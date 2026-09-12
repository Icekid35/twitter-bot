import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/database/store.js";
import { Worker } from "../server/automation/worker.js";
import { parseFeed, feedAddress } from "../server/monitoring/rss.js";
import {
  normalizeHandle,
  parseMirror,
} from "../server/services/verification.js";
import { isPublicAddress, download } from "../server/utils/network.js";
import type { Post, Generation } from "../shared/schema.js";
function setup() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "signaldesk-test-"));
  const store = new Store(dir);
  const account = store.addAccount("alice", {
    displayName: "Alice",
    avatar: "",
    bio: "",
    url: "https://x.com/alice",
    verified: false,
    verification: "valid",
  });
  store.patchAccount(account.id, { addedAt: "2020-01-01T00:00:00.000Z" });
  return {
    store,
    account: store.account(account.id)!,
    dir,
    cleanup: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
function post(id: string, date = new Date().toISOString()): Post {
  return {
    id,
    author: "alice",
    text: "A specific post about testing software.",
    url: `https://x.com/alice/status/${id}`,
    publishedAt: date,
    type: "original",
    media: [],
  };
}
const generation: Generation = {
  text: "A useful distinction to test.",
  context: "safe",
  mediaStatus: "text-only",
  mediaErrors: [],
  tokens: 10,
  model: "test",
  duration: 1,
};
test("baseline skips all current posts, excludes old pinned posts, and persists stable IDs", () => {
  const f = setup();
  try {
    assert.deepEqual(f.store.observe(f.account, [post("1")], false), []);
    f.store.patchAccount(f.account.id, {
      baselineAt: "2021-01-01T00:00:00.000Z",
    });
    const ids = f.store.observe(
      f.store.account(f.account.id)!,
      [post("1"), post("2", "2020-12-31T00:00:00Z"), post("3")],
      false,
    );
    assert.equal(ids.length, 1);
    assert.equal(f.store.activity(ids[0])?.post.id, "3");
    const reopened = new Store(f.dir);
    assert.equal(reopened.state.observations.length, 3);
    assert.equal(
      reopened.observe(reopened.account(f.account.id)!, [post("3")], false)
        .length,
      0,
    );
    reopened.close();
  } finally {
    f.cleanup();
  }
});
test("JSON encrypted secrets never contain plaintext; tampering fails closed", () => {
  const f = setup();
  try {
    f.store.saveSecret("cookies", "SECRET_AUTH_TOKEN");
    const raw = readFileSync(path.join(f.dir, "state.json"), "utf8");
    assert.ok(!raw.includes("SECRET_AUTH_TOKEN"));
    assert.equal(f.store.secret("cookies"), "SECRET_AUTH_TOKEN");
    assert.equal(statSync(path.join(f.dir, "state.json")).mode & 0o777, 0o600);
    assert.ok(JSON.parse(raw).secrets.cookies);
    assert.throws(() => f.store.vault.decrypt("corrupt"));
    writeFileSync(path.join(f.dir, "state.json"), "{ broken");
    assert.throws(() => new Store(f.dir), /unreadable/);
  } finally {
    f.cleanup();
  }
});
test("reservations survive restart and never repeat uncertain actions", () => {
  const f = setup();
  try {
    const id = f.store.reserve("me", "123", "reply", "hello");
    assert.equal(typeof id, "number");
    assert.equal(f.store.reserve("me", "123", "reply", "hello"), null);
    const reopened = new Store(f.dir);
    assert.equal(reopened.state.actions[0].status, "uncertain");
    assert.equal(reopened.reserve("me", "123", "reply", "hello"), null);
    assert.equal(reopened.getMeta("paused", false), true);
    reopened.close();
  } finally {
    f.cleanup();
  }
});
test("action budget counts pending and uncertain attempts", () => {
  const f = setup();
  try {
    f.store.setMeta("settings", { ...f.store.settings(), likesPerHour: 1 });
    assert.equal(typeof f.store.reserve("me", "1", "like", null), "number");
    assert.equal(f.store.reserve("me", "2", "like", null), "limited");
    assert.equal(f.store.state.actions.length, 1);
  } finally {
    f.cleanup();
  }
});
test("filters skip replies, reposts, unknowns and paused observations", () => {
  const f = setup();
  try {
    f.store.patchAccount(f.account.id, { baselineAt: "2021-01-01T00:00:00Z" });
    const a = f.store.account(f.account.id)!;
    assert.deepEqual(
      f.store.observe(
        a,
        [
          { ...post("1"), type: "reply" },
          { ...post("2"), type: "repost" },
          { ...post("3"), type: "unknown" },
        ],
        false,
      ),
      [],
    );
    assert.deepEqual(f.store.observe(a, [post("4")], true), []);
    assert.equal(
      f.store.state.observations.at(-1)?.reason,
      "Observed while actions paused",
    );
  } finally {
    f.cleanup();
  }
});
test("worker uses RSS monitor, never browser scanning, and deduplicates queue entries", async () => {
  const f = setup();
  try {
    let scans = 0,
      actions = 0;
    const worker = new Worker(
      f.store,
      {
        act: async () => {
          actions++;
          return { url: "" };
        },
      },
      { generate: async () => generation },
      {
        scan: async () => {
          scans++;
          return [post("1")];
        },
      },
      0,
    );
    f.store.setMeta("settings", {
      ...f.store.settings(),
      readOnlyWhenPaused: true,
    });
    worker.enqueue(f.account.id);
    worker.enqueue(f.account.id);
    assert.equal(f.store.state.jobs.length, 1);
    await Promise.all([worker.drain(), worker.drain()]);
    assert.equal(scans, 1);
    assert.equal(actions, 0);
    assert.equal(f.store.state.jobs[0].status, "completed");
    assert.ok(f.store.account(f.account.id)?.baselineAt);
  } finally {
    f.cleanup();
  }
});
test("reply generation failure does not prevent independently successful likes", async () => {
  const f = setup();
  try {
    f.store.patchAccount(f.account.id, { baselineAt: "2021-01-01T00:00:00Z" });
    f.store.updateAccount(f.account.id, {
      ...f.account.settings,
      reply: true,
      like: true,
    });
    f.store.setMeta("session", {
      status: "valid",
      username: "me",
      checkedAt: null,
      message: "",
    });
    f.store.setMeta("paused", false);
    const [id] = f.store.observe(
      f.store.account(f.account.id)!,
      [post("99")],
      false,
    );
    let calls = 0;
    const worker = new Worker(
      f.store,
      {
        act: async (_p, type, _text, permit) => {
          assert.equal(type, "like");
          assert.ok(permit());
          calls++;
          return { url: "https://x.com/alice/status/99" };
        },
      },
      {
        generate: async () => {
          throw new Error("provider unavailable");
        },
      },
      { scan: async () => [] },
      0,
    );
    assert.equal(await worker.process(id), true);
    assert.equal(calls, 1);
    assert.deepEqual(
      f.store.state.actions.map((a) => a.status),
      ["failed", "succeeded"],
    );
    await worker.process(id);
    assert.equal(calls, 1);
  } finally {
    f.cleanup();
  }
});
test("pause during generation prevents any browser mutation", async () => {
  const f = setup();
  try {
    f.store.patchAccount(f.account.id, { baselineAt: "2021-01-01T00:00:00Z" });
    f.store.updateAccount(f.account.id, {
      ...f.account.settings,
      reply: true,
      like: true,
    });
    f.store.setMeta("session", {
      status: "valid",
      username: "me",
      checkedAt: null,
      message: "",
    });
    f.store.setMeta("paused", false);
    const [id] = f.store.observe(
      f.store.account(f.account.id)!,
      [post("99")],
      false,
    );
    const worker = new Worker(
      f.store,
      {
        act: async () => {
          assert.fail("must not act");
        },
      },
      {
        generate: async () => {
          f.store.setMeta("paused", true);
          return generation;
        },
      },
      { scan: async () => [] },
      0,
    );
    await worker.process(id);
    assert.equal(f.store.state.actions[0].status, "skipped");
    assert.equal(f.store.state.actions.length, 1);
  } finally {
    f.cleanup();
  }
});
test("unconfirmed browser submission is uncertain and never automatically retried", async () => {
  const f = setup();
  try {
    f.store.patchAccount(f.account.id, { baselineAt: "2021-01-01T00:00:00Z" });
    f.store.updateAccount(f.account.id, { ...f.account.settings, like: true });
    f.store.setMeta("session", {
      status: "valid",
      username: "me",
      checkedAt: null,
      message: "",
    });
    f.store.setMeta("paused", false);
    const [id] = f.store.observe(
      f.store.account(f.account.id)!,
      [post("99")],
      false,
    );
    let calls = 0;
    const worker = new Worker(
      f.store,
      {
        act: async () => {
          calls++;
          throw new Error("network lost");
        },
      },
      { generate: async () => generation },
      { scan: async () => [] },
      0,
    );
    await worker.process(id);
    await worker.process(id);
    assert.equal(calls, 1);
    assert.equal(f.store.state.actions[0].status, "uncertain");
  } finally {
    f.cleanup();
  }
});
test("Nitter RSS parses IDs, dates, images, replies and reposts", () => {
  const xml = `<rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>Alice / @alice</title><item><title>Original</title><dc:creator>@alice</dc:creator><link>https://mirror.example/alice/status/123#m</link><pubDate>Sun, 06 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Actual content</p><img src="https://mirror.example/pic/pbs.twimg.com%2Fmedia%2Fphoto.jpg"/>]]></description></item><item><title>R to @bob: reply</title><link>https://mirror.example/alice/status/124</link><pubDate>Sun, 06 Sep 2026 10:01:00 GMT</pubDate><description>Reply</description></item><item><title>RT by @alice: text</title><link>https://mirror.example/bob/status/125</link><pubDate>Sun, 06 Sep 2026 10:02:00 GMT</pubDate><description>RT</description></item></channel></rss>`;
  const posts = parseFeed(xml, "alice");
  assert.equal(posts.length, 3);
  assert.deepEqual(
    posts.map((p) => p.type),
    ["original", "reply", "repost"],
  );
  assert.equal(posts[0].url, "https://x.com/alice/status/123");
  assert.equal(posts[0].media[0].url, "https://pbs.twimg.com/media/photo.jpg");
  assert.throws(
    () => parseFeed("<html>Rate limited</html>", "alice"),
    /instead of an RSS/,
  );
  assert.equal(
    feedAddress("https://rss.example", "rsshub", "alice"),
    "https://rss.example/twitter/user/alice",
  );
});
test("account verification distinguishes invalid handles, outage, suspension and valid profiles", () => {
  assert.equal(normalizeHandle(" @Alice "), "alice");
  assert.throws(() => normalizeHandle("bad name"));
  assert.throws(
    () => parseMirror("<html>maintenance</html>", "alice"),
    /recognizable profile/,
  );
  assert.throws(
    () =>
      parseMirror('<div class="error-panel">Account suspended</div>', "alice"),
    /suspended/,
  );
  const profile = parseMirror(
    '<div class="profile-card"><span class="profile-card-username">@alice</span><span class="profile-card-fullname">Alice</span></div>',
    "alice",
  );
  assert.equal(profile.displayName, "Alice");
});
test("network boundaries reject local destinations and non-HTTPS protocols", async () => {
  assert.equal(isPublicAddress("127.0.0.1"), false);
  assert.equal(isPublicAddress("192.168.1.2"), false);
  assert.equal(isPublicAddress("::1"), false);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  await assert.rejects(download("http://example.com"));
  await assert.rejects(download("https://127.0.0.1"));
});
test("Nitter video thumbnails are never mistaken for complete video context", () => {
  const xml =
    '<rss><channel><title>Alice / @alice</title><item><title>Video</title><link>https://mirror.example/alice/status/555</link><pubDate>Sun, 06 Sep 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Watch this</p><a href="https://mirror.example/alice/status/555"><br>Video<br><img src="https://pbs.twimg.com/media/thumb.jpg"/></a>]]></description></item></channel></rss>';
  assert.ok(parseFeed(xml, "alice")[0].media.some((m) => m.type === "video"));
});
test("JSON write failures stop subsequent mutations and pause actions", () => {
  const f = setup();
  try {
    f.store.setMeta("paused", false);
    writeFileSync(path.join(f.dir, "blocker"), "x"); // Simulate the temp-file path being unusable, without modifying the primary JSON.
    mkdirSync(path.join(f.dir, "state.json.tmp"));
    assert.throws(() => f.store.reserve("me", "1", "like", null), /storage/);
    assert.equal(f.store.getMeta("paused", false), true);
    assert.ok(f.store.fault);
    assert.equal(f.store.state.actions.length, 0);
    assert.throws(() => f.store.setMeta("paused", false), /storage/);
  } finally {
    f.cleanup();
  }
});
test("live Nitter relative CDN paths resolve to HTTPS media without fetching the mirror", async () => {
  const { mediaSource } = await import("../server/utils/media.js");
  assert.equal(
    mediaSource(
      "http://nitter.meowing.monster/pic/media%2FHRfFqg4XsAEX_hi.png",
    ),
    "https://pbs.twimg.com/media/HRfFqg4XsAEX_hi.png",
  );
  assert.equal(
    mediaSource("/pic/card_img%2F123%2Fcover%3Fformat%3Dpng"),
    "https://pbs.twimg.com/card_img/123/cover?format=png",
  );
  assert.equal(
    mediaSource("/pic/profile_images%2F123%2Favatar.jpg"),
    "https://pbs.twimg.com/profile_images/123/avatar.jpg",
  );
  assert.equal(
    mediaSource("https://attacker.example/internal"),
    "https://attacker.example/internal",
  );
});

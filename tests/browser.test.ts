import { browserExecutable } from "../server/browser/executable.js";
import test from "node:test";
import assert from "node:assert/strict";
import puppeteer from "puppeteer";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/database/store.js";
import { XBrowser } from "../server/browser/x-browser.js";
import type { Post } from "../shared/schema.js";
test("browser fixtures confirm targeted likes, reposts, replies and challenge stop without contacting X", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "signaldesk-browser-")),
    store = new Store(dir);
  store.setMeta("settings", {timeout: 15000});
  const chrome = await puppeteer.launch({
    headless: true,
    executablePath: await browserExecutable(),
  });
  const page = await chrome.newPage();
  page.setDefaultTimeout(2500);
  await page.setRequestInterception(true);
  let mode = "normal";
  let submissions = 0;
  page.on("request", (request) => {
    if (request.url().includes("/CreateRetweet")) {
      void request.respond({status: 200, contentType: "application/json", body: JSON.stringify(mode === "rejected" ? {errors: [{code: 226, message: "This request was rejected."}]} : {data: {create_retweet: {retweet_results: {result: {rest_id: "888"}}}}})});
      return;
    }
    if (request.url().includes("/CreateTweet")) {
      submissions++;
      void request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            create_tweet: { tweet_results: { result: { rest_id: "999" } } },
          },
        }),
      });
      return;
    }
    void request.respond({
      status: 200,
      contentType: "text/html",
      body: `<html><head><style>@keyframes menuEnter {from {transform: translateX(150px)} to {transform: translateX(0)}}</style></head><body><button data-testid="SideNav_AccountSwitcher_Button">Account</button><a data-testid="AppTabBar_Profile_Link" href="/me">Profile</a>${mode === "challenge" ? "<div>Verify your identity</div>" : ""}<article data-testid="tweet"><a href="/other/status/1"><time>Old</time></a><button data-testid="like" onclick="window.wrong=true">Other like</button></article><article data-testid="tweet"><a href="/alice/status/123"><time>Now</time></a><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/test.jpg"></div><video src="https://video.twimg.com/test.mp4"></video><button data-testid="like" onclick="this.dataset.testid='unlike'">Like</button><button data-testid="retweet" onclick="const menu=document.getElementById('confirm');menu.hidden=false;menu.style.animation='menuEnter 0.4s linear';menu.style.pointerEvents='none';menu.onanimationend=()=>menu.style.pointerEvents='auto'">Repost</button><button data-testid="reply" onclick="document.getElementById('reply').hidden=false">Reply</button></article><button id="confirm" hidden role="menuitem" onclick="fetch('/i/api/graphql/mock/CreateRetweet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variables:{tweet_id:'123'}})});this.hidden=true">Repost</button><div id="reply" hidden role="dialog"><div contenteditable="true" data-testid="tweetTextarea_0"></div><button data-testid="tweetButton" onclick="fetch('/i/api/graphql/mock/CreateTweet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({variables:{tweet_text:document.querySelector('[contenteditable]').textContent,reply:{in_reply_to_tweet_id:'123'}}})})">Post</button></div></body></html>`,
    });
  });
  const adapter = new XBrowser(store);
  (adapter as unknown as { page: typeof page }).page = page;
  const post: Post = {
    id: "123",
    author: "alice",
    text: "Test",
    url: "https://x.com/alice/status/123",
    publishedAt: new Date().toISOString(),
    type: "original",
    media: [],
  };
  try {
    const session = await adapter.testSession();
    assert.equal(session.username, "me");
    const scanned = await adapter.scanPosts("alice");
    const mediaPost = scanned.find((p) => p.id === "123")!;
    assert.deepEqual(mediaPost.media.map((m) => m.type), ["image", "video"]);
    await adapter.act(post, "like", undefined, () => true);
    assert.ok(await page.$('[data-testid="unlike"]'));
    assert.equal(
      await page.evaluate(() => Boolean((window as any).wrong)),
      false,
    );
    await adapter.act(post, "repost", undefined, () => true);
    assert.equal(await page.$('[data-testid="unretweet"]'), null); // Server confirmation works even when UI stays stale.
    mode = "rejected";
    await assert.rejects(adapter.act(post, "repost", undefined, () => true), /X rejected the repost \(code 226\)/);
    mode = "normal";
    const reply = await adapter.act(
      post,
      "reply",
      "A specific response",
      () => true,
    );
    assert.equal(reply.url, "https://x.com/me/status/999");
    assert.equal(submissions, 1);
    await assert.rejects(
      adapter.act(post, "like", undefined, () => false),
      /stopped/,
    );
    mode = "challenge";
    await assert.rejects(
      adapter.act(post, "like", undefined, () => true),
      /verification/,
    );
    assert.equal(store.getMeta("paused", false), true);
    assert.equal(store.session().status, "challenge");
  } finally {
    await chrome.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { Store } from "../server/database/store.js";
import { XBrowser } from "../server/browser/x-browser.js";
import { Gemini } from "../server/ai/gemini.js";
import { Worker } from "../server/automation/worker.js";
import { RSSMonitor } from "../server/monitoring/rss.js";
import { api } from "../server/routes/api.js";
import { AppError } from "../server/utils/errors.js";
import { ZodError } from "zod";
test("API validates settings, preserves imports atomically, and never reads secrets back", async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "signaldesk-api-"));
  const store = new Store(dir),
    browser = new XBrowser(store),
    ai = new Gemini(store),
    worker = new Worker(store, browser, ai, new RSSMonitor(store));
  const app = express();
  app.use(express.json());
  app.use("/api", api(store, browser, ai, worker));
  app.use(
    (
      e: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(
          e instanceof ZodError ? 400 : e instanceof AppError ? e.status : 500,
        )
        .json({ error: "Request failed" });
    },
  );
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  const call = (url: string, method = "GET", data?: unknown) =>
    fetch(base + url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  try {
    assert.equal(
      (await call("/settings", "PATCH", { interval: 0.1 })).status,
      400,
    );
    assert.equal(
      (await call("/settings", "PATCH", { interval: 0.5 })).status,
      200,
    );
    assert.equal(store.settings().interval, 0.5);
    await call("/settings", "PATCH", { interval: 10 });
    assert.equal(store.settings().interval, 10);
    assert.equal(
      (await call("/settings/gemini-key", "PUT", { key: "private-key-123456" }))
        .status,
      200,
    );
    const settings = await (await call("/settings")).text();
    assert.ok(settings.includes("geminiConfigured"));
    assert.ok(!settings.includes("private-key"));
    assert.equal(
      (
        await call("/session", "PUT", {
          cookies: [{ name: "auth_token", value: "private-cookie" }],
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await call("/session", "PUT", {
          cookies: [
            {
              name: "auth_token",
              value: "private-cookie-2",
              sameSite: "no_restriction",
              expirationDate: 1789069651.601831,
              id: 1,
            },
            {
              name: "ct0",
              value: "ct0-val",
              sameSite: "unspecified",
              id: 2,
            },
          ],
        })
      ).status,
      200,
    );
    assert.ok(
      !(await (await call("/session")).text()).includes("private-cookie"),
    );
    const before = store.settings();
    assert.equal(
      (
        await call("/settings/import", "POST", {
          version: 1,
          settings: { ...before, interval: 20 },
          accounts: [{ username: "invalid handle", settings: {} }],
        })
      ).status,
      400,
    );
    assert.equal(store.settings().interval, 10);
    assert.ok(
      !(await (await call("/settings/export")).text()).includes("private-key"),
    );
    assert.equal((await call("/automation/start", "POST")).status, 409);
    const a = store.addAccount("alice", {
      displayName: "Alice",
      avatar: "",
      bio: "",
      url: "https://x.com/alice",
      verified: false,
      verification: "valid",
    });
    assert.equal(
      (await call(`/accounts/${a.id}/settings`, "PATCH", { reply: true }))
        .status,
      200,
    );
    assert.equal(store.account(a.id)?.settings.reply, true);
    await call(`/accounts/${a.id}`, "DELETE");
    assert.equal(store.accounts().length, 0);
    assert.equal(store.state.accounts.length, 1);
    assert.equal((await (await call("/history")).json()).total, 0);
    assert.equal((await (await call("/stats")).json()).tracked, 0);

    // Verify session persistence in x-session.json and across store restarts
    const sessionFile = path.join(dir, "x-session.json");
    assert.ok(existsSync(sessionFile));
    store.setMeta("session", {
      status: "valid",
      username: "myuser",
      checkedAt: "2026-09-10T12:00:00Z",
      message: "Session verified with X.",
    });
    // A destructive reset must wait for existing work, reject unconfirmed calls,
    // preserve configuration/credentials, and sanitize both JSON snapshots.
    assert.equal((await call("/system/clear-data", "POST", {})).status, 400);
    const savedSettings = store.settings();
    const savedSecrets = structuredClone(store.state.secrets);
    const sequence = store.state.sequence;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const inFlight = worker.exclusive(() => barrier);
    store.setMeta("paused", false);
    const resetting = call("/system/clear-data", "POST", {confirmation: "clear-data"});
    try {
      for (let i = 0; i < 100 && !store.getMeta("paused", false); i++)
        await new Promise(resolve => setTimeout(resolve, 5));
      assert.equal(store.getMeta("paused", false), true);
      assert.equal(store.state.accounts.length, 1);
      assert.equal((await call("/settings", "PATCH", {interval: 20})).status, 409);
    } finally { release(); }
    await inFlight;
    assert.equal((await resetting).status, 200);
    assert.deepEqual(store.settings(), savedSettings);
    assert.deepEqual(store.state.secrets, savedSecrets);
    assert.equal(store.state.sequence, sequence);
    for (const file of ["state.json", "state.json.bak"]) {
      const snapshot = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
      for (const collection of ["accounts", "observations", "actions", "jobs", "scans", "logs"])
        assert.equal(snapshot[collection].length, 0);
    }
    // Restart store instance
    const reloadedStore = new Store(dir);
    assert.equal(reloadedStore.session().status, "valid");
    assert.equal(reloadedStore.session().username, "myuser");
    assert.ok(reloadedStore.session().configured);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

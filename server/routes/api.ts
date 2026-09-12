import { RSSMonitor, verifyFeed } from "../monitoring/rss.js";
import { stats } from "../services/reporting.js";
import { Router } from "express";
import { z } from "zod";
import { accountSettingsSchema, settingsSchema } from "../../shared/schema.js";
import type { Store } from "../database/store.js";
import type { XBrowser } from "../browser/x-browser.js";
import type { Gemini } from "../ai/gemini.js";
import type { Worker } from "../automation/worker.js";
import { normalizeHandle, verifyMirror } from "../services/verification.js";
import { AppError, now } from "../utils/errors.js";
const idSchema = z.coerce.number().int().positive();
const pageSchema = z.coerce.number().int().min(1).max(100000).default(1);
export function api(
  store: Store,
  browser: XBrowser,
  ai: Gemini,
  worker: Worker,
) {
  const router = Router();
  let clearing = false;
  router.use((req, _res, next) => {
    if (clearing && !["GET", "HEAD"].includes(req.method))
      return next(new AppError("CLEARING", "Data is being cleared. Wait for it to finish.", 409));
    next();
  });
  router.post("/system/clear-data", async (req, res) => {
    z.object({confirmation: z.literal("clear-data")}).strict().parse(req.body);
    clearing = true;
    try {
      store.setMeta("paused", true);
      await worker.exclusive(async () => {
        await browser.close();
        store.clearData();
      });
      res.json({cleared: true, paused: true});
    } finally { clearing = false; }
  });
  router.post("/monitoring/test", async (req, res) => {
    const username = normalizeHandle(
      z.object({ username: z.string().max(100) }).parse(req.body).username,
    );
    const posts = await new RSSMonitor(store, browser).scan(username);
    res.json({
      count: posts.length,
      latest:
        posts.toSorted(
          (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
        )[0]?.publishedAt || null,
      message:
        "Feed read successfully. No state changed and no actions performed.",
    });
  });
  router.get("/health", (_req, res) =>
    res.json({ ok: true, version: "1.0.0", pid: process.pid }),
  );
  router.get("/accounts", (_req, res) => res.json(store.accounts()));
  router.post("/accounts", async (req, res) => {
    const { username: input } = z
      .object({ username: z.string().max(100) })
      .strict()
      .parse(req.body);
    const username = normalizeHandle(input);
    if (store.accounts().some((a) => a.username === username))
      throw new AppError("DUPLICATE", "This account is already tracked.", 409);
    const settings = store.settings();
    const profile = await worker.exclusive(() =>
      settings.verificationProvider === "x"
        ? browser.verify(username)
        : settings.verificationProvider === "rss"
          ? verifyFeed(store, username)
          : verifyMirror(username, settings.mirrorUrl, settings.timeout),
    );
    if (store.accounts().some((a) => a.username === username))
      throw new AppError("DUPLICATE", "This account is already tracked.", 409);
    const account = store.addAccount(username, profile);
    store.log(
      "SUCCESS",
      `Added @${username}; initial scan will establish a baseline`,
      account.id,
    );
    res.status(201).json(account);
  });
  router.get("/accounts/:id", (req, res) => {
    const account = store.account(idSchema.parse(req.params.id));
    if (!account) throw new AppError("NOT_FOUND", "Account not found.", 404);
    res.json(account);
  });
  router.get("/accounts/:id/stats", (req, res) => {
    const id = idSchema.parse(req.params.id);
    if (!store.account(id))
      throw new AppError("NOT_FOUND", "Account not found.", 404);
    const observations = store.state.observations.filter(
      (o) => o.accountId === id,
    );
    const ids = new Set(observations.map((o) => o.post.id));
    const actions = store.state.actions.filter((a) => ids.has(a.postId));
    const succeeded = actions.filter((a) => a.status === "succeeded");
    const failed = actions.filter((a) =>
      ["failed", "uncertain"].includes(a.status),
    );
    res.json({
      posts: observations.filter((o) => !o.reason).length,
      reply: succeeded.filter((a) => a.type === "reply").length,
      like: succeeded.filter((a) => a.type === "like").length,
      repost: succeeded.filter((a) => a.type === "repost").length,
      successRate:
        succeeded.length + failed.length
          ? Math.round(
              (succeeded.length / (succeeded.length + failed.length)) * 100,
            )
          : null,
    });
  });
  router.patch("/accounts/:id/settings", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const account = store.account(id);
    if (!account) throw new AppError("NOT_FOUND", "Account not found.", 404);
    const patch = accountSettingsSchema.partial().parse(req.body);
    store.updateAccount(
      id,
      accountSettingsSchema.parse({ ...account.settings, ...patch }),
    );
    res.json(store.account(id));
  });
  router.delete("/accounts/:id", (req, res) => {
    const id = idSchema.parse(req.params.id);
    store.mutate((s) => {
      const a = s.accounts.find((a) => a.id === id);
      if (a) a.removed = true;
      for (const j of s.jobs)
        if (j.accountId === id && j.status === "queued") {
          j.status = "skipped";
          j.completedAt = now();
        }
    });
    store.log(
      "INFO",
      "Tracked account removed; duplicate protection retained",
      id,
    );
    res.json({ ok: true });
  });
  router.post("/accounts/:id/scan", (req, res) => {
    if (store.getMeta("paused", true) && !store.settings().readOnlyWhenPaused)
      throw new AppError(
        "PAUSED",
        "Resume automation or enable read-only monitoring before scanning.",
        409,
      );
    worker.enqueue(idSchema.parse(req.params.id));
    res.status(202).json({ queued: true });
  });
  router.get("/settings", (_req, res) =>
    res.json({
      ...store.settings(),
      geminiConfigured: !!(
        store.secret("gemini") || process.env.GEMINI_API_KEY
      ),
    }),
  );
  router.patch("/settings", (req, res) => {
    const patch = settingsSchema.partial().parse(req.body);
    const next = settingsSchema.parse({ ...store.settings(), ...patch });
    store.setMeta("settings", next);
    store.log("INFO", "Settings updated");
    res.json({
      ...next,
      geminiConfigured: !!(
        store.secret("gemini") || process.env.GEMINI_API_KEY
      ),
    });
  });
  router.get("/settings/export", (_req, res) => {
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="signaldesk-settings.json"',
    );
    res.json({
      version: 1,
      settings: store.settings(),
      accounts: store
        .accounts()
        .map((a) => ({ username: a.username, settings: a.settings })),
    });
  });
  router.post("/settings/import", (req, res) => {
    const data = z
      .object({
        version: z.literal(1),
        settings: settingsSchema,
        accounts: z
          .array(
            z.object({ username: z.string(), settings: accountSettingsSchema }),
          )
          .max(500)
          .optional(),
      })
      .strict()
      .parse(req.body);
    const accounts = (data.accounts || []).map((a) => ({
      ...a,
      username: normalizeHandle(a.username),
    }));
    store.mutate((s) => {
      s.meta.paused = true;
      s.meta.settings = data.settings;
      for (const account of accounts) {
        const existing = s.accounts.find(
          (a) => !a.removed && a.username === account.username,
        );
        if (existing) existing.settings = account.settings;
      }
    });
    store.log("WARNING", "Configuration imported; automation paused");
    res.json({
      ok: true,
      message:
        "Settings imported. Account settings updated for existing verified accounts only.",
    });
  });
  router.put("/settings/gemini-key", (req, res) => {
    const { key } = z
      .object({ key: z.string().trim().min(10).max(300) })
      .strict()
      .parse(req.body);
    store.saveSecret("gemini", key);
    res.json({ configured: true });
  });
  router.post("/ai/preview", async (req, res) => {
    const input = z
      .object({
        text: z.string().min(1).max(12000),
        prompt: z.string().max(8000).optional(),
        image: z
          .object({
            mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
            data: z
              .string()
              .max(7_000_000)
              .regex(/^[A-Za-z0-9+/]+={0,2}$/),
          })
          .optional(),
      })
      .strict()
      .parse(req.body);
    const generation = await ai.generate(
      {
        id: "preview",
        author: "sample",
        text: input.text,
        url: "",
        publishedAt: now(),
        type: "original",
        media: [],
      },
      input.prompt,
      input.image,
    );
    res.json(generation);
  });
  router.get("/session", (_req, res) => res.json(store.session()));
  router.put("/session", async (req, res) => {
    const rawCookie = z
      .object({
        name: z.string().min(1).max(100),
        value: z.string().min(1).max(10000),
        domain: z.string().optional(),
        path: z.string().optional(),
        secure: z.boolean().optional(),
        httpOnly: z.boolean().optional(),
        sameSite: z.unknown().optional(),
        expires: z.number().optional(),
        expirationDate: z.number().optional(),
      })
      .passthrough()
      .transform((c) => {
        let sameSite: "Strict" | "Lax" | "None" | undefined = undefined;
        if (typeof c.sameSite === "string") {
          const lower = c.sameSite.toLowerCase();
          if (lower === "strict") sameSite = "Strict";
          else if (lower === "lax") sameSite = "Lax";
          else if (lower === "none" || lower === "no_restriction")
            sameSite = "None";
        }
        return {
          name: c.name,
          value: c.value,
          domain:
            c.domain && [".x.com", "x.com", ".twitter.com", "twitter.com"].includes(c.domain)
              ? c.domain
              : ".x.com",
          path: c.path === "/" ? "/" : "/",
          secure: typeof c.secure === "boolean" ? c.secure : true,
          httpOnly: typeof c.httpOnly === "boolean" ? c.httpOnly : true,
          sameSite,
          expires: c.expires ?? (c.expirationDate ? Math.round(c.expirationDate) : undefined),
        };
      });
    const { cookies } = z
      .object({ cookies: z.array(rawCookie).min(1).max(50) })
      .passthrough()
      .parse(req.body);
    if (!cookies.some((c) => c.name === "auth_token"))
      throw new AppError(
        "COOKIES",
        "Cookies must include auth_token from your own X session.",
      );
    store.setMeta("paused", true);
    await worker.exclusive(async () => {
      await browser.close();
      store.saveSecret(
        "cookies",
        JSON.stringify(
          cookies.map((c) => ({ ...c, domain: ".x.com", secure: true })),
        ),
      );
      store.setMeta("session", {
        status: "reauthentication_required",
        username: null,
        checkedAt: null,
        message: "Credentials saved. Test the session before resuming.",
      });
    });
    res.json(store.session());
  });
  router.post("/session/test", async (_req, res) => {
    if (!store.session().configured)
      throw new AppError(
        "SESSION",
        "Save X cookies before testing the session.",
      );
    res.json(await worker.exclusive(() => browser.testSession()));
  });
  router.post("/automation/start", (_req, res) => {
    if (!store.settings().feedUrl && !store.settings().mirrorUrl)
      throw new AppError(
        "FEED_REQUIRED",
        "Configure an RSS feed source in System Settings before starting.",
        409,
      );
    if (store.session().status !== "valid")
      throw new AppError(
        "SESSION",
        "A verified X session is required before starting.",
        409,
      );
    if (
      store.accounts().some((a) => a.settings.reply) &&
      !(store.secret("gemini") || process.env.GEMINI_API_KEY)
    )
      throw new AppError(
        "GEMINI_KEY",
        "Configure Gemini before enabling automated replies.",
        409,
      );
    store.setMeta("paused", false);
    for (const account of store.accounts()) {
      if (account.settings.monitoring) {
        store.patchAccount(account.id, { nextScan: now() });
        worker.enqueue(account.id);
      }
    }
    void worker.drain();
    store.log("SUCCESS", "Automation resumed");
    res.json({ paused: false });
  });
  router.post("/automation/pause", (_req, res) => {
    store.setMeta("paused", true);
    store.mutate((s) => {
      for (const o of s.observations)
        if (["pending", "limited"].includes(o.status)) {
          o.status = "skipped";
          o.reason = "Paused by operator";
        }
    });
    store.log("WARNING", "Automation paused by operator");
    res.json({ paused: true });
  });
  router.get("/automation/status", (_req, res) =>
    res.json({
      paused: store.getMeta("paused", true),
      storageError: store.fault,
      busy: worker.busy,
      interval: store.settings().interval,
      session: store.session(),
      nextScan:
        store
          .accounts()
          .filter((a) => a.settings.monitoring)
          .sort((a, b) => a.nextScan.localeCompare(b.nextScan))[0]?.nextScan ||
        null,
      lastScan: store.state.scans.at(-1) || null,
      jobs: store.state.jobs
        .slice(-20)
        .reverse()
        .map((j) => ({
          ...j,
          username: store.state.accounts.find((a) => a.id === j.accountId)
            ?.username,
        })),
    }),
  );
  router.get("/history", (req, res) => {
    const page = pageSchema.parse(req.query.page);
    const account = req.query.account
      ? idSchema.parse(req.query.account)
      : null;
    const from = req.query.from
      ? z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(req.query.from)
      : null;
    const to = req.query.to
      ? z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .parse(req.query.to)
      : null;
    const type = req.query.type
      ? z
          .enum(["original", "reply", "repost", "quote", "unknown"])
          .parse(req.query.type)
      : null;
    const action = req.query.action
      ? z.enum(["reply", "like", "repost"]).parse(req.query.action)
      : null;
    const status = req.query.status
      ? z
          .enum(["succeeded", "failed", "uncertain", "skipped"])
          .parse(req.query.status)
      : null;
    const rows = store.state.observations
      .filter(
        (o) =>
          (!account || o.accountId === account) &&
          (!from || o.detectedAt >= from) &&
          (!to || o.detectedAt.slice(0, 10) <= to) &&
          (!type || o.post.type === type) &&
          (!(action || status) ||
            store.state.actions.some(
              (a) =>
                a.postId === o.post.id &&
                (!action || a.type === action) &&
                (!status || a.status === status),
            )),
      )
      .toReversed();
    res.json({
      items: rows
        .slice((page - 1) * 25, page * 25)
        .map((r) => store.activity(r.id)),
      total: rows.length,
      page,
      pages: Math.ceil(rows.length / 25),
    });
  });
  router.get("/history/:id", (req, res) => {
    const activity = store.activity(idSchema.parse(req.params.id));
    if (!activity) throw new AppError("NOT_FOUND", "Activity not found.", 404);
    res.json({
      ...activity,
      logs: store.state.logs.filter((l) => l.postId === activity.post.id),
    });
  });
  router.post("/actions/:id/resolve", (req, res) => {
    const id = idSchema.parse(req.params.id);
    const { status } = z
      .object({ status: z.enum(["succeeded", "failed"]) })
      .strict()
      .parse(req.body);
    if (store.state.actions.find((a) => a.id === id)?.status !== "uncertain")
      throw new AppError(
        "STATE",
        "Only uncertain actions can be resolved.",
        409,
      );
    store.finishAction(id, status, "Manually reconciled by operator");
    store.log("INFO", "Uncertain action manually reconciled");
    res.json({ ok: true });
  });
  router.get("/logs", (req, res) => {
    const page = pageSchema.parse(req.query.page);
    const level = req.query.level
      ? z.enum(["INFO", "SUCCESS", "WARNING", "ERROR"]).parse(req.query.level)
      : null;
    const account = req.query.account
      ? idSchema.parse(req.query.account)
      : null;
    const rows = store.state.logs
      .filter(
        (l) =>
          (!level || l.level === level) &&
          (!account || l.accountId === account),
      )
      .toReversed();
    res.json({
      items: rows.slice((page - 1) * 50, page * 50),
      total: rows.length,
      page,
      pages: Math.ceil(rows.length / 50),
    });
  });
  router.get("/stats", (_req, res) => res.json(stats(store)));
  router.post("/system/retention", (_req, res) => {
    const before = new Date(
      Date.now() - store.settings().retentionDays * 86400000,
    ).toISOString();
    store.mutate((s) => {
      s.logs = s.logs.filter((l) => l.time >= before);
      for (const o of s.observations)
        if (
          o.detectedAt < before &&
          !["pending", "limited"].includes(o.status)
        ) {
          o.generation = null;
          o.post.text = "";
          o.post.media = [];
        }
    });
    res.json({ ok: true });
  });
  return router;
}

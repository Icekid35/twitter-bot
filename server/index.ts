import "./polyfill.js";
import "dotenv/config";
import express from "express";
import helmet from "helmet";
import path from "node:path";
import {
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
  readFileSync,
} from "node:fs";
import { ZodError } from "zod";
import { RSSMonitor } from "./monitoring/rss.js";
import { Store } from "./database/store.js";
import { XBrowser } from "./browser/x-browser.js";
import { Gemini } from "./ai/gemini.js";
import { Worker } from "./automation/worker.js";
import { Scheduler } from "./scheduler/scheduler.js";
import { api } from "./routes/api.js";
import { AppError, safeError } from "./utils/errors.js";
const port = Number(process.env.PORT || 4318);
const dir = path.resolve(process.env.DATA_DIR || "data");
// A lock prevents a second process recovering or dispatching the same durable work.
const { mkdirSync, writeFileSync } = await import("node:fs");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const lock = path.join(dir, "process.lock");
if (existsSync(lock)) {
  const pid = Number(readFileSync(lock, "utf8"));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
  }
  if (alive) {
    try {
      process.kill(pid, "SIGTERM");
      const start = Date.now();
      while (Date.now() - start < 2000) {
        try {
          process.kill(pid, 0);
        } catch {
          alive = false;
          break;
        }
      }
      if (alive) {
        process.kill(pid, "SIGKILL");
      }
    } catch {
      // Process already terminated or unable to kill
    }
  }
  try {
    unlinkSync(lock);
  } catch {}
}
const fd = openSync(lock, "wx", 0o600);
writeFileSync(fd, String(process.pid));
closeSync(fd);
const store = new Store(dir),
  browser = new XBrowser(store),
  ai = new Gemini(store),
  worker = new Worker(store, browser, ai, new RSSMonitor(store, browser)),
  scheduler = new Scheduler(store, worker);
const app = express();
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        "img-src": ["'self'", "data:", "https://pbs.twimg.com"],
        "connect-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "upgrade-insecure-requests": null,
      },
    },
  }),
);
app.use((req, res, next) => {
  const host = req.hostname;
  if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
    res
      .status(403)
      .json({ error: { message: "Only local access is enabled." } });
    return;
  }
  const origin = req.get("origin");
  if (origin) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      res.status(403).end();
      return;
    }
    if (
      ![
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        `http://127.0.0.1:${port}`,
        `http://localhost:${port}`,
      ].includes(url.origin)
    ) {
      res
        .status(403)
        .json({ error: { message: "Request origin is not permitted." } });
      return;
    }
  }
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    req.get("x-signaldesk") !== "1"
  ) {
    res
      .status(403)
      .json({ error: { message: "Missing application request header." } });
    return;
  }
  next();
});
app.use(express.json({ limit: "8mb" }));
app.use("/api", api(store, browser, ai, worker));
app.use("/api", (_req, res) =>
  res.status(404).json({ error: { message: "API endpoint not found." } }),
);
if (existsSync("dist/index.html")) {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
}
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const validation = error instanceof ZodError;
    const status = validation
      ? 400
      : error instanceof AppError
        ? error.status
        : 500;
    const message = validation
      ? `Check your input: ${error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`
      : safeError(error);
    if (!validation) {
      try {
        store.log("ERROR", message);
      } catch {
        console.error("Unable to persist operational log.");
      }
    }
    res.status(status).json({
      error: {
        code: error instanceof AppError ? error.code : "REQUEST_FAILED",
        message,
        retryable: error instanceof AppError && error.retryable,
      },
    });
  },
);
const server = app.listen(port, "127.0.0.1", () => {
  console.info(`Signaldesk is available at http://127.0.0.1:${port}`);
  scheduler.start();
});
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  scheduler.stop();
  store.setMeta("paused", true);
  server.close();
  await worker.exclusive(() => browser.close());
  store.close();
  unlinkSync(lock);
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

// A desktop parent disappearing must not leave automation running invisibly.
if (process.env.SIGNALDESK_DESKTOP === "1") {
  process.stdin.resume();
  process.stdin.on("end", () => void shutdown());
}

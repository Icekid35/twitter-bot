import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  existsSync,
  openSync,
  fsyncSync,
  closeSync,
  copyFileSync,
  chmodSync,
} from "node:fs";
import path from "node:path";
import {
  accountSettingsSchema,
  settingsSchema,
  type Account,
  type AccountSettings,
  type Action,
  type ActionType,
  type Activity,
  type Post,
  type Settings,
  type Session,
} from "../../shared/schema.js";
import { now } from "../utils/errors.js";
import { Vault } from "../utils/secrets.js";
export interface Job {
  id: number;
  accountId: number;
  status: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}
export interface Log {
  id: number;
  time: string;
  level: string;
  message: string;
  accountId: number | null;
  postId: string | null;
}
export interface Scan {
  id: number;
  accountId: number;
  startedAt: string;
  completedAt?: string;
  duration: number;
  error: string | null;
}
export interface State {
  version: 1;
  sequence: number;
  meta: Record<string, unknown>;
  secrets: Record<string, string>;
  accounts: (Account & { removed?: boolean })[];
  observations: Omit<Activity, "actions" | "username">[];
  actions: Action[];
  jobs: Job[];
  scans: Scan[];
  logs: Log[];
}
const empty = (): State => ({
  version: 1,
  sequence: 0,
  meta: {},
  secrets: {},
  accounts: [],
  observations: [],
  actions: [],
  jobs: [],
  scans: [],
  logs: [],
});
export class Store {
  state: State;
  vault: Vault;
  fault: string | null = null;
  private file: string;
  public sessionFile: string;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.vault = new Vault(dir);
    this.file = path.join(dir, "state.json");
    this.sessionFile = path.join(dir, "x-session.json");
    this.state = empty();
    if (existsSync(this.file)) {
      try {
        this.state = this.parse(readFileSync(this.file, "utf8"));
      } catch {
        throw new Error(
          "state.json is unreadable. Restore a verified backup before starting; automatic rollback could replay actions.",
        );
      }
    } else if (existsSync(this.file + ".bak"))
      throw new Error(
        "Primary state is missing but backup exists. Restore it explicitly before starting.",
      );

    // Sync cookies and session info from dedicated session file if available
    let sessionFromFile: { status?: string; username?: string | null; checkedAt?: string | null } | null = null;
    if (existsSync(this.sessionFile)) {
      try {
        const rawSession = readFileSync(this.sessionFile, "utf8").trim();
        if (rawSession) {
          const parsed = JSON.parse(rawSession);
          const cookiesList = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.cookies)
              ? parsed.cookies
              : null;
          if (cookiesList && cookiesList.length > 0) {
            const cookiesStr = JSON.stringify(cookiesList);
            if (this.secret("cookies") !== cookiesStr) {
              const encrypted = this.vault.encrypt(cookiesStr);
              this.state.secrets.cookies = encrypted;
            }
            if (parsed && !Array.isArray(parsed)) {
              sessionFromFile = {
                status: parsed.status,
                username: parsed.username,
                checkedAt: parsed.checkedAt,
              };
            }
          }
        }
      } catch {}
    } else if (this.state.secrets.cookies) {
      // Export existing cookies to dedicated session file so it exists immediately
      try {
        const decrypted = this.vault.decrypt(this.state.secrets.cookies);
        if (decrypted) {
          const cookies = JSON.parse(decrypted);
          const metaSession = (this.state.meta.session as Record<string, unknown>) || {};
          writeFileSync(
            this.sessionFile,
            JSON.stringify(
              {
                status: metaSession.status || "saved",
                username: metaSession.username || null,
                checkedAt: metaSession.checkedAt || null,
                cookies,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
        }
      } catch {}
    }

    this.mutate((s) => {
      for (const action of s.actions)
        if (["running", "reserved"].includes(action.status)) {
          action.status = "uncertain";
          action.error =
            "Interrupted before confirmation. Inspect X before resolving.";
          action.updatedAt = now();
        }
      for (const job of s.jobs)
        if (job.status === "running") {
          job.status = "failed";
          job.error = "Interrupted by restart";
          job.completedAt = now();
        }
      s.meta.paused = true;
      const prevSession = s.meta.session as
        | { status?: string; username?: string | null; checkedAt?: string | null; message?: string }
        | undefined;
      const hasCookies = !!s.secrets.cookies || existsSync(this.sessionFile);
      const effectiveStatus = (prevSession?.status === "valid" ? "valid" : sessionFromFile?.status === "valid" ? "valid" : prevSession?.status) || "disconnected";
      const effectiveUsername = prevSession?.username || sessionFromFile?.username || null;
      const effectiveCheckedAt = prevSession?.checkedAt || sessionFromFile?.checkedAt || now();

      if (!hasCookies) {
        s.meta.session = {
          status: "disconnected",
          username: null,
          checkedAt: null,
          message: "Test your saved session to connect.",
        };
      } else if (effectiveStatus === "valid" && effectiveUsername) {
        s.meta.session = {
          status: "valid",
          username: effectiveUsername,
          checkedAt: effectiveCheckedAt,
          message: "Session preserved across restart.",
        };
      } else {
        s.meta.session = {
          status: effectiveStatus,
          username: effectiveUsername,
          checkedAt: effectiveCheckedAt,
          message: prevSession?.message || "Test your saved session to connect.",
        };
      }
    });
  }
  clearData() {
    this.mutate((s) => {
      const settings = s.meta.settings;
      const session = s.meta.session;
      s.meta = { ...(settings ? {settings} : {}), ...(session ? {session} : {}), paused: true };
      s.accounts = [];
      s.observations = [];
      s.actions = [];
      s.jobs = [];
      s.scans = [];
      s.logs = [];
      // Keep the sequence monotonic so stale open tabs cannot address new records.
    });
    // Rotate a sanitized backup too; clearing must not leave the old history in .bak.
    this.mutate(() => undefined);
  }
  private parse(raw: string): State {
    const s = JSON.parse(raw);
    if (
      s.version !== 1 ||
      !Number.isInteger(s.sequence) ||
      !s.meta ||
      !s.secrets ||
      !["accounts", "observations", "actions", "jobs", "scans", "logs"].every(
        (k) => Array.isArray(s[k]),
      )
    )
      throw new Error("Invalid state file");
    return s;
  }
  mutate<T>(fn: (state: State) => T): T {
    if (this.fault) throw new Error(this.fault);
    const next = structuredClone(this.state);
    const result = fn(next);
    try {
      const temp = this.file + ".tmp";
      const fd = openSync(temp, "w", 0o600);
      try {
        writeFileSync(fd, JSON.stringify(next, null, 2));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (existsSync(this.file)) {
        copyFileSync(this.file, this.file + ".bak");
        chmodSync(this.file + ".bak", 0o600);
      }
      renameSync(temp, this.file);
      this.state = next;
      const dirfd = openSync(this.dir, "r");
      try {
        fsyncSync(dirfd);
      } finally {
        closeSync(dirfd);
      }
      return result;
    } catch {
      this.fault =
        "Local JSON storage could not be written. Automation stopped. Check disk space and permissions, then restart.";
      this.state.meta.paused = true;
      throw new Error(this.fault);
    }
  }
  next(s: State) {
    return ++s.sequence;
  }
  getMeta<T>(key: string, fallback: T): T {
    return (this.state.meta[key] as T) ?? fallback;
  }
  setMeta(key: string, value: unknown) {
    this.mutate((s) => {
      s.meta[key] = value;
    });
    if (key === "session" && value && typeof value === "object" && existsSync(this.sessionFile)) {
      try {
        const raw = readFileSync(this.sessionFile, "utf8").trim();
        if (raw) {
          const parsed = JSON.parse(raw);
          const cookies = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.cookies)
              ? parsed.cookies
              : [];
          const sessionObj = value as Record<string, unknown>;
          writeFileSync(
            this.sessionFile,
            JSON.stringify(
              {
                status: sessionObj.status || "saved",
                username: sessionObj.username || null,
                checkedAt: sessionObj.checkedAt || null,
                cookies,
              },
              null,
              2,
            ),
            { mode: 0o600 },
          );
        }
      } catch {}
    }
  }
  settings(): Settings {
    return settingsSchema.parse({
      ...settingsSchema.parse({}),
      ...this.getMeta("settings", {}),
      ...(process.env.GEMINI_MODEL && !this.getMeta("settings", null)
        ? { model: process.env.GEMINI_MODEL }
        : {}),
    });
  }
  secret(key: string) {
    if (key === "cookies") {
      if (this.state.secrets.cookies) {
        try {
          return this.vault.decrypt(this.state.secrets.cookies);
        } catch {}
      }
      if (existsSync(this.sessionFile)) {
        try {
          const raw = readFileSync(this.sessionFile, "utf8").trim();
          if (raw) {
            const parsed = JSON.parse(raw);
            const cookiesList = Array.isArray(parsed)
              ? parsed
              : Array.isArray(parsed?.cookies)
                ? parsed.cookies
                : null;
            if (cookiesList) return JSON.stringify(cookiesList);
          }
        } catch {}
      }
      return null;
    }
    return this.state.secrets[key]
      ? this.vault.decrypt(this.state.secrets[key])
      : null;
  }
  saveSecret(key: string, value: string) {
    const encrypted = this.vault.encrypt(value);
    this.mutate((s) => {
      s.secrets[key] = encrypted;
    });
    if (key === "cookies") {
      try {
        const cookies = JSON.parse(value);
        const metaSession = (this.state.meta.session as Record<string, unknown>) || {};
        writeFileSync(
          this.sessionFile,
          JSON.stringify(
            {
              status: metaSession.status || "saved",
              username: metaSession.username || null,
              checkedAt: metaSession.checkedAt || null,
              cookies,
            },
            null,
            2,
          ),
          { mode: 0o600 },
        );
      } catch {}
    }
  }
  session(): Session {
    return {
      ...this.getMeta("session", {
        status: "disconnected",
        username: null,
        checkedAt: null,
        message: "Connect your X account.",
      }),
      configured: !!this.secret("cookies"),
    };
  }
  accounts(): Account[] {
    return this.state.accounts
      .filter((a) => !a.removed)
      .toSorted((a, b) => a.username.localeCompare(b.username));
  }
  account(id: number): Account | undefined {
    return this.state.accounts.find((a) => a.id === id && !a.removed);
  }
  addAccount(username: string, profile: object) {
    return this.mutate((s) => {
      const previous = s.accounts.find((a) => a.username === username);
      if (previous) {
        Object.assign(previous, profile, {
          removed: false,
          baselineAt: null,
          addedAt: now(),
          nextScan: now(),
        });
        return previous;
      }
      const account = {
        id: this.next(s),
        username,
        ...profile,
        settings: accountSettingsSchema.parse({}),
        addedAt: now(),
        baselineAt: null,
        lastChecked: null,
        lastPost: null,
        lastSuccess: null,
        nextScan: now(),
        failures: 0,
        error: null,
      } as Account;
      s.accounts.push(account);
      return account;
    });
  }
  updateAccount(id: number, settings: AccountSettings) {
    this.mutate((s) => {
      const a = s.accounts.find((a) => a.id === id);
      if (a) a.settings = settings;
    });
  }
  patchAccount(id: number, patch: Partial<Account>) {
    this.mutate((s) => {
      const a = s.accounts.find((a) => a.id === id);
      if (a) Object.assign(a, patch);
    });
  }
  observe(account: Account, posts: Post[], readOnly: boolean) {
    return this.mutate((s) => {
      const detected = now(),
        eligible: number[] = [];
      for (const post of posts) {
        if (
          s.observations.some(
            (o) => o.accountId === account.id && o.post.id === post.id,
          )
        )
          continue;
        const field =
          post.type === "reply"
            ? "replies"
            : post.type === "repost"
              ? "reposts"
              : post.type;
        const old =
          !Number.isFinite(Date.parse(post.publishedAt)) ||
          Date.parse(post.publishedAt) <=
            Math.max(
              Date.parse(account.baselineAt || detected),
              Date.parse(account.addedAt),
            );
        const allowed =
          field !== "unknown" && account.settings[field as "original"];
        const reason = !account.baselineAt
          ? "Initial baseline"
          : old
            ? "Published before baseline"
            : !allowed
              ? "Post type excluded"
              : readOnly
                ? "Observed while actions paused"
                : null;
        const id = this.next(s);
        s.observations.push({
          id,
          accountId: account.id,
          post,
          detectedAt: detected,
          status: reason ? "skipped" : "pending",
          reason,
          duration: 0,
          generation: null,
        });
        if (!reason) eligible.push(id);
      }
      const target = s.accounts.find((a) => a.id === account.id)!;
      target.baselineAt ??= detected;
      const latest = posts.toSorted(
        (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
      )[0];
      if (latest) target.lastPost = latest.url;
      return eligible;
    });
  }
  reserve(
    actor: string,
    postId: string,
    type: ActionType,
    reply: string | null,
  ) {
    const settings = this.settings();
    return this.mutate((s) => {
      if (
        s.actions.some(
          (a) => a.actor === actor && a.postId === postId && a.type === type,
        )
      )
        return null;
      const hour = new Date(Date.now() - 3600000).toISOString(),
        day = now().slice(0, 10);
      const count = (from: string, t?: string) =>
        s.actions.filter(
          (a) =>
            a.createdAt >= from &&
            a.status !== "skipped" &&
            (!t || a.type === t),
        ).length;
      const limit =
        type === "reply"
          ? settings.repliesPerHour
          : type === "like"
            ? settings.likesPerHour
            : settings.repostsPerHour;
      if (count(day) >= settings.actionsPerDay || count(hour, type) >= limit)
        return "limited" as const;
      const id = this.next(s);
      s.actions.push({
        id,
        actor,
        postId,
        type,
        status: "reserved",
        reply,
        error: null,
        createdAt: now(),
        updatedAt: now(),
        resultUrl: null,
      });
      return id;
    });
  }
  finishAction(
    id: number,
    status: Action["status"],
    error: string | null = null,
    resultUrl: string | null = null,
  ) {
    this.mutate((s) => {
      const a = s.actions.find((a) => a.id === id);
      if (a) Object.assign(a, { status, error, resultUrl, updatedAt: now() });
    });
  }
  activity(id: number): Activity | undefined {
    const row = this.state.observations.find((o) => o.id === id);
    if (!row) return;
    return {
      ...row,
      username:
        this.state.accounts.find((a) => a.id === row.accountId)?.username ||
        "removed",
      actions: this.state.actions.filter((a) => a.postId === row.post.id),
    };
  }
  log(
    level: string,
    message: string,
    accountId: number | null = null,
    postId: string | null = null,
  ) {
    const threshold = { INFO: 0, SUCCESS: 0, WARNING: 1, ERROR: 2 };
    if (
      (threshold[level as keyof typeof threshold] ?? 0) <
      threshold[this.settings().logLevel]
    )
      return;
    this.mutate((s) => {
      s.logs.push({
        id: this.next(s),
        time: now(),
        level,
        message,
        accountId,
        postId,
      });
    });
  }
  close() {}
}

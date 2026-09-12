import type { Store } from "../database/store.js";
import type {
  Account,
  ActionType,
  Post,
  Generation,
} from "../../shared/schema.js";
import { AppError, delay, now, safeError } from "../utils/errors.js";
export interface BrowserAdapter {
  enrichMedia?(post: Post): Promise<Post>;
  act(
    post: Post,
    type: ActionType,
    text: string | undefined,
    beforeMutation: () => boolean,
  ): Promise<{ url: string }>;
}
export interface MonitorAdapter {
  scan(username: string): Promise<Post[]>;
}
export interface AIAdapter {
  generate(post: Post, prompt?: string): Promise<Generation>;
}
export class Worker {
  private chain: Promise<unknown> = Promise.resolve();
  busy = false;
  constructor(
    private store: Store,
    private browser: BrowserAdapter,
    private ai: AIAdapter,
    private monitor: MonitorAdapter,
    private actionDelay = 800,
  ) {}
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.chain.then(task);
    this.chain = result.catch(() => undefined);
    return result;
  }
  allowed(accountId: number) {
    return (
      !this.store.getMeta("paused", true) &&
      this.store.session().status === "valid" &&
      !!this.store.account(accountId)?.settings.monitoring
    );
  }
  enqueue(id: number) {
    if (!this.store.account(id))
      throw new AppError("NOT_FOUND", "Tracked account was not found.", 404);
    if (
      this.store.state.jobs.some(
        (j) => j.accountId === id && ["queued", "running"].includes(j.status),
      )
    )
      return;
    this.store.mutate((s) =>
      s.jobs.push({
        id: this.store.next(s),
        accountId: id,
        status: "queued",
        createdAt: now(),
      }),
    );
  }
  private job(id: number, patch: object) {
    this.store.mutate((s) =>
      Object.assign(
        s.jobs.find((j) => j.id === id)!,
        patch,
      ),
    );
  }
  async drain() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.exclusive(async () => {
        if (
          this.store.getMeta("paused", true) &&
          !this.store.settings().readOnlyWhenPaused
        )
          return;
        const job = this.store.state.jobs.find((j) => j.status === "queued");
        if (!job) return;
        const account = this.store.account(job.accountId);
        if (!account?.settings.monitoring) {
          this.job(job.id, { status: "skipped", completedAt: now() });
          return;
        }
        this.job(job.id, { status: "running", startedAt: now() });
        try {
          const partial = await this.scan(account);
          this.job(job.id, {
            status: partial ? "partially_completed" : "completed",
            completedAt: now(),
          });
        } catch (error) {
          this.job(job.id, {
            status: "failed",
            error: safeError(error),
            completedAt: now(),
          });
        }
      });
    } finally {
      this.busy = false;
    }
  }
  private async scan(account: Account) {
    const start = Date.now();
    const scanId = this.store.mutate((s) => {
      const id = this.store.next(s);
      s.scans.push({
        id,
        accountId: account.id,
        startedAt: now(),
        duration: 0,
        error: null,
      });
      return id;
    });
    this.store.log("INFO", `Checking RSS for @${account.username}`, account.id);
    let errorMessage: string | null = null;
    try {
      let posts: Post[] = [];
      for (let attempt = 0; ; attempt++) {
        try {
          posts = await this.monitor.scan(account.username);
          break;
        } catch (error) {
          if (
            !(error instanceof AppError) ||
            !error.retryable ||
            attempt >= this.store.settings().retries
          )
            throw error;
          this.store.log(
            "WARNING",
            `Feed retry ${attempt + 1} for @${account.username}`,
            account.id,
          );
          await delay(Math.min(30000, 2000 * 2 ** attempt));
        }
      }
      this.store.observe(account, posts, !this.allowed(account.id));
      const pending = this.store.state.observations.filter(
        (o) =>
          o.accountId === account.id &&
          ["pending", "limited"].includes(o.status),
      );
      let partial = false;
      for (const row of pending) {
        if (!this.allowed(account.id)) break;
        partial = (await this.process(row.id)) || partial;
      }
      this.store.patchAccount(account.id, {
        failures: 0,
        error: null,
        lastChecked: now(),
        nextScan: new Date(
          Date.now() +
            (account.settings.interval || this.store.settings().interval) *
              60000,
        ).toISOString(),
      });
      this.store.log(
        "SUCCESS",
        `RSS scan completed for @${account.username}`,
        account.id,
      );
      return partial;
    } catch (error) {
      errorMessage = safeError(error);
      const minutes = Math.min(
        1440,
        (account.settings.interval || this.store.settings().interval) *
          2 ** Math.min(account.failures + 1, 5),
      );
      this.store.patchAccount(account.id, {
        failures: account.failures + 1,
        error: errorMessage,
        lastChecked: now(),
        nextScan: new Date(Date.now() + minutes * 60000).toISOString(),
      });
      this.store.log("ERROR", errorMessage, account.id);
      throw error;
    } finally {
      this.store.mutate((s) =>
        Object.assign(
          s.scans.find((scan) => scan.id === scanId)!,
          {
            completedAt: now(),
            duration: Date.now() - start,
            error: errorMessage,
          },
        ),
      );
    }
  }
  async process(id: number) {
    const activity = this.store.activity(id);
    if (!activity) return false;
    const account = this.store.account(activity.accountId);
    if (!account) return false;
    const start = Date.now();
    let partial = false,
      limited = false;
    let generation = activity.generation;
    for (const type of ["reply", "like", "repost"] as ActionType[]) {
      const current = this.store.account(account.id);
      if (!current?.settings[type]) continue;
      if (!this.allowed(account.id)) break;
      const actor = this.store.session().username;
      if (!actor) break;
      if (
        this.store.state.actions.some(
          (a) =>
            a.actor === actor &&
            a.postId === activity.post.id &&
            a.type === type,
        )
      )
        continue;
      const reservation = this.store.reserve(
        actor,
        activity.post.id,
        type,
        null,
      );
      if (reservation === "limited") {
        limited = true;
        this.store.log(
          "WARNING",
          `${type} limit reached; action deferred`,
          account.id,
          activity.post.id,
        );
        continue;
      }
      if (!reservation) continue;
      try {
        if (type === "reply") {
          if (!generation) {
            if (this.browser.enrichMedia && ((!activity.post.text.trim() && !activity.post.media.length) || activity.post.media.some((m) => m.type === "video" && (!m.url.startsWith("https://") || !m.url.includes(".mp4"))))) {
              const enriched = await this.browser.enrichMedia(activity.post);
              this.store.mutate((s) => { s.observations.find((o) => o.id === id)!.post = enriched; });
              activity.post = enriched;
            }
            generation = await this.ai.generate(
              activity.post,
              current.settings.prompt || undefined,
            );
            this.store.mutate((s) => {
              s.observations.find((o) => o.id === id)!.generation = generation;
            });
            this.store.log(
              "SUCCESS",
              "Gemini response generated",
              account.id,
              activity.post.id,
            );
          }
          this.store.mutate((s) => {
            s.actions.find((a) => a.id === reservation)!.reply =
              generation!.text;
          });
        }
        if (
          !this.allowed(account.id) ||
          !this.store.account(account.id)?.settings[type]
        ) {
          this.store.finishAction(
            reservation,
            "skipped",
            "Paused or disabled before submission",
          );
          continue;
        }
        if (this.actionDelay)
          await delay(this.actionDelay + Math.random() * 700);
        this.store.finishAction(reservation, "running");
        const result = await this.browser.act(
          activity.post,
          type,
          generation?.text,
          () =>
            this.allowed(account.id) &&
            !!this.store.account(account.id)?.settings[type],
        );
        this.store.finishAction(reservation, "succeeded", null, result.url);
        this.store.patchAccount(account.id, { lastSuccess: now() });
        this.store.log(
          "SUCCESS",
          `${type[0].toUpperCase() + type.slice(1)} confirmed`,
          account.id,
          activity.post.id,
        );
      } catch (error) {
        const uncertain = !(error instanceof AppError && error.code === "ACTION_REJECTED") &&
          this.store.state.actions.find((a) => a.id === reservation)?.status ===
          "running";
        this.store.finishAction(
          reservation,
          uncertain ? "uncertain" : "failed",
          uncertain
            ? `${safeError(error)} Inspect X before resolving.`
            : safeError(error),
        );
        partial = true;
        this.store.log(
          "ERROR",
          `${type}: ${uncertain ? `Outcome uncertain: ${safeError(error)}. Manual reconciliation required.` : safeError(error)}`,
          account.id,
          activity.post.id,
        );
      }
    }
    this.store.mutate((s) =>
      Object.assign(
        s.observations.find((o) => o.id === id)!,
        {
          status: limited
            ? "limited"
            : !this.allowed(account.id)
              ? "skipped"
              : partial
                ? "partially_completed"
                : "completed",
          duration: Date.now() - start,
        },
      ),
    );
    return partial;
  }
}

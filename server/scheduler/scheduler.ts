import type { Store } from "../database/store.js";
import type { Worker } from "../automation/worker.js";
import { now, safeError } from "../utils/errors.js";
export class Scheduler {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  constructor(
    private store: Store,
    private worker: Worker,
  ) {}
  start() {
    this.timer = setInterval(() => void this.tick(), 2000);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
  }
  async tick() {
    if (this.running || this.store.fault) return;
    this.running = true;
    try {
      if (
        this.store.getMeta("paused", true) &&
        !this.store.settings().readOnlyWhenPaused
      )
        return;
      for (const account of this.store.accounts()) {
        if (account.settings.monitoring && account.nextScan <= now())
          this.worker.enqueue(account.id);
      }
      await this.worker.drain();
    } catch (error) {
      try {
        this.store.log("ERROR", safeError(error));
      } catch {
        console.error("Monitoring stopped: local storage is unavailable.");
      }
    } finally {
      this.running = false;
    }
  }
}

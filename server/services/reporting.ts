import type { Store } from "../database/store.js";
import { now } from "../utils/errors.js";
export function stats(store: Store) {
  const day = now().slice(0, 10),
    month = new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10),
    hour = new Date(Date.now() - 3600000).toISOString();
  const actions = store.state.actions,
    observations = store.state.observations;
  const group = (items: Record<string, any>[], keys: string[]) => {
    const map = new Map<string, any>();
    for (const item of items) {
      const values = Object.fromEntries(keys.map((k) => [k, item[k]])),
        key = JSON.stringify(values);
      map.set(key, { ...values, count: (map.get(key)?.count || 0) + 1 });
    }
    return [...map.values()];
  };
  return {
    tracked: store.accounts().length,
    active: store.accounts().filter((a) => a.settings.monitoring).length,
    postsToday: observations.filter(
      (o) => o.detectedAt >= day && o.reason === null,
    ).length,
    actions: group(
      actions.filter((a) => a.createdAt >= day),
      ["type", "status"],
    ),
    hourly: group(
      actions.filter((a) => a.createdAt >= hour && a.status !== "skipped"),
      ["type"],
    ),
    daily: group(
      actions
        .filter((a) => a.status === "succeeded" && a.createdAt >= month)
        .map((a) => ({ ...a, day: a.createdAt.slice(0, 10) })),
      ["day", "type"],
    ),
    postsDaily: group(
      observations
        .filter((o) => o.reason === null && o.detectedAt >= month)
        .map((o) => ({ day: o.detectedAt.slice(0, 10) })),
      ["day"],
    ),
    actionsToday: actions.filter(
      (a) => a.createdAt >= day && a.status !== "skipped",
    ).length,
    totalSuccess: actions.filter((a) => a.status === "succeeded").length,
    totalFailed: actions.filter((a) =>
      ["failed", "uncertain"].includes(a.status),
    ).length,
    generated: observations.filter((o) => o.generation).length,
    tokens: observations.reduce((n, o) => n + (o.generation?.tokens || 0), 0),
    averageDuration:
      observations
        .filter((o) => o.duration)
        .reduce((n, o) => n + o.duration, 0) /
      Math.max(1, observations.filter((o) => o.duration).length),
    topAccounts: group(
      observations
        .filter((o) => !o.reason)
        .map((o) => ({
          username:
            store.state.accounts.find((a) => a.id === o.accountId)?.username ||
            "removed",
        })),
      ["username"],
    )
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  MessageSquare,
  Clock3,
  Download,
} from "lucide-react";
import type { Activity, Account } from "../../shared/schema";
import { useData } from "../hooks/useData";
import { request } from "../services/api";
import {
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorBox,
  Modal,
  PageHeader,
  Pager,
  Panel,
  Skeleton,
  dateTime,
  relative,
  useToast,
} from "../components/ui";
export function ActivityPage() {
  const [params, setParams] = useSearchParams();
  const query = new URLSearchParams(params);
  query.delete("event");
  const { data, error, reload, loading } = useData(`/history?${query}`, 7000);
  const { data: accounts } = useData<Account[]>("/accounts");
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.delete("page");
    value ? next.set(key, value) : next.delete(key);
    setParams(next);
  }
  return (
    <>
      <PageHeader
        title="Activity history"
        description="Every detected post, generated reply, and action. Nothing hidden."
      />
      <Panel>
        <div className="toolbar filter-toolbar">
          <select
            aria-label="Account filter"
            value={params.get("account") || ""}
            onChange={(e) => filter("account", e.target.value)}
          >
            <option value="">All accounts</option>
            {accounts?.map((a) => (
              <option key={a.id} value={a.id}>
                @{a.username}
              </option>
            ))}
          </select>
          <select
            aria-label="Action filter"
            value={params.get("action") || ""}
            onChange={(e) => filter("action", e.target.value)}
          >
            <option value="">All actions</option>
            {["reply", "like", "repost"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="Result filter"
            value={params.get("status") || ""}
            onChange={(e) => filter("status", e.target.value)}
          >
            <option value="">All results</option>
            {["succeeded", "failed", "uncertain", "skipped"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            aria-label="Post type filter"
            value={params.get("type") || ""}
            onChange={(e) => filter("type", e.target.value)}
          >
            <option value="">All post types</option>
            {["original", "reply", "repost", "quote", "unknown"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <input
            aria-label="From date"
            type="date"
            value={params.get("from") || ""}
            onChange={(e) => filter("from", e.target.value)}
          />
          <input
            aria-label="To date"
            type="date"
            value={params.get("to") || ""}
            onChange={(e) => filter("to", e.target.value)}
          />
        </div>
        {error ? (
          <ErrorBox message={error} retry={reload} />
        ) : loading ? (
          <Skeleton />
        ) : !data?.items.length ? (
          <Empty
            title="No activity to show"
            description="New posts and their individual action results will appear here. Baseline posts are recorded as skipped."
          />
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Account & post</th>
                  <th>Detected</th>
                  <th>Type</th>
                  <th>Result</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: Activity) => (
                  <tr key={item.id} className="clickable-row">
                    <td>
                      <button
                        className="activity-open"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          next.set("event", String(item.id));
                          setParams(next);
                        }}
                      >
                        <strong>@{item.username}</strong>
                        <span>{item.post.text || "Media post"}</span>
                      </button>
                    </td>
                    <td className="nowrap">{relative(item.detectedAt)}</td>
                    <td>
                      {item.post.type}
                      {item.post.media.length ? (
                        <small className="muted"> · media</small>
                      ) : null}
                    </td>
                    <td>
                      <Badge
                        tone={
                          item.status === "completed"
                            ? "green"
                            : item.status === "partially_completed"
                              ? "red"
                              : "neutral"
                        }
                      >
                        {item.status.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td>
                      <div className="action-results">
                        {item.actions.map((a) => (
                          <span
                            title={a.error || a.status}
                            className={a.status}
                            key={a.id}
                          >
                            {a.type}: {a.status}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data ? (
          <Pager
            {...data}
            onChange={(page) => {
              const next = new URLSearchParams(params);
              next.set("page", String(page));
              setParams(next);
            }}
          />
        ) : null}
      </Panel>
      {params.get("event") ? (
        <ActivityDetail
          id={params.get("event")!}
          onClose={() => {
            const next = new URLSearchParams(params);
            next.delete("event");
            setParams(next);
          }}
        />
      ) : null}
    </>
  );
}
function ActivityDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, reload } = useData(`/history/${id}`);
  const [resolve, setResolve] = useState<{ id: number; status: string } | null>(
    null,
  );
  const toast = useToast();
  return (
    <Modal title="Activity details" onClose={onClose}>
      {error ? (
        <ErrorBox message={error} />
      ) : !data ? (
        <Skeleton />
      ) : (
        <div className="event-details">
          <div className="event-meta">
            <strong>@{data.username}</strong>
            <span>{dateTime(data.detectedAt)}</span>
            <Badge>{data.post.type}</Badge>
          </div>
          <blockquote>{data.post.text || "No text retained."}</blockquote>
          <a
            className="text-link"
            href={data.post.url}
            target="_blank"
            rel="noreferrer"
          >
            Open original post <ArrowUpRight size={14} />
          </a>
          {data.reason ? <p className="info-note">{data.reason}</p> : null}
          {data.post.quotedText ? (
            <>
              <h3>Quoted post</h3>
              <blockquote>{data.post.quotedText}</blockquote>
            </>
          ) : null}
          <div className="event-media">
            {data.post.media
              .filter(
                (m: { type: string; url: string }) =>
                  m.type === "image" &&
                  m.url.startsWith("https://pbs.twimg.com/"),
              )
              .map((m: { url: string }, i: number) => (
                <a key={i} href={m.url} target="_blank" rel="noreferrer">
                  <img
                    src={m.url}
                    alt={`Post attachment ${i + 1}`}
                    loading="lazy"
                  />
                </a>
              ))}
          </div>
          <h3>Media & AI context</h3>
          <p className="muted">
            {data.post.media.length} attachments ·{" "}
            {data.generation?.mediaStatus || "Not analyzed"} · {data.duration}{" "}
            ms processing
          </p>
          {data.generation ? (
            <>
              <pre className="context-block">{data.generation.context}</pre>
              <h3>Generated reply</h3>
              <blockquote>{data.generation.text}</blockquote>
              {data.generation.mediaErrors.map((e: string, i: number) => (
                <p className="muted" key={i}>
                  {e}
                </p>
              ))}
            </>
          ) : (
            <p className="muted">No reply generated for this post.</p>
          )}
          <h3>Action results</h3>
          {data.actions.length ? (
            data.actions.map((a: any) => (
              <div className="event-action" key={a.id}>
                <div>
                  <strong>{a.type}</strong>
                  <Badge
                    tone={
                      a.status === "succeeded"
                        ? "green"
                        : a.status === "uncertain" || a.status === "failed"
                          ? "red"
                          : "neutral"
                    }
                  >
                    {a.status}
                  </Badge>
                </div>
                {a.error ? <p>{a.error}</p> : null}
                {a.status === "uncertain" ? (
                  <div className="inline-actions">
                    <Button
                      onClick={() =>
                        setResolve({ id: a.id, status: "succeeded" })
                      }
                    >
                      Mark confirmed
                    </Button>
                    <Button
                      onClick={() => setResolve({ id: a.id, status: "failed" })}
                    >
                      Mark not completed
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          ) : (
            <p className="muted">No external actions attempted.</p>
          )}
          <h3>Event logs</h3>
          {data.logs.map((l: any) => (
            <div className="event-log" key={l.id}>
              <small>{dateTime(l.time)}</small>
              <span>{l.message}</span>
            </div>
          ))}
        </div>
      )}
      {resolve ? (
        <Confirm
          title="Reconcile this action?"
          description="Inspect the post on X first. This changes the recorded outcome and will not retry the action."
          label="Save outcome"
          onClose={() => setResolve(null)}
          onConfirm={async () => {
            await request(`/actions/${resolve.id}/resolve`, "POST", {
              status: resolve.status,
            });
            await reload();
            toast("Action outcome updated.");
          }}
        />
      ) : null}
    </Modal>
  );
}
export function Analytics() {
  const { data, error, reload } = useData("/stats", 10000);
  const days = Array.from({ length: 14 }, (_, i) =>
    new Date(Date.now() - (13 - i) * 86400000).toISOString().slice(0, 10),
  );
  const max = Math.max(
    1,
    ...days.map(
      (day) =>
        data?.daily
          .filter((d: any) => d.day === day)
          .reduce((n: number, d: any) => n + d.count, 0) || 0,
    ),
  );
  return (
    <>
      <PageHeader
        title="Analytics"
        description="A clear view of activity, reliability, and AI usage."
      />
      {error ? (
        <ErrorBox message={error} retry={reload} />
      ) : !data ? (
        <Skeleton />
      ) : (
        <>
          <div className="metric-grid">
            {[
              ["Confirmed actions", data.totalSuccess],
              [
                "Success rate",
                data.totalSuccess + data.totalFailed
                  ? `${Math.round((data.totalSuccess / (data.totalSuccess + data.totalFailed)) * 100)}%`
                  : "—",
              ],
              ["Failed / uncertain", data.totalFailed],
              ["Replies generated", data.generated],
            ].map(([label, value]) => (
              <div className="metric" key={label}>
                <div>{label}</div>
                <strong>{value}</strong>
                <small>All retained history</small>
              </div>
            ))}
          </div>
          <Panel
            title="Actions over time"
            description="Confirmed replies, likes, and reposts · last 14 days"
          >
            <div className="chart-legend">
              <span className="reply">Replies</span>
              <span className="like">Likes</span>
              <span className="repost">Reposts</span>
            </div>
            {data.daily.length ? (
              <div
                className="bar-chart"
                role="img"
                aria-label="Daily confirmed actions over the past fourteen days"
              >
                {days.map((day) => {
                  const entries = data.daily.filter((d: any) => d.day === day);
                  return (
                    <div className="bar-column" key={day}>
                      <div className="bar-stack">
                        {["repost", "like", "reply"].map((type) => {
                          const count =
                            entries.find((d: any) => d.type === type)?.count ||
                            0;
                          return (
                            <div
                              key={type}
                              className={`bar ${type}`}
                              style={{ height: `${(count / max) * 180}px` }}
                              title={`${day}: ${count} ${type} actions`}
                            />
                          );
                        })}
                      </div>
                      <small>{day.slice(5)}</small>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="Your trends will grow here"
                description="Charts use confirmed activity only. Start monitoring to build a useful picture over time."
              />
            )}
          </Panel>
          <div className="settings-grid">
            <Panel title="AI & processing">
              <div className="health-list">
                <div>
                  <span>Gemini tokens used</span>
                  <strong>{data.tokens.toLocaleString()}</strong>
                </div>
                <div>
                  <span>Replies generated</span>
                  <strong>{data.generated}</strong>
                </div>
                <div>
                  <span>Average processing time</span>
                  <strong>{(data.averageDuration / 1000).toFixed(1)}s</strong>
                </div>
              </div>
            </Panel>
            <Panel title="Most active accounts">
              {data.topAccounts.length ? (
                <div className="health-list">
                  {data.topAccounts.map((a: any) => (
                    <div key={a.username}>
                      <strong>@{a.username}</strong>
                      <span>{a.count} posts</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="panel-body muted">
                  No eligible posts recorded yet.
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
export function Logs() {
  const [level, setLevel] = useState(""),
    [page, setPage] = useState(1);
  const { data, error, loading, reload } = useData(
    `/logs?page=${page}&level=${level}`,
    7000,
  );
  return (
    <>
      <PageHeader
        title="System logs"
        description="Readable operational events. Credentials are never included."
      />
      <Panel>
        <div className="toolbar">
          <div className="filter-tabs">
            {["", "INFO", "SUCCESS", "WARNING", "ERROR"].map((value) => (
              <button
                key={value}
                className={level === value ? "selected" : ""}
                onClick={() => {
                  setLevel(value);
                  setPage(1);
                }}
              >
                {value || "All events"}
              </button>
            ))}
          </div>
          <span className="live-label">
            <i className="green-dot" />
            Updates every 7s
          </span>
        </div>
        {error ? (
          <ErrorBox message={error} retry={reload} />
        ) : loading ? (
          <Skeleton />
        ) : !data?.items.length ? (
          <Empty
            title="No log events"
            description="Monitoring, generation, and action events will be recorded here."
          />
        ) : (
          <div className="log-list">
            {data.items.map((log: any) => (
              <div className="log-row" key={log.id}>
                <time>{dateTime(log.time)}</time>
                <Badge
                  tone={
                    log.level === "ERROR"
                      ? "red"
                      : log.level === "WARNING"
                        ? "amber"
                        : log.level === "SUCCESS"
                          ? "green"
                          : "blue"
                  }
                >
                  {log.level}
                </Badge>
                <span>{log.message}</span>
              </div>
            ))}
          </div>
        )}
        {data ? <Pager {...data} onChange={setPage} /> : null}
      </Panel>
    </>
  );
}

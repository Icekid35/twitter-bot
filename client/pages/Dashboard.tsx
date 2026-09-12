import { Link } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  Heart,
  MessageSquare,
  Plus,
  Repeat2,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { useData } from "../hooks/useData";
import {
  Badge,
  Button,
  Empty,
  ErrorBox,
  Panel,
  PageHeader,
  relative,
  Skeleton,
} from "../components/ui";
import type { Account } from "../../shared/schema";
export function Dashboard() {
  const { data: stats, error, reload } = useData("/stats", 7000),
    { data: status } = useData("/automation/status", 5000),
    { data: accounts } = useData<Account[]>("/accounts", 7000),
    { data: settings } = useData("/settings"),
    { data: history } = useData("/history", 7000);
  const configured =
    (settings?.feedUrl || settings?.mirrorUrl) &&
    settings?.geminiConfigured &&
    status?.session.status === "valid" &&
    accounts?.length;
  const count = (type: string) =>
    stats?.actions
      .filter((a: any) => a.type === type && a.status === "succeeded")
      .reduce((n: number, a: any) => n + a.count, 0) || 0;
  return (
    <>
      <PageHeader
        eyebrow="YOUR WORKSPACE, AT A GLANCE"
        title="Overview"
        description="Keep a pulse on your accounts. Make every interaction count."
        actions={
          <Link className="button primary" to="/accounts?add=1">
            <Plus size={16} /> Track an account
          </Link>
        }
      />
      {error ? <ErrorBox message={error} retry={reload} /> : null}
      {!configured ? (
        <section className="setup-panel">
          <div className="setup-intro">
            <span className="setup-icon">
              <Zap size={22} />
            </span>
            <div>
              <div className="eyebrow">LET’S GET YOU CONNECTED</div>
              <h2>A little setup. A lot less busywork.</h2>
              <p>
                Connect your tools and choose who to follow. You stay in
                control.
              </p>
            </div>
            <Badge tone="blue">
              {
                [
                  !!(settings?.feedUrl || settings?.mirrorUrl),
                  settings?.geminiConfigured,
                  status?.session.status === "valid",
                  !!accounts?.length,
                ].filter(Boolean).length
              }{" "}
              of 4 complete
            </Badge>
          </div>
          <div className="setup-steps">
            {[
              {
                done: !!(settings?.feedUrl || settings?.mirrorUrl),
                title: "Choose an RSS source",
                description: "Connect Nitter or your RSSHub feed.",
                to: "/system",
                icon: Zap,
              },
              {
                done: settings?.geminiConfigured,
                title: "Configure your AI",
                description: "Bring your Gemini key and your voice.",
                to: "/ai",
                icon: Sparkles,
              },
              {
                done: status?.session.status === "valid",
                title: "Connect your X session",
                description: "Securely use your existing account.",
                to: "/session",
                icon: ShieldCheck,
              },
              {
                done: !!accounts?.length,
                title: "Track your first account",
                description: "Choose accounts and set your actions.",
                to: "/accounts?add=1",
                icon: Users,
              },
            ].map((step, i) => (
              <Link
                to={step.to}
                key={step.title}
                className={step.done ? "complete" : ""}
              >
                <span className="step-number">
                  {step.done ? (
                    <Check size={17} />
                  ) : (
                    String(i + 1).padStart(2, "0")
                  )}
                </span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </div>
                <ArrowUpRight size={17} />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
      {!stats ? (
        <Skeleton />
      ) : (
        <div className="metric-grid">
          {[
            {
              label: "Tracked accounts",
              value: stats.tracked,
              detail: `${stats.active} actively monitored`,
              icon: Users,
            },
            {
              label: "Posts detected today",
              value: stats.postsToday,
              detail: "New posts beyond your baseline",
              icon: Zap,
            },
            {
              label: "Replies sent today",
              value: count("reply"),
              detail: "Confirmed on X",
              icon: MessageSquare,
            },
            {
              label: "Likes & reposts today",
              value: count("like") + count("repost"),
              detail: `${count("like")} likes · ${count("repost")} reposts`,
              icon: Heart,
            },
          ].map((item) => (
            <div className="metric" key={item.label}>
              <div>
                <span>{item.label}</span>
                <item.icon size={17} />
              </div>
              <strong>{item.value.toLocaleString()}</strong>
              <small>{item.detail}</small>
            </div>
          ))}
        </div>
      )}
      <div className="dashboard-grid">
        <Panel
          title="Recent activity"
          description="The latest from your automation workspace."
          actions={
            <Link className="text-link" to="/activity">
              View all <ArrowRight size={14} />
            </Link>
          }
        >
          {!history ? (
            <Skeleton />
          ) : !history.items.length ? (
            <Empty
              title="Your activity starts here"
              description="Once monitoring begins, detected posts and confirmed actions will appear in this feed."
              action={
                <Link className="button" to="/accounts">
                  Set up tracked accounts <ArrowRight size={15} />
                </Link>
              }
            />
          ) : (
            <div className="activity-feed">
              {history.items.slice(0, 5).map((item: any) => (
                <Link
                  to={`/activity?event=${item.id}`}
                  className="feed-row"
                  key={item.id}
                >
                  <span className="feed-icon">
                    <MessageSquare size={17} />
                  </span>
                  <div>
                    <strong>@{item.username}</strong>
                    <p>{item.post.text || "Media post"}</p>
                    <small>
                      {item.status.replaceAll("_", " ")} ·{" "}
                      {relative(item.detectedAt)}
                    </small>
                  </div>
                  <ArrowUpRight size={15} />
                </Link>
              ))}
            </div>
          )}
        </Panel>
        <Panel
          title="Automation health"
          description="Everything you need to stay in control."
        >
          <div className="health-list">
            <div>
              <span>
                <ShieldCheck size={17} />X session
              </span>
              <Badge
                tone={status?.session.status === "valid" ? "green" : "neutral"}
              >
                {status?.session.status === "valid"
                  ? "Connected"
                  : "Not connected"}
              </Badge>
            </div>
            <div>
              <span>
                <Sparkles size={17} />
                Gemini
              </span>
              <Badge tone={settings?.geminiConfigured ? "green" : "neutral"}>
                {settings?.geminiConfigured ? "Configured" : "Not configured"}
              </Badge>
            </div>
            <div>
              <span>
                <Zap size={17} />
                Failed actions today
              </span>
              <strong>
                {stats?.actions
                  .filter((a: any) =>
                    ["failed", "uncertain"].includes(a.status),
                  )
                  .reduce((n: number, a: any) => n + a.count, 0) || 0}
              </strong>
            </div>
            <div>
              <span>
                <Clock3 size={17} />
                Scan interval
              </span>
              <strong>
                {status?.interval === 0.5
                  ? "Every 30s"
                  : `Every ${status?.interval || 10} min`}
              </strong>
            </div>
            <div>
              <span>
                <Repeat2 size={17} />
                Last scan
              </span>
              <strong>{relative(status?.lastScan?.completedAt)}</strong>
            </div>
            <div>
              <span>
                <Zap size={17} />
                Next scan
              </span>
              <strong>
                {status?.paused ? "Paused" : relative(status?.nextScan)}
              </strong>
            </div>
          </div>
          <div className="health-note">
            <ShieldCheck size={18} />
            <p>
              Actions start only after a verified session and a successful
              baseline scan.
            </p>
          </div>
          <Link className="panel-bottom-link" to="/automation">
            Manage automation <ArrowRight size={15} />
          </Link>
        </Panel>
      </div>
      <div className="dashboard-grid bottom-grid">
        <Panel
          title="Action budgets"
          description="Conservative limits, predictable activity."
          actions={
            <Link className="text-link" to="/automation">
              Edit limits <ArrowUpRight size={14} />
            </Link>
          }
        >
          <div className="budget-grid">
            {[
              ["reply", "Replies", settings?.repliesPerHour, MessageSquare],
              ["like", "Likes", settings?.likesPerHour, Heart],
              ["repost", "Reposts", settings?.repostsPerHour, Repeat2],
            ].map(([type, label, limit, Icon]: any) => {
              const used =
                stats?.hourly.find((a: any) => a.type === type)?.count || 0;
              return (
                <div className="budget" key={type}>
                  <span>
                    <Icon size={16} />
                    {label}
                  </span>
                  <strong>
                    {used}
                    <small> / {limit ?? "—"}</small>
                  </strong>
                  <progress value={used} max={limit || 1} />
                  <small>Rolling hour</small>
                </div>
              );
            })}
          </div>
        </Panel>
        <div className="quiet-card">
          <span className="quiet-icon">
            <ShieldCheck size={23} />
          </span>
          <h3>Your account. Your rules.</h3>
          <p>
            Independent actions, a customizable voice, and an emergency stop
            whenever you need it.
          </p>
          <Link className="text-link" to="/automation">
            Review your controls <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </>
  );
}

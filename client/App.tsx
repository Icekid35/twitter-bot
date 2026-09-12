import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  ChevronRight,
  Command,
  KeyRound,
  LayoutDashboard,
  ListFilter,
  Menu,
  Pause,
  Play,
  Radio,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  Users,
  Trash2,
  X,
} from "lucide-react";
import { useData } from "./hooks/useData";
import { request } from "./services/api";
import { Badge, Button, Confirm, ToastContext } from "./components/ui";
import { Dashboard } from "./pages/Dashboard";
import { Accounts, AccountDetail } from "./pages/Accounts";
import { ActivityPage, Analytics, Logs } from "./pages/Activity";
import {
  AISettings,
  AutomationSettings,
  SessionPage,
  SystemSettings,
} from "./pages/Settings";
const navigation = [
  {
    label: "Workspace",
    items: [
      ["/", "Overview", LayoutDashboard],
      ["/accounts", "Tracked accounts", Users],
      ["/activity", "Activity", Activity],
      ["/analytics", "Analytics", BarChart3],
      ["/logs", "Logs", ListFilter],
    ],
  },
  {
    label: "Configuration",
    items: [
      ["/ai", "AI settings", Sparkles],
      ["/automation", "Automation", SlidersHorizontal],
      ["/session", "X session", KeyRound],
      ["/system", "System settings", Settings2],
    ],
  },
] as const;
export default function App() {
  const {
    data: status,
    error: connectionError,
    reload,
  } = useData("/automation/status", 5000);
  const [mobile, setMobile] = useState(false),
    [toast, setToast] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [busy, setBusy] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [smallScreen, setSmallScreen] = useState(
    () => window.matchMedia("(max-width: 700px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px)");
    const change = () => {
      setSmallScreen(media.matches);
      if (!media.matches) setMobile(false);
    };
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!mobile) return;
    document.querySelector<HTMLButtonElement>(".drawer-close")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [mobile]);
  function notify(message: string, error = false) {
    setToast({ message, error });
    setTimeout(
      () =>
        setToast((current) => (current?.message === message ? null : current)),
      6000,
    );
  }
  async function toggle() {
    setBusy(true);
    try {
      await request(
        `/automation/${status?.paused ? "start" : "pause"}`,
        "POST",
      );
      await reload();
      notify(status?.paused ? "Automation resumed." : "Automation paused.");
    } catch (e) {
      notify((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ToastContext.Provider value={notify}>
      {confirmClear ? <Confirm
        title="Clear workspace data?"
        description="This removes all tracked accounts, activity, queued jobs, logs, and statistics. Your AI, automation, feed settings, and saved credentials stay. Automation will pause while any current operation finishes. This cannot be undone."
        label="Clear data"
        onClose={() => setConfirmClear(false)}
        onConfirm={async () => {
          await request("/system/clear-data", "POST", {confirmation: "clear-data"});
          window.location.assign("/");
        }}
      /> : null}
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="app">
        <aside
          id="workspace-navigation"
          className={`sidebar ${mobile ? "open" : ""}`}
          inert={smallScreen && !mobile}
        >
          <button
            className="icon-button mobile-menu drawer-close"
            aria-label="Close navigation menu"
            onClick={() => setMobile(false)}
          >
            <X size={19} />
          </button>
          <Link className="brand" to="/" onClick={() => setMobile(false)}>
            <span className="brand-symbol">
              <Radio size={22} />
            </span>
            signaldesk<span className="brand-period">.</span>
          </Link>
          <div className="workspace">
            <span className="workspace-icon">
              <Command size={15} />
            </span>
            <div>
              Personal workspace<small>Local deployment</small>
            </div>
            <Badge tone="blue">PRO</Badge>
          </div>
          <nav>
            {navigation.map((group) => (
              <div className="nav-group" key={group.label}>
                <p>{group.label}</p>
                {group.items.map(([path, label, Icon]) => (
                  <NavLink
                    end={path === "/"}
                    key={path}
                    to={path}
                    onClick={() => setMobile(false)}
                  >
                    <Icon size={18} />
                    {label}
                    {path === "/accounts" ? (
                      <span className="nav-arrow">
                        <ChevronRight size={14} />
                      </span>
                    ) : null}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-note">
              <span className="status-dot" />
              Your data stays local<small>Encrypted credentials · JSON</small>
            </div>
            <Link to="/session" className="operator">
              <span className="operator-avatar">
                {status?.session.username?.slice(0, 2).toUpperCase() || "SD"}
              </span>
              <div>
                {status?.session.username
                  ? `@${status.session.username}`
                  : "Your X account"}
                <small>
                  {status?.session.status === "valid"
                    ? "Session connected"
                    : "Session not connected"}
                </small>
              </div>
              <ArrowUpRight size={15} />
            </Link>
          </div>
        </aside>
        {mobile ? (
          <button
            className="mobile-backdrop"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          />
        ) : null}
        <div className="main-shell" inert={smallScreen && mobile}>
          <header className="topbar">
            <div className="breadcrumb">
              <button
                className="icon-button mobile-menu"
                aria-label="Open navigation"
                aria-expanded={mobile}
                aria-controls="workspace-navigation"
                onClick={() => setMobile(true)}
              >
                <Menu size={21} />
              </button>
              <span>Workspace</span>
              <ChevronRight size={14} />
              <strong>X automation</strong>
            </div>
            <div className="topbar-actions">
              <Button className="clear-data-button" title="Clear workspace data" aria-label="Clear workspace data" disabled={!status || busy} onClick={() => setConfirmClear(true)}>
                <Trash2 size={14} /><span>Clear data</span>
              </Button>
              <Badge tone={!status || status.paused ? "neutral" : "green"}>
                {!status
                  ? "Connecting"
                  : status.paused
                    ? "Automation paused"
                    : "Automation running"}
              </Badge>
              <Button
                className={status?.paused ? "primary" : "pause-button"}
                busy={busy}
                disabled={!status}
                onClick={() => void toggle()}
              >
                {status?.paused ? <Play size={14} /> : <Pause size={14} />}
                <span>
                  {status?.paused ? "Resume automation" : "Pause all"}
                </span>
              </Button>
            </div>
          </header>
          <main id="main">
            {connectionError ? (
              <div className="error-box" role="alert">
                The local server is unavailable. Reconnecting automatically.
              </div>
            ) : null}
            {status?.storageError ? (
              <div className="error-box" role="alert">
                {status.storageError}
              </div>
            ) : null}
            {status &&
            [
              "expired",
              "challenge",
              "authentication_failed",
              "reauthentication_required",
            ].includes(status.session.status) ? (
              <div className="persistent-banner">
                <KeyRound size={18} />
                <span>{status.session.message}</span>
                <Link to="/session">
                  Review session <ArrowUpRight size={14} />
                </Link>
              </div>
            ) : null}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/accounts/:id" element={<AccountDetail />} />
              <Route path="/activity" element={<ActivityPage />} />
              <Route path="/analytics" element={<Analytics />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/ai" element={<AISettings />} />
              <Route path="/automation" element={<AutomationSettings />} />
              <Route path="/session" element={<SessionPage />} />
              <Route path="/system" element={<SystemSettings />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>Page not found</h1>
                    <Link to="/">Back to overview</Link>
                  </div>
                }
              />
            </Routes>
            <footer>
              <span>
                <Radio size={13} /> Signaldesk
              </span>
              <span>
                Built for intentional engagement{" "}
                <span className="footer-dot">·</span> v1.0.0
              </span>
            </footer>
          </main>
        </div>
        {toast ? (
          <div
            className={`toast ${toast.error ? "error" : ""}`}
            role={toast.error ? "alert" : "status"}
          >
            {toast.message}
            <button
              className="icon-button"
              aria-label="Dismiss notification"
              onClick={() => setToast(null)}
            >
              <X size={17} />
            </button>
          </div>
        ) : null}
      </div>
    </ToastContext.Provider>
  );
}

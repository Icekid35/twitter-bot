import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  Check,
  Heart,
  MessageSquare,
  Plus,
  Repeat2,
  Search,
  Trash2,
  RefreshCw,
} from "lucide-react";
import type { Account, AccountSettings } from "../../shared/schema";
import { useData } from "../hooks/useData";
import { request } from "../services/api";
import {
  Avatar,
  Badge,
  Button,
  Confirm,
  Empty,
  ErrorBox,
  Field,
  Modal,
  PageHeader,
  Panel,
  Skeleton,
  Toggle,
  useToast,
  relative,
} from "../components/ui";
export function Accounts() {
  const {
    data: accounts,
    error,
    loading,
    reload,
  } = useData<Account[]>("/accounts", 10000);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [handle, setHandle] = useState(""),
    [busy, setBusy] = useState(false),
    [addError, setAddError] = useState(""),
    [removing, setRemoving] = useState<Account | null>(null),
    [pending, setPending] = useState<number | null>(null);
  const toast = useToast();
  const adding = params.has("add");
  async function update(account: Account, key: string, value: boolean) {
    setPending(account.id);
    try {
      await request(`/accounts/${account.id}/settings`, "PATCH", {
        [key]: value,
      });
      await reload();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setPending(null);
    }
  }
  const shown = accounts?.filter(
    (a) =>
      (a.username + " " + a.displayName)
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "active" && a.settings.monitoring) ||
        (filter === "paused" && !a.settings.monitoring) ||
        (filter === "errors" && a.error)),
  );
  return (
    <>
      <PageHeader
        title="Tracked accounts"
        description="Follow the right conversations. Give each account its own rules."
        actions={
          <Button className="primary" onClick={() => setParams({ add: "1" })}>
            <Plus size={16} />
            Track an account
          </Button>
        }
      />
      <div className="summary-strip">
        <span>
          <strong>{accounts?.length || 0}</strong> total accounts
        </span>
        <span>
          <i className="green-dot" />
          <strong>
            {accounts?.filter((a) => a.settings.monitoring).length || 0}
          </strong>{" "}
          monitoring enabled
        </span>
        <span>RSS monitoring · No browser needed for scans</span>
      </div>
      <Panel>
        <div className="toolbar">
          <div className="search">
            <Search size={17} />
            <input
              aria-label="Search accounts"
              placeholder="Search accounts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            aria-label="Filter accounts"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All accounts</option>
            <option value="active">Monitoring enabled</option>
            <option value="paused">Paused</option>
            <option value="errors">With errors</option>
          </select>
        </div>
        {error ? (
          <ErrorBox message={error} retry={reload} />
        ) : loading ? (
          <Skeleton />
        ) : !shown?.length ? (
          <Empty
            title={
              accounts?.length
                ? "No matching accounts"
                : "Your next conversation starts here"
            }
            description={
              accounts?.length
                ? "Try a different search or filter."
                : "Add an X handle. We’ll verify the profile and establish a baseline before taking any actions."
            }
            action={
              !accounts?.length ? (
                <Button onClick={() => setParams({ add: "1" })}>
                  <Plus size={16} />
                  Track your first account
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-scroll">
            <table className="accounts-table">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Status</th>
                  <th>Last checked</th>
                  <th>Reply</th>
                  <th>Like</th>
                  <th>Repost</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <Link
                        className="account-identity"
                        to={`/accounts/${a.id}`}
                      >
                        <Avatar name={a.displayName} src={a.avatar} />
                        <span>
                          <strong>{a.displayName}</strong>
                          <small>@{a.username}</small>
                        </span>
                      </Link>
                    </td>
                    <td>
                      <button
                        className="plain-button"
                        disabled={pending === a.id}
                        onClick={() =>
                          void update(a, "monitoring", !a.settings.monitoring)
                        }
                      >
                        <Badge
                          tone={
                            a.error
                              ? "red"
                              : a.settings.monitoring
                                ? "green"
                                : "neutral"
                          }
                        >
                          {a.error
                            ? "Needs attention"
                            : a.settings.monitoring
                              ? "Monitoring"
                              : "Paused"}
                        </Badge>
                      </button>
                    </td>
                    <td>
                      <span className="muted">{relative(a.lastChecked)}</span>
                    </td>
                    {(["reply", "like", "repost"] as const).map((type) => (
                      <td key={type}>
                        <Toggle
                          label={`${type} for @${a.username}`}
                          checked={a.settings[type]}
                          disabled={pending === a.id}
                          onChange={(value) => void update(a, type, value)}
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        className="icon-button"
                        aria-label={`Remove @${a.username}`}
                        onClick={() => setRemoving(a)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding ? (
        <Modal title="Track a new account" onClose={() => setParams({})}>
          <p className="muted">
            Enter an X handle. A successful verification is required before
            saving.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setAddError("");
              try {
                await request("/accounts", "POST", { username: handle });
                await reload();
                setParams({});
                setHandle("");
                toast(
                  "Account verified and added. The first scan will establish a baseline.",
                );
              } catch (e) {
                setAddError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field
              label="X username"
              hint="For example, @username. No password needed."
            >
              <input
                autoFocus
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@username"
                required
                maxLength={100}
              />
            </Field>
            {addError ? <ErrorBox message={addError} /> : null}
            <div className="info-note">
              Configure your verification source and RSS feed in{" "}
              <Link to="/system">System Settings</Link>.
            </div>
            <div className="modal-actions">
              <Button
                type="button"
                onClick={() => setParams({})}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button className="primary" busy={busy} type="submit">
                {busy ? "Verifying account…" : "Verify & add account"}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
      {removing ? (
        <Confirm
          title={`Remove @${removing.username}?`}
          description="Monitoring will stop. Activity history and duplicate protection will be retained."
          label="Remove account"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await request(`/accounts/${removing.id}`, "DELETE");
            await reload();
            toast("Account removed.");
          }}
        />
      ) : null}
    </>
  );
}
export function AccountDetail() {
  const { id } = useParams();
  const { data: stats } = useData(`/accounts/${id}/stats`, 10000);
  const { data: account, error, reload } = useData<Account>(`/accounts/${id}`);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (error) return <ErrorBox message={error} retry={reload} />;
  if (!account) return <Skeleton />;
  return (
    <>
      <Link className="text-link back-link" to="/accounts">
        <ArrowLeft size={15} />
        Tracked accounts
      </Link>
      <PageHeader
        title={account.displayName}
        description={`@${account.username} · Independent automation settings`}
        actions={
          <Button
            busy={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await request(`/accounts/${id}/scan`, "POST");
                toast("RSS scan queued.");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            <RefreshCw size={15} />
            Scan RSS now
          </Button>
        }
      />
      <div className="account-profile">
        <Avatar name={account.displayName} src={account.avatar} />
        <div>
          <strong>@{account.username}</strong>
          <p>{account.bio || "No profile bio available."}</p>
          <a
            className="text-link"
            href={account.url}
            target="_blank"
            rel="noreferrer"
          >
            View on X <ArrowUpRight size={13} />
          </a>
        </div>
        <Badge tone={account.settings.monitoring ? "green" : "neutral"}>
          {account.settings.monitoring ? "Monitoring enabled" : "Paused"}
        </Badge>
      </div>
      {account.error ? <ErrorBox message={account.error} /> : null}
      <div className="summary-strip">
        <span>
          Last check: <strong>{relative(account.lastChecked)}</strong>
        </span>
        <span>
          Last action: <strong>{relative(account.lastSuccess)}</strong>
        </span>
        <span>
          Baseline:{" "}
          <strong>
            {account.baselineAt ? "Established" : "Awaiting first scan"}
          </strong>
        </span>
      </div>
      <div className="metric-grid">
        {[
          ["Eligible posts", stats?.posts],
          ["Replies", stats?.reply],
          ["Likes / reposts", stats ? `${stats.like} / ${stats.repost}` : "—"],
          [
            "Success rate",
            stats?.successRate == null ? "—" : `${stats.successRate}%`,
          ],
        ].map(([label, value]) => (
          <div className="metric" key={String(label)}>
            <div>{label}</div>
            <strong>{value ?? "—"}</strong>
            <small>This account’s retained activity</small>
          </div>
        ))}
      </div>
      <AccountForm
        account={account}
        onSave={async (settings) => {
          await request(`/accounts/${id}/settings`, "PATCH", settings);
          await reload();
          toast("Account settings saved.");
        }}
      />
      <Panel
        title="Account activity"
        actions={
          <Link className="text-link" to={`/activity?account=${id}`}>
            View full history <ArrowUpRight size={14} />
          </Link>
        }
      >
        <div className="panel-body">
          {account.lastPost ? (
            <a
              href={account.lastPost}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              Latest observed post <ArrowUpRight size={14} />
            </a>
          ) : (
            <p className="muted">
              No posts observed yet. The first RSS scan will establish the
              baseline.
            </p>
          )}
        </div>
      </Panel>
    </>
  );
}
function AccountForm({
  account,
  onSave,
}: {
  account: Account;
  onSave: (s: AccountSettings) => Promise<void>;
}) {
  const [value, setValue] = useState(account.settings),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function update(key: keyof AccountSettings, next: any) {
    setValue({ ...value, [key]: next });
  }
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await onSave(value);
          setError("");
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="settings-grid">
        <Panel
          title="Actions"
          description="Only enabled actions will run on eligible new posts."
        >
          <div className="panel-body">
            {[
              ["monitoring", "Monitoring", "Check this account’s RSS feed."],
              ["reply", "AI reply", "Generate and post a contextual reply."],
              ["like", "Auto like", "Like once and confirm the result."],
              ["repost", "Auto repost", "Repost once and confirm the result."],
            ].map(([key, label, hint]) => (
              <div className="setting-row" key={key}>
                <div>
                  <strong>{label}</strong>
                  <p>{hint}</p>
                </div>
                <Toggle
                  label={label}
                  checked={value[key as "reply"]}
                  onChange={(next) =>
                    update(key as keyof AccountSettings, next)
                  }
                />
              </div>
            ))}
          </div>
        </Panel>
        <Panel
          title="Post filters"
          description="Unrecognized post types are skipped safely."
        >
          <div className="panel-body">
            {[
              ["original", "Original posts"],
              ["replies", "Replies"],
              ["reposts", "Reposts"],
              ["quote", "Quote posts"],
            ].map(([key, label]) => (
              <div className="setting-row" key={key}>
                <strong>{label}</strong>
                <Toggle
                  label={label}
                  checked={value[key as "original"]}
                  onChange={(next) =>
                    update(key as keyof AccountSettings, next)
                  }
                />
              </div>
            ))}
            <Field
              label="Interval override (minutes)"
              hint="Leave empty to use the global interval. 0.5–1,440 minutes."
            >
              <input
                type="number"
                min="0.5"
                step="0.5"
                max="1440"
                value={value.interval ?? ""}
                onChange={(e) =>
                  update(
                    "interval",
                    e.target.value ? Number(e.target.value) : null,
                  )
                }
              />
            </Field>
          </div>
        </Panel>
      </div>
      <Panel
        title="Account-specific voice"
        description="Leave blank to use the global master prompt."
      >
        <div className="panel-body">
          <Field label="Prompt override">
            <textarea
              rows={5}
              maxLength={8000}
              value={value.prompt}
              onChange={(e) => update("prompt", e.target.value)}
              placeholder="For this account, keep replies technical but conversational…"
            />
          </Field>
        </div>
      </Panel>
      {error ? <ErrorBox message={error} /> : null}
      <div className="save-bar">
        <span>Changes apply to future actions.</span>
        <Button type="submit" className="primary" busy={busy}>
          <Check size={16} />
          Save account settings
        </Button>
      </div>
    </form>
  );
}

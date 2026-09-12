import { useEffect, useState } from "react";
import {
  Check,
  Download,
  ImagePlus,
  KeyRound,
  Play,
  Save,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { Settings } from "../../shared/schema";
import { useData } from "../hooks/useData";
import { request } from "../services/api";
import {
  Badge,
  Button,
  Confirm,
  ErrorBox,
  Field,
  PageHeader,
  Panel,
  Skeleton,
  Toggle,
  dateTime,
  useToast,
} from "../components/ui";
function useSettings() {
  const remote = useData<Settings & { geminiConfigured: boolean }>("/settings");
  const [settings, setSettings] = useState<
      (Settings & { geminiConfigured: boolean }) | null
    >(null),
    [busy, setBusy] = useState(false);
  const toast = useToast();
  useEffect(() => {
    if (remote.data) setSettings(remote.data);
  }, [remote.data]);
  const update = (key: keyof Settings, value: unknown) =>
    setSettings((s) => (s ? { ...s, [key]: value } : null));
  async function save() {
    if (!settings) return;
    setBusy(true);
    try {
      const { geminiConfigured, ...value } = settings;
      await request("/settings", "PATCH", value);
      toast("Settings saved.");
      return true;
    } catch (e) {
      toast((e as Error).message, true);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const markGeminiConfigured = () =>
    setSettings((s) => (s ? { ...s, geminiConfigured: true } : s));
  return { ...remote, settings, update, save, busy, markGeminiConfigured };
}
export function AISettings() {
  const { settings, update, save, busy, error, markGeminiConfigured } =
    useSettings();
  const [key, setKey] = useState(""),
    [savingKey, setSavingKey] = useState(false),
    [sample, setSample] = useState(""),
    [image, setImage] = useState<{
      data: string;
      mimeType: string;
      name: string;
    } | null>(null),
    [result, setResult] = useState<any>(null),
    [testing, setTesting] = useState(false),
    [testError, setTestError] = useState("");
  const toast = useToast();
  if (error) return <ErrorBox message={error} />;
  if (!settings) return <Skeleton />;
  return (
    <>
      <PageHeader
        title="AI settings"
        description="Your point of view, expressed consistently. Fine-tune how Gemini replies."
        actions={
          <Button className="primary" busy={busy} onClick={() => void save()}>
            <Save size={16} />
            Save settings
          </Button>
        }
      />
      <div className="settings-grid">
        <div>
          <Panel
            title="Gemini connection"
            description="Your key is encrypted and never displayed after saving."
            actions={
              <Badge tone={settings.geminiConfigured ? "green" : "neutral"}>
                {settings.geminiConfigured ? "Key saved" : "Not configured"}
              </Badge>
            }
          >
            <div className="panel-body">
              <Field label="Gemini API key">
                <div className="input-action">
                  <input
                    type="password"
                    autoComplete="new-password"
                    placeholder={
                      settings.geminiConfigured
                        ? "Enter a new key to replace the saved key"
                        : "Paste your Gemini API key"
                    }
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                  />
                  <Button
                    disabled={!key}
                    busy={savingKey}
                    onClick={async () => {
                      setSavingKey(true);
                      try {
                        await request("/settings/gemini-key", "PUT", { key });
                        setKey("");
                        markGeminiConfigured();
                        toast("Gemini key encrypted and saved.");
                      } catch (e) {
                        toast((e as Error).message, true);
                      } finally {
                        setSavingKey(false);
                      }
                    }}
                  >
                    Save key
                  </Button>
                </div>
              </Field>
              <Field
                label="Model"
                hint="Use a Gemini model available to your API key."
              >
                <input
                  value={settings.model}
                  onChange={(e) => update("model", e.target.value)}
                />
              </Field>
            </div>
          </Panel>
          <Panel
            title="Your master prompt"
            description="Set the voice and guidance for every reply, unless an account overrides it."
          >
            <div className="panel-body">
              <Field label="Reply instructions">
                <textarea
                  className="prompt-editor"
                  rows={10}
                  value={settings.prompt}
                  maxLength={8000}
                  onChange={(e) => update("prompt", e.target.value)}
                />
              </Field>
              <div className="form-two">
                <Field label="Preferred reply length">
                  <select
                    value={settings.replyLength}
                    onChange={(e) => update("replyLength", e.target.value)}
                  >
                    <option value="very-short">
                      Very short · 90 characters
                    </option>
                    <option value="short">Short · 180 characters</option>
                    <option value="medium">Medium · 260 characters</option>
                    <option value="custom">Custom maximum</option>
                  </select>
                </Field>
                {settings.replyLength === "custom" ? (
                  <Field label="Maximum characters">
                    <input
                      type="number"
                      min="20"
                      max="280"
                      value={settings.maxLength}
                      onChange={(e) =>
                        update("maxLength", Number(e.target.value))
                      }
                    />
                  </Field>
                ) : null}
              </div>
              <p className="helper-note">
                Be specific about your voice. Avoid generic praise, invented
                claims, and instructions to impersonate others.
              </p>
            </div>
          </Panel>
        </div>
        <Panel
          title="Try your prompt"
          description="A private preview. Test replies are never posted to X."
          className="preview-panel"
        >
          <div className="panel-body">
            <Field label="Sample post">
              <textarea
                rows={6}
                value={sample}
                onChange={(e) => setSample(e.target.value)}
                placeholder="Paste a post you’d like to respond to…"
                maxLength={12000}
              />
            </Field>
            <label className="upload-button">
              <ImagePlus size={17} />{" "}
              {image ? image.name : "Add an image (optional)"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    toast("Use an image smaller than 5 MB.", true);
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    setImage({
                      name: file.name,
                      mimeType: file.type,
                      data: String(reader.result).split(",")[1],
                    });
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            {image ? (
              <Button onClick={() => setImage(null)}>
                <X size={14} />
                Remove image
              </Button>
            ) : null}
            <Button
              className="primary full-width"
              disabled={!sample}
              busy={testing}
              onClick={async () => {
                setTesting(true);
                setTestError("");
                try {
                  if (!(await save())) return;
                  setResult(
                    await request("/ai/preview", "POST", {
                      text: sample,
                      prompt: settings.prompt,
                      ...(image
                        ? {
                            image: {
                              data: image.data,
                              mimeType: image.mimeType,
                            },
                          }
                        : {}),
                    }),
                  );
                } catch (e) {
                  setTestError((e as Error).message);
                } finally {
                  setTesting(false);
                }
              }}
            >
              <Sparkles size={16} />
              {testing ? "Generating reply…" : "Generate test reply"}
            </Button>
            {testError ? <ErrorBox message={testError} /> : null}
            <div className="preview-result">
              <span className="eyebrow">GEMINI PREVIEW</span>
              {result ? (
                <>
                  <p>{result.text}</p>
                  <small>
                    {[...result.text].length} characters · {result.tokens}{" "}
                    tokens · {(result.duration / 1000).toFixed(1)}s
                  </small>
                </>
              ) : (
                <>
                  <div className="preview-lines">
                    <span />
                    <span />
                    <span />
                  </div>
                  <p className="muted">
                    Your generated reply will appear here.
                  </p>
                </>
              )}
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}
export function AutomationSettings() {
  const { settings, update, save, busy, error } = useSettings();
  const { data: status } = useData("/automation/status", 5000);
  if (error) return <ErrorBox message={error} />;
  if (!settings) return <Skeleton />;
  return (
    <>
      <PageHeader
        title="Automation settings"
        description="A steady cadence and clear limits. You decide how much happens."
        actions={
          <Button className="primary" busy={busy} onClick={() => void save()}>
            <Save size={16} />
            Save settings
          </Button>
        }
      />
      <div className="settings-grid">
        <Panel
          title="Monitoring cadence"
          description="RSS checks do not launch a browser."
        >
          <div className="panel-body">
            <Field
              label="Global interval (minutes)"
              hint="Between 0.5 (30s) and 1,440 minutes. Accounts can override this."
            >
              <input
                type="number"
                min="0.5"
                step="0.5"
                max="1440"
                value={settings.interval}
                onChange={(e) => update("interval", Number(e.target.value))}
              />
            </Field>
            <div className="interval-presets">
              {[0.5, 5, 10, 15, 30].map((n) => (
                <Button
                  className={settings.interval === n ? "active-preset" : ""}
                  key={n}
                  onClick={() => update("interval", n)}
                >
                  {n === 0.5 ? "30s" : `${n} min`}
                </Button>
              ))}
            </div>
            <div className="setting-row">
              <div>
                <strong>Read-only monitoring while paused</strong>
                <p>
                  Keep observing feeds without taking actions. These posts won’t
                  trigger a catch-up burst.
                </p>
              </div>
              <Toggle
                label="Read-only monitoring while paused"
                checked={settings.readOnlyWhenPaused}
                onChange={(v) => update("readOnlyWhenPaused", v)}
              />
            </div>
            <Field label="Network timeout (seconds)">
              <input
                type="number"
                min="15"
                max="120"
                value={settings.timeout / 1000}
                onChange={(e) =>
                  update("timeout", Number(e.target.value) * 1000)
                }
              />
            </Field>
            <Field
              label="Maximum read retries"
              hint="0–3 retries with exponential backoff. Uncertain submissions are never replayed."
            >
              <input
                type="number"
                min="0"
                max="3"
                value={settings.retries}
                onChange={(e) => update("retries", Number(e.target.value))}
              />
            </Field>
          </div>
        </Panel>
        <Panel
          title="Action budgets"
          description="Reserved and uncertain attempts count conservatively."
        >
          <div className="panel-body">
            {[
              ["repliesPerHour", "Maximum replies per hour", 100],
              ["likesPerHour", "Maximum likes per hour", 300],
              ["repostsPerHour", "Maximum reposts per hour", 100],
              ["actionsPerDay", "Maximum actions per day (UTC)", 1000],
            ].map(([key, label, max]) => (
              <Field key={key} label={String(label)}>
                <input
                  type="number"
                  min="0"
                  max={max}
                  value={settings[key as "repliesPerHour"]}
                  onChange={(e) =>
                    update(key as keyof Settings, Number(e.target.value))
                  }
                />
              </Field>
            ))}
            <p className="info-note">
              Use 0 to prevent that action. Limits defer new actions until
              capacity is available.
            </p>
          </div>
        </Panel>
      </div>
      <Panel
        title="Scheduler status"
        actions={
          <Badge tone={status?.paused ? "neutral" : "green"}>
            {status?.paused ? "Paused" : "Running"}
          </Badge>
        }
      >
        <div className="health-list">
          <div>
            <span>Next scheduled scan</span>
            <strong>
              {status?.paused && !settings.readOnlyWhenPaused
                ? "Paused"
                : dateTime(status?.nextScan)}
            </strong>
          </div>
          <div>
            <span>Last completed scan</span>
            <strong>{dateTime(status?.lastScan?.completedAt)}</strong>
          </div>
          <div>
            <span>Last scan duration</span>
            <strong>
              {status?.lastScan
                ? (status.lastScan.duration / 1000).toFixed(1) + "s"
                : "—"}
            </strong>
          </div>
          <div>
            <span>Worker</span>
            <strong>{status?.busy ? "Processing" : "Idle"}</strong>
          </div>
        </div>
        {status?.jobs.length ? (
          <div className="job-list">
            {status.jobs.slice(0, 5).map((j: any) => (
              <div key={j.id}>
                <strong>@{j.username}</strong>
                <span>{j.status.replaceAll("_", " ")}</span>
                {j.error ? <small>{j.error}</small> : null}
              </div>
            ))}
          </div>
        ) : null}
      </Panel>
    </>
  );
}
export function SessionPage() {
  const { data: session, error, reload } = useData("/session", 5000);
  const [cookies, setCookies] = useState(""),
    [testing, setTesting] = useState(false),
    [confirm, setConfirm] = useState(false),
    [localError, setLocalError] = useState("");
  const toast = useToast();
  return (
    <>
      <PageHeader
        title="X session"
        description="Connect your own account using your existing browser session."
      />
      <div className="settings-grid">
        <Panel
          title="Connection status"
          actions={
            <Badge tone={session?.status === "valid" ? "green" : "neutral"}>
              {session?.status?.replaceAll("_", " ") || "Loading"}
            </Badge>
          }
        >
          <div className="panel-body">
            <div className="session-illustration">
              <ShieldCheck size={38} />
            </div>
            <h3>
              {session?.username
                ? `Connected as @${session.username}`
                : "Your account, securely connected"}
            </h3>
            <p className="muted">
              {session?.message || "Checking saved session status…"}
            </p>
            <div className="health-list compact">
              <div>
                <span>Credentials</span>
                <strong>
                  {session?.configured
                    ? "Encrypted and saved"
                    : "Not configured"}
                </strong>
              </div>
              <div>
                <span>Last verified</span>
                <strong>{dateTime(session?.checkedAt)}</strong>
              </div>
            </div>
            <Button
              className="primary"
              disabled={!session?.configured}
              busy={testing}
              onClick={async () => {
                setTesting(true);
                setLocalError("");
                try {
                  await request("/session/test", "POST");
                  await reload();
                  toast("X session verified. You can now resume automation.");
                } catch (e) {
                  setLocalError((e as Error).message);
                  await reload();
                } finally {
                  setTesting(false);
                }
              }}
            >
              <ShieldCheck size={16} />
              Test authentication
            </Button>
            {error || localError ? (
              <ErrorBox message={error || localError} />
            ) : null}
          </div>
        </Panel>
        <Panel
          title="Session credentials"
          description="Only use cookies from an X account you own."
        >
          <div className="panel-body">
            <Field
              label="Cookies (JSON array)"
              hint="Include auth_token and ct0. Exported cookie values stay write-only."
            >
              <textarea
                className="code-input"
                rows={10}
                autoComplete="off"
                spellCheck={false}
                value={cookies}
                onChange={(e) => setCookies(e.target.value)}
                placeholder={
                  '[\n  { "name": "auth_token", "value": "…" },\n  { "name": "ct0", "value": "…" }\n]'
                }
              />
            </Field>
            <Button disabled={!cookies.trim()} onClick={() => setConfirm(true)}>
              <KeyRound size={16} />
              {session?.configured ? "Replace credentials" : "Save credentials"}
            </Button>
            <p className="helper-note">
              Saving credentials pauses automation. A successful live
              authentication test is required before resuming.
            </p>
          </div>
        </Panel>
      </div>
      <Panel title="How to connect">
        <div className="instructions">
          <div>
            <span>01</span>
            <h3>Sign in to X</h3>
            <p>
              Open x.com in your own browser and complete any login or
              verification steps.
            </p>
          </div>
          <div>
            <span>02</span>
            <h3>Copy your session cookies</h3>
            <p>
              In browser developer tools, open Application → Cookies → x.com.
              Copy auth_token and ct0 into the JSON format above.
            </p>
          </div>
          <div>
            <span>03</span>
            <h3>Save, then verify</h3>
            <p>
              Save your credentials and test authentication. Signaldesk checks X
              directly before enabling actions.
            </p>
          </div>
        </div>
      </Panel>
      {confirm ? (
        <Confirm
          title={
            session?.configured
              ? "Replace your X credentials?"
              : "Save your X credentials?"
          }
          description="Automation will pause, the browser session will close, and these encrypted credentials will replace any saved session."
          label="Save encrypted credentials"
          onClose={() => setConfirm(false)}
          onConfirm={async () => {
            let parsed;
            try {
              parsed = JSON.parse(cookies);
            } catch {
              throw new Error("Enter a valid JSON array of cookie objects.");
            }
            await request("/session", "PUT", { cookies: parsed });
            setCookies("");
            await reload();
            toast("Credentials saved. Test authentication next.");
          }}
        />
      ) : null}
    </>
  );
}
export function SystemSettings() {
  const { settings, update, save, busy, error } = useSettings();
  const [testHandle, setTestHandle] = useState(""),
    [testingFeed, setTestingFeed] = useState(false);
  const [importData, setImportData] = useState<unknown>(null),
    [retention, setRetention] = useState(false);
  const toast = useToast();
  if (error) return <ErrorBox message={error} />;
  if (!settings) return <Skeleton />;
  return (
    <>
      <PageHeader
        title="System settings"
        description="Configure your feed sources and manage your local JSON data."
        actions={
          <Button className="primary" busy={busy} onClick={() => void save()}>
            <Save size={16} />
            Save settings
          </Button>
        }
      />
      <div className="settings-grid">
        <Panel
          title="RSS monitoring source"
          description="All scheduled post checks use feeds, not browser navigation."
        >
          <div className="panel-body">
            <Field label="Feed provider">
              <select
                value={settings.feedProvider}
                onChange={(e) => update("feedProvider", e.target.value)}
              >
                <option value="nitter">Nitter RSS</option>
                <option value="rsshub">RSSHub</option>
              </select>
            </Field>
            <Field
              label="Feed source URL"
              hint="Instance base URL, or an HTTPS template containing {username}."
            >
              <input
                type="url"
                placeholder="https://your-nitter-instance.example"
                value={settings.feedUrl}
                onChange={(e) => update("feedUrl", e.target.value)}
              />
            </Field>
            <Field
              label="Fallback feed URL (optional)"
              hint="Use a full {username} template if the fallback uses a different provider."
            >
              <input
                placeholder="https://your-rsshub.example/twitter/user/{username}"
                value={settings.fallbackFeedUrl}
                onChange={(e) => update("fallbackFeedUrl", e.target.value)}
              />
            </Field>
            <Field label="Test feed for a username">
              <div className="input-action">
                <input
                  placeholder="@username"
                  value={testHandle}
                  onChange={(e) => setTestHandle(e.target.value)}
                />
                <Button
                  disabled={!testHandle}
                  busy={testingFeed}
                  onClick={async () => {
                    setTestingFeed(true);
                    try {
                      if (!(await save())) return;
                      const result = await request("/monitoring/test", "POST", {
                        username: testHandle,
                      });
                      toast(
                        `${result.count} posts read. No actions performed.`,
                      );
                    } catch (e) {
                      toast((e as Error).message, true);
                    } finally {
                      setTestingFeed(false);
                    }
                  }}
                >
                  Test RSS
                </Button>
              </div>
            </Field>
            <p className="info-note">
              Public instances can be unavailable. Use a reliable instance you
              control when possible. Feed errors never reset your baseline or
              mark accounts invalid.
            </p>
          </div>
        </Panel>
        <Panel
          title="Account verification"
          description="Verify a profile once before tracking it."
        >
          <div className="panel-body">
            <Field label="Verification provider">
              <select
                value={settings.verificationProvider}
                onChange={(e) => update("verificationProvider", e.target.value)}
              >
                <option value="nitter">Nitter profile</option>
                <option value="rss">RSS profile identity</option>
                <option value="x">Authenticated X browser</option>
              </select>
            </Field>
            <Field
              label="Nitter profile source URL"
              hint="Used for profile verification; also a fallback base for Nitter feeds."
            >
              <input
                type="url"
                value={settings.mirrorUrl}
                onChange={(e) => update("mirrorUrl", e.target.value)}
                placeholder="https://your-nitter-instance.example"
              />
            </Field>
            <p className="helper-note">
              Choosing X verification opens a browser only when you add an
              account. Scheduled monitoring always uses RSS.
            </p>
          </div>
        </Panel>
      </div>
      <div className="settings-grid">
        <Panel
          title="Local storage"
          description="One human-readable JSON file. Encrypted secret values."
        >
          <div className="panel-body">
            <div className="storage-file">
              <span>{"{ }"}</span>
              <div>
                <strong>data/state.json</strong>
                <small>
                  Atomic writes · recovery backup · single process lock
                </small>
              </div>
              <Badge tone="green">JSON</Badge>
            </div>
            <Field label="Log level">
              <select
                value={settings.logLevel}
                onChange={(e) => update("logLevel", e.target.value)}
              >
                <option value="INFO">Info and above</option>
                <option value="WARNING">Warnings and errors</option>
                <option value="ERROR">Errors only</option>
              </select>
            </Field>
            <Field
              label="History detail retention (days)"
              hint="Cleanup removes older post content and logs; post IDs and action deduplication remain."
            >
              <input
                type="number"
                min="7"
                max="3650"
                value={settings.retentionDays}
                onChange={(e) =>
                  update("retentionDays", Number(e.target.value))
                }
              />
            </Field>
            <Button onClick={() => setRetention(true)}>
              Clean up older details
            </Button>
          </div>
        </Panel>
        <Panel
          title="Configuration portability"
          description="Export settings without exposing credentials."
        >
          <div className="panel-body">
            <p className="muted">
              Exports include global and per-account settings. Imports update
              existing verified accounts and pause automation. Add new accounts
              through verification.
            </p>
            <div className="inline-actions">
              <a className="button" href="/api/settings/export" download>
                <Download size={16} />
                Export configuration
              </a>
              <label className="button">
                <Upload size={16} />
                Import JSON
                <input
                  className="sr-only"
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      if (file.size > 1024 * 1024)
                        throw new Error(
                          "Configuration file must be smaller than 1 MB.",
                        );
                      setImportData(JSON.parse(await file.text()));
                    } catch (error) {
                      toast((error as Error).message, true);
                    }
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
            <p className="helper-note">
              Back up state.json together with its separate encryption key to
              preserve the full workspace. Configuration exports are not full
              backups.
            </p>
          </div>
        </Panel>
      </div>
      {importData ? (
        <Confirm
          title="Import configuration?"
          description="This replaces global settings and updates settings for matching verified accounts. Automation will pause. Secrets are not imported."
          label="Import settings"
          onClose={() => setImportData(null)}
          onConfirm={async () => {
            await request("/settings/import", "POST", importData);
            toast("Configuration imported. Reloading settings.");
            location.reload();
          }}
        />
      ) : null}
      {retention ? (
        <Confirm
          title="Clean up older history details?"
          description="Old post text, AI context, and logs will be removed according to the saved retention setting. Deduplication IDs remain. This cannot be undone from the dashboard."
          label="Clean up details"
          onClose={() => setRetention(false)}
          onConfirm={async () => {
            await request("/system/retention", "POST");
            toast("Older details removed; duplicate protection preserved.");
          }}
        />
      ) : null}
    </>
  );
}

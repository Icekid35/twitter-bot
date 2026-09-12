# Signaldesk

A local-first X automation workspace built with Node.js, React, Puppeteer, and Gemini. **New posts are checked through RSS, without opening a browser. All application state is saved in `data/state.json`.**

Puppeteer is used for X authentication, optional profile verification, and enabled reply/like/repost actions. No SQLite or database server is required.

## Features

- Light, responsive dashboard with overview, accounts, activity, analytics, logs, AI settings, automation controls, session management, and system settings.
- Nitter RSS or RSSHub monitoring with configurable URLs, a fallback source, bounded network retries, per-account intervals, and a durable single-worker queue.
- Profile verification through Nitter, RSS identity, or an authenticated X session.
- Persistent first-scan baseline, original/reply/repost/quote filters, and stable post-ID deduplication.
- Independent reply, like, and repost settings per account; independent action results.
- Gemini prompt editor, per-account override, response length control, image preview, multimodal input, and explicit media-availability records.
- AES-256-GCM encrypted X cookies and Gemini key, write-only secret APIs, loopback-only server, origin checks, and restricted resource downloads.
- Hourly and daily action budgets, emergency pause, optional read-only monitoring, restart recovery, and manual reconciliation of uncertain actions.
- Filtered activity/logs, account statistics, real activity charts, JSON configuration export/import, and detail retention cleanup.

## Requirements

- Node.js **24 or newer**, npm, and macOS/Linux/Windows.
- A working public HTTPS Nitter or RSSHub instance/feed for monitoring. Public instances are not guaranteed to be available; a maintained instance under your control is preferable.
- Chrome/Chromium for session verification and X actions. The app tries Puppeteer's bundled browser, then common installed Chrome locations. `CHROME_EXECUTABLE_PATH` overrides detection.
- A Gemini API key for reply generation and an authenticated X session for external actions. RSS-only monitoring needs neither.

## Installation

```sh
npm install
cp .env.example .env
npm run build
npm start
```

Open **http://127.0.0.1:4318**. The workspace begins paused with empty activity. If Chrome isn't installed:

```sh
npx puppeteer browsers install chrome
```

The browser is not launched just by starting the server or checking RSS feeds.

## Development

```sh
npm run dev
```

Open **http://127.0.0.1:5173**. Vite proxies API requests to port 4318. Stop an existing production server before starting development against the same data directory.

```sh
npm run check     # TypeScript checks
npm test          # Store, RSS, API, worker, and intercepted-browser tests
npm run build    # TypeScript + optimized frontend build
```

Browser tests require an installed Chrome or Puppeteer browser. They intercept every request and use synthetic HTML/JSON fixtures; they do not contact X or perform social actions.

## Environment variables

| Variable                 | Default                | Purpose                                                                 |
| ------------------------ | ---------------------- | ----------------------------------------------------------------------- |
| `PORT`                   | `4318`                 | Local API and production dashboard port                                 |
| `DATA_DIR`               | `./data`               | JSON state, backup, process lock, and optional local key                |
| `ENCRYPTION_KEY`         | Generated local `.key` | Optional 64-character hexadecimal AES key                               |
| `GEMINI_API_KEY`         | Empty                  | Optional environment-based Gemini key; a dashboard key takes precedence |
| `GEMINI_MODEL`           | `gemini-3.5-flash`     | Initial model setting; saved settings take precedence                   |
| `CHROME_EXECUTABLE_PATH` | Auto-detected          | Explicit Chrome/Chromium executable                                     |
| `HEADLESS`               | `true`                 | Set `false` to display the automation browser                           |

Generate an environment encryption key if desired:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the same encryption key for an existing workspace. Never commit `.env`, `data/`, cookies, or keys. Unix data directories use mode 0700 and sensitive files use 0600; Windows users should restrict access with their operating system's file permissions.

## RSS monitoring setup

1. Open **System Settings**.
2. Choose **Nitter RSS** or **RSSHub**.
3. Enter your instance base URL, or a full URL template containing `{username}`.
4. Optionally add a fallback URL template.
5. Save settings and use **Test RSS** with a handle. Testing reads the feed without saving posts or taking actions.

Examples (replace these illustrative domains with working instances):

```text
Nitter base:     https://nitter.your-domain.example
Nitter template:https://nitter.your-domain.example/{username}/rss
RSSHub base:     https://rsshub.your-domain.example
RSSHub template:https://rsshub.your-domain.example/twitter/user/{username}
```

A Nitter base expands to `/{username}/rss`; an RSSHub base expands to `/twitter/user/{username}`. Nitter's `with_replies` RSS route is used when reply monitoring is enabled. A fallback using a different provider should use a full template.

Downloads require public HTTPS addresses and port 443. Loopback, private networks, and credential-bearing URLs are rejected. To use a private deployment, expose it through a suitable public HTTPS endpoint. This is a deliberate boundary against unintended requests into local services.

Nitter or RSSHub must themselves have working access to X. Signaldesk cannot repair a broken upstream instance. Unknown HTML, malformed entries, and network failures leave the baseline intact and apply bounded backoff. Profiles are not marked invalid merely because a source fails.

Feeds expose a bounded recent window, not a complete archive. Long outages can leave gaps. Different feed generators expose different reply/quote metadata; verify your source with representative posts before enabling actions. Unrecognized authors/types are skipped. Nitter video entries often provide only thumbnails: these are recorded as incomplete video context, never as full video analysis.

## Adding accounts

Open **Tracked Accounts**, choose **Track an account**, and enter a handle such as `@username`. Handles are normalized and verified before saving.

Choose a verification provider in System Settings:

- **Nitter profile:** verifies HTML profile identity and stores available name/bio/avatar information.
- **RSS profile identity:** validates the feed and checks channel identity; useful with RSSHub. Feed metadata may provide less profile information.
- **Authenticated X browser:** verifies the profile using your authenticated browser, only when adding an account.

The first successful monitoring scan establishes a baseline and records existing posts as skipped. Only subsequently observed eligible posts published after the baseline can trigger actions. Old pinned posts, repeated text with the same ID, and posts seen before restart cannot silently become new work.

## Gemini setup

Open **AI Settings**, save your Gemini API key, select a model available to your key, and edit the master prompt. The default reply length is 180 characters. Very short, medium, and custom settings are available; overlong/empty responses fail without posting.

Use **Generate test reply** with sample text and an optional PNG/JPEG/WebP image up to 5 MB. It saves the current AI settings and runs Gemini without posting anything. Account-specific prompt overrides replace the global prompt.

Production generation sends author/text/quote context plus up to four retrievable media attachments. Supported downloads are JPEG, PNG, WebP, and MP4, with per-file limits of 5 MB for images and 12 MB for video. Streaming-only video, oversized media, and download errors are recorded. When essential video is missing and text is insufficient, the reply is skipped rather than inferred from a thumbnail. Token counts, model, context, media status, and generated replies are saved in activity.

Official integration references: [Gemini JavaScript SDK](https://googleapis.github.io/js-genai/) and [Gemini media documentation](https://ai.google.dev/gemini-api/docs/video-understanding).

## X session setup

1. Sign in to your own account at x.com in your normal browser. Complete any verification there.
2. In browser developer tools, inspect **Application → Cookies → x.com**.
3. Copy `auth_token` and `ct0` into the JSON form in **X Session**:

```json
[
  { "name": "auth_token", "value": "YOUR_AUTH_TOKEN" },
  { "name": "ct0", "value": "YOUR_CT0_COOKIE" }
]
```

4. Save credentials, confirm replacement, then choose **Test authentication**.
5. A successful live check identifies the signed-in profile. Loading cookies alone does not mark the session valid.

Saving cookies pauses automation and closes the previous browser. Secrets are encrypted in JSON and never returned by read endpoints. Expiration, challenges, and suspicious-activity screens stop actions. Resolve challenges manually on X; the app does not bypass them. Test restored credentials and explicitly resume.

## Running automation

Configure each tracked account's monitoring, actions, filters, interval override, and optional prompt. Actions default off; originals default on and replies/reposts/quotes default off.

In **Automation Settings**, set the global interval (5–1,440 minutes), bounded read retries, timeout, and action budgets. Choose **Resume automation** after feed/session setup succeeds. Reply-enabled accounts also require Gemini configuration.

For RSS-only use, keep global automation paused and enable **Read-only monitoring while paused**. Feeds and baseline state will update without launching Chrome. Posts observed this way are not automatically replayed as a catch-up burst when actions resume.

Pause prevents subsequent external mutations, but a network submission already dispatched may finish. Its result is still recorded. Deferred work is skipped when the operator pauses. Per-account removal preserves action tombstones and cancels queued monitoring.

## Duplicate protection and uncertain outcomes

Action identity is `(acting account, stable post ID, action type)`. The reservation is written durably before browser work. Likes and reposts check existing state and confirm the resulting UI. Replies require a matching submission response containing a server-issued reply ID.

A network failure after submission can make the outcome unknowable. Such actions are marked **uncertain** and never automatically replayed. Inspect X, open the activity detail, and manually mark the outcome confirmed or not completed. Reconciliation does not retry it. This favors duplicate prevention over guaranteed delivery; no browser UI can provide a distributed exactly-once guarantee.

All reservations and uncertain attempts count conservatively against budgets. Read retries use bounded exponential backoff. External mutations are not blindly retried.

## JSON persistence and backup

```text
data/
  state.json       # Settings, accounts, posts, actions, jobs, scans, logs, encrypted secrets
  state.json.bak   # Previous committed version
  .key             # Local encryption key, unless ENCRYPTION_KEY is supplied
  process.lock     # Single-writer process ownership
```

Each commit clones state, writes a temporary JSON file, flushes it, backs up the previous file, and atomically renames the new file. A process lock prevents multiple workers using the same data directory. A write failure stops automation. Restart always starts paused and marks interrupted reservations uncertain.

For a full backup, stop the app and copy `state.json` together with `.key` (or preserve the environment encryption key separately). Configuration export omits secrets and history and is not a full backup.

Corrupt JSON fails closed. The app does **not** automatically roll back to an older backup because doing so could forget recently completed actions. Restore a reviewed backup explicitly while stopped, reconcile actions since its timestamp, and inspect state before resuming. Never delete deduplication records to make an uncertain action run again.

The complete state is held in memory and rewritten per transaction. This is designed for a local personal workspace, not a distributed/high-volume service. Use retention cleanup to bound verbose content. Cleanup retains IDs and action tombstones. Do not edit the JSON while the server is running.

## Architecture and project structure

```text
client/
  components/      Accessible controls, dialogs, status and layout primitives
  hooks/           API loading/polling
  pages/           Overview, accounts, activity, analytics, logs and configuration
  services/        API client
server/
  ai/              Gemini generation and bounded media pipeline
  automation/      Serialized worker and action orchestration
  browser/         Puppeteer session/actions, executable detection, centralized selectors
  database/        Atomic JSON store (directory name is a persistence-layer boundary)
  monitoring/      Nitter/RSSHub parsing and HTTP monitoring
  routes/          Validated API endpoints
  scheduler/       Due-time scheduling and backoff
  services/        Profile verification and statistics
  utils/           Encryption, errors and secure HTTP downloads
shared/            Request schemas and shared types
tests/             Reliability, API, feed and browser fixture tests
docs/              Design and implementation notes
```

The browser worker owns external UI operations, while monitoring is a separate RSS adapter. UI interactions call validated APIs rather than Puppeteer directly. Logs and all application records live in JSON; no database engine is loaded.

## API overview

Endpoints are under `/api`. Mutations require JSON and `X-Signaldesk: 1`; foreign origins are rejected.

| Resource                                                              | Operations                                     |
| --------------------------------------------------------------------- | ---------------------------------------------- |
| `/accounts`, `/accounts/:id`                                          | List, verify/add, view, remove                 |
| `/accounts/:id/settings`, `/accounts/:id/scan`, `/accounts/:id/stats` | Configure, queue scan, statistics              |
| `/monitoring/test`                                                    | Read-only feed test                            |
| `/history`, `/history/:id`                                            | Paginated/filtered history and event details   |
| `/actions/:id/resolve`                                                | Reconcile an uncertain outcome                 |
| `/stats`, `/logs`                                                     | Analytics and paginated logs                   |
| `/settings`, `/settings/export`, `/settings/import`                   | Configuration                                  |
| `/settings/gemini-key`, `/ai/preview`                                 | Write-only key and test generation             |
| `/session`, `/session/test`                                           | Write-only cookies and live session validation |
| `/automation/start`, `/automation/pause`, `/automation/status`        | Global controls and scheduler state            |
| `/system/retention`, `/health`                                        | Cleanup and health                             |

## Deployment boundary

The server binds only to `127.0.0.1`. This is a local single-operator product, not a multi-tenant hosted SaaS. Do not expose it publicly through an unauthenticated proxy. Use an SSH tunnel for access from another trusted device, or add and validate an authenticated deployment layer before public hosting.

## Troubleshooting

- **RSS source unavailable:** test the configured URL, inspect instance health, and use a fallback template. An HTML error page is not a feed.
- **Verification unavailable:** choose another Nitter profile source or RSS/X verification. A temporary source failure is not an invalid handle.
- **No new actions:** check baseline state, post timestamps, filters, monitoring toggles, global pause, Gemini configuration, valid X session, and budgets.
- **Replies absent from feed:** use a source that exposes replies; Nitter `with_replies` is selected for accounts with replies enabled.
- **Chrome not found:** install Chrome, run `npx puppeteer browsers install chrome`, or set `CHROME_EXECUTABLE_PATH`.
- **X session expired/challenge:** resolve it in your own X browser, replace cookies, and test authentication.
- **X selectors changed:** update `server/browser/selectors.ts` and adapter confirmation logic, then run fixture and authorized live validation. Do not loosen success checks to make errors disappear.
- **Gemini quota/model error:** check key permissions, selected model, billing/quota, and network connectivity. The API error is recorded without exposing the key.
- **Uncertain action:** inspect X and reconcile from activity details; do not force an automatic retry.
- **Storage error:** check free disk space and permissions, preserve files, and restart after correcting the issue.
- **Already running:** stop the other process. Only remove a stale lock after confirming its PID is no longer running.
- **Lost key:** restore the original key from backup. Encrypted cookies and API keys cannot be recovered without it.

## Validation limits

Local tests exercise feed fixtures, durable state, encryption, limits, pause, API validation, and intercepted browser controls. These do not prove compatibility with the current live X UI or availability of a particular Nitter/RSSHub instance. Live session validation, Gemini generation, and social actions require your credentials and a working source and must be verified in your environment before unattended use.

## Automatically finding a feed source

Run the reusable discovery command to probe the candidate instances, reject non-feed/error/approval pages, and rank recent valid RSS responses:

```sh
npm run discover:feeds
# With the local server running, also save the selected primary/fallback:
npm run discover:feeds -- --apply
```

Discovery tests NASA and GitHub on each candidate, then Elon Musk on passing finalists. It uses at most three concurrent hosts and does not send cookies, launch Chrome, add tracked accounts, or change automation's paused state. Reports are saved as `data/instance-selection.json`. With `--apply`, only successfully tested sources are written through the API; no healthy result leaves existing settings unchanged. The candidate list is in `scripts/discover-feeds.ts` and can be updated from the linked instance directories.

This workspace was configured on **7 September 2026** with **x.n0g.xyz** as primary RSS and **nitter.meowing.monster** as fallback, with RSS-based account verification. Both passed multiple real feed checks; this is not an uptime guarantee. See [the verification record](docs/verification.md).

## Mac app

Double-click `release/Signaldesk.app` to open Signaldesk in its own Mac window. Node and the app dependencies are bundled; Terminal and `npm start` are not needed. You can drag the app into Applications. The build is for this Mac's architecture.

If the terminal version is running, stop it with Control-C before the first app launch. The app copies the existing workspace and configuration once, preserving the source files. The desktop workspace lives in `~/Library/Application Support/Signaldesk/data/`, with its environment configuration in `~/Library/Application Support/Signaldesk/config.env`. Later launches use that workspace, including after rebuilding the app. The terminal version still uses the project's `data/` folder; use the desktop app consistently after switching.

Closing the window or pressing Command-Q pauses automation, saves state, and terminates the owned server. Startup always remains paused until you resume. An unresponsive shutdown has a 30-second limit; interrupted actions retain the existing manual-reconciliation behavior. A second app launch activates the existing window. Logs for startup issues are in `~/Library/Application Support/Signaldesk/desktop.log`.

Build again after source changes:

```sh
npm run build:mac
node scripts/test-mac.mjs
```

The second command checks startup, rendering, and window-close shutdown in a temporary workspace. Quit the desktop app before running it. Building needs Apple's command-line developer tools. The app is locally signed for this machine; distributing it publicly would require Developer ID signing/notarization. Browser automation uses the existing Puppeteer browser cache or installed Chrome.

### Clear workspace data

The top-bar **Clear data** button asks for confirmation, pauses automation, waits for active work, and clears tracked accounts, observations, action history, queued jobs, logs, and statistics. AI, automation, feed/system settings, and saved credentials remain. Both the primary JSON and its rotating backup are cleared. Automation stays paused. Accounts added again establish a new baseline, so their old posts are not replayed.

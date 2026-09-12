# X automation platform design

Updated during implementation per user instruction: all scheduled monitoring uses Nitter/RSSHub HTTP feeds; application persistence is atomic JSON, not atomic JSON. Browser access is limited to session checks, optional profile verification, and enabled social actions.

## Scope and deployment

Build the complete requested local-first platform for one operator's authenticated X account and multiple tracked accounts. Use Node.js, TypeScript, React with Vite, an Express API, atomic JSON storage, Puppeteer, and Gemini. Keep monitoring, generation, and browser actions separate behind service interfaces. No fabricated activity, connected status, or analytics in the working application.

Recommended deployment: one Node process serves the compiled dashboard and API and owns the worker, bound to loopback by default. This minimizes installation and operational overhead. Remote access requires an authenticated HTTPS reverse proxy and explicit configuration; the application must not expose an unauthenticated API on a public interface.

Alternatives considered:

- PostgreSQL plus a separate queue/worker supports distributed deployment but adds operational cost without benefiting this single-operator scope.
- An official X API adapter could reduce dependence on browser selectors but changes the requested Puppeteer integration and introduces access requirements. Keep provider boundaries so it can be added later.

## Implementation divisions

1. Foundation: typed configuration, versioned state, encrypted secrets, validated API, logs, persistent state, and error taxonomy.
2. Integrations: session verification, replaceable account verification, post extraction, Gemini text/media processing, and confirmed browser actions.
3. Orchestration: baseline creation, filtering, durable jobs, duplicate protection, limits, pause, recovery, and retries.
4. Dashboard: all requested pages, real API integration, responsive layouts, accessible controls, and operational notifications.
5. Delivery: automated reliability tests, browser UI verification, setup documentation, and explicit live-integration verification status.

## Dashboard design

Use a light productivity interface with a narrow sidebar, white surfaces, subtle gray borders, restrained blue accents, compact typography, and generous section spacing. Use consistent line icons and status labels that do not rely only on color. Mobile uses a navigation drawer and account/activity cards rather than squeezed tables.

- Dashboard: automation and session states, setup checklist when incomplete, tracked/active counts, today's detected posts and actions, failure count, last/next scan, recent activity, and prominent pause/resume.
- Tracked Accounts: search and status filtering, verified add flow, profile information, quick monitoring/reply/like/repost toggles, last check, latest post, and errors.
- Account Details: profile, per-account actions, post-type filters, interval and prompt overrides, account activity, and statistics.
- Activity: paginated records with account/date/action/result/post-type filters; detail view includes source post, media handling, AI context, generated reply, individual outcomes, timings, and redacted event logs.
- Analytics: real daily post/action totals, generation and submission counts, success rate, failures, processing duration, Gemini token usage, and most active accounts. Empty datasets receive explanatory empty states.
- Logs: paginated, filterable severity/account/event records with safe messages.
- AI Settings: write-only Gemini key, editable model and master prompt, length presets/custom maximum, text and optional image test input, generated result and usage.
- Automation Settings: default interval, action budgets, bounded retry/network settings, pause behavior, scheduler status.
- Session: write-only cookie input, replace confirmation, explicit test, validated status, authenticated identity when available, and remediation instructions.
- System Settings: verification provider configuration, log level, retention, secret-free configuration export/import with validation and confirmation before replacement.

Use inline validation, loading skeletons, pending button states, retryable error feedback, temporary toasts, persistent blocking banners, keyboard-accessible dialogs, visible focus indicators, and confirmation for removal or credential replacement. Live monitoring remains off until setup succeeds and the operator starts it.

## API and persistence

Organize source into client components/pages/hooks/services and server routes/middleware/database/services/browser/monitoring/ai/scheduler/automation/utils. Shared schemas define validated request and response shapes.

API resources include accounts and per-account settings; history and event detail; stats; logs; settings; session replacement/test/status; AI preview; automation start/pause/status; and manual scan. List endpoints paginate and filter server-side. Browser work goes through the worker rather than executing directly inside routes.

The JSON document covers schema version, settings, encrypted secrets, accounts, posts, account-post observations, jobs, actions, generation results, scan runs, and logs. Use synchronous single-writer transactions, atomic rename, flush-to-disk, a prior-version backup, and explicit uniqueness checks. Save timestamps in UTC. Preserve action deduplication tombstones when purging verbose history or removing/re-adding tracked accounts. Configuration exports exclude secrets and action history.

## Session and browser ownership

Only one worker owns browser operations, including session tests, scans, and actions. Restore validated cookies at browser startup, then navigate to X and check authenticated UI state. Loading cookies alone never establishes a valid session.

Distinguish disconnected, checking, valid, expired, authentication failed, challenge detected, and reauthentication required. Login redirects, challenges, suspicious-activity warnings, unexpected blocking dialogs, and ambiguous page structure prevent actions. Authentication interruption pauses automation persistently and surfaces a banner. Restored credentials require a successful test before explicit resumption.

Centralize selectors and bounded navigation/wait helpers. Use DOM state and visibility, never absolute coordinates. Browser launch/crash failures terminate the current operation safely and expose an actionable error; recovery does not replay uncertain actions.

## Verification and monitoring

Normalize handles and validate syntax before network access. A provider interface returns valid, nonexistent, suspended, protected, unavailable, or temporary-network-failure results with available profile fields. Configure a Nitter-compatible HTTPS source; do not assume any public instance remains available. Permit a separately selected authenticated X verification provider as a fallback. Failed sources do not prove that an account is invalid.

Verification URLs and media requests must use constrained destinations, protocols, redirects, response sizes, and timeouts to prevent server-side requests to unintended local services. Mirror markup recognition must fail as unavailable when uncertain, rather than confidently accepting an arbitrary page.

Each account gets a durable initial baseline. The first successful scan records visible post IDs without actions. Subsequent eligibility requires an unseen stable ID and a publication time after the baseline, with an account-added timestamp safeguard. Parse chronological IDs/timestamps rather than relying on visual order because posts can be pinned. Record observed posts transactionally before queueing actions. RSS feeds are polled over HTTP; the browser is never used for scheduled timeline scanning.

Default filters: originals on; replies, reposts, and quotes off. Unknown classifications are skipped with a reason. Quote content remains separate from authored content. Do not claim complete detection during prolonged downtime or beyond the bounded timeline window; expose incomplete scans and extraction failures.

## Scheduling, actions, and recovery

Use a durable queue, one browser worker, and unique active-account jobs. Global intervals default to 10 minutes; allow 5–1,440 minutes and optional account overrides. Persist due times, scan start/end/duration, checked counts, and errors. Apply bounded exponential backoff for retryable reads and small delay variation for load smoothing. Never overlap jobs or attempt to bypass platform challenges.

Maintain independent action records keyed by acting account, stable post ID, and action type. Atomically reserve an action before interacting with X. Outcomes include pending, running, succeeded, failed, skipped, and uncertain. Interrupted running jobs become uncertain on recovery; they are not blindly retried.

Check existing liked/reposted states before mutation and confirm the resulting state afterward. For replies, capture a resulting reply ID or other positive submission evidence. If confirmation is missing after submission, retain an uncertain result for manual reconciliation. An exactly-once guarantee cannot be manufactured across a local persistence and a third-party browser UI; prioritize preventing duplicate attempts and clearly expose uncertainty.

Process reply, like, and repost independently in that order. AI failure may fail the reply while allowing enabled likes/reposts, unless a global/session stop applies. Recheck pause, session state, account configuration, and limits before every external mutation. Pause stops subsequent actions immediately; an already dispatched network submission may still finish and must be recorded.

Enforce hourly per-action and daily aggregate limits transactionally. Count reserved and uncertain attempts conservatively. Defer eligible actions when budgets are exhausted, checking current configuration again before execution. Paused monitoring may optionally continue read-only; posts observed during a pause are not automatically turned into a catch-up burst on resume.

## Gemini and media

Use the supported Gemini SDK after checking current official documentation during implementation. Keep model configurable. Supply the effective prompt (account override or global prompt), author, post text, classification, available media, and recent reply examples to reduce repetitive output. Treat post content as untrusted input, separate from instructions, and give the model no tools or secret access.

Support bounded image downloads and multiple images. Supply retrievable video through Gemini-supported upload/input paths with bounded size and processing time; do not pretend a thumbnail is full video understanding. Record media supplied, unavailable, partially analyzed, or skipped, plus reasons. If essential media is unavailable and text is insufficient, skip reply generation. For usable text with missing supplementary media, allow a recorded text-only fallback.

Validate nonempty output and configured character maximum before submission. Default short replies to a 180-character maximum and bound custom maximum to the supported posting limit. Store generated text, sanitized context, model, token usage, latency, and errors. Preview generation never posts anything.

## Secrets and application protection

Store Gemini and session secrets using authenticated encryption with a deployment key supplied outside the JSON file. Provide placeholder-only .env.example and gitignore all secrets, runtime databases, browser profiles, and logs. Restrict local runtime file permissions. Never return saved secrets through read APIs; expose only configured state. Do not log cookie input, keys, raw upstream request objects, or model headers.

Validate input, cap request sizes, restrict browser origins and host headers, and protect mutations against cross-origin requests. Authenticate non-loopback deployment. Serve a restrictive content security policy compatible with the app. Retention must preserve deduplication information. Import settings cannot silently enable automation or replace credentials.

## Verification and delivery criteria

Automated tests will exercise baseline exclusion including pinned old posts, classification/filtering, restart persistence, duplicate reservations, uncertain-action recovery, independent outcomes, limits, pause boundaries, queue serialization, secret redaction/encryption, request validation, and verification failure distinctions. Use controlled browser fixtures for selectors and confirmation paths and mocked Gemini responses for deterministic integration tests.

Run type checks, production build, backend integration tests, and responsive browser checks of setup, account settings, history filters, errors, and confirmation dialogs. Document exact checks and results.

Real X authentication/actions and live Gemini generation require operator credentials and working external services. Do not claim those integrations are verified until exercised with authorization and actual results. Never post test replies or perform social actions merely to validate the UI. Deliver a README covering installation, environment, development/production commands, session/Gemini setup, operation, architecture, JSON backup, recovery, and troubleshooting.

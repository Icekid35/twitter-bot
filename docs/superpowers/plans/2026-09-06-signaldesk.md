# Signaldesk Implementation Plan

**Goal:** Deliver the approved local-first X monitoring and automation application.
**Architecture:** One loopback Node API, one serialized browser worker, atomic JSON transactional state, and a React dashboard.
**Tech Stack:** TypeScript, Node 24, Express, atomic JSON, Puppeteer, React/Vite, Gemini.

## Global constraints
- Start paused; never fabricate integration success.
- Secrets never appear in read APIs or logs.
- Uncertain mutations are never automatically replayed.
- Credentials are required for live external validation.

## Tasks and verification
- [x] Foundation: shared schemas in `shared/schema.ts`; storage/migrations in `server/database/store.ts`; encryption and network boundaries in `server/utils/`. Test restart persistence, encryption, baseline exclusion, and atomic reservations in `tests/core.test.ts`.
- [x] Integrations: centralized browser selectors/adapter in `server/browser/`; configurable verification in `server/services/verification.ts` and RSS monitoring in `server/monitoring/rss.ts`; bounded Gemini media in `server/ai/gemini.ts`. Fixture tests must reject unknown markup and classify posts conservatively.
- [x] Worker: `server/automation/worker.ts` and `server/scheduler/scheduler.ts`; persistent jobs, no overlap, independent action outcomes, budgets and immediate pause checks. Test duplicate work, uncertain recovery, pause and partial failure using injected browser and AI adapters.
- [x] API: `server/routes/api.ts` and `server/index.ts`; validated account/settings/session/history/stats/log routes, same-origin restrictions, loopback binding, safe errors. Exercise health, invalid input, secret omission and forbidden origins.
- [x] Dashboard: reusable components, typed API hook, overview/accounts/activity/analytics/logs/settings/session pages. Connect all controls to real endpoints; handle pending, empty, error and destructive states.
- [x] Delivery: `README.md`, `npm test`, `npm run build`, and desktop/mobile browser validation. Record unverified live integration boundaries explicitly.

Execution is inline, as authorized by the user's request to proceed. Each task is reviewed against the approved design before completion.

User steering implemented: scheduled scans use Nitter/RSSHub feeds with configurable fallback, and all application state uses data/state.json. Validation: 17 automated tests pass, TypeScript and production build pass. Live credentials are not configured.

Final source discovery tested 19 instances and selected x.n0g.xyz with nitter.meowing.monster as fallback through the application API. Both passed three-account RSS checks; report saved in data/instance-selection.json.

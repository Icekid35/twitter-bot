# Verification record

## Local application

- TypeScript and production frontend build: passed.
- Automated suite: 17 tests passed. Covers baseline/pinned-old-post exclusion, encrypted JSON and corruption handling, restart reservations, action budgets, post filtering, read-only RSS scanning, serialized jobs, independent failures, pause during generation, uncertain outcomes, feed parsing, profile errors, network boundaries, real Nitter media URL normalization, JSON write failure stops, API secret omission/import atomicity, and browser action/challenge fixtures.
- Intercepted browser fixtures confirmed target selection, Like state, Repost confirmation, server-issued reply ID, pause checks, and challenge stop. Requests were intercepted; no X actions were performed.
- All nine dashboard routes rendered at 1440px and 390px without document-level horizontal overflow.
- Account form invalid-handle error verified in the browser.
- Real HTTP checks: health 200; foreign Origin 403; missing mutation header 403; untrusted Host 403 (using curl, since Node fetch does not send the supplied Host override).
- Public HTTPS downloader checked against example.com after fixing Node 24 DNS callback compatibility.
- npm audit returned zero vulnerabilities after the dependency updates. A later repeat could not reach the npm registry due to a temporary DNS failure; it did not produce a new audit result.

## Nitter source selection — 7 September 2026

Nineteen candidate instances were tested from the upstream directory and community directory. Each received RSS checks for NASA and GitHub. Passing finalists received repeated GitHub and Elon Musk checks. Responses had to contain actual X post IDs and publication dates; HTTP 200 alone was insufficient.

Configured by the final `npm run discover:feeds -- --apply` run at 05:34 UTC:

| Purpose | Source | Evidence |
|---|---|---|
| Primary RSS | `https://x.n0g.xyz` | NASA, GitHub, and Elon Musk feeds passed; mean 964 ms in the final run |
| Fallback RSS | `https://nitter.meowing.monster/{username}/rss` | All three feeds passed; mean 986 ms |
| Account verification | RSS identity on the primary source | Feed channel identity checked against the requested handle; no browser required |

The final discovery run rechecked 19 candidates. `tw.eir-nya.gay` also passed that round (mean 1,063 ms), but was slower and had failed an earlier confirmation read. `nitter.jaydenha.uk` passed the initial feed and HTML profile checks but did not pass all final confirmation checks. Selection reflects measured results, not a permanent ranking. The slight latency difference between the selected pair should not be interpreted as a meaningful long-term performance advantage.

The original eight upstream-listed candidates did not pass the complete RSS checks. XCancel returned an RSS reader-whitelisting notice, not posts. Other sources returned HTTP 400/403/404/410/429/503, DNS failure, or timeout. Challenge/approval requirements were not bypassed.

Complete timings and outcomes are in `data/instance-selection.json`, with the original JSON probe reports preserved in `data/`. Settings were saved through the application API. No tracked accounts were added and automation remains paused. These are point-in-time results from this machine, not an uptime guarantee.

Directories and source statements:

- https://github.com/zedeus/nitter/wiki/Instances
- https://codeberg.org/mv12star/shitter/wiki/Instances
- https://nitter.net/

## Still requiring operator credentials

Live Gemini generation, live X authentication, and real social actions have not been exercised. The operator must configure their credentials and validate those integrations before unattended operation. No test replies, likes, or reposts were sent.

Post-selection integration check: the application RSS test endpoint returned HTTP 200 with 16 NASA posts and 20 Elon Musk posts. Live feed CDN paths were normalized to HTTPS and covered by a regression test.

Mobile navigation was checked for opening, Escape closing, and removal of hidden links from keyboard navigation. A real image download from a selected feed returned HTTP 200 image/png (57,686 bytes) from pbs.twimg.com. The reusable discovery command was executed with --apply and persisted its selected URLs while retaining paused automation and zero tracked accounts.

### 2026-09-12 repost and media fixes

Saved observations showed an empty text/media post incorrectly generating a text-only reply. Browser fallback now extracts image/video elements. Before replying, missing media is recovered from the specific post's browser-loaded tweet data; playable MP4 variants are preferred over blob/HLS URLs. This lookup is restricted to posts needing media, not every RSS poll. Empty context is rejected before calling Gemini. Existing download size limits still apply (5 MiB per image, 12 MiB per video).

Repost confirmation accepts a matching CreateRetweet server result in addition to the Undo repost control, and supports an accessible Repost menu item when the test ID is missing. Fixture tests cover a stale button after server confirmation, media extraction, tweet-specific MP4 selection, and rejection of empty context. No real social actions were submitted during these checks. Existing uncertain actions remain pending manual reconciliation; they are not retried.

### Follow-up: truncated replies and moving repost menus

The user reported a published “Constraint Checklist” reply. A live generation using the same stored image reproduced `finishReason: MAX_TOKENS`: 491 thinking tokens consumed almost all of the previous 512-token output budget. The resulting fragment was previously accepted because validation only checked nonempty text and character count. Generation now requests a structured `reply`, allows 4096 output tokens (8192 on one validation retry), uses low thinking for Gemini 3, and accepts only STOP-completed, non-thought content with a complete sentence. Checklist/drafting output and malformed JSON fail validation. Two invalid outputs fail without producing publishable text. The configured user prompt remains intact. See [Gemini completion status documentation](https://ai.google.dev/api/generate-content).

A live non-posting test with the same image returned: “Pretty sure this is just the standard job description for most VC-backed startups.” Media status was analyzed. No social action was submitted by the diagnostic.

Live browser diagnostics blocked outgoing mutations. The raw menu click inconsistently dismissed the menu without emitting CreateRetweet; a Puppeteer locator click emitted the expected blocked request. An animated-menu fixture reproduced the failure with the old code (UNCONFIRMED) and passed after switching to a locator that waits for stable geometry. Explicit X rejection codes/messages now reach the action error and logs, with an explicit rejection marked failed rather than uncertain. The test also covers a server rejection without an optimistic UI update. A successful real repost has not been claimed or tested; outgoing repost requests were aborted in live diagnostics.

Validation: 23 automated tests pass; TypeScript and production build pass. Automation was paused via the running application's API during investigation. Existing action records were not replayed or removed.

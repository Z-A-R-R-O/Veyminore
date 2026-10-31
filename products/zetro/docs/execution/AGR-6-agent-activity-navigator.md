# AGR-6 agent activity navigator receipt

## Changes

- Replaced the left placeholder with a workspace agent tree sourced from `/api/status`. AGR, OCR, and RCT rows have evidence-based status, filters, collapse and show-more controls, selection, and a narrow-screen overlay.
- Reused the existing worker detail action. The three bottom docks and the right tool rail were not changed.
- Added focused status and ordering tests. An old worker update is treated as stale even if the status endpoint was polled recently.
- Refreshes leave the sidebar DOM untouched when visible content is unchanged. When content changes, the focused control is restored by identity; a disappearing agent row falls back to its group control.
- Added one static route for `/agent-nav.js` in `server.mjs`. This is required because the server uses an explicit static-file whitelist. No API payload, dispatch logic, provider, or backend contract changed.

## Verification

- `npm test`: 46 passed, 0 failed, including unchanged-refresh and focus-restoration coverage.
- `npm run build`: passed.
- `git diff --check`: passed (Git printed only line-ending conversion warnings).
- Browser check on a separate local server at port 4318: the Work page rendered 15 actual agents and retained all bottom docks. At 390 × 720, the compact rail opened an overlay that fit above the bottom dock.

## Limits

- Browser checks covered the Work route and the narrow overlay; no live dispatch was attempted.
- The already-running port 4317 process was not restarted, so it still serves the old asset whitelist until restart. The 4318 check used the new source.
- Worker states remain observations and are labeled unverified. RCT slots have no persistent runtime connection.

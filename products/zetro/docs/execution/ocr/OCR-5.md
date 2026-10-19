# OCR-5 Receipt — Computer Conformance Harness (Worker OCR-5)

Task: OCR-W1-conformance. Status: complete (authoring pass + duplicate-export fix + P1 fail-closed native & effect-boundary re-checks). Tests: **NOT RUN** by author (shell unavailable); coordinator reruns `npm test` after this fix.

Fix log 1: `src/index.js` line 342 duplicate-exported `SCENARIOS` (already `export const SCENARIOS`), breaking module import. Removed from final export list; behavior preserved.

Fix log 2 (P1): (a) native-live fail-closed ALWAYS blocked — `createIntegrationEntrypoints` returns `available:false/attested:false` (wiring only; caller-supplied ports/labels cannot self-certify native-live). (b) Mock `observerPort.observe` re-validates authority after the await effect boundary: grant existence/revocation/expiry plus exact target identity. (c) Regression scenarios: `wrong-target-during-observe`, `revoke-during-observe`, `expiry-during-observe`.

Fix log 3 (narrow blockers): (a) `beginObservation` now requires exact grant-target equality (`STALE_TARGET` at begin), and `observe` re-checks observation-vs-grant target at the effect boundary. (b) Expiry checks changed `>` to `>=` consistently in revoke/begin/observe (exact-expiry denied). New regressions: `direct-wrong-target-creation`, `exact-expiry` (11 scenarios; fixtures remain mock-only).

## File list (owned)

- `packages/computer-conformance/package.json` — package metadata, ESM, zero dependencies.
- `packages/computer-conformance/src/index.js` — offline conformance harness:
  injected contract/session/observer ports; scenarios: lifecycle
  (authenticate->grant->observe->revoke->stop->export audit), stale target, expired grant,
  canceled pending observation, malicious observer claim, evidence identity (forged digest).
  Modes distinguish mock verification vs native-live; native-live is blocked (never faked)
  without actual OCR-1/2/3 integration ports. Integration entrypoints defined via
  `createIntegrationEntrypoints({ ocr1, ocr2, ocr3 })`.
- `packages/computer-conformance/test/conformance.test.js` — `node --test` suite using
  fake-port fixtures (`createMockPorts`).
- `packages/computer-conformance/README.md` — states mocks-only status; actual OCR integration
  and Windows native **NOT VERIFIED**; lists remaining live gates.
- `docs/execution/ocr/OCR-5.md` — this receipt.

## Coverage boundaries

- Offline, dependency-free, deterministic. No desktop operations, no input effects, no network,
  no secrets, no installs, no root manifest edits, no existing-package edits.
- No workerclaims verification.
- Does not touch AGR's RCT product smoke scripts.
- Exact shared reads honored: `packages/protocol/src/index.js`, `packages/policy/src/index.js`
  (available; harness does not import them to stay dependency-free and offline-verifiable).

## Verification posture

- Implementation vs mock vs native-live are explicitly distinguished in report output
  (`verification` field; native-live `blocked: true` + `missing` list when packages absent).
- Not fabricating passing actual integration: OCR-1/2/3 wiring is an entrypoint contract only.

## Remaining live Windows gates (coordinator)

1. Run `npm test` in `packages/computer-conformance/` (NOT RUN by author).
2. Once OCR-1/2/3 packages are accepted, supply real ports via `createIntegrationEntrypoints`
   and re-run `mode: 'native-live'` against real Windows observer/desktop targets.
3. Verify audit export digests against a real session store.

Fix log 4 (OCR-W2 actual integration): added `src/actual-integration.js` + `test/actual-integration.test.js` consuming ACTUAL accepted packages via direct src imports (computer-contract OCR-1, computer-runtime OCR-2, computer-observer OCR-3). Real ComputerSession + real createObserver; boundary mocks ONLY: clock, token verifier, shared authority, trusted verifier port, audit sink, Windows metadata process runner. Label `offline-integration`, `nativeUnverified: true`. Flow: authenticate -> injected shared authority -> real observe -> contract request/result/trusted verification (PASSED) -> revoke -> emergencyStop -> audit export. Negatives: wrong-identity (principal_mismatch), future-target (RESPONSE_MALFORMED), stale-target (WINDOW_STALE), revoke-during-authority-await (session_revoked), authority-timeout (authority_timeout), bounds (observer_failed), no-trusted-verifier (never PASSED). Sibling packages unedited. package.json test script now `node --test test/`. Tests **NOT RUN** (no shell); coordinator runs.

Fix log 5 (actual-integration review): adapted harness to real ComputerSession lifecycle. (a) Revoke is terminal: `emergencyStop` after revoke is honestly rejected as already-terminal `session_stopped` (details.state 'revoked'); happy path asserts final state 'revoked', not 'stopped'. (b) Added terminal-state + zero-observer-effects assertions: post-revoke `observe` returns `session_revoked` and the capture counter proves the observer never ran. (c) Rebuilt revoke-during-authority negative with explicit authority start/release barriers: revoke is issued between authority-start and authority-completion; post-await effect gate returns `session_revoked` (full result JSON asserted); observer captures must be 0. (d) expectOk now includes full result JSON in failure messages. Actual imports kept; no sibling edits. Tests **NOT RUN** (no shell); coordinator reruns.

Fix log 6 (async assertion bug): `authority-timeout` and `bounds-oversize-runner-response` negatives passed an un-awaited `session.observe` Promise into `expectOk` (result `{}` → code undefined). Fixed with `await` at both call sites; audited all other `expectOk` sites (wrong-identity uses sync `start`; revoke/future/stale already awaited). Added: thenable guard in `expectOk`; `makeStack` capture counter proving authority-timeout is awaited/bounded (elapsed ≤ 2s, observerCaptures === 0) and that the bounds failure happens inside exactly 1 real observer attempt. No assertion loosening; actual imports retained; no sibling edits. Author tests **NOT RUN** (no shell); coordinator reruns.

Fix log 7 (OCR-W3 CLI): added `src/cli.js` + `test/cli.test.js`. CLI runs the existing offline actual-package integration + negative suite (no duplication, no faked measurements), prints a bounded JSON report (schemaVersion `zetro.computer-conformance.report.alpha.v1`, mode `offline-integration`, `nativeVerified:false`, actual package names/entries, per-scenario outcomes; `serializeReport` enforces ≤16KB). Exit codes: 0 pass, 1 scenario failure (fail-closed on unknown outcomes), 2 native-live blocked. `--native-live` always blocked/never self-certified. package.json gained `bin` entry; README documents invocation. Tests cover report identity, bounded size, negative failure propagation (via `summarizeScenarios` on synthetic report-logic input, not faked measurements), and native-live fail-closed exit. No sibling edits, no network/shell/desktop/secrets. Author tests **NOT RUN** (no shell); coordinator reruns.

Fix log 8 (serializeReport UTF-8 bound): `serializeReport` compared `string.length` to `REPORT_MAX_BYTES`, under-counting multibyte text (e.g. 6000×'界' = 18016 UTF-8 bytes passed a 16384 bound). Now enforces `Buffer.byteLength(json, 'utf8')`; error reports byte counts. Added multibyte boundary regression (`serializeReport` test: over-bound CJK rejected with byte message; under-bound CJK accepted). Actual integration results and exit codes unchanged (0/1/2). Own package + receipt only; no sibling edits. Author tests **NOT RUN** (no shell); coordinator reruns.

Fix log 9 (disjoint UI work, user-authorized): new isolated module `apps/control-center/public/task-timeline/` (view.js, style.css, README.md) plus this receipt entry. `renderTaskTimeline(events, {connected=false})` pure ESM HTML string: escapes all input; stable sort on trusted provided timestamp → id → original order; bounded 100 events with disclosure note; missing/invalid identity → `Unavailable`, unusable timestamp → `Not available`; empty states `Not connected` / `No events reported`; displays task/attempt identity, timestamp, concise event type and summary at 14px Satoshi neutral-premium (tokens read from existing `/style.css`, scoped `tt-` classes with standalone fallbacks). No inline JS/styles/handlers, no network/storage/dependencies, no execution controls, no invented logs/stages/percentages. Only `task-timeline/` and this receipt touched; parent app/server/index.html untouched; prior Computer conformance work preserved. Author tests **NOT RUN** (no shell); coordinator verifies on integration.

## 2026-10-19 — IFZ run timeline module (disjoint UI extension)

**Doc-read blocker (precise):** `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` could not be read — two attempts returned permission-denied. The active rules allow reads for `*OCR-5.md`, `*COMPLETION-PLAN.md`, `*RCT-EXPANSION-PLAN.md`, the computer-conformance/protocol/policy/computer-* packages and `*apps*control-center*public*`, while the catch-all `read:* → deny` has **no allow entry for the IFZ architecture doc**. No workaround attempted; the module implements exactly the task-specified contract.

**Files (own scope only):**
- `apps/control-center/public/task-timeline/view.js` — added `renderIfzRunTimeline(run, {connected=false})`, `IFZ_EVENT_KINDS` (11 kinds: prompt reference, route plan, worker request, public status, result, verification, handoff, question, failure, cancellation, uncertain delivery), `IFZ_LIMITS`.
- `apps/control-center/public/task-timeline/ifz-fixtures.js` — eight fixtures: empty, loading, disconnected, running, partial_failure, uncertain, cancelled, complete.
- `apps/control-center/public/task-timeline/style.css` — scoped `.ifz-run-view` styles: distinct **Worker claim** (warm neutral) vs **Independent verification** (green) badges, tone colors for failure/cancellation/uncertain, `:focus-visible` outlines, `cursor:pointer` summary, `prefers-reduced-motion` block, ≤580px responsive.
- `apps/control-center/public/task-timeline/test/ifz-timeline.test.js` — 16 focused tests.
- `apps/control-center/public/task-timeline/README.md` — IFZ input contract, guarantees, browser-integration limits.

**Requirements coverage:** producing/requesting worker identities per event (missing → `Unavailable`); parallel branches as labeled sections (`main` first); collapsed delegation via native `<details>`/`<summary>` (keyboard expansion, starts collapsed); everything escaped and whitelisted — raw HTML, private `reasoning`/`secrets` fields, full prompt text (140-char reference preview) and unbounded tool output (160-char cap) never render; secret-shaped tokens masked to `[redacted]`; stable timestamp→id sort with invalid timestamps last; 100-event bound with disclosure; semantic markup + aria-live/aria-busy state badges; empty/loading/disconnected copy per contract. Prior task-timeline renderer untouched.

**Exact test results: NOT RUN.** The authoring environment exposes no shell/execution tool, so `node --test` could not be executed in this pass. The 16 authored tests assert fixture rendering (8 states), state badges and empty copy, HTML-escape safety, secret redaction, reasoning-field dropping, all three bounds (140/200/160), identity labels, claim-vs-verification badge distinctness, branch sections + collapsed details, all 11 kinds + unknown-kind labeling, stable/invalid-timestamp ordering, the 100-event cap, semantic/a11y hooks, style.css focus/reduced-motion checks, and legacy-renderer coexistence. Coordinator command: `node --test apps/control-center/public/task-timeline/test/`.

**Browser-integration limits:** not integrated into the live app (no `index.html`/`app.js` edits, no stylesheet link, no mount); no runtime socket/loader behavior — callers decide `connected`/`loading`; fixtures are development/test references only; visual verification in a real browser (focus rings, details expansion, reduced motion) is pending coordinator integration.

Ready for review.

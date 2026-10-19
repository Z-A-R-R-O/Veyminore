# OCR-2 — Computer Session Lifecycle Core (Receipt)

Worker: OCR-2 | Model: opencode/mimo-v2.6-flash-free (no paid fallback) | Pass: single bounded pass

## Status

ready_for_review: true
tests: NOT RUN (shell unavailable to this worker)

Coordinator verification commands:

```
node --test packages/computer-runtime/test/
node -e "import('./packages/computer-runtime/src/index.js').then(m => console.log(Object.keys(m)))"
```

## Owned scope

- `packages/computer-runtime/` (new, empty before this pass; created directly, no root config changes)
- `docs/execution/ocr/OCR-2.md` (this receipt)

No existing packages were edited. No env/secrets/network/install/commit/push. No subagents.

## Deliverables

```
packages/computer-runtime/package.json          — @zetro/computer-runtime 0.1.0, type: module, zero dependencies
packages/computer-runtime/src/index.js          — public entry
packages/computer-runtime/src/computer-session.js — ComputerSession core + constants
packages/computer-runtime/src/types.d.ts        — declarations for ports, requests, results
packages/computer-runtime/test/session.test.js  — fixtures + lifecycle tests (NOT RUN)
```

## Exact public ports (exported from `src/index.js`)

- `ComputerSession` (class)
- `SessionState` = `{ ACTIVE: 'active', REVOKED: 'revoked', STOPPED: 'stopped' }`
- `SessionErrorCode` = missing_principal | missing_token | missing_session | invalid_token | principal_mismatch | session_not_found | session_expired | session_revoked | session_stopped | target_mismatch | authority_denied | authority_unavailable | observer_failed | observation_cancelled | observation_limit_exceeded | contract_invalid
- `AuditEventType` = session_started | session_status | observation_delivered | observation_cancelled | observation_denied | session_revoked | session_stopped | operation_denied

### Injected ports required by `new ComputerSession(ports)`

| Port | Shape | Role |
|---|---|---|
| `clock` | `{ now(): number }` | injected time; expiry boundary is `now >= expiresAt` (fail-closed) |
| `tokenVerifier` | `{ verify({token, principalId, sessionId?}) → {valid:true, principalId, claims?} \| {valid:false, reason?} }` | sole authentication source; resolved principal must equal claimed principal and session owner |
| `authorityPort` | `{ evaluateScreenCapture({principalId, sessionId, displayId, frames}) → {allowed, reason?, grantId?, details?} }` | shared authority decision, awaited at observe; shape matches `ComputerPolicyPort.evaluateScreenCapture` |
| `observer` | `capture({sessionId, displayId, frames, maxBytes, signal}) → Promise<{frames, bytes}>` | only place a desktop read could occur; core never implements capture |
| `auditSink` | `write(event)` | every operation emits an audit event with `correlationId` |
| `validationPort` (optional) | `validate(operation, payload) → {valid, errors?}` | OCR-1 contract gate (`session.start`, `session.observe`) |
| `idFactory` (optional) | `(prefix) => string` | deterministic ids for tests |
| `limits` (optional) | `{maxObservationsPerSession, maxFramesPerObservation, maxBytesPerObservation, defaultTtlMs, minTtlMs, maxTtlMs}` | observation bounds |

### Methods

`start` / `status` / `observe` (async) / `revoke` / `emergencyStop` / `getSession` / `now`.
All return `{ok:true, correlationId, ...}` or `{ok:false, code, details?}` (fail-closed result objects; no thrown auth errors).

## Guarantees implemented

- Authenticated lifecycle: every operation verifies token via injected verifier; missing principal/token, invalid token, and principal mismatch (claimed vs verifier-resolved vs session owner) deny before any effect. Worker labels never authenticate.
- Effect-time recheck: observe awaits `authorityPort.evaluateScreenCapture` first, then re-checks expiry/revocation/stop before invoking the observer, and re-checks again after the awaited capture. A clock advance inside the authority call correctly expires the observation (tested).
- Expiry boundary: `now >= expiresAt` denies; `expiresAt - 1` allows (tested).
- Deterministic cancellation: revoke/emergencyStop synchronously cancel all pending observations via per-observation abort signals; queued observe resolves `{ok:false, code:'observation_cancelled', details.reason}`; revoke is terminal and re-revoke denies (tested).
- Bounded observations: `maxObservationsPerSession`, frames clamped to `maxFramesPerObservation`, `maxBytesPerObservation` passed to the observer and enforced on return; over-limit observer output is rejected as `observer_failed`.
- Mismatched target: session pins `targetDisplayId` at start; observe with a different display denies (`target_mismatch`) before authority and observer (tested).
- Audit correlation: every operation and denial writes an audit event carrying the request `correlationId` (tested: start/denial/revoke/delivered share their correlation ids).
- No desktop calls or input injection exist in this package; the observer is the only capture path and is injected.

## Tests (NOT RUN — shell denied)

`test/session.test.js` (node:test, dependency-free) covers: missing principal/session, missing/invalid token, label-never-verifies, expiry boundary (±1ms), expiry-after-awaited-authority, revoked session + revoked-queued-observe cancellation, stopped session, mismatched target, authority denied → observer untouched, principal mismatch vs session owner, audit correlation, observation limit, OCR-1 validation-port rejection.

## Honest limitations / blockers

1. **OCR-1 contract not accepted.** Its session-request schema was not available to this pass, so the contract is consumed only through the injected `validationPort`; when un-injected, the core enforces only its own presence/range checks. No OCR-1 policy logic is duplicated here. Swapping in the accepted OCR-1 validator requires only wiring `validationPort`.
2. **No runtime dependency on @zetro/protocol or @zetro/policy.** Port shapes were aligned by reading `packages/protocol/src/{index,authority,errors,constants}.js` and `packages/policy/src/ports/computer-port.js` (read-only); `authorityPort` is duck-typed to `ComputerPolicyPort.evaluateScreenCapture`. Wiring the real port is a coordinator concern.
3. Worker labels, RCT/AGR assignments, and desktop/provider effects are out of scope; AGR remains assigned to RCT.
4. All test files are marked NOT RUN; no shell was available to execute them in this pass.

## Correction pass addendum (Independent15 review)

Tests remain **NOT RUN** (no shell). Coordinator: `node --test packages/computer-runtime/test/`. Own package only; no env/live/bash; no shared-source edits.

Corrections applied in `src/computer-session.js` (public ports unchanged; new codes/limits added):

1. **Strict observation schema** (`_validateObservation`): rejects negative/non-integer declared `bytes`/`size`/`contentLength` on the result, frames, and artifact metadata (`invalid_observation_schema`, reason `declared_size_not_non_negative_integer`); rejects inline unbounded `frame.data` (plain objects/arrays) and data exceeding `maxFrameInlineBytes` (reason `unbounded_frame_data`); declared metadata sizes must equal measured content and never substitute for it (reason `declared_size_mismatch`); bounds are enforced against **actual measured content bytes** (`observer_exceeded_bounds` carries `actualBytes`).
2. **Quota reservation before await**: `reservedCount`/`inFlight` are admitted before any authority/observer await; delivered+reserved is checked against `maxObservationsPerSession`; reservations release on every failure path and convert to `observationCount` only on delivery.
3. **Concurrency bound**: `maxConcurrentObservationsPerSession` (default 1) denies a second in-flight observe with `concurrency_limit_exceeded`.
4. **Authority awaiting**: `evaluateScreenCapture` is awaited via `Promise.resolve().then(...)`; async allow works, async reject maps to `authority_unavailable`, and only literal `allowed === true` passes (truthy non-boolean denies).
5. **Finite port timeouts**: `authorityTimeoutMs` (default 5000) and `observerTimeoutMs` (default 10000) bound hung ports; timeouts deny with `authority_timeout`/`observer_timeout` and abort the observer signal.
6. **Revoke/stop gates preserved after await**: post-authority and post-observer `_effectGate` rechecks retained; revoke during an awaited authority call still denies `session_revoked` at the post-await gate (regression test added).

New error codes: `concurrency_limit_exceeded`, `authority_timeout`, `observer_timeout`, `invalid_observation_schema`. New limits: `maxFrameInlineBytes`, `maxConcurrentObservationsPerSession`, `authorityTimeoutMs`, `observerTimeoutMs`. `src/types.d.ts` updated to match. 10 regression tests appended to `test/session.test.js` (schema, metadata-vs-content, reservation/concurrency, async authority, hung ports, revoke-during-authority); prior 14 tests preserved. All tests NOT RUN.

## Suite2 pass addendum (Independent15 session suite, 24/25 → fix)

Tests remain **NOT RUN** (no shell). Coordinator: `node --test packages/computer-runtime/test/`. Own package only; no env/live/bash. Async-allow, negative-bytes, and concurrent-max1 fixes preserved unchanged.

1. **Test fixture fixed honestly** (suite2 case ~483): the concurrency regression's hanging observer hangs *every* capture until released; the third capture was never released and hit `observer_timeout`. The test now awaits the third observe's in-flight state and releases it explicitly before asserting success — the fixture behavior is unchanged, the test drives it correctly.
2. **Nested artifact escape closed (P1)**: with `maxBytesPerObservation: 8`, a backend frame carrying `artifact.pixels` (10000 chars) and `metadata.secret` (10000 chars) with declared `bytes: 0` was previously accepted and delivered. `_validateObservation` now enforces strict field whitelists — result (`frames`, `bytes`), frame (`id`, `data`, `metadata`), metadata (`format`, `bytes`, `size`, `contentLength`, `capturedAt`) — and rejects anything else fail-closed: `unknown_result_field`, `unknown_frame_field`, `unknown_metadata_field`.
3. **Unbounded strings rejected**: whitelisted string fields (`id`, `metadata.format`) must be strings of length ≤ `maxStringFieldBytes` (default 256) or the observation is denied (`unbounded_string`); non-string values are `string_field_invalid`.
4. **Serialized metadata is measured**: sanitized metadata JSON byte length counts toward `actualBytes` and is capped by `maxMetadataBytes` (default 4096, denial reason `metadata_exceeds_limit`), so nested payloads cannot hide behind declared `bytes: 0`.
5. **Sanitized bounded output**: delivered `frames` are rebuilt from whitelisted fields only; no raw nested objects (pixels/secrets/debug dumps) ever reach the caller or audit trail. `bytes` in the result is always the measured actual total.

Regression tests added: prior nested probe (`artifact.pixels` + `metadata.secret` under maxBytes8 → `unknown_frame_field`), unknown metadata field, unknown top-level result field, oversized whitelisted string, serialized-metadata bounds, sanitized-output shape assertion. `src/types.d.ts` limits updated (`maxStringFieldBytes`, `maxMetadataBytes`). All tests NOT RUN.

## Suite3 pass addendum (Independent15 review, 30/31 → fix)

Tests remain **NOT RUN** (no shell). Coordinator: `node --test packages/computer-runtime/test/`. Own package only; no env/live/bash. Nested-pixels bypass, quota reservation, concurrency, authority-async, and timeout fixes preserved unchanged.

1. **Test 701 expectation corrected honestly**: the sanitized-output test previously asserted `bytes === 4` (data only) after metadata began counting. The expectation is now *computed*, not hard-coded: `4 + UTF-8(JSON.stringify({id, metadata}))` — the same formula the core uses — so the assertion tracks the real measured aggregate (30) instead of being loosened or faked.
2. **P2 — `frame.id` (and all sanitized frame material) is now measured**: `_validateObservation` computes each delivered frame's `actualBytes` as measured `data` content bytes **plus** the UTF-8 byte length of the serialized sanitized frame (`JSON.stringify` of the frame minus `data`, which includes `id`, `metadata`, and their serialized keys). The prior gap — `frames: [{id: 'x'×100}]` with `maxBytes: 8` accepted and delivered 100 unmeasured chars — is closed: it now denies `observer_exceeded_bounds` with `actualBytes ≥ 100`.
3. **UTF-8, not char count**: all string material is measured with `TextEncoder`, so multibyte content (e.g. `'é'` = 2 UTF-8 bytes vs 1 char) is counted correctly; a 10-char multibyte id under `maxBytes: 15` denies, under a sufficient limit delivers with `bytes` equal to the computed UTF-8 aggregate.
4. **Enforced before delivery, reported consistently**: the `actualBytes > maxBytesPerObservation` gate runs before the observation is counted/delivered; the returned `bytes` and audit `bytes` are always the same measured aggregate, and denial details carry the identical `actualBytes`.

Regression tests added: long `frame.id` bypass probe, multibyte UTF-8 measurement (deny + accept paths), and an id+metadata+data aggregate test asserting the exact computed boundary (`expected-1` denies with matching `actualBytes`; `expected` delivers with identical reported `bytes`). The prior bounds test's hard-coded `actualBytes: 64` was updated to the computed `64 + UTF-8('{}')`. All tests NOT RUN.

## Frontend accessibility audit (read-only pass)

Scope: read-only inspection of `apps/control-center/public/{index.html,app.js,style.css,worker-detail/view.js,worker-detail/style.css,task-timeline/view.js,task-timeline/style.css}`. **No product files modified; no UI code written; no shell/network; no browser or assistive-tech verification was performed** — items marked "browser-needed" require coordinator confirmation in a real browser/SR. Computer runtime package untouched. 7 reads, max-5 findings ranked by severity.

### 1. HIGH — Mojibake corrupts visible text and an SR-announced status label (status honesty) — source-checked read, browser-needed to confirm disk bytes
- `index.html:3` `<title>ZETRO â€” Control center</title>`; `index.html:7` workspace chevron `âŒ„`; `index.html:23` dialog close glyph `Ã—`; `app.js:66` headings `WhatÃ¢â‚¬â„¢s taking shape` / `YouÃ¢â‚¬â„¢re looking`; `app.js:65` metric strings.
- **`worker-detail/view.js:40`** — live-state label returns `'Running â€” unverified'`; also `:63` stage suffix ` â€” unknown`, `:113` group fallback `â€”`, `:122` ` Â· ` separator. This string is emitted verbatim into the dialog's live chip (`:125`) and the "State" row (`:140`), so assistive tech announces corrupted text — a status-honesty failure, not just cosmetics.
- Reproduction (browser-needed): load `/` — `document.title` shows `ZETRO â€” Control center`; open any worker row → dialog live chip reads `Running â€â€” unverified`. If the bytes as read are the bytes on disk, every em-dash/apostrophe in the UI renders garbled; if a reader-side decoding artifact, this finding collapses — must be confirmed by viewing page source in a browser before acting.
### 2. HIGH — `--muted` token fails WCAG AA contrast on white at 10–13px — source-computed, browser confirm
- `style.css:2` `--muted:#747b80` on `--paper:#fff` computes to ≈ **4.30:1** (linearized sRGB), under 4.5:1 for normal text. Pervasive: `worker-detail/style.css:66` `.wd-sub`, `:109` `.wd-observed`, `:225` `.wd-note`, `:231` `.wd-empty` (13px); `task-timeline/style.css:46` `.tt-count`, `:95` `.tt-time`, `:128` `.tt-note` (12px); `:80` `.tt-meta-label` (10px).
- Same pass: `style.css:3` `.nav-item{...color:#72797d;font-size:13px}` ≈ **4.45:1** on white — also under 4.5:1.
- Reproduction (browser-needed): DevTools contrast picker on `.wd-observed` in the worker dialog and on a sidebar `.nav-item`; expect ratio < 4.5. Includes status-bearing text (`.wd-observed` "Observed … unverified" note).
### 3. MEDIUM — View changes neither focus nor announce main content — source-checked, SR browser-needed
- `app.js:94-101` `render()` replaces `#content.innerHTML` and updates `#breadcrumb`, but never focuses `#content` (`index.html:20` declares `tabindex="-1"` — currently unused) nor writes to `#announcement` (`index.html:25`, `aria-live="polite"`), which is only set on fetch failure (`app.js:130`).
- Reproduction (browser-needed): Tab to sidebar "Workers", press Enter — visually the page swaps and scrolls (`app.js:137`), but keyboard focus stays on the nav button with no focus move to the new content, and a screen reader announces nothing; breadcrumb change is the only cue.
### 4. MEDIUM — Connection state flips unannounced; footer implies freshness after failure (status honesty) — source-checked, SR browser-needed
- `index.html:19` `#connection` is a plain `<span>` (no `aria-live`/`role=status`); its text cycles `Connecting → Live workspace / Partial connection → Connection unavailable` (`app.js:120,127`) silently — only the failure path reaches `#announcement`.
- On failure (`app.js:125-131`) `#updated` is **not** refreshed, so the footer keeps the last success wording `Checked 10:32 - auto refresh 10s` (`app.js:124`) while data is stale; nothing on screen ties "stale" to that timestamp except the header chip.
- Reproduction (source-checked logic; browser confirm): stop the local evidence service, wait ≤10s — header shows `Connection unavailable` (unannounced to SR), footer still reads `Checked <old time> - auto refresh 10s`.
### 5. MEDIUM — Read-only disclosure hidden on small screens (responsive/status honesty) — source-checked, browser confirm
- `style.css:7` `@media(max-width:580px){... .mode-label{display:none} ...}` removes the hero's "Read-only workspace preview" lock label; earlier, `style.css:6` `@media(max-width:850px)` hides `.sidebar-bottom` (profile `Read-only access`, `Local preview` dot). Below 580px neither the sidebar nor the hero discloses read-only status; only the footer `#updated` line remains, which says `Local evidence · no provider calls` (`index.html:21`) — not the same claim as read-only/no-execution.
- Reproduction (browser-needed): open DevTools responsive mode at 375×667 — `.mode-label` and sidebar status are `display:none`; no "Read-only" indicator visible in the viewport.

Not verified (browser-needed, not counted): table rows as `tr[role=button][tabindex=0]` (`app.js:58`) SR semantics, dialog focus return after 10s auto-refresh re-render (`app.js:107,122-123`), and focus-visible outline colors (`style.css:3` `#628a77`) — source-inspected but left unranked to respect the max-5 budget. All findings are source-derived; none are browser-verified.

## W-COMPUTER shared-authority integration addendum

Tests **NOT RUN** (no shell). Coordinator: `node --test packages/computer-runtime/test/`. Own package + this receipt only; no sibling edits, no shell/network/env; accepted runtime API (`ComputerSession` constructor/methods/results) unchanged.

**Actual shared components wired (names verified from source, not assumed):**
- `OcrComputerAuthorityAdapter` — confirmed exported from `packages/policy/src/index.js:8` (via `ports/ocr-computer-port.js`). It already conforms to the injected `authorityPort.evaluateScreenCapture(params, options)` duck-type and enforces literal `allowed === true`, so **no factory was added** (per "only if needed").
- `PolicyService` (injected clock) and `createWorkspaceAdmission` (`packages/protocol/src/validators/workspace-admission.js`) — real digested WorkspaceAdmission with exact `taskId`/`attemptId`/`canonicalRoot`/scope.

**New file:** `packages/computer-runtime/test/authority-conformance.test.js` — one shared fake clock drives both `PolicyService` and `ComputerSession`; the adapter is bound to exact principal/session/target-display/admission; grants are issued via the adapter's `createObservationGrant`; the observer is an injected fake (promise-barrier based, zero native calls); an async hub seam allows gating the authority call mid-await. Every denial asserts **observer call count === 0** (effect absence), not just the returned code.

**Scenarios (9):**
1. Admitted principal/session/target/task/attempt happy path — delivers through real adapter; audit `observation_delivered` carries the real `grantId` and correlation id.
2. One-use consuming grant — first observe consumes (`revocationReason: 'one_use_consumed'` verified in policy store); second sequential observe denies `authority_denied/request_already_consumed` with observer count still 1.
3. Concurrent in-flight observe — runtime `concurrency_limit_exceeded` for the second while the one-use grant is consumed exactly once; third observe denied `request_already_consumed`; observer count pinned at 1.
4. **Expiry during authority await** — clock advanced past grant+session expiry while the adapter call is gated; real adapter denies `grant_expired`; observer 0.
5. **Session revoked during authority await** — post-await session gate denies `session_revoked`; policy grant untouched (`revoked: false`); observer 0.
6. **Policy grant revoked during authority await** (`policy.revokeSession`) — adapter denies `grant_revoked`; observer 0.
7. **Emergency stop denies capture** — `session_stopped`; observer 0; multi-use grant remains unconsumed/unrevoked in the policy store.
8. **Unadmitted target** — session pinned to display 1, adapter admits only display 0 → `target_outside_grant_scope`; observer 0.
9. **Identity confinement (direct adapter conformance)** — forged principal/session/taskId/attemptId each fail closed (`principal_mismatch`/`session_mismatch`/`unadmitted_session`).

**Honest limitations:** not executed here (NOT RUN); no native Windows capture was performed or claimed — the observer is a fake and the adapter itself states it provides application-layer policy only, not OS sandboxing; import of policy/protocol uses relative paths in the test file only (runtime `src/` remains dependency-free).

## W-COMPUTER hang fix addendum (suite failure handoff)

Tests **NOT RUN** by author (no shell); fix is source-level, awaiting coordinator re-run of `node --test packages/computer-runtime/test/`. Runtime `src/` untouched; guards and expectations unchanged (no weakening).

**Exact root cause of the 10021ms first-test failure (diagnosed from source):**
The injected fake observer in `makeObserver()` resolved **only** via manual `state.release()`. The first test (`admitted … delivers through real authority`) is the happy path — authority **allows**, so execution reaches `observer.capture()`, which returned a promise nobody ever resolved. `ComputerSession`'s finite `observerTimeoutMs` (default 10 000ms) then fired: the observed denial shape was `{ ok: false, code: 'observer_timeout', details: { timeoutMs: 10000 } }` at ≈10021ms — exactly the coordinator's 10-second failure with no useful output. Tests 2/4–9 never hit capture (authority or pre-gates deny first), which is why only the first test hung; the concurrency test (3) worked only because it armed and released the observer manually.

**Fixes in `test/authority-conformance.test.js` only:**
1. **Fail-fast observer fixture** — `capture()` resolves immediately by default (schema-valid minimal result); hanging is explicit via `state.hang = true` and must be released in try/finally.
2. **Finite node:test timeout per case** — every test now passes `{ timeout: 3000 }`, so no case can consume the suite's 10s+ before failing with a labeled error.
3. **Awaitable entry barriers raced against deadlines** — gates expose `entered` (resolved when the authority call actually claims the gate); tests `await withDeadline(gate.entered, 1000, 'authority gate never entered')` before mutating clock/state, and every `observe` await is raced via `withDeadline(..., 2000, '<label>')` producing labeled `deadline exceeded` errors instead of silent hangs.
4. **Guaranteed release** — every gated test calls `gate.release()` and the concurrency test releases the pending observer in `finally`, so a failed assertion cannot strand an in-flight observe, gate, or 10s internal timer; release is idempotent and also unblocks a late-arriving authority call.
5. All waits bounded (`setImmediate` tick raced, no unbounded loops). Shared `ComputerSession`/`OcrComputerAuthorityAdapter` wiring, real-policy scenarios, and all expectations (including observer-count === 0 effect proofs) are unchanged.

Coordinator: re-run `node --test packages/computer-runtime/test/` — expected: all conformance cases settle well under 3s; any failure now surfaces a labeled deadline message or a normal assertion diff.

## IFZ route-wide computer cancellation contract — 2026-10-19

**Blocker (recorded honestly):** reading `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` was **denied by permission policy** (single attempt; only `OCR-2.md`/`COMPLETION-PLAN.md`/`RCT-EXPANSION-PLAN.md` are readable under docs). This implementation is therefore derived strictly from the task's stated contract bullets; if the IFZ doc defines additional identities or semantics, a follow-up pass must reconcile them.

**Delivered (own package only; no shared-file edits; zero new dependencies):**
- `packages/computer-runtime/src/route-cancellation.js` — `RouteCancellationCoordinator`, a pure, isolated coordinator with injected clock and ports (`cancellationPort.send`, optional `branchControl.end/stop`, optional `inputLease.isValid`, optional `auditSink`). Exports added to `src/index.js`; declarations appended to `src/types.d.ts`. Accepted `ComputerSession` API untouched.
- `packages/computer-runtime/test/route-cancellation.test.js` — 13 deterministic tests with fake clock and scripted/recorded ports.

**Contract mapping:**
1. **Exact identities** — every operation validates all eight ids (run, task, branch, session, worker, workspace, cancellation, attempt); any missing field fails closed with the offending field name.
2. **Fan-out once** — `cancel()` marks the route cancelled and sends to each **active admitted** branch exactly once per `cancellationId`; repeat cancel with the same id is idempotent (`already`), a different id on a cancelled route is rejected (`route_already_cancelled`); audit records per-branch outcomes.
3. **Queued blocked** — queued branches are cancelled locally during fan-out; `tryStart()` afterwards denies `route_cancelled` (also blocks late admits).
4. **Uncertain delivery** — `timeout`/`unknown`/thrown sends become `delivery: uncertain` on the branch (state stays active); resolution only via `reconcile(identity, 'delivered'|'not_delivered')` keyed by the **same stable cancellationId** (mismatch rejected).
5. **No blind retry** — resend is exposed only as `resendCancellation()`, callable **only** from `reconciled_failed`; there is no code path from `uncertain` or `failed` to a resend; tests assert the send count stays frozen without reconciliation.
6. **Late completion** — `complete()` rejects `late_completion_rejected` for cancelled/stopped branches (and for delivered cancellations on a cancelled route); completion under a merely uncertain delivery is accepted but flagged `completedUnderUncertainCancellation`.
7. **Native effects stay behind ports** — the coordinator performs no session/desktop calls itself; confirmed delivery fans into injected `branchControl.end` (host wires this to `ComputerSession.revoke`), stop uses `branchControl.stop`, and input-bearing starts require `inputLease.isValid` — session authority (token/verifier/policy) remains entirely with the existing `ComputerSession` stack.
8. **Determinism** — injected clock everywhere; all port behaviors scripted; no timers, loops, network, process, provider, or native input.

**Tests: NOT RUN (shell unavailable to author).** Focused command for coordinator:
`node --test packages/computer-runtime/test/route-cancellation.test.js`
Full package: `node --test packages/computer-runtime/test/`.

**Limits:** doc-derived context unavailable (blocker above); coordinator is application-layer only (no OS enforcement claim); delivery semantics depend on the host `cancellationPort` honestly reporting `delivered` vs `timeout`/`unknown`; reconciliation is operator/host-driven by design.

## IFZ cancellation rework addendum — 2026-10-19

Independent run result being fixed: `node --test packages/computer-runtime/test/route-cancellation.test.js` → **10 pass, 4 fail** (coordinator-reported). Author re-run: **NOT RUN — this session has no shell tool available (tool inventory: read/edit/write only)**; limitation recorded honestly rather than fabricating output. Coordinator must re-run the focused command after this rework.

**Exact root causes of the 4 failures (diagnosed from source):**

1. **Late-completion test (fixture bug, coordinator correct):** the stop scenario reused `runId: 'run-1'`, whose route was already cancelled by the first scenario — `admit()` correctly denied `route_cancelled`, so `stop()` returned `branch_not_found` and `stop.ok === true` failed. Fixed: stop scenario now runs on `runId: 'run-2'`. Assertions unchanged.
2. **inputLease fake/API mismatch (test double bug):** `makeLease()` returned `{ lease, isValid }` with `isValid` on the *outer* object, but tests injected `lease.lease` — a plain `{calls, valid}` object without `isValid` — so `tryStart` threw/failed the lease path. Fixed: the fake **is** the port (`{ calls, valid, isValid(args){...} }`), injected directly; test now also asserts the exact lease call shape `{sessionId, workerId}`.
3. **branchControl stop fake/API mismatch (same class of bug):** `makeBranchControl()` kept `end`/`stop` on the outer wrapper while tests injected `control.control` (methods absent) — `endCalls`/`stopCalls` stayed empty and assertions failed. Fixed: the fake **is** the port with `end`/`stop`/`endCalls`/`stopCalls` on one object; stop test now asserts the exact stop payload.
4. **`branch_cancelled` audit lacked sessionId:** `_fanOne` emitted only `{runId, branchId, cancellationId, delivery}`. Fixed: all branch-level audit events now go through `_branchEvent()`, which stamps the **full stable identity** (runId, taskId, branchId, sessionId, workerId, workspaceId, attemptId); the audit test asserts every field, and `route_cancelled` now carries taskId/workspaceId too.

**Hardening per review instruction (no weakened assertions):**
- New `IDENTITY_MISMATCH` error code and `_getBranchChecked()`: every transition (`tryStart`, `stop`, `complete`, `status`, `reconcile`, `resendCancellation`) re-validates the full binding identity (taskId, sessionId, workerId, workspaceId, attemptId) against the admitted record — not just the runId/branchId map key. New test forges each binding field in turn and asserts `identity_mismatch` with expected/received details.
- Uncertain-delivery semantics **preserved unchanged**: timeout/unknown/thrown → `uncertain`; no API path from `uncertain` to resend; resend only from `reconciled_failed`; same stable cancellationId required to reconcile.

**Files changed:** `src/route-cancellation.js` (full-identity checks, `_branchEvent` audit stamping, new code), `test/route-cancellation.test.js` (port-shaped fakes, run-2 fixture, identity-mismatch test, strengthened audit assertions — now 14 tests), `src/index.js`/`src/types.d.ts` unchanged (no new exports; `CancelErrorCode` is already `Record<string, string>`). Focused command for coordinator: `node --test packages/computer-runtime/test/route-cancellation.test.js` — expected 14/14 pass.

## IFZ cancellation final correction — 2026-10-19

Independent rerun: **14 pass / 1 fail**. Remaining failure root cause (exact): the reconcile-mismatch test builds its probe via `identity({ branchId: 'bA', cancellationId: 'cancel-X' })`, whose counter-generated `sessionId` also differs from the admitted record — `_getBranchChecked` ran first and returned `identity_mismatch`, so the assertion for `cancellation_id_mismatch` failed.

**Fix (no weakened assertions; full binding checks kept):** in `reconcile()` and `resendCancellation()`, the dedicated `CANCELLATION_ID_MISMATCH` check against the branch's `deliveryCancellationId` now runs **before** the generic full-binding `_getBranchChecked` — a different cancellationId always reports `cancellation_id_mismatch` (with expected/received details), per the public contract. All other transitions (`tryStart`, `stop`, `complete`, `status`) still enforce full identity binding unchanged; reconcile with the *correct* cancellationId plus a forged binding field still fails `identity_mismatch` — the test now asserts **both** orderings explicitly (wrong cancellationId → `cancellation_id_mismatch`; right id + forged sessionId → `identity_mismatch`).

Uncertain-delivery no-blind-resend behavior untouched. Author run: **NOT RUN — no shell tool in this session**; honest coordinator rerun requested: `node --test packages/computer-runtime/test/route-cancellation.test.js` — expected 15 assertions-rich cases, 14 tests, all passing (the mismatch test carries the extra ordering assertions).

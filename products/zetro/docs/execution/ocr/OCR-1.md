# OCR-1 Receipt — OCR-W1-contract

- Task IDs: OCR-W1-contract (Computer contract), C0 (overlay session model)
- Worker: OCR-1
- Model: opencode/mimo-v2.6-flash-free
- Date: 2026-10-17
- ready_for_review: true

## Files (owned scope)

W1 — Computer contract package:

- `E:/Veyminore/products/zetro/packages/computer-contract/package.json`
- `E:/Veyminore/products/zetro/packages/computer-contract/src/index.js`
- `E:/Veyminore/products/zetro/packages/computer-contract/src/index.d.ts`
- `E:/Veyminore/products/zetro/packages/computer-contract/test/contract.test.js`

C0 — isolated overlay state model:

- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/model.js`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/model.test.js`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/README.md`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/package.json`
- `E:/Veyminore/products/zetro/docs/execution/ocr/OCR-1.md` (this receipt)

No root manifest edits; existing Computer contract, app/server/preview/backend sources and other workers' files untouched this pass.

## C0 review1 fixes (this pass)

- `disconnected` now clears `actingTargetId`, `captureIndicator`, `authorityGranted` (disconnect removes active capture; explicit disconnected state shown; no stale indicators for rejected/unknown events — they return the unchanged model).
- `connection_restored` → `off`: no automatic observing access and no restored grant. Fresh events required: `observation_started` to observe; `authority_restored` (new event type, strict `authorityGranted === true`, never derived from a button press) to re-establish authority before `control_granted` can succeed again.
- Expiry wins over restore: `connection_restored` with `timestamp >= expiry` (or any event at/after expiry) applies the `expired` transition with cleared pointer/indicator/authority; terminal states still reject everything.
- Retained unchanged: strict identity (exact session/target), finite monotonic sequence, stale (`timestamp < current`) and future (`timestamp > now`) rejects, strict booleans, bounded inputs/errors, frozen models, `nativeAccess` immutable `false`, `simulation` separate, no DOM/network/native calls.

## C0 public contract (summary)

- `createSessionViewModel(config)` — strict config (`sessionId`, `targetId`, `sequence`, `timestamp`, `expiry`, `authorityGranted`, `observationOnly`, optional `simulation`); `ModelContractError` on violation; frozen model; `timestamp >= expiry` → initial `expired`.
- `reduceSessionEvent(model, event, { now })` → frozen `{ ok, model, errors }`; unchanged model on rejection.
- States: `off`, `observing`, `requesting_control`, `acting`, `paused`, `stopped`, `disconnected`, `expired`.
- Guard order: structure → type → exact identity → monotonic sequence → stale/future → authority boolean rules (grant/restore require `true`, revoke `false`) → terminal rejection → expiry → transition table.
- Expiry, revoke, stop, **and disconnect** remove `actingTargetId` + `captureIndicator` (and clear `authorityGranted`).

## Verification

- Actually run by this worker: none. Shell unavailable; no tests executed for the contract package or the model.
- Prior coordinator baseline reported (not run by this worker): 12 model tests passing (pre-this-fix); the disconnect/restore test was rewritten and new regressions added (expiry-on-restore, stale/unknown events in disconnected, fresh-authority re-grant path) — all unexecuted by this worker. Contract-package baseline previously reported at 22 tests (pre-request-admission fix; later regressions added unexecuted).
- Proposed exact commands (NOT RUN):
  - Model: `node --test model.test.js` (cwd `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model`)
  - Contract: `node --test packages/computer-contract/test/contract.test.js` (cwd `E:/Veyminore/products/zetro`)
- No passing results are claimed by this worker.

## Limitations

- Read-only Computer alpha contract and pure overlay view-model only; no native implementation, no OS sandboxing, no effects; no native-access inference path exists.
- Contract trust authority is procedural (injected `createTrustedVerifierPort` callback + exact binding equality), not cryptographic identity; port must be held outside worker control.
- Model transitions are a curated allow-list, not a proof of intent; parent integration/review owns wiring of events to real sources.
- Tests NOT RUN by this worker (shell unavailable).

## IFZ computer session projection (2026-10-19)

Task: pure, tested projection of a bounded IFZ run + computer session into Computer page state.

### Files (owned scope, this pass)

- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/projection.js`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/projection.test.js`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/README.md` (IFZ section added before Ownership note)
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/package.json` (test script → `node --test model.test.js projection.test.js`; export `./projection.js`)
- `E:/Veyminore/products/zetro/docs/execution/ocr/OCR-1.md` (this receipt)

Untouched: contract package, model.js / model.test.js, app/server/preview/backend sources, other workers' files.

### Blockers (recorded, not retried)

- Required architecture doc `E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` is unreadable: two read attempts failed with a permission error (forward-slash and back-slash path forms). Per the two-attempt rule the worker stopped retrying and implemented solely from the in-message requirements. Any doc-only nuance is out of scope until access is granted.
- Shell unavailable in this session: **no tests were executed** (authoring only; no fabrication of passing results).

### Contract (summary)

- `projectComputerPage(input, { now })` → frozen `{ ok: true, page }` or frozen `{ ok: false, errors }` (errors frozen, capped at 20). Pure/offline/no deps; clock injected via `options.now` (required, positive finite epoch-ms; unknown options rejected).
- `input`: plain object, keys `run` + `session` + optional `update` only. `update` absent (`undefined`) = run state only; `null`/malformed rejected; at most one update per call.
- Enums exported: `RUN_STATES`, `PAGE_LIFECYCLES` (all 11 distinct: requested, admitted, observing, acting, paused, stopped, cancelled, disconnected, uncertain, failed, verified_completion), `WORKER_REPORT_OUTCOMES`, `STALE_AFTER_MS` (30000), `MAX_EVIDENCE_REFS_LIMIT` (16).
- Rejections: unknown fields everywhere; bad id/sequence/timestamp/state/boolean types; `run.sessionId`/`run.targetId` mismatch vs session; `update.sequence <= run.sequence`; `update.timestamp < run.timestamp` (stale), `> now` (future), `>= run.expiry` (expired); `run.timestamp > now` (future run); verification `verified: true` without ≥1 bounded evidence ref; `worker_reported` completion carrying evidence refs; `claimedPermissions.<key> === true` where the derived permission is false (authority-growing) plus unknown/non-boolean claim keys.
- Worker self-report never verifies: `worker_report` update or `run.completion.kind: 'worker_reported'` → lifecycle `uncertain`, subtext `Worker reported completion; not independently verified`, `evidenceRefs: []`; `run_status: 'completed'` (unverified claim) → `uncertain`. Only `verification.verified === true` (or `run.completion.kind: 'verified'`) with bounded refs → `verified_completion`.
- Output `page` (frozen, exact keys): `lifecycle`, `simulation`, `subtext` (fixed constant strings only), `permissions` (derived: observe/control/requestControl/stop, escape always true), `freshness` (fresh/stale/expired/future + ageMs + asOf), `stopAvailable` (active ∧ non-terminal), `escapeAvailable` (always true), `evidenceRefs` (only on verified), `identity` (nine bound run ids).
- Privacy: no prompts, typed content, secrets, screenshots, capture indicators, or private reasoning in output; only the fixed key set + fixed subtexts are emitted.

### Tests authored (NOT RUN)

- `projection.test.js` (node:test, injected fake clock, no I/O): frozen success/failure results; all eleven lifecycles projected distinctly; worker self-report / run-status completion cannot verify; verification with evidence verifies, rejected verification does not; identity binding (session/target mismatch, bad run id); stale/future/expired/non-monotonic updates + future run rejected; expired run/session → uncertain + expired freshness + no Stop; malformed/unknown-field/bad-option inputs rejected; authority-growing claims rejected vs equal/lesser claims accepted (incl. observation-only); evidence refs bounded (empty, >16, bad chars, worker-reported refs, missing refs); freshness fresh/stale/expired; Stop/Escape availability matrix; privacy key-set + all 18 fixed subtexts reachable; composition with `reduceSessionEvent` (observe → act → disconnect).
- Proposed exact commands (NOT RUN):
  - `node --test projection.test.js` (cwd `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model`)
  - `npm test` → `node --test model.test.js projection.test.js` (same cwd)
- No passing results are claimed by this worker.

### Proof limits (IFZ pass)

- Projection is a deterministic function of injected inputs; tests are authored but unexecuted, so no behavior is empirically verified by this worker.
- The lifecycle precedence order is a curated decision list (verified > expired > failed > stopped > cancelled > disconnected > uncertain > paused > requested > admitted > acting/observing > fallback), not a theorem; integration/review owns precedence disputes.
- `claimedPermissions` authority-growth check compares against page-derived permissions only; it does not attest to the updater's identity — trust in the update source remains procedural (same model as contract port authority).
- Architecture doc unreadable → doc-conformance claims cannot be made this pass (blocker above).

## IFZ projection rework: update identity + terminal precedence (2026-10-19)

Source review found two contract blockers after an independent run reported 28/28 tests (reported by coordinator; not executed by this worker). Both fixed in owned scope only.

### Files touched (this rework)

- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/projection.js`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/projection.test.js`
- `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model/README.md`
- `E:/Veyminore/products/zetro/docs/execution/ocr/OCR-1.md` (this receipt)

`package.json` unchanged (test script already covers both suites). Contract package, model.js/model.test.js, app/server/preview/backend sources untouched.

### Fix 1 — identity-bound updates

- Every update must now carry all nine identity fields (`taskId`, `runId`, `conversationId`, `workerId`, `workspaceId`, `sessionId`, `targetId`, `authorityId`, `observationId`); they were added to `UPDATE_KEYS` and validated in `validateUpdate` immediately after the unknown-field check, **before any lifecycle/state derivation**:
  - missing → `update.<key> is required (every update must carry the bound identity)`
  - malformed (non-string / pattern fail) → `update.<key> must be a string matching ^[a-zA-Z0-9_-]{1,64}$`
  - mismatched → `update.<key> '<value>' does not match run.<key> '<run value>'`
- A rejected update returns only `{ ok: false, errors }` — no page is ever projected for a rejected update.

### Fix 2 — terminal/expiry precedence over verification

- `expired` and `baseTerminal` (run state stopped/cancelled/failed/disconnected, or session status stopped/disconnected) are computed **before** update/completion processing; `canVerify = !expired && !baseTerminal`.
- Verified completion field and `verification.verified === true` updates are applied only when `canVerify`; otherwise the verification is dropped (effective state left at the terminal/expired projection).
- Post-processing gate: any remaining `verified` flag is cleared when `expired`, `baseTerminal`, or the effective state is terminal — so a terminal `run_status` update also overrides an earlier verified completion.
- Lifecycle order is now: `uncertain` (expiry) → terminal effective/session state (`failed` > `stopped` > `cancelled` > `disconnected`) → `verified_completion` → the previous chain.
- `evidenceRefs` are exposed only while `verified` holds after gating → terminal/expired projections always show `[]`.
- Unchanged: worker self-report can never verify, `run_status: 'completed'` stays `uncertain`, authority-grown `claimedPermissions` rejection, fixed key set / fixed subtexts (privacy), injected clock, frozen bounded output, `update` still optional when absent.

### Tests updated / added (NOT RUN by this worker)

- Update helpers now stamp `UPDATE_IDENTITY` (all nine ids) on every update.
- **Flipped**: `expired-but-verified` test now asserts `uncertain` + `Session expired; state uncertain` + `evidenceRefs: []` (was asserting `verified_completion`); added expired-session + verification-update case.
- **New**: `every update must carry and exactly match all nine bound identities` (per-key missing rejection, runId/sessionId/observationId mismatches, bad-format/non-string ids, rejection-before-page assertions).
- **New**: `terminal run/session state beats verification (stopped, cancelled, failed, disconnected)` — 8 cases: stopped/cancelled/failed runs and stopped/disconnected sessions via verification update and completion field, worker-report-on-terminal negative, and a positive control proving an active run still verifies.
- Proposed exact commands (NOT RUN):
  - `node --test projection.test.js` (cwd `E:/Veyminore/products/zetro/apps/control-center/public/computer-session-model`)
  - `npm test` → `node --test model.test.js projection.test.js` (same cwd)
- Shell unavailable to this worker: **no tests executed here**; no passing results claimed. Coordinator rerun requested honestly for both suites (model suite is expected unchanged, but was not re-run by this worker).

### Proof limits (rework)

- Identity match is string equality against the run's ids; it binds updates to the run but does not attest who produced the update (trust in the update source remains procedural).
- Terminal precedence treats session `stopped`/`disconnected` and run stopped/cancelled/failed/disconnected as blocking; other precedence questions (e.g., worker report over an already-verified completion) were left at prior behavior intentionally, as they were not part of the review blockers.
- Tests authored but unexecuted by this worker — no empirical verification claimed.

# computer-session-model

Pure, dependency-free overlay **session view-model** for the Computer alpha. Isolated module for parent integration; no DOM, no network, no native/OS calls.

## Non-goals / claims

- This module **never** performs input, clipboard, file, or shell effects and never touches native APIs.
- `nativeAccess` is a constant `false` in every model; no event, state, or button press can change it.
- `simulation` is a separate explicit boolean: `status: 'acting'` under `simulation: true` means *simulated* acting only. Actual access is never derived from a button press — control requires explicit authority input (config flag AND event flag).
- `disconnected` and any rejected/unknown event leave **no stale indicators**: the model only ever reports its explicit status; acting pointer, capture indicator and authority are cleared on disconnect, and unknown/disallowed events return the unchanged (explicit) state.

## Files

- `model.js` — ESM implementation (`createSessionViewModel`, `reduceSessionEvent`, guards, enums).
- `model.test.js` — `node:test` suite with a finite fake clock.
- `projection.js` — IFZ computer session projection (`projectComputerPage`, lifecycle/permission/freshness enums).
- `projection.test.js` — `node:test` suite for the projection (fake injected clock, no I/O).
- `package.json` — `type: module` + test script (module scope only; no dependencies).

Run tests (from this directory): `npm test` (= `node --test model.test.js projection.test.js`)

## API

```js
import {
  createSessionViewModel,   // config -> frozen model (throws ModelContractError)
  reduceSessionEvent,       // (model, event, { now }) -> frozen { ok, model, errors }
  isSessionViewModel,       // structural guard
  SESSION_STATES, SESSION_EVENT_TYPES, ModelContractError
} from './model.js';
```

### createSessionViewModel(config)

Required fields, all strict (unknown fields rejected, errors capped at 20):

| field | type/bound |
|---|---|
| `sessionId` | string `^[a-zA-Z0-9_-]{1,64}$` |
| `targetId` | string `^[a-zA-Z0-9_-]{1,64}$` |
| `sequence` | safe integer `>= 0` (finite, bounded) |
| `timestamp` | positive finite epoch-ms integer |
| `expiry` | positive finite epoch-ms integer |
| `authorityGranted` | strict boolean |
| `observationOnly` | strict boolean |
| `simulation` | optional strict boolean (default `false`) |

Initial state: `off`; if `timestamp >= expiry` → `expired` with `actingTargetId: null`, `captureIndicator: false`, `authorityGranted: false`. Output model is frozen with fixed key set (`isSessionViewModel` enforces exact keys).

### reduceSessionEvent(model, event, { now })

`event` keys (strict, unknown rejected): `type`, `sessionId`, `targetId`, `sequence`, `timestamp`, `authorityGranted`.

Guard order (all failures return `{ ok: false, model (unchanged), errors }`, frozen):

1. model/event/options structural validity (`now`, when supplied, must be a positive finite epoch-ms integer; only `now` allowed).
2. `event.type` ∈ `SESSION_EVENT_TYPES`.
3. **Exact identity**: `event.sessionId === model.sessionId`, `event.targetId === model.targetId`.
4. **Monotonic finite sequence**: `event.sequence` safe integer `> model.sequence`.
5. **Stale reject**: `event.timestamp < model.timestamp`. **Future reject**: `event.timestamp > now` (when `now` supplied).
6. **Authority field rules**: strict boolean required on `control_granted` / `authority_restored` / `authority_revoked`; grant and restore require `authorityGranted === true` ("never derived from a button press"); revoke requires `false`; forbidden on all other types.
7. Terminal (`stopped`, `expired`) rejects everything.
8. **Expiry**: `event.type === 'session_expired'` or `event.timestamp >= expiry` → apply expiry (this includes a `connection_restored` event at/after expiry — expiry wins over restore).
9. State transition table; disallowed → error `event '<type>' is not allowed in state '<state>'`.

Accepted events return `{ ok: true, model (new, frozen), errors: [] }` with updated `sequence`/`timestamp`.

## States

`off` → `observing` → `requesting_control` → `acting`; plus `paused`, `stopped`, `disconnected`, `expired`.

## Event types and transitions

| from | event | to / effect |
|---|---|---|
| off | `observation_started` | `observing`, capture indicator on |
| observing | `observation_started` | `observing`, capture indicator on (re-arm) |
| observing | `control_requested` | `requesting_control` (rejected if `observationOnly`) |
| observing / requesting_control | `control_granted` | `acting`, `actingTargetId = targetId` (requires config `authorityGranted: true` AND event `authorityGranted: true`; rejected if `observationOnly`) |
| requesting_control | `control_denied` | `observing` |
| any non-terminal | `authority_restored` | sets `authorityGranted = true` only (fresh explicit authority input; no status/access change — the path to re-establish authority after disconnect) |
| acting / requesting_control / observing / paused / disconnected | `authority_revoked` | clears `actingTargetId`, `captureIndicator`, `authorityGranted` (from acting/requesting → `observing`; from paused stays `paused`; from disconnected stays `disconnected`) |
| observing / requesting_control / acting | `session_paused` | `paused` (pointer/indicator kept — only expiry/revoke/stop/disconnect clear them) |
| paused | `session_resumed` | `acting` if pointer set, else `observing` |
| any non-terminal | `session_stopped` | `stopped`, pointer + indicator + authority cleared |
| any non-terminal | `session_expired` (or `timestamp >= expiry`) | `expired`, pointer + indicator + authority cleared |
| off / observing / requesting_control / acting / paused | `disconnected` | `disconnected`, pointer + indicator + authority **cleared** (explicit disconnected; no stale capture) |
| disconnected | `connection_restored` | `off` — **no automatic observing access or grant**; a fresh `observation_started` and (if control is needed) a fresh `authority_restored` are required |

Anything else (including any event in `stopped`/`expired`, and unknown types) is rejected with the unchanged model.

## Simulation vs native

- `simulation: true|false` is display-only metadata.
- `nativeAccess: false` is immutable; the model makes no native-implementation or OS-sandboxing claims. No inference path (button, grant, restore) can set it.

## Example

```js
const model = createSessionViewModel({
  sessionId: 'sess-1', targetId: 'screen-1', sequence: 0,
  timestamp: 1000, expiry: 100000,
  authorityGranted: true, observationOnly: false, simulation: true
});
let r = reduceSessionEvent(model,
  { type: 'observation_started', sessionId: 'sess-1', targetId: 'screen-1', sequence: 1, timestamp: 1000 },
  { now: 1000 });
// r.ok === true; r.model.status === 'observing', r.model.nativeAccess === false
```

## IFZ computer session projection (`projection.js`)

Pure, offline, dependency-free mapping of a bounded IFZ run + computer session (+ one optional update) into the **Computer page view-model**. No DOM, no network, no clock reads — the clock is injected.

```js
import { projectComputerPage, RUN_STATES, PAGE_LIFECYCLES, WORKER_REPORT_OUTCOMES, STALE_AFTER_MS, MAX_EVIDENCE_REFS_LIMIT } from './projection.js';
const result = projectComputerPage({ run, session, update }, { now: 1710000000000 });
// frozen { ok: true, page }  or  frozen { ok: false, errors }
```

### Input contract (strict; unknown fields rejected, errors capped at 20)

- `input` must be a plain object with keys `run`, `session`, `update` only.
- `update` is **optional** (`undefined` = run state only); `null` or a malformed object is rejected. At most one update per call.
- Every `update` must **carry all nine bound identities** — `taskId`, `runId`, `conversationId`, `workerId`, `workspaceId`, `sessionId`, `targetId`, `authorityId`, `observationId` — each exactly matching the run's values (same id pattern `^[a-zA-Z0-9_-]{1,64}$`). Missing, malformed, or mismatched identity is rejected **before any state change**; a rejected update never projects a page.
- `options` must be a plain object; only `now` allowed, required, positive finite epoch-ms integer.

`run` keys: `taskId`, `runId`, `conversationId`, `workerId`, `workspaceId`, `sessionId`, `targetId`, `authorityId`, `observationId` (each `^[a-zA-Z0-9_-]{1,64}$`), `state` ∈ `RUN_STATES`, `simulation` (boolean), `sequence` (non-negative safe integer), `timestamp` / `expiry` (positive finite epoch-ms), optional `completion: { kind: 'verified' | 'worker_reported', evidenceRefs? }`.

`session` must pass `isSessionViewModel` (exact 12-key model) **and** match `run.sessionId` + `run.targetId` exactly.

`update` keys: the nine identity fields above (required, must match the run), plus `sequence`, `timestamp`, `kind`, `runState`, `workerReport`, `verification`, `claimedPermissions` — only fields valid for the `kind`:

| kind | required | forbidden |
|---|---|---|
| `run_status` | `runState` ∈ `RUN_STATES` | `workerReport`, `verification` |
| `worker_report` | `workerReport: { outcome }` ∈ `WORKER_REPORT_OUTCOMES` (no other keys) | `runState`, `verification` |
| `verification` | `verification: { verified, evidenceRefs? }` (no other keys) | `runState`, `workerReport` |

### Rejections (stale / future / expired / mismatched / malformed / authority-growing)

1. Structural: non-object `input`/`options`/`run`/`session`/`update`, unknown fields anywhere, bad id/sequence/timestamp/state/boolean types, unknown `options` key, missing/invalid `now`.
2. **Update identity**: every update must carry all nine identity fields, each exactly matching the run (`update.<key> is required` / `update.<key> '<value>' does not match run.<key> '<run value>'`) — checked before any state change.
3. **Identity mismatch**: `run.sessionId !== session.sessionId` or `run.targetId !== session.targetId`.
4. **Sequence**: `update.sequence` must be a safe integer `> run.sequence`.
5. **Timestamps**: `update.timestamp < run.timestamp` → stale; `> now` → future; `>= run.expiry` → expired; `run.timestamp > now` → future run.
6. **Completion rules**: `kind: 'verified'` requires ≥1 bounded `evidenceRefs` (max `MAX_EVIDENCE_REFS_LIMIT`, regex `^[a-zA-Z0-9_.\-/]{1,128}$`); `worker_reported` must not carry `evidenceRefs` at all (worker self-reports carry no evidence).
7. **Authority-growing claims**: any `claimedPermissions.<key> === true` where the derived permission is `false` is rejected (unknown/non-boolean claim keys rejected too). Under-claiming is always allowed.

### Lifecycle derivation (first match wins)

**Terminal/expiry precedence over verification.** Order: `uncertain` (expiry: now ≥ run `expiry` or session `expired`) → terminal state from the effective run state or session status (`failed` → `stopped` → `cancelled` → `disconnected`) → `verified_completion` → `uncertain` (run `uncertain` or worker self-report) → `paused` → `requested` (run `requested`, or run `running` + session `requesting_control`) → `admitted` (run `admitted`, or run `running` + session `off`) → `acting` / `observing` (run `running` + session `acting`/`observing`) → fallback `uncertain`.

A verified completion field or verification update is applied only when the run/session is **not** expired and **not** in a terminal state (stopped/cancelled/failed/disconnected run state, or stopped/disconnected session status). Otherwise it is dropped: the page projects the terminal (or expired-`uncertain`) lifecycle with `evidenceRefs: []`. A later terminal `run_status` update also overrides an earlier verified completion.

All eleven `PAGE_LIFECYCLES` values are kept distinct; `simulation` is a separate output flag. **A worker self-report (update or `run.completion`) can never produce `verified_completion`** — it projects `uncertain` with the fixed subtext `Worker reported completion; not independently verified` and `evidenceRefs: []`. Even `run_status: 'completed'` (an unverified claim) projects `uncertain`.

### Output page (frozen, exact key set)

`lifecycle`, `simulation`, `subtext`, `permissions`, `freshness`, `stopAvailable`, `escapeAvailable`, `evidenceRefs`, `identity`.

- `subtext` is one of a **fixed set of constant strings** (never interpolated from run/session data).
- `permissions` derived: `observe` = active ∧ session ∈ {observing, acting, paused}; `control` = active ∧ session acting; `requestControl` = active ∧ `observationOnly === false` ∧ session observing; `stop` = active; `escape` = always `true`. "Active" = run state ∉ {stopped, cancelled, failed, completed} ∧ not expired.
- `freshness` = `{ status: 'fresh' | 'stale' | 'expired' | 'future', ageMs, asOf }` from the injected `now` (`stale` after `STALE_AFTER_MS`).
- `stopAvailable` = active ∧ lifecycle not terminal (stopped/cancelled/failed/verified_completion); `escapeAvailable` is always `true`.
- `evidenceRefs` present **only** when verification actually applied (verified completion on a non-terminal, non-expired run/session) — frozen copy; empty otherwise.
- `identity` echoes the nine bound run ids (task/run/conversation/worker/workspace/session/target/authority/observation).
- Privacy: no prompts, typed content, secrets, screenshots, capture indicators, or private reasoning are ever emitted; only the key set above leaves the module.

Both success and failure results are frozen; validation errors are frozen strings, capped at 20.

Run projection tests: `node --test projection.test.js` (or `npm test` for both suites).

## Ownership note

Created under OCR-1 scope for parent integration review. Does not modify the Computer contract package, app/server/preview sources, or other workers' files.

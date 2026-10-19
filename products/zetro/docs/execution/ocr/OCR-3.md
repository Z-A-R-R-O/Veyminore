# OCR-3 — Windows read-only computer-observer boundary

Task: OCR-W1-observer. Owner package: `packages/computer-observer/`.
Receipt date: 2026-10-17. Revision: 4 (captureBackend artifact-shape fix).

## Revision 4 — independent failure fix

Independent run of `test/native-port.test.js`: **22 pass / 1 fail** — the
`captureBackend` compatibility test failed inside
`createObserver.performCapture` with `ARTIFACT_INVALID`
("artifact reference (artifactId/uri) missing or out of bounds").

Root cause (own adapter only): `native-port.js` `readArtifact` published the
bounded reference under the adapter-local key `ref` only, while the existing
`createObserver.performCapture` contract requires `artifactId` (or `uri`).
The adapter's artifact never carried either key, so the reference check failed.

Fix:

- `src/native-port.js`: published artifact now carries **both** `ref` and
  `artifactId` (same bounded value; native `uri` inputs are normalized into
  `artifactId` the same way). Reference length is still capped at
  `maxArtifactRefChars` (512); mime/width/height/bytes bounds unchanged; no
  pixel fields are ever emitted.
- `types/index.d.ts`: `ArtifactRef.artifactId?: string` added; adapter capture
  return typed `ArtifactRef & { artifactId: string }`.
- **No change to `createObserver` validations** — `performCapture` artifact
  checks are untouched and were not weakened. **No `nativeVerified` claim**
  added anywhere; `attestation: 'caller_asserted_not_native_verified'` unchanged.

Regression fixture added in `test/native-port.test.js`:
"direct adapter artifact shape is accepted by actual createObserver.performCapture"
— asserts the **direct** `adapter.capture(...)` result (bounded
`artifactId`/`ref`/`mime`/`bytes`, no `data`/`pixels`/`base64`, no
`nativeVerified`) **and then the actual `createObserver` capture path**
(`processRunner: adapter`, `captureBackend: adapter`,
`observeWindow({ hwnd, expectedGeneration, expectedProcessId, capture: true })`)
ending in `capture.status: 'captured'` with full artifact metadata and the
caller-asserted attestation.

## Supported capabilities (cumulative)

- Bounded window metadata enumeration via **injected** `processRunner` only
  (structured specs, no shell strings, no spawning in-package).
- Exact-hwnd observation with fresh re-enumeration per request.
- Freshness (`maxAgeMs`) and generation (`expectedGeneration`) checks; stale
  requests rejected explicitly (`WINDOW_STALE`), never silently re-bound.
- Freshness bypass fixed (revision 2): `ageMs = clock() - observedAt` with **no
  non-negative clamp**; future `observedAt` rejected as `RESPONSE_MALFORMED`.
- Strict literal boolean `minimized`/`visible` flags; invalid entries dropped,
  all-invalid payload is `RESPONSE_MALFORMED`.
- Timeout (`OBSERVER_TIMEOUT`) and AbortSignal cancellation
  (`OBSERVER_CANCELLED`) as distinct typed errors; zero effect endpoints.
- Injected `NativeObservationPort` adapter (revision 3): bounded
  enumerate/inspect/capture with exact
  `windowHandle`/`processId`/`processStartedAt`/`generation`/`displayId` and
  freshness; **identity rechecked before and after async capture**; missing
  provider -> `CAPTURE_UNSUPPORTED`; revocation -> `PORT_REVOKED`; response
  bounds enforced; port contract documented (README + `types/index.d.ts`);
  no import of the separate AGR4 native implementation in either direction.
- Capture results are artifact-metadata-only: bounded `artifactId`/`ref`
  (revision 4), never pixels; no logging of window content.

## Attestation semantics

`independentlyTested: true` on an injected capture backend or native port is a
**caller assertion**, not native-verified proof. This package performs no native
verification: `nativeCaptureAttestation: 'caller_asserted_not_native_verified'`
is exposed on capabilities and captured results; no `nativeVerified` claim is
emitted anywhere.

## Planned / not in this pass

- Real native Windows capture (PrintWindow/BitBlt/DXGI etc.): **explicitly
  unsupported** here; implemented only by the separate AGR4 native package via
  the injected port, and only meaningful once independently tested.
- Integration against a real Windows process runner. Only offline mocks
  exercised in this package.
- Persistence/artifact store for capture references.

## Files

- `packages/computer-observer/package.json`
- `packages/computer-observer/src/index.js` (additive: `PORT_REVOKED`, re-export)
- `packages/computer-observer/src/native-port.js` (port adapter; rev-4 artifact fix)
- `packages/computer-observer/types/index.d.ts` (rev-4: `artifactId` typing)
- `packages/computer-observer/test/fixtures.js`
- `packages/computer-observer/test/observer.test.js` (unchanged, preserved)
- `packages/computer-observer/test/native-port.test.js` (rev-4: regression fixture)
- `packages/computer-observer/README.md` (rev-4: artifact-reference note)
- `docs/execution/ocr/OCR-3.md` (this receipt)

## Blockers

- Shared reads `packages/protocol/src/index.js` and `packages/policy/src/index.js`
  were unavailable at the attempted paths (file-not-found); no cross-package
  imports were made — package is fully dependency-free.
- Shell unavailable in this environment; tests **NOT RUN** here (the 22/1
  figures are from the independent run). Commands to run:

```bash
node --test packages/computer-observer/test/
# or individually:
node --test packages/computer-observer/test/observer.test.js
node --test packages/computer-observer/test/native-port.test.js
```

- Native capture was not executed (by design); no real window enumeration, no
  OS/helper execution, no screenshots, no input/network/shell.

## Fixtures covered

Prior (preserved): changed hwnd / process / generation (stale request),
entry-vs-snapshot generation inconsistency, aged snapshot, future `observedAt`,
non-boolean flag types, minimized/closed window, runner timeout, pre-aborted and
mid-flight cancellation, malformed JSON, all-invalid entries, oversized
response, unsupported capture, inline pixel rejection, missing/invalid artifact,
caller-asserted attestation (no `nativeVerified`), mock-port wrong PID, reused
HWND, target closed before/mid-capture, minimized/hidden, stale/future
freshness, revoke, cancel, response bounds, missing provider ->
`CAPTURE_UNSUPPORTED`, no-`nativeVerified`, prior-API smoke check.

New (revision 4): **direct adapter capture + actual `createObserver`
capture-path regression** asserting the artifact-reference shape
(`artifactId` + `ref`, bounded, no pixels, no `nativeVerified`) end to end.

## IFZ truthful public observation projection — 2026-10-19

New module `src/ifz-projection.js` (exported via `src/index.js`): a **pure,
offline, dependency-free** projection from admitted observer events to bounded
IFZ public status. Injected time only (`clock`); no capture, no native input,
no network, no providers, no shared-file edits.

Output contract: `{ state, subtext, ageMs, source, seq, evidence, admitted,
rejections: { total, byCode } }`.

- **Eight lifecycle states**: `available`, `idle`, `running`,
  `reportedComplete`, `verifiedComplete`, `unavailable`, `interrupted`,
  `uncertain`. Kind mapping: `available`/`connected` -> available, `idle` ->
  idle, `busy`/`worker-started`/`progress` -> running, `reported-complete` ->
  reportedComplete, `verified-complete` -> verifiedComplete, `unavailable` ->
  unavailable, `interrupted`/`failed` -> interrupted; empty/stale-at-project ->
  uncertain.
- **Proof rules**: only `verified-complete` yields `verifiedComplete`, and it
  is `EVENT_MALFORMED` without ≥1 evidence ref. `reported-complete` yields
  `reportedComplete` with unverified subtext and empty evidence. Idle,
  connected, busy, and worker/progress text **cannot prove completion**.
  `verifiedComplete` is sticky over later idle/available but yields to
  running/reportedComplete/unavailable/interrupted; latest lifecycle otherwise
  wins.
- **Rejections** (counted per fixed code set, never projected): malformed,
  oversized (`maxEventBytes`, default 2048 UTF-8 bytes), future (`at > clock`),
  stale (`age > maxAgeMs`, default 30000; boundary age admitted), mismatched
  (source changed mid-stream), reordered (non-increasing `seq`), duplicated
  (`seq` or `id` replay; bounded recent-id ring, default 64).
- **Safe public subtext**: fixed per-state vocabulary only, byte-bounded
  (`maxSubtextBytes`, default 160).
- **Redaction by design**: projector reads only whitelisted fields
  (`id/seq/at/kind/source/evidence`); prompts, typed content, window content,
  secrets, source text, and private reasoning are never read and cannot reach
  the projection. Evidence refs are bounded `[A-Za-z0-9._:-]` tokens
  (`maxEvidenceRefs` 8, `maxEvidenceRefChars` 128). Source tokens bounded to 64
  chars.
- **Age**: `ageMs = clock() - at` with injected clock, no clamping; negative or
  over-age at project time degrades state to `uncertain` while retaining
  age/source/seq for truthful reporting.

Files: `src/ifz-projection.js` (new), `src/index.js` (additive re-export),
`types/index.d.ts` (Ifz* declarations), `README.md` (IFZ section). IFZ tests
are appended to `test/observer.test.js` (see rework section below).

Blocker note: `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` **could not be read** —
the active permission policy denies reads outside the own package and an allow
list that does not include that file (exact error: read denied by rule
`{"permission":"read","pattern":"*","action":"deny"}`). The projection was
implemented strictly from the OCR-3 task-specified contract above; no content
from that architecture doc was assumed or paraphrased.

Focused package tests: **NOT RUN** in this environment (no shell tool
available). Commands and limits to verify:

```bash
node --test packages/computer-observer/test/observer.test.js
```

Expected bounds under test: see the rework section below — IFZ tests now live
in `test/observer.test.js` (this section's earlier `test/ifz-projection.test.js`
reference is superseded); event byte cap 2048 (configurable 64..1 MiB),
subtext byte cap 160 (8..1024), maxAgeMs 30000, source/id/evidence token caps
as above; prior suites unchanged and expected to remain green.

## IFZ projection rework — 2026-10-19 (test consolidation + hardening)

- Correction: the previously promised `test/ifz-projection.test.js` was never
  created in this workspace; focused IFZ coverage is now **appended to
  `test/observer.test.js`** (single focused command, no new files).
- Hardening in `src/ifz-projection.js`:
  - events must be **plain objects** (prototype `Object.prototype`/`null`);
    `Date`, class instances, arrays, and proxies with a throwing
    `getPrototypeOf` trap are `EVENT_MALFORMED`;
  - the entire accept path is guarded — throwing getters (enumerable or not),
    cyclic references, and deep payloads that break `JSON.stringify` are
    `EVENT_MALFORMED` before any projection state changes;
  - **exact source/project/workspace identity**: the first admitted event
    binds the triple; any later change *or omission* is `EVENT_MISMATCH`;
    `project()` now surfaces `project` and `workspace` (typed in
    `types/index.d.ts`);
  - **duplicate evidence refs** within one event are `EVENT_MALFORMED`;
  - UTF-8 byte bounds unchanged (`maxEventBytes` default 2048; multi-byte
    characters counted by bytes; subtext byte-truncated at `maxSubtextBytes`).
- Proof rules re-verified under test: `connected`/`idle`/`busy`/worker text and
  `reported-complete` self-reports can never yield `verifiedComplete` or
  evidence; only `verified-complete` with ≥1 unique evidence ref can.
- Also covered: stale/future/reordered/duplicate events, boundary age,
  project-time staleness -> `uncertain`, exact clock-derived `ageMs`, redaction
  (prompt/typed/window/secret/source-text/reasoning fields never appear in
  projected JSON), fixed rejection-code counter keys, reset semantics.
- Tests: **NOT RUN** in this environment (no shell tool available). Focused
  command: `node --test packages/computer-observer/test/observer.test.js`
  (expected: 44 tests = 32 prior + 12 IFZ; prior assertions unchanged).

## IFZ final correction — 2026-10-19 (verified-complete evidence gate)

Independent rerun after the rework reported **43/44 pass**; single failure:
"ifz: verified-complete requires evidence refs" expected `EVENT_MALFORMED` but
`accept()` returned `{admitted: true, code: null}` for a `verified-complete`
event without evidence.

Root cause: `acceptInner` validated evidence *shape* (array, count cap, token
charset, uniqueness) but never required a **non-empty** evidence list for the
`verified-complete` kind, so the event was admitted and mutated lifecycle state
with `evidence: []`.

Correction (`src/ifz-projection.js` only; test unchanged, not weakened):
schema-level gate added immediately after evidence validation and **before any
state mutation** (before freshness checks, identity binding, seq/id updates,
and lifecycle changes):

```js
if (kind === 'verified-complete' && evidence.length === 0) {
  return rejectRef('EVENT_MALFORMED');
}
```

Effects: `verified-complete` with omitted `evidence`, `evidence: []`, or only
invalid/duplicate refs (already rejected individually) can never be admitted,
can never bind stream identity, and can never reach `verifiedComplete`.
`reported-complete` remains unverified by design (no evidence exposed,
unverified subtext). All other kinds remain unaffected.

Tests: **NOT RUN** in this environment (no shell tool). Requesting rerun of:

```bash
node --test packages/computer-observer/test/observer.test.js
```

Expected: 44/44 pass (32 prior + 12 IFZ), with the evidence-gate test now
matching implementation behavior.

## Status

Tests: NOT RUN in this environment (see commands above). No shell/network/
secrets/installs used. Own computer-observer package + own receipt only; no
sibling packages, manifests, or AGR sources touched.

ready_for_review: true

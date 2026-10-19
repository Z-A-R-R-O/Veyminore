# @zetro/computer-observer

Windows **read-only** observation provider boundary. All OS access is injected:
this package never spawns processes, never touches the network, and exposes **no**
mouse/keyboard/clipboard/shell effect endpoints.

## Model

```
caller ──> createObserver({ processRunner, captureBackend?, clock? })
              │
              ├─ enumerate({ limit?, timeoutMs?, signal? })  -> bounded Snapshot
              └─ observeWindow({ hwnd, expectedGeneration?, expectedProcessId?,
                                 maxAgeMs?, timeoutMs?, signal?,
                                 capture?, requireCapture? }) -> ObserveResult

caller ──> createNativeObservationAdapter({ port, clock?, ... })
              │   (injected NativeObservationPort -> bounded, identity-checked results)
              ├─ run(spec, { signal })   -> ProcessRunner-compatible (drives createObserver)
              ├─ enumerate / inspect     -> exact identity + freshness
              └─ capture(target, ...)    -> identity rechecked before AND after async capture
```

- `processRunner.run(spec, { signal })` — injected; returns `{ stdout: string }`.
  Specs are structured objects (`{ kind: 'enumerate' | 'inspect', limit, ... }`), never
  shell strings built by this package.
- `captureBackend` — optional, injected. Native capture is **explicitly unsupported
  until independently tested**: the backend must declare `status: 'supported'`
  **and** `independentlyTested: true`, otherwise `nativeCapture` reports
  `unsupported` and capture requests return an explicit unsupported result
  (or fail with `CAPTURE_UNSUPPORTED` when `requireCapture: true`). This package
  never guesses a screenshot or a success.
- `independentlyTested: true` is a **caller assertion only** — it is not proof of
  native verification. Results therefore carry
  `attestation: 'caller_asserted_not_native_verified'` (also exposed as
  `getCapabilities().nativeCaptureAttestation`). This package performs no native
  testing and reports no `nativeVerified` claim anywhere.

## NativeObservationPort (injected, small, documented)

The adapter depends only on this port contract — **no import of any native
implementation** (the separate Windows native package provides its own
implementation, injected here at composition time):

```ts
interface NativeObservationPort {
  independentlyTested?: boolean; // caller assertion, never native-verified proof
  enumerate({ maxWindows }, { signal }): Promise<{
    windows: [{ windowHandle, processId, processStartedAt, generation,
                displayId, minimized, visible, title? }],
    generation, observedAt
  }>;
  inspect({ windowHandle }, { signal }): Promise<{ window, observedAt } | null>;
  capture({ windowHandle, processId, processStartedAt, generation, displayId },
          { signal }): Promise<{ artifact: { mime, width, height, bytes, artifactId|uri, ... } }>;
}
```

Adapter guarantees:

- **Exact identity**: every response must carry `windowHandle`, `processId`,
  `processStartedAt`, `generation`, `displayId` with strict types; anything else
  is dropped (`dropped`) or `RESPONSE_MALFORMED`. An inspect for handle X that
  returns a different handle is `WINDOW_MISSING` — never substituted.
- **Freshness**: `observedAt` in the future -> `RESPONSE_MALFORMED`; older than
  `maxAgeMs` -> `WINDOW_STALE` (no age clamp).
- **Capture recheck**: target identity is re-inspected **before** capture
  (expected fields validated: wrong PID -> `PROCESS_MISMATCH`, renewed
  `processStartedAt`/`displayId` -> `WINDOW_STALE`, generation ->
  `GENERATION_MISMATCH`, closed -> `WINDOW_MISSING`, minimized -> `WINDOW_MINIMIZED`)
  and **after** the async capture (divergence -> `PROCESS_MISMATCH` /
  `WINDOW_STALE` / `GENERATION_MISMATCH`; post-capture closure ->
  `WINDOW_MISSING`). On any post-check failure the capture result is discarded.
- **Missing provider**: `port` absent or incomplete -> `CAPTURE_UNSUPPORTED` on
  enumerate/inspect/capture. Adapter `status`/`independentlyTested` forward the
  port's declaration only; it never self-labels `nativeVerified`.
- **Revocation**: `adapter.revoke()` (or a provider error coded
  `REVOKED`/`AUTH_REVOKED`) -> `PORT_REVOKED` on all subsequent calls.
- **Bounds**: every provider response is size-checked
  (`maxResponseBytes`, `*64` for capture) -> `RESPONSE_TOO_LARGE`; inline pixel
  fields -> `INLINE_PIXELS_REJECTED`; artifact metadata validated ->
  `ARTIFACT_INVALID`. The adapter publishes the bounded reference as both `ref`
  and `artifactId` (native `uri` inputs are normalized the same way), so
  `createObserver.performCapture`'s existing artifact-reference checks pass
  unchanged — they are not weakened, and no pixel fields are ever emitted.
- **Timeout/cancel**: `timeoutMs` -> `OBSERVER_TIMEOUT`, `AbortSignal` ->
  `OBSERVER_CANCELLED` (provider codes `TIMEOUT`/`ABORTED` mapped accordingly).

## Exact identity, freshness, generation

`observeWindow` re-enumerates a fresh snapshot, then:

1. selects the **exact hwnd** (missing -> `WINDOW_MISSING`, no guessing);
2. requires entry generation == snapshot generation (`GENERATION_MISMATCH`);
3. requires `expectedGeneration` to still be current (`WINDOW_STALE`, stale request);
4. rejects snapshots older than `maxAgeMs` (`WINDOW_STALE`);
5. checks `expectedProcessId` against the fresh binding (`PROCESS_MISMATCH`);
6. rejects minimized (`WINDOW_MINIMIZED`) and hidden (`WINDOW_NOT_VISIBLE`) targets.

All checks fail closed with typed `ObserverError`s — never a silent success.

Freshness is strict: `ageMs = clock() - observedAt` is computed **without any
non-negative clamp**, and a backend `observedAt` in the future (relative to the
injected clock) is rejected outright as `RESPONSE_MALFORMED`. A future timestamp
can never masquerade as age 0 to bypass `maxAgeMs`.

## Bounded metadata, no personal content

- Windows capped at `maxWindows` (default 256); overflow marked `truncated`.
- Window entries require **literal boolean** `minimized` / `visible` fields;
  string/number/nullish values (e.g. `"true"`) make the entry invalid — dropped
  and counted (`dropped`); all-invalid payloads are `RESPONSE_MALFORMED`.
- Runner stdout capped at `maxResponseBytes` (default 64 KiB) -> `RESPONSE_TOO_LARGE`.
- Titles are **omitted by default** (only `titleChars` returned); with
  `includeTitles: true` they are truncated at `maxTitleChars`.
- The package performs **no logging**; pixel payloads from a capture backend are
  rejected (`INLINE_PIXELS_REJECTED`). Only artifact metadata/references are returned.

## Timeouts and cancellation

Every operation accepts `timeoutMs` (default 5000) and an `AbortSignal`:
`OBSERVER_TIMEOUT` and `OBSERVER_CANCELLED` are distinct typed errors.

## Error codes

`REQUEST_INVALID`, `OBSERVER_TIMEOUT`, `OBSERVER_CANCELLED`, `RESPONSE_MALFORMED`,
`RESPONSE_TOO_LARGE`, `WINDOW_MISSING`, `WINDOW_STALE`, `WINDOW_MINIMIZED`,
`WINDOW_NOT_VISIBLE`, `GENERATION_MISMATCH`, `PROCESS_MISMATCH`,
`CAPTURE_UNSUPPORTED`, `ARTIFACT_INVALID`, `INLINE_PIXELS_REJECTED`,
`PORT_REVOKED`.

## Capabilities

| Capability | Status |
| --- | --- |
| Bounded window enumeration | supported |
| Exact-hwnd observation | supported |
| Freshness/generation checks (incl. future-timestamp rejection, no age clamp) | supported |
| Strict literal boolean flags | supported |
| NativeObservationPort adapter (enumerate/inspect/capture, identity + freshness) | supported (port injected; no native implementation imported) |
| Pre/post async-capture identity recheck | supported |
| Port revocation (`PORT_REVOKED`) | supported |
| Timeout / cancellation | supported |
| Bounded artifact metadata | supported |
| Native screenshot capture | **explicitly unsupported**; any backend flag is a caller assertion (`caller_asserted_not_native_verified`), never native-verified proof |
| Mouse / keyboard / clipboard / shell effects | **not provided** (by design) |

## Tests (offline fixtures, no native capture, no OS execution)

Fixtures in `test/fixtures.js` and `test/observer.test.js` simulate: changed
hwnd/process/generation, stale request, aged snapshot, **future `observedAt`
timestamps**, **non-boolean flag values**, minimized/closed window, timeout,
mid-flight cancellation, malformed and oversized responses,
unsupported/invalid capture, and attestation exposure.

`test/native-port.test.js` uses a **mock injected port** (no real provider):
wrong PID, reused HWND (PID/`processStartedAt` changed across capture), target
closed before/during capture, minimized/hidden target, stale and future
freshness, adapter and provider revocation, pre-aborted and mid-flight cancel,
timeout, oversized and malformed identity responses, missing provider ->
`CAPTURE_UNSUPPORTED`, and the no-`nativeVerified` guarantee.

```bash
node --test packages/computer-observer/test/
# or, from this package directory:
npm test
```

Declarations: `types/index.d.ts`.

## IFZ truthful public observation projection

`createIfzProjector({ clock, maxAgeMs?, maxEventBytes?, maxSubtextBytes?, ... })`
is a **pure, offline projection** from admitted observer events to a bounded
public status: `{ state, subtext, ageMs, source, seq, evidence, admitted,
rejections }`. Time is always injected (`clock`); there is no I/O, no capture,
no network, no providers.

Lifecycle states: `available`, `idle`, `running`, `reportedComplete`,
`verifiedComplete`, `unavailable`, `interrupted`, `uncertain` (empty, stale, or
future-skewed projectors report `uncertain`).

Proof rules: only `verified-complete` (which **requires** evidence refs) yields
`verifiedComplete`; `reported-complete` yields `reportedComplete` with an
explicitly-unverified subtext and **no** evidence refs. `idle`, `connected`,
`busy`, and worker/progress text can never prove completion. `verifiedComplete`
is sticky over later `idle`/`available` but yields to `running`,
`reportedComplete`, `unavailable`, or `interrupted`.

Rejections (counted, never projected): `EVENT_MALFORMED`, `EVENT_TOO_LARGE`,
`EVENT_FUTURE`, `EVENT_STALE`, `EVENT_MISMATCH` (exact
source/project/workspace identity changed or omitted mid-stream),
`EVENT_REORDERED`, `EVENT_DUPLICATE`. Strict UTF-8 byte bounds apply to whole
events (`maxEventBytes`, default 2048) and subtext (`maxSubtextBytes`).
Events must be plain objects; cyclic, accessor-throwing, proxy,
class-instance, and deep payloads are rejected as `EVENT_MALFORMED` before any
projection state changes. Evidence refs must be unique within an event.

Redaction by design: the projector reads only whitelisted schema fields
(`id`, `seq`, `at`, `kind`, `source`, `project`, `workspace`, `evidence`);
unknown fields (prompts, typed content, window text, secrets, source text,
private reasoning) are never read and can never reach the projection. Subtext
is drawn from a fixed safe vocabulary. Evidence refs are bounded token strings
(`[A-Za-z0-9._:-]`).

Tests: IFZ coverage is appended to `test/observer.test.js` (IFZ block; pure
offline, dependency-free).

# @zetro/computer-conformance

Offline conformance harness for the Computer alpha. Dependency-free ESM. No runtime deps.

## Verification status (read this first)

- **Mock verification only.** All scenarios run against injected in-memory fake ports
  (`createMockPorts`). Scenarios cover: authenticate -> grant -> observe -> revoke -> stop ->
  export audit, stale target, expired grant, canceled pending observation, malicious observer
  claim, and evidence identity (forged digest rejected).
- **Actual OCR-1/2/3 integration: NOT VERIFIED.** `createIntegrationEntrypoints()` is wiring
  only. `mode: 'native-live'` is fail-closed: ALWAYS blocked in this offline harness.
  Caller-supplied ports/labels cannot self-certify native-live; independent attestation of the
  real OCR packages is required and happens outside this module.
- **Native live Windows verification: NOT VERIFIED.** No desktop operations, no input effects,
  no network, no secrets. Remaining live gates (real Windows observer, real OCR package wiring)
  must be executed by the coordinator outside this package.

## API

- `runConformance({ mode, ports, integration })` -> structured report
  (`mode`: `mock` | `native-live`; `verification` field distinguishes mock vs native-live).
- `runScenario(name, ports, ctx)` -> single-scenario result.
- `createMockPorts()` -> fake contract/session/observer ports.
- `createIntegrationEntrypoints({ ocr1, ocr2, ocr3 })` -> integration readiness; `missing` lists
  unavailable OCR packages precisely.
- `SCENARIOS` -> the six scenario names.
- `evidenceDigest(payload)` -> deterministic evidence identity digest.

## CLI (OCR-W3)

```
node src/cli.js                 # offline integration + negatives -> bounded JSON report, exit 0/1
node src/cli.js --native-live   # fail-closed: blocked, exit 2, never self-certified
```

Report identity: `schemaVersion: zetro.computer-conformance.report.alpha.v1`,
`mode: offline-integration`, `nativeVerified: false`, actual package names, per-scenario
outcomes (`pass`/`rejected`/`never_verified`), bounded size (≤16KB, enforced).
Any non-pass scenario exits nonzero. No network, shell runner, desktop ops, or secrets.

## Test

```
npm test   # node --test test/conformance.test.js
```

Tests were **NOT RUN** by the authoring pass (shell unavailable). Coordinator must run them.

## Offline actual-package integration (OCR-W2)

`src/actual-integration.js` imports the ACCEPTED actual packages directly
(`computer-contract` OCR-1, `computer-runtime` OCR-2, `computer-observer` OCR-3) and runs
authenticate -> injected shared authority -> real `ComputerSession` -> real observer over an
injected Windows metadata runner -> real contract request/result/trusted verification ->
revoke -> stop -> audit export. Label: **offline-integration; native Windows UNVERIFIED**.
Only OS metadata / clock / auth / authority / trusted-verifier ports are mocked (boundaries).
Negatives (wrong identity, future target, stale generation, revoke-during-authority-await,
authority timeout, bounds, no-trusted-verifier) are rejected/never-verified by the actual
packages. Tests: `node --test test/`.

## Boundaries

- Owns `packages/computer-conformance/` and `docs/execution/ocr/OCR-5.md` only.
- No workerclaims verification, no RCT product smoke scripts, no root manifest edits,
  no existing-package edits, no installs/network/secrets.

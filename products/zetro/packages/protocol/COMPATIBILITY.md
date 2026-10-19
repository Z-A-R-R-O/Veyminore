# ZETRO Protocol Compatibility Document

Version: 1.0.0
Date: 2026-10-17
Author: AGR-1 (ZETRO Protocol Worker)

## 1. Overview and Architectural Intent

The `@zetro/protocol` package provides dependency-free, versioned contracts and runtime validators for ZETRO. Prior to this package, different subsystem components (`rct-runtime`, `orchestration-core`, and `antigravity-bridge`) maintained separate shapes, naming conventions, and validation constraints.

This document records the exact compatibility mappings between existing subsystems and the unified Protocol v1 schemas without modifying code in other packages during this dispatch wave.

### Core Protocol Principles

1. **Strict Separation of Concerns**:
   - **Worker Claim**: What the worker asserts it did (reported state, summary, proposed patches).
   - **Effects**: Verified mutations to the environment or filesystem (applied patches, changed files, file hashes).
   - **Verification**: Independent check results from the coordinator or verifier (`passed`, `failed`, `inconclusive`). Worker submissions never determine their own verification status.
   - **Task State**: Authoritative lifecycle state (`pending`, `running`, `submitted`, `completed`, `failed`, `cancelled`, `unknown`). `completed` strictly requires independent verification to have passed.
   - **Attempt Identity**: Distinct from task identity. `taskId` identifies the job; `attemptId` identifies the specific execution attempt.
   - **Uncertainty**: Ambiguous or unconfirmed transport and delivery states are explicitly tracked, preventing false success and avoiding automatic duplicate execution.

2. **Deny-by-Default Authority**:
   - Every effect requires a valid, unexpired, unrevoked `Grant`.
   - Grants support exact-request approval digests (`exactRequestDigest`), principal scope, session scope, and path scope.

---

## 2. RCT Compatibility Mapping

RCT currently exposes two contract interfaces:
1. Manifest admission (`packages/rct-runtime/src/admission.js` - `rct.assignment.v1`)
2. Direct runtime API (`packages/rct-runtime/src/index.js` - `validateAssignment` and `runAssignment`)

### 2.1 Assignment Mapping Table

| Protocol Field (`zetro.protocol.assignment.v1`) | RCT Admission Manifest (`rct.assignment.v1`) | RCT Runtime (`validateAssignment`) | Notes |
| :--- | :--- | :--- | :--- |
| `schemaVersion` | `schemaVersion: 'rct.assignment.v1'` | *(implicit)* | Mapped to `zetro.protocol.assignment.v1`. |
| `taskId` | `taskId` | `id` | Standardized to string `^[a-zA-Z0-9_-]{1,64}$`. |
| `attemptId` | *(implicit: 1)* | *(implicit: 1)* | Explicit attempt identity (e.g. `1`, `2`). |
| `agentId` | *(implicit: 'RCT-1')* | *(implicit: 'RCT-1')* | Explicit worker slot identifier. |
| `objective` | `objective` (string 3-2000 chars) | `objective` | Direct 1:1 match. |
| `acceptance` | `acceptance` (array of strings) | `acceptance` (string) | Unified as array of strings `string[]`. If RCT runtime passes a single string, the adapter wraps it in `[str]`. |
| `scope.root` | `source.root` | `options.isolatedRoot` | Realpath / directory path for isolation. |
| `scope.readPaths` | `scope.readPaths` | `allowedPaths` (or `.readPaths`) | Posix relative paths. |
| `scope.writePaths` | `scope.writePaths` | `allowedPaths` (or `.writePaths`) | Posix relative paths. |
| `scope.createPaths` | `scope.createPaths` | *(optional)* | Posix relative paths for newly created files. |
| `scope.sourceHashes` | `scope.sourceHashes` | *(computed in admission)* | Hex SHA-256 baseline hashes. |
| `checks` | `checks: [{ type, path, text }]` | `checks: [{ type, path, text }]` | Check profiles: `equals`, `contains`, `command`. |
| `budget.maxTurns` | `budget.maxTurns` (default 6) | `budget.maxTurns` | Mapped directly. |
| `budget.maxInputTokens`| `budget.maxInputTokens` (default 6000) | `budget.maxInputTokens` | Mapped directly. |
| `budget.maxOutputTokens`| `budget.maxOutputTokens` (default 3000) | `budget.maxOutputTokens`| Mapped directly. |
| `budget.maxPromptChars`| `budget.maxPromptChars` (default 16000) | `budget.maxPromptChars`| Mapped directly. |
| `budget.maxReadBytes` | `budget.maxReadBytes` (default 8192) | `budget.maxReadBytes` | Mapped directly. |
| `budget.maxWriteBytes` | `budget.maxWriteBytes` (default 8192) | `budget.maxWriteBytes` | Mapped directly. |
| `budget.maxWallMs` | `budget.maxWallMs` (default 30000) | `budget.maxWallMs` | Mapped directly. |
| `dataPolicy` | `dataPolicy: { classification, allowRemoteInference, provider, model }` | *(absent)* | Fully validated in Protocol; defaults to `public`, `allowRemoteInference: false`. |
| `deadlineMs` | Derived from `budget.maxWallMs` | Derived from `budget.maxWallMs` | Safe integer duration in ms. |

### 2.2 Receipt / Result Mapping Table

| Protocol `TaskResult` (`zetro.protocol.task_result.v1`) | RCT Runtime Receipt (`runAssignment`) | Handling & Invariants |
| :--- | :--- | :--- |
| `status` | `state` (`'review_ready'`, `'failed'`, `'unknown'`, `'budget_exhausted'`) | If RCT `state === 'review_ready'` AND all checks passed -> `completed`. If checks failed -> `failed`. If `state === 'unknown'` -> `unknown`. |
| `workerClaim.reportedState` | `completionSource: 'worker_receipt'` / `state` | `submitted` or `failed`. Worker's self-assertion. |
| `workerClaim.summary` | `workerSummary` | String up to 2000 chars. |
| `workerClaim.proposedPatches` | `patches: [{ path, before, after, applied }]` | Normalizes before/after hashes and byte counts. |
| `effects.applied` | Filtered from `patches.some(p => p.applied)` | Boolean indicating filesystem mutation. |
| `effects.changedFiles` | Filtered from `patches.filter(p => p.applied).map(p => p.path)` | Array of modified relative paths. |
| `verification.verified` | `checks.every(c => c.passed)` | **True ONLY if verifier confirmed checks passed**. |
| `verification.status` | Derived from check results | `passed` (if all pass), `failed` (if any fail), or `not_requested`. |
| `verification.checkResults` | `checks: [{ type, path, passed, sha256 }]` | Detailed independent check results. |
| `uncertainty.isUncertain` | `remoteUsageUncertain` or `state === 'unknown'` | Boolean flag. |
| `uncertainty.reasons` | `failureReason`, transport timeout | Explicit array of uncertainty causes. |

---

## 3. Dispatcher Compatibility Mapping

Dispatcher (`packages/orchestration-core/src/types.js` and `dispatcher.js`) uses `TaskEnvelope` and `TaskReceipt`.

### 3.1 TaskEnvelope to Protocol Assignment

| Protocol `Assignment` | Dispatcher `TaskEnvelope` | Mapping Notes |
| :--- | :--- | :--- |
| `taskId` | `id` | Direct mapping. |
| `attemptId` | *(implicit or options)* | Defaults to `1`. |
| `agentId` | `agent` | Target agent slot (e.g. `'AGR-1'`). |
| `objective` | `objective` | Direct mapping. |
| `acceptance` | `acceptance` | Dispatcher string wrapped in `[envelope.acceptance]`. |
| `scope.readPaths` / `writePaths` | `allowedPaths` | Flat array mapped to both readPaths and writePaths. |
| `checks` | `verification` (string) | Parsed into command check e.g. `['npm', 'test']`. |
| `budget.maxContextChars` | `budget.maxContextChars` | Carried over into Protocol budget. |
| `budget.maxReplyChars` | `budget.maxReplyChars` | Carried over into Protocol budget. |
| `deadlineMs` | `deadlineMs` | Direct mapping. |
| `metadata.contextRefs` | `contextRefs` | Array of reference strings preserved in `metadata`. |

### 3.2 Dispatcher States to Protocol TaskState

| Dispatcher `States` | Protocol `TaskState` | Protocol Invariant |
| :--- | :--- | :--- |
| `PENDING` | `TaskState.PENDING` | Queued, not yet dispatched. |
| `RUNNING` | `TaskState.RUNNING` | Active execution. |
| `SUBMITTED` | `TaskState.SUBMITTED` | Worker submitted; awaiting verification. |
| `COMPLETED` | `TaskState.COMPLETED` | Independent checks verified passed. |
| `FAILED` | `TaskState.FAILED` | Execution or verification failure. |
| `CANCELLED` | `TaskState.CANCELLED` | Explicitly cancelled. |
| `UNKNOWN` | `TaskState.UNKNOWN` | Ambiguous outcome; requires uncertainty record. |

---

## 4. Antigravity Bridge & MCP Compatibility Mapping

The Antigravity Bridge (`packages/antigravity-bridge/`) has two key components:
1. **MCP Tool Server** (`mcp/src/server.js`): Exposes `fetch_task` and `submit_receipt`.
2. **Events Journal & Coordinator** (`events/src/coordinator.js` & `journal.js`): Implements `ingest()` and event transitions.

### 4.1 MCP submit_receipt to Protocol TaskResult

Bridge MCP `submit_receipt` tool input:
```json
{
  "taskId": "task-xyz",
  "capabilityDigest": "sha256-digest",
  "receipt": {
    "status": "success",
    "agent": "AGR-1",
    "paths": ["path/to/file.js"]
  }
}
```

**Critical Compatibility Rule**:
- `receipt.status === 'success'` is a **Worker Claim** (`workerClaim.reportedState = 'submitted'`).
- It does **NOT** set `verification.verified = true`.
- The bridge `Coordinator.ingest` independently runs `this.verifier.runCheck(checkId)` before writing `independently-verified` or `independently-failed` into the journal.
- The `bridgeMcpReceiptToWorkerClaim()` adapter strictly marks `verified: false`.

### 4.2 Bridge Journal Events to Protocol Events

| Bridge Journal Event (`events/src/journal.js`) | Protocol `EventType` (`zetro.protocol.event.v1`) | Actor Role |
| :--- | :--- | :--- |
| `created` | `EventType.TASK_CREATED` | `coordinator` |
| `intent-to-submit` | `EventType.INTENT_TO_SUBMIT` | `coordinator` |
| `submitted` | `EventType.SUBMITTED` | `coordinator` |
| `hook-idle` | `EventType.WORKER_STARTED` | `daemon` |
| `worker-reported` | `EventType.WORKER_REPORTED` | `worker` |
| `verified` (`independently-verified` / `independently-failed`) | `EventType.VERIFICATION_COMPLETED` | `verifier` |
| `hook-error` | `EventType.TASK_FAILED` | `daemon` |
| `unknown-transition` | `EventType.UNCERTAINTY_RECORDED` | `coordinator` |

---

## 5. Migration Guide for Subsystem Owners

1. **For AGR-2 (`rct-runtime`)**:
   - In Wave 2 integration, use `rctManifestToProtocolAssignment()` and `protocolAssignmentToRctManifest()` to bridge manifests.
   - Use `rctReceiptToTaskResult()` when returning final task receipts.

2. **For AGR-3 (`orchestration-core`)**:
   - In Wave 2 integration, replace custom ad-hoc `validateEnvelope` with `dispatcherEnvelopeToProtocolAssignment()`.
   - Map dispatcher state transitions cleanly using `DispatcherStates` and `TaskState`.

3. **For AGR-4 (`antigravity-adapter` & `apps/agent-tools`)**:
   - Preserve adapter observation distinctions: `delivery: 'submitted'` means transport delivery acknowledgment only, never task completion or verification.

4. **For AGR-5 (Root Baseline & Verification)**:
   - Root checks can execute `packages/protocol` tests with `pnpm --filter @zetro/protocol test` or `node --test packages/protocol/test/*.test.js`.

# @zetro/protocol

Dependency-free, versioned protocol schemas, runtime validators, authority evaluator, and compatibility adapters for ZETRO.

## Overview

The `@zetro/protocol` package provides the authoritative contract definitions for ZETRO tasks, effects, events, and verifications. It has **zero external runtime dependencies**, relying solely on Node.js standard library built-ins (`node:crypto`, `node:assert`, `node:test`).

### Key Invariants

1. **Separation of Concerns**:
   - **Task State**: The authoritative execution state (`pending`, `running`, `submitted`, `completed`, `failed`, `cancelled`, `unknown`).
   - **Worker Claim**: What the worker claims occurred (summary, reported state, proposed patches).
   - **Effects**: Actual observed system mutations (applied patches, modified files, file hashes).
   - **Verification**: Independent check results from the coordinator/verifier.
   - **Attempt Identity**: Distinct from task identity (`taskId` vs `attemptId`).
   - **Uncertainty**: Explicit tracking of ambiguous transport outcomes (`unknown` states never trigger automatic duplicate work or claim completion).

2. **Rejection of False Verified States**:
   - A worker self-reporting "submitted" or "success" **cannot** set `verification.verified = true` or `status = 'completed'`.
   - `status = 'completed'` requires `verification.verified = true`, `verification.status = 'passed'`, non-empty check results where all checks passed, and `uncertainty.isUncertain = false`.
   - Any attempt to claim completion without passed verification checks fails closed with `ValidationError`.

3. **Deny-by-Default Authority**:
   - Actions require a valid, unexpired, unrevoked `Grant`.
   - Supports exact-request approval digest (`exactRequestDigest`), principal scope, session scope, and path scope.
   - Evaluator supports clock injection for deterministic time testing.

---

## Schemas & Versions

All schemas are strictly versioned:

| Schema | Version String | Description |
| :--- | :--- | :--- |
| **Assignment** | `zetro.protocol.assignment.v1` | Bounded task specification with scope, criteria, checks, budget, and data policy. |
| **TaskResult** | `zetro.protocol.task_result.v1` | Outcome separating worker claim, applied effects, independent verification, and uncertainty. |
| **Event** | `zetro.protocol.event.v1` | Append-only telemetry/journal event. |
| **ActionRequest** | `zetro.protocol.action_request.v1` | Typed request for effect (file, shell, desktop, browser) with request digest binding. |
| **ActionResult** | `zetro.protocol.action_result.v1` | Outcome of authorized action with `effectObserved` flag and execution metrics. |
| **Grant** | `zetro.protocol.grant.v1` | Authority grant with principal/session scope, expiry, revocation, and exact digest binding. |
| **EvidenceReceipt** | `zetro.protocol.evidence_receipt.v1` | Cryptographic evidence binding initial baseline, final effects, verification, and artifacts. |

---

## Usage Examples

### 1. Validating an Assignment

```javascript
import { validateAssignment, SCHEMA_VERSIONS, CheckType, DataClassification } from '@zetro/protocol';

const assignment = validateAssignment({
  schemaVersion: SCHEMA_VERSIONS.ASSIGNMENT,
  taskId: 'task-001',
  attemptId: 1,
  agentId: 'AGR-1',
  objective: 'Implement protocol package',
  acceptance: ['Tests pass deterministically'],
  scope: {
    root: 'E:/Veyminore/products/zetro',
    readPaths: ['packages/protocol/src/index.js'],
    writePaths: ['packages/protocol/src/index.js'],
    createPaths: []
  },
  checks: [
    {
      type: CheckType.EQUALS,
      path: 'packages/protocol/src/index.js',
      text: 'export * from "./constants.js";'
    }
  ],
  budget: {
    maxTurns: 10,
    maxWallMs: 30000
  },
  dataPolicy: {
    classification: DataClassification.PUBLIC,
    allowRemoteInference: false
  },
  deadlineMs: 30000
});
```

### 2. Evaluating Authority with Injected Clock

```javascript
import { evaluateGrant, createActionRequest, ActionType } from '@zetro/protocol';

const request = createActionRequest({
  taskId: 'task-001',
  attemptId: 1,
  principalId: 'worker-1',
  sessionId: 'sess-1',
  actionType: ActionType.FILE_WRITE,
  parameters: {
    path: 'packages/protocol/src/constants.js',
    content: '// approved changes'
  }
});

const evaluation = evaluateGrant(grant, request, {
  currentTime: Date.now() // or injected timestamp
});

if (evaluation.granted) {
  // Execute effect safely
} else {
  console.error(`Denied: ${evaluation.reason}`);
}
```

### 3. Compatibility Adapters

```javascript
import {
  rctManifestToProtocolAssignment,
  protocolAssignmentToRctManifest,
  rctReceiptToTaskResult,
  dispatcherEnvelopeToProtocolAssignment,
  bridgeMcpReceiptToWorkerClaim
} from '@zetro/protocol';

// Convert RCT manifest to Protocol Assignment
const protocolAssignment = rctManifestToProtocolAssignment(rctManifest);

// Convert Dispatcher envelope to Protocol Assignment
const fromDispatcher = dispatcherEnvelopeToProtocolAssignment(taskEnvelope);

// Map bridge MCP receipt to an unverified worker claim
const workerClaim = bridgeMcpReceiptToWorkerClaim(mcpSubmission);
```

---

## Scripts & Testing

Run all package tests using the native Node.js test runner:

```bash
npm test
# or directly:
node --test test/*.test.js
```

All 60+ tests execute deterministically in under 300ms without network, mock server, or external package dependencies.

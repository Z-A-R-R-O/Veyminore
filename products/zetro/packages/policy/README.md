# @zetro/policy

A zero-dependency, fail-closed shared policy service for the ZETRO platform.

Provides deterministic authority evaluation, capability grants, principal/session scoping, expiry boundaries, revocation, atomic one-use approval tracking, and effect-time authority rechecking with injected clock support.

> [!NOTE]
> `@zetro/policy` enforces authorization, capability bounds, and approval verification at the application and IPC layer. It does **not** claim or provide OS-level hardware/kernel sandboxing.

---

## Features

- **Deny-by-Default Evaluation**: Any missing identity, expired grant, revoked grant, empty scope, parameter tampering, or unpermitted action fails closed.
- **Principal & Session Scoping**: Grants are strictly tied to `principalId` and optionally `sessionId`. Unauthenticated or session-mismatched requests are denied.
- **Injected Clock**: Full deterministic testing support via injected timestamp function `() => number`.
- **Atomic One-Use Consumption**: `authorizeAndConsume()` atomically validates authority and records request consumption in a single operation, eliminating replay race windows.
- **Effect-Time Rechecking**: `recheckAtEffectTime()` validates that queued work has not been revoked or expired between queue time and effect execution.
- **Emergency Stop & Revocation**: Instant revocation of individual grants, entire sessions, principals, or platform-wide emergency stop (`revokeAll()`).
- **Subsystem Ports**:
  - `RctPolicyPort`: Implements the evaluator contract for RCT's `AuthorityPort` without modifying RCT runtime.
  - `ComputerPolicyPort`: Mediates screen capture, desktop input, scoped filesystem, shell, and browser operations for ZETRO Computer.

---

## Architecture & Ports

```
                          ┌───────────────────────────┐
                          │   @zetro/protocol Schemas │
                          │   (Grant, ActionRequest)  │
                          └─────────────▲─────────────┘
                                        │
                          ┌─────────────┴─────────────┐
                          │       PolicyService       │
                          │ - Injected Clock          │
                          │ - Active Grants Store     │
                          │ - Replay & Use Tracking   │
                          │ - Revocation & Stop Gates │
                          └───────▲───────────▲───────┘
                                  │           │
                 ┌────────────────┴──┐     ┌──┴────────────────┐
                 │   RctPolicyPort   │     │ ComputerPolicyPort│
                 │ (RCT Tool Handlers│     │(Desktop, Screen,  │
                 │  & AuthorityPort) │     │ Shell, Browser)   │
                 └───────────────────┘     └───────────────────┘
```

---

## Usage Example

```javascript
import { PolicyService, RctPolicyPort } from '@zetro/policy';
import { ActionType, SCHEMA_VERSIONS, createActionRequest } from '@zetro/protocol';

// 1. Initialize service with optional injected clock
const policy = new PolicyService({ clock: () => 1700000000000 });

// 2. Register an authoritative grant
policy.issueGrant({
  schemaVersion: SCHEMA_VERSIONS.GRANT,
  grantId: 'grant-worker-01',
  principalId: 'worker-1',
  sessionId: 'sess-alpha',
  scope: {
    actionTypes: [ActionType.FILE_READ, ActionType.FILE_WRITE],
    allowedPaths: ['src/app.js']
  },
  issuedAt: 1700000000000,
  expiresAt: 1700000060000, // 60s validity
  revoked: false,
  issuerId: 'coordinator'
});

// 3. Create and evaluate an action request
const req = createActionRequest({
  taskId: 'task-101',
  attemptId: 1,
  principalId: 'worker-1',
  sessionId: 'sess-alpha',
  actionType: ActionType.FILE_READ,
  parameters: { path: 'src/app.js' }
});

const evalResult = policy.evaluate(req);
console.log(evalResult.granted); // true

// 4. Atomically authorize and consume (prevents replay)
const consumeResult = policy.authorizeAndConsume(req);
console.log(consumeResult.granted); // true

// 5. Replay fails closed
const replayResult = policy.evaluate(req);
console.log(replayResult.granted); // false ('request_already_consumed')
```

---

## Test Suite

Run focused deterministic tests:
```bash
node --test test/*.test.js
```

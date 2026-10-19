# Receipt: IFZ Contracts & Worker Registry

- **Task**: IFZ contracts and worker registry
- **Worker**: AGR-1
- **Coordinator**: Codex
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Files**:
  - [`packages/orchestration-core/src/ifz/contracts.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/contracts.js)
  - [`packages/orchestration-core/src/ifz/worker-registry.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/worker-registry.js)
  - [`packages/orchestration-core/test/ifz-contracts.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/ifz-contracts.test.js)
  - [`packages/orchestration-core/test/ifz-worker-registry.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/ifz-worker-registry.test.js)
  - [`docs/execution/AGR-1-ifz-contracts.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-1-ifz-contracts.md)
- **Status**: `ready_for_review`

---

## 1. Architectural Summary & Scope Boundaries

Per [`docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`](file:///E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md), this slice delivers the authoritative, schema-enforced contracts and the in-memory `WorkerRegistry` for the IFZ backend architecture as isolated modules under `packages/orchestration-core/src/ifz/`.

### Preserved Boundaries & Invariants
- **Unmodified Core Files**: No edits were made to `packages/orchestration-core/src/index.js`, existing dispatchers (`dispatcher.js`, `journal.js`, `types.js`), or `package.json`.
- **Worker Isolation**: No edits were made to sibling worker assignments (AGR-2, AGR-3, AGR-4, AGR-5) or control center applications.
- **Zero External Dependencies**: Implemented using pure Node.js standard libraries (`node:crypto`, `node:assert`, `node:test`). Zero npm/pnpm packages installed or altered.
- **Execution Invariants**: Strictly offline, deterministic execution with no live inference, network calls, or Git commits.

---

## 2. Requirements Implemented

### 1. Authoritative Schema Contracts ([`src/ifz/contracts.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/contracts.js))
Enforces 6 distinct schema-versioned models:
1. **Worker Manifest** (`zetro.ifz.worker_manifest.v1`):
   - Strict identity tuple: `workerId`, `workerType`, `adapterId`, `projectId`, `workspaceId`, `revision`.
   - Capabilities: `effects`, `actions`, `contextTypes`, `canDelegate`, `supportsCancellation`, `supportsResume`.
   - Limits: `maxConcurrency`, `maxDurationMs`.
   - Availability projection: initial status and observed timestamp.
2. **Task Envelope** (`zetro.ifz.task_envelope.v1`):
   - Scope: `taskId`, `runId`, `conversationId`, `parentTaskId`, `sourceWorkerId`, `destinationWorkerId`.
   - Execution scope: `objective`, `authorizedEffects`, `pathScopes` (`read`, `write`, `create`), `limits` (`maxDurationMs`, `maxDelegationDepth`).
3. **Route Request** (`zetro.ifz.route_request.v1`):
   - Any-to-any multi-agent routing request supporting strategies: `single`, `broadcast`, `sequential`, `parallel`, `fallback`, `consensus`.
   - Scopes required effects, context references, priority, and timeouts.
4. **Context Reference** (`zetro.ifz.context_reference.v1`):
   - Cryptographic SHA-256 digest pinning with URI, kind, mime type, byte size, and redaction flags.
5. **Public Event** (`zetro.ifz.public_event.v1`):
   - Safe observable lifecycle events (`route_selected`, `task_enqueued`, `task_started`, `task_progress`, `task_delivered`, `task_failed`, `worker_registered`, `worker_status_changed`).
   - Redaction enforcement: forbids private prompts, credentials, or raw thoughts in details.
6. **Delivery Receipt** (`zetro.ifz.delivery_receipt.v1`):
   - Secret-free proof of task execution.
   - Forbids raw prompts, source code, credentials, secrets, or raw private reasoning.
   - Cryptographic payload digest computation and verification (`verifyDigest`).
   - Verifier checks record required when marked `verified: true`.

### 2. Seven Distinct Effect Classes
Distinctly partitions and enforces 7 approved effect classes:
- `read`: Read-only inspections and file queries.
- `write`: File modifications within authorized path scopes.
- `create`: New file creations within authorized path scopes.
- `execute`: Process execution or shell runs.
- `external-send`: Egress messages, external API posts, reviews.
- `inference`: Model token generation.
- `computer`: OS / desktop automation and UI interactions.

### 3. Strict Boolean and Identity Validation
- **No Truthy Coercion**: Rejects truthy values (`"true"`, `1`, `{}`) on all boolean attributes (`canDelegate`, `supportsCancellation`, `supportsResume`, `delivered`, `effectsObserved`, `verified`). Must strictly be `typeof val === 'boolean'`.
- **Identity Integrity**: Identifiers (`workerId`, `taskId`, etc.) must be non-empty strings without whitespace-only content.

### 4. Authority Growth Prevention (`assertNoAuthorityGrowth`)
Prevents unconstrained subtask delegation by verifying:
- Child request cannot ask for effect classes not granted in parent envelope's `authorizedEffects`.
- Child request cannot declare `write` or `create` path scopes outside parent envelope's authorized path boundaries.
- Child delegation depth cannot exceed `parentEnvelope.limits.maxDelegationDepth`.

### 5. In-Memory Worker Registry ([`src/ifz/worker-registry.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/worker-registry.js))
- **`register(manifest)`**: Validates manifest, rejects duplicate worker IDs with `IfzConflictError`.
- **`replace(manifest, exactPreviousRevision)`**: Concurrency control via exact previous revision match; requires strictly increasing monotonic revision.
- **`get(workerId)` / `has(workerId)` / `count()` / `unregister(workerId)`**: Lookups and life-cycle management.
- **`list(filter)`**: Filter by `workerType`, `adapterId`, `projectId`, `workspaceId`, `availabilityStatus`, and `hasEffect`.
- **`queryCapabilities(query)`**: Capability subset matching on `effects`, `actions`, `contextTypes`, `canDelegate`, and `supportsCancellation`.
- **`getAvailability(workerId)`**: Projections containing `{ workerId, status, observedAt, isAvailable, canAcceptTask, impliesCompletion: false }`.
- **`updateAvailability(workerId, params)`**: Updates status and observation timestamp; strictly rejects completion implication statuses (e.g. `'completed'`).
- **Deep Immutability**: All storage and returned objects are deep-cloned and frozen via `Object.freeze` across all nested structures.

---

## 3. Verification & Evidence

### Test Execution Command
```bash
node --test test/ifz-contracts.test.js test/ifz-worker-registry.test.js
```

### Test Output Summary
```
▶ IFZ Unified Architecture Contracts
  ▶ 1. Worker Manifest
    ✔ creates and validates a well-formed WorkerManifest (1.783ms)
    ✔ rejects empty or whitespace-only identities (0.7112ms)
    ✔ rejects malformed booleans (no truthy coercion) (0.2375ms)
    ✔ validates distinct effect classes and rejects unknown effects (0.2105ms)
    ✔ rejects duplicate effect classes in capabilities (0.1846ms)
    ✔ supports all 7 approved effect classes (0.2249ms)
  ✔ 1. Worker Manifest (4.4773ms)
  ▶ 2. Context Reference
    ✔ creates and validates a ContextReference with SHA-256 digest (0.4845ms)
    ✔ rejects invalid context kinds and malformed digests (0.5473ms)
  ✔ 2. Context Reference (1.4888ms)
  ▶ 3. Route Request
    ✔ creates and validates an Any-to-Any RouteRequest (0.8256ms)
    ✔ rejects empty destinations or unsupported strategies (0.5003ms)
  ✔ 3. Route Request (1.6326ms)
  ▶ 4. Task Envelope
    ✔ creates and validates a TaskEnvelope with explicit scopes (0.3702ms)
    ✔ rejects empty objective or missing identities in envelope (0.2529ms)
  ✔ 4. Task Envelope (0.818ms)
  ▶ 5. Public Event
    ✔ creates and validates a safe PublicEvent (0.5579ms)
    ✔ rejects sensitive reasoning or credential fields in public event details (0.3446ms)
  ✔ 5. Public Event (1.1062ms)
  ▶ 6. Delivery Receipt & Secret Prevention
    ✔ creates and validates a DeliveryReceipt with cryptographic digest verification (1.86ms)
    ✔ detects digest tampering when verifyDigest=true (0.8127ms)
    ✔ strictly forbids prompt text, source code, secrets, and raw reasoning in receipts (1.3954ms)
    ✔ rejects verified=true without verifier checks record (0.2294ms)
  ✔ 6. Delivery Receipt & Secret Prevention (4.849ms)
  ▶ 7. Authority Growth Prevention
    ✔ permits child request within parent authority scope (0.304ms)
    ✔ rejects authority growth when child requests ungranted effect (0.199ms)
    ✔ rejects authority growth when child requests undeclared write path (0.2214ms)
    ✔ rejects authority growth when delegation depth exceeds limit (0.1523ms)
  ✔ 7. Authority Growth Prevention (1.084ms)
✔ IFZ Unified Architecture Contracts (16.5246ms)

▶ WorkerRegistry
  ▶ 1. Registration
    ✔ registers a valid worker manifest and returns deeply frozen copy (2.3998ms)
    ✔ rejects duplicate workerId registration with IfzConflictError (1.899ms)
    ✔ rejects invalid worker manifest with IfzValidationError (0.5627ms)
  ✔ 1. Registration (6.3898ms)
  ▶ 2. Concurrency Control (replace by exact revision)
    ✔ replaces worker manifest when exactPreviousRevision matches (1.9739ms)
    ✔ rejects replacement when revision does not match exactPreviousRevision (0.6316ms)
    ✔ rejects replacement when new revision is not strictly greater than previous revision (0.6156ms)
    ✔ rejects replacement for unregistered worker (0.4681ms)
    ✔ rejects invalid exactPreviousRevision parameter (0.5382ms)
  ✔ 2. Concurrency Control (replace by exact revision) (4.898ms)
  ▶ 3. Read and Lookup Operations
    ✔ get returns deep-frozen copy or null if absent (0.494ms)
    ✔ has checks registration presence correctly (0.4155ms)
    ✔ count returns exact number of registered workers (0.4394ms)
    ✔ unregister removes registered worker and adjusts count (0.4585ms)
  ✔ 3. Read and Lookup Operations (2.2841ms)
  ▶ 4. List and Filtering
    ✔ lists all workers when no filter is provided (1.21ms)
    ✔ filters by workerType (0.6095ms)
    ✔ filters by adapterId (0.5168ms)
    ✔ filters by projectId and workspaceId (0.6232ms)
    ✔ filters by availabilityStatus (2.4334ms)
    ✔ filters by hasEffect (0.8501ms)
    ✔ combines multiple filter criteria (0.7174ms)
  ✔ 4. List and Filtering (7.6521ms)
  ▶ 5. Capability Querying
    ✔ queries by subset of effects (1.0877ms)
    ✔ queries by actions (0.9359ms)
    ✔ queries by contextTypes (0.5666ms)
    ✔ queries by canDelegate flag (0.8036ms)
    ✔ queries by supportsCancellation flag (0.897ms)
    ✔ queries with compound requirements and rejects non-matching workers (0.7504ms)
  ✔ 5. Capability Querying (5.6807ms)
  ▶ 6. Honest Availability Projections
    ✔ projects availability with observation timestamp and explicit impliesCompletion: false (0.829ms)
    ✔ idle status is projected as available to accept tasks (0.4329ms)
    ✔ busy status is projected as cannot accept tasks (0.4772ms)
    ✔ updates worker availability with timestamp (0.6867ms)
    ✔ defaults observedAt to current timestamp if omitted (0.7462ms)
    ✔ rejects status that implies task completion (0.6857ms)
    ✔ rejects getAvailability or updateAvailability on unregistered worker (0.7393ms)
    ✔ rejects invalid observedAt timestamp (1.9776ms)
  ✔ 6. Honest Availability Projections (7.2477ms)
  ▶ 7. Immutability and State Protection
    ✔ mutating input manifest after registration does not alter registry state (0.4529ms)
    ✔ returned manifests and queries are frozen and cannot be mutated (0.6005ms)
    ✔ returned availability projection is frozen and cannot be mutated (0.3318ms)
  ✔ 7. Immutability and State Protection (1.6175ms)
✔ WorkerRegistry (37.296ms)

ℹ tests 58
ℹ suites 16
ℹ pass 58
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 175.8739
```

---

## 4. Honesty Declaration & Sign-off

- **Exact Pass Rate**: 58 passed, 0 failed, 0 skipped across 16 suites.
- **Scope Compliance**: Confirmed zero modifications outside the 5 owned files.
- **Git Commit**: No git commit or push was performed.
- **Ready for Review**: The isolated IFZ contracts and worker registry are fully validated, strictly typed, frozen against runtime mutation, and ready for integration by downstream router and orchestration modules.


---

## 5. Rework & Hardening Addendum (2026-10-19)

### 1. Corrective Actions Completed
- **Canonical Route Strategies**:
  - Canonical identifiers strictly enforced: `parallel`, `sequential`, `review-chain`, `first-verified`, `compare`, `bounded-delegation`.
  - Removed all underscore aliases (`review_chain`, `first_verified`, `compare_results`, `bounded_delegation`) from the public contract; all non-canonical variants are rejected with `IfzValidationError`.
- **Adversarial Defenses & Input Bounding**:
  - Rejects non-plain objects, custom prototypes, and instances of unapproved classes.
  - Rejects property accessors (getters and setters) to prevent side-effects during validation.
  - Rejects prototype pollution attempts (`__proto__`, `constructor`, `prototype` keys).
  - Rejects control characters (`[\x00-\x1F\x7F-\x9F]`) in identities and strings.
  - Rejects `NaN` and `Infinity` across all numerical fields.
  - Rejects duplicate entries in capabilities (`effects`, `actions`, `contextTypes`), qualifications (`roles`, `certifications`, `tags`), scopes (`readPaths`, `writePaths`, `createPaths`), and route destinations.
  - Rejects malformed nested arrays where string collections are required.
  - Deterministic cycle detection using active call-stack tracing to fail closed on cyclic structures before deep operations.
  - Hard bounds enforced: payload depth <= 16, array lengths <= 512, object keys <= 128, string UTF-8 bytes <= 64 KB, total payload <= 1 MB.
- **Worker Manifest & Hardened Registry Queries**:
  - Worker manifests require exact identity, revision, observation, capabilities, limits, delegation, and qualification.
  - `WorkerRegistry.list()` and `WorkerRegistry.queryCapabilities()` / `WorkerRegistry.query()` enforce `projectId`, `workspaceId`, `qualification` (by string, array, or object), `availabilityStatus`, and `observationFreshnessMs` / `maxAgeMs` (filtering out stale workers).
  - Synchronized observation and availability projections without allowing completion implication.
- **Task Envelope Budgets & Preservation**:
  - Preserves exact IDs (`taskId`, `runId`, `conversationId`, `parentTaskId`, `sourceWorkerId`, `destinationWorkerId`, `cancellationId`).
  - Preserves Master Prompt version (`masterPromptVersion`) and context version (`contextVersion`).
  - Preserves `projectId`, `workspaceId`, and `scopes` (`effects`, `readPaths`, `writePaths`, `createPaths`).
  - Preserves explicit `budgets`: `timeBudgetMs`, `tokenBudget`, `providerBudget`, `workerBudget`, `depthBudget`, `branchBudget`.
  - Authority growth prevention (`assertNoAuthorityGrowth`) strictly rejects child delegations requesting higher budgets (time, tokens, branches, depth) or ungranted effects/paths.

### 2. Changed Files
- [`packages/orchestration-core/src/ifz/contracts.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/contracts.js)
- [`packages/orchestration-core/src/ifz/worker-registry.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/worker-registry.js)
- [`packages/orchestration-core/test/ifz-contracts.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/ifz-contracts.test.js)
- [`packages/orchestration-core/test/ifz-worker-registry.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/ifz-worker-registry.test.js)
- [`docs/execution/AGR-1-ifz-contracts.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-1-ifz-contracts.md)

### 3. Verification & Focused Test Results
```
Command: node --test test/ifz-contracts.test.js test/ifz-worker-registry.test.js

▶ IFZ Unified Architecture Contracts
  ▶ 1. Worker Manifest
    ✔ creates and validates a well-formed WorkerManifest (1.9175ms)
    ✔ rejects empty or whitespace-only identities (1.1431ms)
    ✔ rejects malformed booleans (no truthy coercion) (0.4356ms)
    ✔ validates distinct effect classes and rejects unknown effects (0.2738ms)
    ✔ rejects duplicate effect classes in capabilities (0.2613ms)
    ✔ supports all 7 approved effect classes (0.3448ms)
  ✔ 1. Worker Manifest (5.4947ms)
  ▶ 2. Context Reference
    ✔ creates and validates a ContextReference with SHA-256 digest (0.4936ms)
    ✔ rejects invalid context kinds and malformed digests (0.3478ms)
  ✔ 2. Context Reference (1.0814ms)
  ▶ 3. Route Request & Canonical Strategies
    ✔ creates and validates an Any-to-Any RouteRequest with canonical review-chain strategy (0.4999ms)
    ✔ accepts all 6 canonical route strategies exactly (0.4412ms)
    ✔ strictly rejects underscore aliases from the public contract (0.2929ms)
    ✔ rejects empty destinations or unsupported strategies (0.2401ms)
  ✔ 3. Route Request & Canonical Strategies (1.6996ms)
  ▶ 4. Task Envelope & Budgets
    ✔ creates and validates a TaskEnvelope preserving IDs, versions, scopes, and budgets (0.3126ms)
    ✔ rejects empty objective, missing cancellationId, or missing identities in envelope (0.2913ms)
  ✔ 4. Task Envelope & Budgets (0.7176ms)
  ▶ 5. Public Event
    ✔ creates and validates a safe PublicEvent (0.4317ms)
    ✔ rejects sensitive reasoning or credential fields in public event details (0.1497ms)
  ✔ 5. Public Event (0.6895ms)
  ▶ 6. Delivery Receipt & Secret Prevention
    ✔ creates and validates a DeliveryReceipt with cryptographic digest verification (1.1949ms)
    ✔ detects digest tampering when verifyDigest=true (0.2931ms)
    ✔ strictly forbids prompt text, source code, secrets, and raw reasoning in receipts (2.0301ms)
    ✔ rejects verified=true without verifier checks record (0.2885ms)
  ✔ 6. Delivery Receipt & Secret Prevention (4.0165ms)
  ▶ 7. Authority Growth Prevention & Budgets
    ✔ permits child request within parent authority scope (0.4105ms)
    ✔ rejects authority growth when child requests ungranted effect (0.2244ms)
    ✔ rejects authority growth when child requests undeclared write path (0.2338ms)
    ✔ rejects authority growth when delegation depth exceeds limit (0.1822ms)
    ✔ rejects authority growth when child budget exceeds parent limits (0.4008ms)
  ✔ 7. Authority Growth Prevention & Budgets (1.6464ms)
  ▶ 8. Focused Adversarial Tests & Input Bounding
    ✔ rejects non-plain objects and custom prototypes (0.3317ms)
    ✔ rejects property accessors (getters/setters) (0.1673ms)
    ✔ rejects prototype pollution attempts (0.1437ms)
    ✔ rejects control characters in identities (0.1719ms)
    ✔ rejects NaN and Infinity (0.2803ms)
    ✔ rejects duplicate entries in capability actions and context types (0.3504ms)
    ✔ rejects malformed nested arrays in place of string arrays (0.2364ms)
    ✔ fails deterministically on cyclic structures without crashing stack (0.3667ms)
    ✔ bounds payload depth and rejects deep nesting (0.2943ms)
    ✔ bounds array lengths and string UTF-8 byte sizes (0.2506ms)
  ✔ 8. Focused Adversarial Tests & Input Bounding (2.938ms)
✔ IFZ Unified Architecture Contracts (19.2499ms)

▶ WorkerRegistry
  ▶ 1. Registration
    ✔ registers a valid worker manifest and returns deeply frozen copy (2.5304ms)
    ✔ rejects duplicate workerId registration with IfzConflictError (1.2133ms)
    ✔ rejects invalid worker manifest with IfzValidationError (0.4684ms)
  ✔ 1. Registration (5.2534ms)
  ▶ 2. Concurrency Control (replace by exact revision)
    ✔ replaces worker manifest when exactPreviousRevision matches (2.1819ms)
    ✔ rejects replacement when revision does not match exactPreviousRevision (0.9038ms)
    ✔ rejects replacement when new revision is not strictly greater than previous revision (0.8881ms)
    ✔ rejects replacement for unregistered worker (0.4433ms)
    ✔ rejects invalid exactPreviousRevision parameter (0.5547ms)
  ✔ 2. Concurrency Control (replace by exact revision) (5.4886ms)
  ▶ 3. Read and Lookup Operations
    ✔ get returns deep-frozen copy or null if absent (1.0932ms)
    ✔ has checks registration presence correctly (0.4515ms)
    ✔ count returns exact number of registered workers (0.5513ms)
    ✔ unregister removes registered worker and adjusts count (0.6022ms)
  ✔ 3. Read and Lookup Operations (2.9448ms)
  ▶ 4. List and Filtering
    ✔ lists all workers when no filter is provided (1.3675ms)
    ✔ filters by workerType and adapterId (2.0277ms)
    ✔ filters by projectId and workspaceId (1.3426ms)
    ✔ filters by availabilityStatus (0.908ms)
    ✔ filters by hasEffect (1.2387ms)
    ✔ filters by qualification (string, array, and object) (1.9377ms)
    ✔ filters by observation freshness (1.2517ms)
  ✔ 4. List and Filtering (10.4862ms)
  ▶ 5. Capability Querying with Project, Workspace, and Freshness
    ✔ queries by subset of effects, projectId, and workspaceId (0.9982ms)
    ✔ queries by actions, contextTypes, and delegation (1.1325ms)
    ✔ enforces qualification and freshness in queryCapabilities (1.1077ms)
  ✔ 5. Capability Querying with Project, Workspace, and Freshness (3.3849ms)
  ▶ 6. Honest Availability Projections
    ✔ projects availability with observation timestamp and explicit impliesCompletion: false (0.9545ms)
    ✔ updates worker availability with timestamp and synchronizes observation (0.9612ms)
    ✔ rejects status that implies task completion (0.8539ms)
  ✔ 6. Honest Availability Projections (2.9391ms)
  ▶ 7. Adversarial Registrations & Immutability
    ✔ rejects registration of non-plain objects, accessors, or cycles (0.4965ms)
    ✔ mutating input manifest after registration does not alter registry state (0.4882ms)
    ✔ returned manifests and availability projections are frozen (0.4451ms)
  ✔ 7. Adversarial Registrations & Immutability (1.5728ms)
✔ WorkerRegistry (32.915ms)

ℹ tests 63
ℹ suites 17
ℹ pass 63
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147.7861
```

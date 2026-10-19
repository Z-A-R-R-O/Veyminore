# Receipt: IFZ Cross-Slice Integration Tests

- **Task**: IFZ cross-slice integration tests
- **Worker**: AGR-1
- **Coordinator**: Codex
- **Workspace**: `E:/Veyminore/products/zetro`
- **Created Files**:
  - [`packages/orchestration-core/test/ifz-integration.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/ifz-integration.test.js)
  - [`docs/execution/AGR-1-ifz-integration-tests.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-1-ifz-integration-tests.md)
- **Status**: `ready_for_review`

---

## 1. Architectural Summary & Scope Boundaries

Per the coordinator's directives, this integration test suite exercises all 7 core IFZ modules in unison without modifying any source files or shared UI/build/server files:
1. [`contracts.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/contracts.js) (authoritative schemas, validation, cryptographic digest verification, authority growth checks)
2. [`worker-registry.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/worker-registry.js) (worker registry, concurrency control, qualification/freshness querying, honest availability projections)
3. [`route-planner.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/route-planner.js) (manual, automatic proposal, and saved-workflow planning with public allowlist previews)
4. [`route-guard.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/route-guard.js) (cycle detection, authority monotonicity, ceiling enforcement, capability and workspace validation)
5. [`master-prompt.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/master-prompt.js) (four-layer prompt composition: Charter, Worker Knowledge, Project Context, Task Package)
6. [`presets.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/presets.js) (7 canonical presets enforcing strict non-widening of authority)
7. [`context-package.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/ifz/context-package.js) (fresh-worker 8-step boot package, version pinning, admission-only acknowledgment)

### Execution Invariants
- **Zero Source Edits**: Strictly zero modifications made to `packages/orchestration-core/src/`, `apps/`, `build.mjs`, or package manifests.
- **Offline & Deterministic**: Uses deterministic timestamps (`1713000000000`), fixed IDs, and strictly zero network requests, subprocess spawning, or native OS effects.
- **Scope Compliance**: Ran only the new integration test file alongside the six focused IFZ unit test files.

---

## 2. Integrated Scenarios Tested

### 1. Manual AGR-2 to OCR-1 Cross-Slice Pipeline
- Planned manual sequential route from AGR-2 (planner) to OCR-1 (runner).
- Verified public route preview conforms to the strict allowlist (no leaked prompt or secrets).
- Created authoritative `TaskEnvelope` for Step 1 with explicit `cancellationId`, `scopes`, and `budgets`.
- Assembled composite `MasterPrompt` and generated fresh-worker context package.
- Simulated child delegation request from AGR-2 to OCR-1; verified `assertNoAuthorityGrowth` passes.
- Verified secret-free `DeliveryReceipt` with SHA-256 cryptographic digest verification.

### 2. Bounded Parallel RCT to AGR-1..AGR-5
- Planned manual parallel route distributing work across 5 workers (`AGR-1`, `AGR-2`, `AGR-3`, `AGR-4`, `AGR-5`).
- Verified all steps execute concurrently with empty dependencies (`dependsOn: []`).
- Bound parallel execution under active branch and worker ceilings (`maxWorkers: 6`, `maxActiveBranches: 5`).
- Verified authority monotonicity: root task envelope from RCT bounds all 5 child envelopes.
- Verified negative ceiling overflow: exceeding `maxActiveBranches` fails closed with `RouteValidationError`.

### 3. Sequential / Review Pipeline: AGR-5 -> AGR-1 -> OCR-2 -> RCT
- Modeled complete implementation-to-audit flow across 4 stages: UI implementation (`AGR-5`) -> Core review (`AGR-1`) -> CLI audit (`OCR-2`) -> Computer runtime acceptance (`RCT`).
- Enforced strict cascading DAG dependencies (`step_1` -> `step_2` -> `step_3` -> `step_4`).
- Verified delivery receipts at each stage with verifier records and cryptographic digests.

### 4. Automatic Proposal Only, No Dispatch
- Requested automatic route for write tasks; verified planner selects canonical `review-chain` strategy.
- Verified invariant: Automatic mode returns `isProposal: true` and `status: 'proposed'`.
- Verified that proposed plans cannot claim dispatch, execution, or completion.

### 5. Saved Workflow Revalidation at Use Time
- Instantiated route from template `standard-review-chain`.
- Revalidated plan at execution time using `revalidateSavedWorkflow`.
- Verified dynamic failure closed: making a worker unavailable or allowing its observation timestamp to go stale causes revalidation to throw `WorkerUnavailableError` or `CapabilityMismatchError`.

### 6. Fresh-Worker Package Exact Order, Versioning, and Admission-Only Acknowledgment
- Constructed fresh-worker boot package; verified exact 8-step sequence in documented order:
  1. `charter`
  2. `workerContract`
  3. `projectContext`
  4. `preset`
  5. `taskPackage`
  6. `toolsAndScope`
  7. `requiredEvidence`
  8. `delegationProtocol`
- Verified version pinning across all 4 layers (`charterVersion`, `workerKnowledgeVersion`, `projectContextVersion`, `taskPackageVersion`), preset version, and composite version.
- Created and verified worker acknowledgment with `verifyWorkerAcknowledgment`.
- Verified admission-only invariant: attempts to claim dispatch (`isDispatch: true`), completion (`isCompletion: true`), or verification (`isVerification: true`) are strictly rejected.

### 7. Negative Failure Modes (All Cross-Slice Constraints)
- **Stale Workers**: Observations exceeding `maxStalenessMs` are rejected by router and registry.
- **Unavailable / Offline Workers**: Unavailable workers fail closed with `WorkerUnavailableError`.
- **Wrong Workspace**: Workers registered in a different workspace throw `WorkspaceMismatchError`.
- **Capability Mismatch**: Requests requiring ungranted effects throw `CapabilityMismatchError`.
- **Duplicate Worker Tasks**: Duplicate worker-task pairs in step DAGs throw `DuplicateWorkerTaskError`.
- **Circular Route Graphs**: Cyclic step dependencies throw `CircularRouteError`.
- **Authority & Budget Overflows**: Child delegations exceeding time budgets, token budgets, depth, branch limits, or ungranted effects/paths throw `IfzAuthorityGrowthError`.
- **Forbidden Context Material**: Raw secrets, `<thinking>` tags, and uncontrolled full transcripts throw `MasterPromptError` and `ContextPackageSecurityError`.

---

## 3. Verification & Focused Test Results

```bash
node --test \
  test/ifz-contracts.test.js \
  test/ifz-worker-registry.test.js \
  test/ifz-route-planner.test.js \
  test/ifz-route-guard.test.js \
  test/ifz-master-prompt.test.js \
  test/ifz-context-package.test.js \
  test/ifz-integration.test.js
```

### Complete Test Output Summary
```
▶ IFZ Unified Architecture Contracts
  ✔ 1. Worker Manifest (6.4974ms)
  ✔ 2. Context Reference (1.4009ms)
  ✔ 3. Route Request & Canonical Strategies (2.2462ms)
  ✔ 4. Task Envelope & Budgets (1.0764ms)
  ✔ 5. Public Event (0.7694ms)
  ✔ 6. Delivery Receipt & Secret Prevention (4.377ms)
  ✔ 7. Authority Growth Prevention & Budgets (1.8985ms)
  ✔ 8. Focused Adversarial Tests & Input Bounding (6.0341ms)
✔ IFZ Unified Architecture Contracts (63.5289ms)

▶ IFZ Cross-Slice Integration Tests
  ▶ 1. Manual AGR-2 to OCR-1 Cross-Slice Pipeline
    ✔ plans route, constructs Master Prompt & context package, validates envelopes and receipts (41.173ms)
  ✔ 1. Manual AGR-2 to OCR-1 Cross-Slice Pipeline (43.4534ms)
  ▶ 2. Bounded Parallel RCT to AGR-1..AGR-5
    ✔ coordinates bounded parallel delegation under active branch and worker ceilings (10.8954ms)
    ✔ rejects parallel execution exceeding maxActiveBranches ceiling (4.5039ms)
  ✔ 2. Bounded Parallel RCT to AGR-1..AGR-5 (15.8875ms)
  ▶ 3. Sequential/Review Pipeline: AGR-5 -> AGR-1 -> OCR-2 -> RCT
    ✔ enforces cascading step dependencies and cryptographic receipt verification across 4 stages (5.405ms)
  ✔ 3. Sequential/Review Pipeline: AGR-5 -> AGR-1 -> OCR-2 -> RCT (5.6357ms)
  ▶ 4. Automatic Proposal Only, No Dispatch
    ✔ produces proposed route plans with isProposal=true and status=proposed (4.8867ms)
  ✔ 4. Automatic Proposal Only, No Dispatch (5.1199ms)
  ▶ 5. Saved Workflow Revalidation at Use Time
    ✔ successfully revalidates valid template and fails closed if worker becomes unavailable or stale (10.4109ms)
  ✔ 5. Saved Workflow Revalidation at Use Time (10.6881ms)
  ▶ 6. Fresh-Worker Package Exact Order, Versioning, and Admission-Only Acknowledgment
    ✔ preserves exact 8-step boot sequence and verifies admission evidence invariants (4.7444ms)
  ✔ 6. Fresh-Worker Package Exact Order, Versioning, and Admission-Only Acknowledgment (4.9558ms)
  ▶ 7. Negative Failure Modes (All Cross-Slice Constraints)
    ✔ rejects stale workers in routing and filtering (2.9959ms)
    ✔ rejects unavailable or offline workers (3.0212ms)
    ✔ rejects workers bound to a different workspace (4.1027ms)
    ✔ rejects capability mismatches when required effects are absent (5.3553ms)
    ✔ rejects duplicate worker assignments in same step DAG where prohibited (4.0533ms)
    ✔ rejects circular route dependency graphs (3.3503ms)
    ✔ rejects authority and budget growth across all dimensions in child delegation (2.7292ms)
    ✔ rejects forbidden secret credentials, thinking tags, and transcripts in context (1.698ms)
  ✔ 7. Negative Failure Modes (All Cross-Slice Constraints) (28.0915ms)
✔ IFZ Cross-Slice Integration Tests (120.1822ms)

✔ createCharter - creates default versioned charter (3.7918ms)
✔ createCharter - supports custom version and principles, rejects invalid (1.2174ms)
✔ createWorkerKnowledge - derives from manifest with capabilities and protocols (0.7156ms)
✔ createProjectContext - captures bounded context and rejects missing workspace (0.8384ms)
✔ createTaskPackage - validates required fields and captures route position (1.6484ms)
✔ createMasterPrompt - unites the 4 versioned layers and renders markdown (2.0794ms)
✔ presets - provides all 7 required presets (0.434ms)
✔ presets - getPreset resolves by ID and name case-insensitively (0.5886ms)
✔ presets - applyPreset narrows work and cannot weaken authority (1.7733ms)
✔ IFZ Route Guard - Canonical Strategies & Normalization (3.2221ms)
✔ IFZ Route Guard - Reject Malformed, Non-Plain, Cyclic, and Deep Inputs (4.0754ms)
✔ IFZ Route Guard - Worker Freshness and Qualification Checks (0.9817ms)
✔ IFZ Route Guard - Strict Authority Monotonicity Across All Limits (1.4622ms)
✔ IFZ Route Guard - Full Ancestry Cycle Detection and Missing Dependencies (1.1984ms)
✔ IFZ Route Guard - Duplicates, Wrong Workspace, and Cap Mismatches (1.6577ms)
✔ Adversarial Scenario 1: AGR2 to OCR1 manual route (6.7192ms)
✔ Adversarial Scenario 2: RCT to AGR1-5 bounded parallel execution and branch overflow (4.8255ms)
✔ Adversarial Scenario 3: AGR5 -> AGR1 -> OCR2 -> RCT sequential/review pipeline (1.1167ms)
✔ Adversarial Scenario 4: Automatic mode returns proposal only and cannot dispatch (1.2142ms)
✔ Adversarial Scenario 5: Saved-workflow revalidation at use time (2.1314ms)
✔ Adversarial Scenario 6: Cycles in ancestry delegation and step DAG (1.0344ms)
✔ Adversarial Scenario 7: Stale worker rejection in manual and automatic modes (1.4677ms)
✔ Adversarial Scenario 8: Wrong workspace rejection (0.6797ms)
✔ Adversarial Scenario 9: Capability mismatch rejection (0.6753ms)
✔ Adversarial Scenario 10: Duplicates rejection (1.3267ms)
✔ Adversarial Scenario 11: All Limit Overflows in Child Delegation (4.0089ms)
✔ IFZ Route Planner - Public Route Preview Strict Explicit Allowlist (1.8585ms)

▶ WorkerRegistry
  ✔ 1. Registration (9.2298ms)
  ✔ 2. Concurrency Control (replace by exact revision) (9.9306ms)
  ✔ 3. Read and Lookup Operations (5.8459ms)
  ✔ 4. List and Filtering (12.6734ms)
  ✔ 5. Capability Querying with Project, Workspace, and Freshness (4.9665ms)
  ✔ 6. Honest Availability Projections (6.5203ms)
  ✔ 7. Adversarial Registrations & Immutability (3.1771ms)
✔ WorkerRegistry (54.1558ms)

ℹ tests 121
ℹ suites 25
ℹ pass 121
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 324.2287
```

---

## 4. Honesty Declaration & Sign-off

- **Exact Test Pass Rate**: 121 passed, 0 failed across 25 suites (including 15 new end-to-end integration tests).
- **Scope Compliance**: Confirmed zero modifications outside the assigned integration test file and receipt.
- **Git State**: No git commits or pushes performed.
- **Readiness**: All IFZ contracts, registry, routing, guarding, prompt composition, and context package systems are verified to interact safely, monotonically, and deterministically.

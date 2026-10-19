# Worker Receipt: AGR-2 (IFZ Route Planner and Guard)

- **Task ID**: `AGR-2 task: IFZ route planner and guard`
- **Worker**: AGR-2
- **Coordinator**: Codex
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Paths**:
  - `packages/orchestration-core/src/ifz/route-planner.js` (NEW)
  - `packages/orchestration-core/src/ifz/route-guard.js` (NEW)
  - `packages/orchestration-core/test/ifz-route-planner.test.js` (NEW)
  - `packages/orchestration-core/test/ifz-route-guard.test.js` (NEW)
  - `docs/execution/AGR-2-ifz-router.md` (NEW)
- **Status**: `ready_for_review`
- **Live Provider / Network Calls**: 0 (pure domain logic and offline unit tests)
- **Environment Isolation**: 0 `.env` reads.

---

## 1. Summary of Deliverables

AGR-2 implemented the isolated IFZ route-planning and guarding domain slice for the ZETRO unified application architecture (`docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`).

### A. IFZ Route Guard (`packages/orchestration-core/src/ifz/route-guard.js`)

Provides foundational validation, policy enforcement, and cycle detection:

1. **Routing Modes & Execution Strategies**:
   - Modes: `manual`, `automatic`, `saved-workflow`.
   - Strategies: `parallel`, `sequential`, `review-chain`, `first-verified`, `compare`, `bounded-delegation`.
   - Effect classes: `read`, `write`, `create`, `execute`, `external_send`, `inference`, `computer`.

2. **Default Limits**:
   - `maxWorkers`: 10
   - `maxActiveBranches`: 5
   - `maxDelegationDepth`: 3
   - `timeBudgetMs`: 600,000 (10 minutes)
   - `tokenBudget`: 100,000
   - `maxProviderAttempts`: 5

3. **Domain Error Taxonomy**:
   - `RouteValidationError`: Base error for general structural and schema violations.
   - `CapabilityMismatchError`: Missing required effect or action capabilities.
   - `AuthorityExpansionError`: Child route attempting to expand effect classes, allowed paths, write paths, or context types.
   - `BudgetExceededError`: Child route requesting time, tokens, or provider attempts exceeding parent limits.
   - `CircularRouteError`: Cyclic step dependencies in the execution graph or ancestor re-delegation.
   - `DuplicateWorkerTaskError`: Repeated `(workerId, taskId)` assignment pairs.
   - `WorkspaceMismatchError`: Worker or child route workspace/project diverging from route binding.
   - `WorkerUnavailableError`: Worker marked `unavailable` or `offline` selected in manual routing.

4. **Policy Enforcement Checks**:
   - `validateWorkerManifest`: Validates worker identity regex, non-empty types, valid availability status (`available`, `idle`, `running`, `busy`, `unavailable`, `offline`), and deep-freezes.
   - `hasCapability` & `checkCapabilityCompatibility`: Validates that workers satisfy all required capabilities across both object boolean flags and array declarations (`effects`, `actions`, `contextTypes`).
   - `checkAuthorityNarrowing`: Enforces that child routes cannot add effect classes or expand file access outside parent `allowedPaths` and `writePaths`.
   - `checkContextNarrowing`: Prevents child routes from requesting context types outside parent envelope.
   - `checkBudgetLimits`: Rejects child budgets exceeding parent remaining allocations.
   - `detectCircularRoute`: Evaluates both delegation chain history (preventing re-delegation to ancestors) and step dependency DAGs (3-color DFS detecting direct cycles, self-dependencies, indirect loops, and missing step references).
   - `validateRoutePlan`: Authoritative validator enforcing worker count ceilings, active concurrent branch counts, max delegation depth, unique worker-task pairs, workspace/project binding, manual availability, and child delegation constraints. Returns deeply frozen route plans.

---

### B. Pure Offline Route Planner (`packages/orchestration-core/src/ifz/route-planner.js`)

Provides deterministic, side-effect-free route plan construction:

1. **Routing Modes Supported**:
   - **`manual`**: User/caller specifies exact destination worker IDs or explicit step objects. Constructs dependency graphs corresponding to the chosen strategy, validating worker existence, capability qualification, workspace binding, and availability.
   - **`automatic`**: Pure offline route proposal from supplied manifests (or `WorkerRegistry`). Queries workers by workspace, project, and required capabilities; prioritizes available and idle workers over busy ones; rejects offline workers. Automatically configures step graphs according to strategy (e.g. `review-chain` with distinct implementer and reviewer workers, `compare` with parallel candidates and an arbiter step).
   - **`saved-workflow`**: Instantiates predefined or custom workflow templates, resolving role capabilities to compatible workers and wiring dependency step IDs.

2. **Saved Workflow Template Catalog (`SAVED_WORKFLOW_TEMPLATES`)**:
   - `standard-review-chain`: Strategy `review-chain`, 2 stages (implementer `write` -> reviewer `read`).
   - `parallel-exploration`: Strategy `parallel`, concurrent steps without interdependencies.
   - `dual-compare`: Strategy `compare`, 2 parallel candidate steps + 1 comparator step.
   - `first-verified`: Strategy `first-verified`, competing parallel candidates.
   - `sequential-pipeline`: Strategy `sequential`, ordered multi-stage linear pipeline.
   - `bounded-delegation`: Strategy `bounded-delegation`, lead worker with bounded delegation limits.

3. **Child Route Planning (Delegation)**:
   - Derives child `runId`, `conversationId`, workspace, and project from `parentEnvelope`.
   - Increments child depth (`parentEnvelope.depth + 1`), enforcing that it does not exceed `maxDelegationDepth`.
   - Clamps child authority and budget to parent allocations.

4. **Plan Integrity Hashing (`computeRouteHash`)**:
   - Generates deterministic SHA-256 digest over the canonical, sorted plan representation (routeId, runId, conversationId, projectId, workspaceId, mode, strategy, steps, limits, authority, budget).

5. **Public Route Preview (`createRoutePreview`)**:
   - Creates a public sanitized preview for the Work and Runs pages.
   - **Guaranteed Zero-Leakage Sanitization**:
     - Strips all prompt text (`prompt`, `taskPrompt`, `userPrompt`, `objective`).
     - Strips private reasoning (`rawReasoning`, `privateReasoning`, `modelThinking`).
     - Strips all secrets and credentials (`secrets`, `secret`, `token`, `password`, `apiKey`).
     - Strips file contents and code diffs (`fileContents`, `buffers`, `code`, `diff`).
   - Surfaces safe structural metadata: `routeId`, `runId`, `conversationId`, `projectId`, `workspaceId`, `mode`, `strategy`, `createdAt`, `routeHash`, `stepCount`, `limits`, `authority` (effect classes and path counts), `budget`, sanitized `steps`, and `summary` (totalWorkers, uniqueWorkers, activeBranches, maxDepth).
   - Returns deeply frozen object.

---

## 2. Test Verification Results

### Focused Test Run
Command:
```powershell
node --test test/ifz-route-guard.test.js test/ifz-route-planner.test.js
```
Working directory: `packages/orchestration-core`

Output:
```text
✔ IFZ Route Guard - Constants and Types (1.4485ms)
✔ IFZ Route Guard - validateWorkerManifest (1.332ms)
✔ IFZ Route Guard - Capability Compatibility & hasCapability (0.358ms)
✔ IFZ Route Guard - checkAuthorityNarrowing & checkContextNarrowing (0.5795ms)
✔ IFZ Route Guard - checkBudgetLimits (0.3174ms)
✔ IFZ Route Guard - detectCircularRoute (0.9731ms)
✔ IFZ Route Guard - validateRoutePlan comprehensive checks (1.9348ms)
✔ IFZ Route Planner - normalizeManifests & findMatchingWorker (1.1436ms)
✔ IFZ Route Planner - Manual Route Planning (5.5719ms)
✔ IFZ Route Planner - Automatic Route Proposal (1.638ms)
✔ IFZ Route Planner - Saved Workflow Route Planning (1.9325ms)
✔ IFZ Route Planner - Child Route Delegation Constraints (0.7149ms)
✔ IFZ Route Planner - Public Route Preview Sanitization (0.5742ms)
✔ IFZ Route Planner - computeRouteHash deterministic hashing (0.255ms)
ℹ tests 14
ℹ suites 0
ℹ pass 14
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 122.8336
```

### Full Package Regression Run
Command:
```powershell
npm test
```
Working directory: `packages/orchestration-core`

Output:
```text
ℹ tests 273
ℹ suites 16
ℹ pass 273
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 13723.8247
```

---

## 3. Honesty Declaration & Exact Limitations

1. **Ownership Scope Strictly Respected**:
   - Authored only `route-planner.js`, `route-guard.js`, `ifz-route-planner.test.js`, `ifz-route-guard.test.js`, and `AGR-2-ifz-router.md`.
   - Did not edit peer files owned by AGR-1 (`contracts.js`, `worker-registry.js`), AGR-3 (`master-prompt.js`, `presets.js`), or existing task store / dispatcher modules.
2. **Pure Offline Execution**:
   - Zero adapter sends, subprocess spawns, or network calls.
   - Zero external npm dependencies added; relies solely on Node.js built-ins (`node:crypto`, `node:test`, `node:assert/strict`).
   - Automatic proposal operates strictly offline against supplied in-memory manifests or registry queries; it does not dispatch.
3. **Display Layer Requirement**:
   - Public route preview strips prompt text and secrets at the object level. Callers and presentation layers must preserve this sanitization when rendering public event feeds or external streams.

---

## 4. Hardening Rework (Directives & Verification)

Following coordinator instructions, the route planner and guard slice was hardened with the following enhancements:

### A. Canonical Execution Strategies
- Supported identifiers strictly match contracts: `parallel`, `sequential`, `review-chain`, `first-verified`, `compare`, `bounded-delegation`.
- Normalized aliases: `review_chain` -> `review-chain`, `first_verified` -> `first-verified`, `compare_results` -> `compare`, `bounded_delegation` -> `bounded-delegation`.
- Any unrecognized strategy is rejected with `RouteValidationError`.

### B. Input Safety & Monotonicity
- `validateInputSafety`: Rejects non-plain objects, cyclic reference structures (via active stack cycle tracking), and deep nesting beyond depth ceiling.
- `checkWorkerFreshness`: Rejects workers with `isStale: true` or observation timestamps older than `DEFAULT_MAX_STALENESS_MS` (300,000ms / 5 min).
- `checkWorkerQualification`: Rejects unqualified or failed qualification workers with `CapabilityMismatchError`.
- Strict authority monotonicity enforced across:
  - `allowedPaths`: child scope cannot exceed parent paths.
  - `writePaths`: child write scope cannot exceed parent write paths.
  - `context`: child allowed types cannot exceed parent types.
  - `effectClasses`: child effect classes cannot exceed parent effect classes.
  - `timeBudgetMs`: child time limit cannot exceed parent allocation.
  - `tokenBudget`: child token limit cannot exceed parent allocation.
  - `maxProviderAttempts`: child attempt limit cannot exceed parent allocation.
  - `maxWorkers`: child limit cannot exceed parent limit.
  - `maxActiveBranches`: child limit cannot exceed parent limit.
  - `maxDelegationDepth`: child limit cannot exceed parent limit.

### C. Mode Contracts & Revalidation
- **Manual Mode**: Preserves exact user destinations without substitution. Rejects stale, unqualified, offline, or mismatched workers.
- **Automatic Mode**: Generates route proposals only (`isProposal: true`, `status: 'proposed'`). Has zero dispatch hooks and cannot initiate side-effects.
- **Saved Workflows**: `revalidateSavedWorkflow` performs use-time validation against live manifests, verifying freshness, availability, and qualification before execution.

### D. Explicit Allowlist Public Preview
- `createRoutePreview` uses an **exclusive allowlist**. It never copies or spreads candidate plans/steps followed by redaction. Only explicit safe fields (`routeId`, `runId`, `conversationId`, `projectId`, `workspaceId`, `mode`, `strategy`, `isProposal`, `createdAt`, `routeHash`, `stepCount`, `limits`, `authority`, `budget`, `steps`, `summary`) are extracted.

### E. Adversarial Test Suite Verification
Command:
```powershell
node --test test/ifz-route-guard.test.js test/ifz-route-planner.test.js
```
Working directory: `packages/orchestration-core`

Output:
```text
✔ IFZ Route Guard - Canonical Strategies & Normalization (2.3791ms)
✔ IFZ Route Guard - Reject Malformed, Non-Plain, Cyclic, and Deep Inputs (2.9472ms)
✔ IFZ Route Guard - Worker Freshness and Qualification Checks (0.8327ms)
✔ IFZ Route Guard - Strict Authority Monotonicity Across All Limits (1.5491ms)
✔ IFZ Route Guard - Full Ancestry Cycle Detection and Missing Dependencies (1.1387ms)
✔ IFZ Route Guard - Duplicates, Wrong Workspace, and Cap Mismatches (1.2985ms)
✔ Adversarial Scenario 1: AGR2 to OCR1 manual route (4.9297ms)
✔ Adversarial Scenario 2: RCT to AGR1-5 bounded parallel execution and branch overflow (5.3079ms)
✔ Adversarial Scenario 3: AGR5 -> AGR1 -> OCR2 -> RCT sequential/review pipeline (1.4637ms)
✔ Adversarial Scenario 4: Automatic mode returns proposal only and cannot dispatch (1.266ms)
✔ Adversarial Scenario 5: Saved-workflow revalidation at use time (3.0255ms)
✔ Adversarial Scenario 6: Cycles in ancestry delegation and step DAG (0.9613ms)
✔ Adversarial Scenario 7: Stale worker rejection in manual and automatic modes (1.0167ms)
✔ Adversarial Scenario 8: Wrong workspace rejection (0.6238ms)
✔ Adversarial Scenario 9: Capability mismatch rejection (0.6373ms)
✔ Adversarial Scenario 10: Duplicates rejection (1.3157ms)
✔ Adversarial Scenario 11: All Limit Overflows in Child Delegation (3.1534ms)
✔ IFZ Route Planner - Public Route Preview Strict Explicit Allowlist (0.9269ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 153.1664
```


# Worker Receipt: AGR-3 (IFZ Master Prompt & Fresh-Worker Package)

- **Task ID**: `AGR3-ifz-master-prompt`
- **Worker**: AGR-3
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Paths**:
  - `packages/orchestration-core/src/ifz/master-prompt.js` (NEW)
  - `packages/orchestration-core/src/ifz/context-package.js` (NEW)
  - `packages/orchestration-core/src/ifz/presets.js` (NEW)
  - `packages/orchestration-core/test/ifz-master-prompt.test.js` (NEW)
  - `packages/orchestration-core/test/ifz-context-package.test.js` (NEW)
  - `docs/execution/AGR-3-ifz-master-prompt.md` (NEW)
- **Status**: `ready_for_review`
- **Live Provider / Network Calls**: 0 (pure domain logic and offline unit tests)
- **Environment Isolation**: 0 `.env` reads.

---

## 1. Summary of Deliverables

AGR-3 implemented the versioned Master Prompt and fresh-worker context-package domain slice for the IFZ unified app architecture (`docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` Phase 5).

### A. Master Prompt System (`packages/orchestration-core/src/ifz/master-prompt.js`)
Modeled the four distinct versioned layers:
1. **ZETRO Charter (`createCharter`)**:
   - Defines the immutable foundation: central IFZ orchestration, independent verification, privacy/secret exclusion, bounded delegation, and exact workspace binding.
   - User-controlled layer with versioning, title, principles, and markdown content.
2. **Worker Knowledge (`createWorkerKnowledge`)**:
   - Derived deterministically from worker manifests or registration data.
   - Captures worker identity, capabilities, allowed tools, IFZ message routing protocol, delegation constraints, and receipt specifications.
3. **Project Context (`createProjectContext`)**:
   - Bounded representation of project structure, milestone, accepted work, pending work, component ownership, relevant files, and checks.
   - Prohibits full uncontrolled transcripts.
4. **Task Package (`createTaskPackage`)**:
   - Captures exact user request, route position (index and total), owned paths, allowed action classes, limits (maxSteps, maxBytes), checks, and required output format.
5. **Composite Master Prompt (`createMasterPrompt`)**:
   - Unites all 4 layers with the selected preset into an immutable container with a deterministic composite version (`v#c...:w...:p...:t...`).
   - Provides a `render()` method outputting structured Markdown for worker bootstrapping.

### B. Versioned Presets (`packages/orchestration-core/src/ifz/presets.js`)
Implemented all seven required presets:
1. **ZETRO Standard**: Normal product work, balanced limits, standard test and receipt evidence.
2. **ECO Mode**: Small context, focused reads, bounded checks, reduced byte budget (24KB), max 15 steps.
3. **Build Mode**: Implementation with focused verification, clean build check, and focused test runs.
4. **Review Mode**: Read-only inspection and evidence, `readOnly: true`, strips mutating actions (`write`, `create`, `execute`).
5. **Design Mode**: Product architecture, interface specifications, UX/UI guidelines.
6. **Qualification Mode**: Strict independent testing, adversarial verification, conformance matrix.
7. **Recovery Mode**: Diagnostic inspection of interrupted or uncertain state before dispatch.

**Enforced Negative Constraint (`applyPreset`)**:
- *A preset may narrow work; it cannot weaken authority, security, destination, or usage limits.*
- Resulting action classes are the strict intersection of base authority and preset actions.
- Presets cannot enable `allowExternalSend` if base security forbids it.
- Presets cannot modify or widen the assigned destination.
- Usage limits (`maxPackageBytes`, `maxSteps`, `maxFiles`) are strictly clamped to `Math.min(base, preset)`. Presets can never raise ceilings above base limits.

### C. Fresh-Worker Context Package (`packages/orchestration-core/src/ifz/context-package.js`)
- **Documented 8-Step Boot Package Order**:
  Constructs the fresh-worker boot package in the exact order documented in `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`:
  1. `1. ZETRO Charter`
  2. `2. Worker Identity and Capability Contract`
  3. `3. Current Project Context`
  4. `4. Selected Master Prompt Preset`
  5. `5. Task Package`
  6. `6. Allowed Tools and Scope`
  7. `7. Required Evidence`
  8. `8. Delegation and Receipt Protocols`
- **Explicit Identity Bindings**:
  Every package is bound to `workerId`, `adapterId`, `project`, `workspace`, `taskId`, `runId`, `routePosition`, and `contextVersions` (including composite version).
- **Worker Acknowledgment Protocol**:
  - `createWorkerAcknowledgment`: Creates a formal acknowledgment object validating worker identity, canonical workspace, task ID, scope (owned paths, allowed actions, readOnly), and context version.
  - `verifyWorkerAcknowledgment`: Strictly verifies that worker acknowledgment matches the issued package before dispatch is finalized.
- **Privacy & Sanitization Engine**:
  - Automatically redacts Bearer tokens, GitHub personal access tokens (`ghp_`), OpenAI/Anthropic API keys (`sk-`), AWS keys (`AKIA...`), and private key blocks.
  - Redacts `.env` file secret definitions (`SECRET_KEY=...`, `PASSWORD=...`, `TOKEN=...`).
  - Strips private reasoning tags (`<thinking>...</thinking>`) and internal object keys (`thinking`, `internalReasoning`, `scratchpad`).
  - Redacts sensitive object keys (`password`, `apiKey`, `token`, `credentials`).
- **Strict Byte & Entry Bounds**:
  - Enforces entry bounds on owned paths (max 50), relevant files (max 50), work items (max 50), checks (max 20), and tools (max 30).
  - Enforces byte size checks before output (`ContextPackageBoundsError` if byte budget is exceeded).
  - Defaults to 64KB ceiling, clamped to 24KB in ECO Mode, with hard 128KB maximum ceiling.

---

## 2. Test Verification Results

### Focused Test Run
Executed command:
`node --test packages/orchestration-core/test/ifz-master-prompt.test.js packages/orchestration-core/test/ifz-context-package.test.js`

```text
✔ buildFreshWorkerPackage - generates 8-step boot package in documented order (3.3399ms)
✔ buildFreshWorkerPackage - binds package to worker, adapter, project, workspace, task, route, and versions (0.8255ms)
✔ sanitization - strips tokens, secrets, .env content, and private reasoning (0.2177ms)
✔ buildFreshWorkerPackage - sanitizes incoming task content and sections (0.7572ms)
✔ acknowledgment - creation and strict verification (1.3547ms)
✔ bounds enforcement - rejects packages exceeding entry bounds or byte limits (0.8972ms)
✔ preset interaction - ECO Mode applies tightened byte limits and Review Mode enforces read-only (1.4652ms)
✔ presets - all 7 presets build valid fresh-worker packages (2.6129ms)
✔ sanitization - deep nested structures and forbidden keys (0.3698ms)
✔ acknowledgment - validation of invalid inputs (0.3817ms)
✔ createCharter - creates default versioned charter (2.6648ms)
✔ createCharter - supports custom version and principles, rejects invalid (0.5586ms)
✔ createWorkerKnowledge - derives from manifest with capabilities and protocols (0.3602ms)
✔ createProjectContext - captures bounded context and rejects missing workspace (0.2976ms)
✔ createTaskPackage - validates required fields and captures route position (0.5187ms)
✔ createMasterPrompt - unites the 4 versioned layers and renders markdown (0.6657ms)
✔ presets - provides all 7 required presets (0.2322ms)
✔ presets - getPreset resolves by ID and name case-insensitively (0.4418ms)
✔ presets - applyPreset narrows work and cannot weaken authority (1.0013ms)

ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 114.7094
```

---

## 3. Honesty Declaration & Exact Limitations

1. **Ownership Boundaries Strictly Respected**:
   - Authored only `master-prompt.js`, `context-package.js`, `presets.js`, `ifz-master-prompt.test.js`, `ifz-context-package.test.js`, and `AGR-3-ifz-master-prompt.md`.
   - Did not touch any peer-owned files (`contracts.js`, `worker-registry.js`, `route-planner.js`, `route-guard.js`, shell, or work page components).
2. **Pure, Offline, and Zero Dependencies**:
   - Zero external npm packages added.
   - Zero filesystem reads or network provider calls in implementation modules.
   - All tests run deterministically with Node.js standard test runner.
3. **No Unwarranted Inferences**:
   - Unit tests verify schema compliance, section ordering, immutability, bound enforcement, sanitization, and acknowledgment verification.
   - They do not imply deployment to live multi-agent clusters or external provider networks.

---

## 4. Rework Verification Receipt (Structural Safety & Non-Widening Invariants)

- **Rework Trigger**: Strict enforcement of structural rejection for forbidden material, structural safety guards, non-widening invariants across all authority/budget dimensions, and admission-only acknowledgment semantics.
- **Status**: `ready_for_review`

### A. Rework Implementation Details

1. **Structural Rejection of Forbidden Material (`assertStructuralSafety`)**:
   - Rejects credential and secret fields (`password`, `token`, `apiKey`, `privateKey`, `credential`, `auth`, `cookie`, `sessionSecret`, etc.) at *every* nested level with `ContextPackageSecurityError`. Regex redaction is retained strictly as defense-in-depth.
   - Rejects `.env` material (`ENV_FILE_LINE_PATTERN`) structurally before serialization.
   - Rejects private reasoning and model-thinking fields (`thinking`, `chainOfThought`, `internalReasoning`, `scratchpad`, `hiddenThoughts`) and XML tags (`<thinking>`, `<thought>`, `<scratchpad>`) structurally.
   - Rejects full-transcript payloads (keys like `transcript`, `fullTranscript`, `rawTurns`, `messages`, or arrays of `{ role, content }` conversation turns) structurally.

2. **Structural Object & Collection Safety**:
   - **Cycles**: Detects and rejects circular object references via ancestor tracking (`ContextPackageError`).
   - **Accessors**: Rejects objects with custom getters or setters via `Object.getOwnPropertyDescriptor` (`ContextPackageSecurityError`).
   - **Prototypes**: Rejects non-plain objects, custom class instances, and own `__proto__` property poisoning (`ContextPackageSecurityError`).
   - **Nesting**: Enforces `MAX_NESTING_DEPTH = 10`, rejecting excessive depth with `ContextPackageBoundsError`.
   - **Collection Bounds**: Enforces `MAX_ARRAY_LENGTH = 100` and `MAX_OBJECT_KEYS = 100`, rejecting oversized collections with `ContextPackageBoundsError`.
   - **UTF-8 Byte Bounds**: Enforces `MAX_STRING_BYTES = 16384` (16 KB) on every individual string before serialization (`ContextPackageBoundsError`).

3. **Strict Non-Widening Invariants (`presets.js` & `context-package.js`)**:
   - **Destination**: Rejects attempts to widen or change destination.
   - **Project & Workspace**: Rejects attempts to widen project or workspace boundaries.
   - **Paths**: Rejects attempts to add owned paths beyond base scope.
   - **Effects (Action Classes)**: Clamps action classes to the strict intersection with base authority; rejects unauthorized actions under strict check. Preserves `readOnly` constraint.
   - **Budgets & Limits**: Clamps all limits via `Math.min(base, preset)` and rejects widening for:
     - `maxPackageBytes`
     - `maxSteps`
     - `maxFiles`
     - `timeoutMs` (time)
     - `maxTokens` (tokens)
     - `maxProviderAttempts` (provider attempts)
     - `maxWorkers` (worker count)
     - `maxDepth` (delegation depth)
     - `maxBranches` (branch count)
   - **Delegation Authority**: Rejects enabling delegation when disabled by base authority.

4. **Admission-Only Acknowledgment Semantics**:
   - `createWorkerAcknowledgment` sets:
     `evidenceType: 'admission_evidence'`, `isDispatch: false`, `isCompletion: false`, `isVerification: false`.
   - `verifyWorkerAcknowledgment` explicitly rejects any acknowledgment claiming `isDispatch: true`, `isCompletion: true`, or `isVerification: true`, confirming that acknowledgment serves as admission evidence only.

### B. Rework Test Execution

Executed command:
`node --test packages/orchestration-core/test/ifz-master-prompt.test.js packages/orchestration-core/test/ifz-context-package.test.js`

```text
✔ buildFreshWorkerPackage - generates 8-step boot package in documented order (7.9503ms)
✔ buildFreshWorkerPackage - binds package to worker, adapter, project, workspace, task, route, and versions (0.9752ms)
✔ adversarial: structural rejection of secrets and credentials at every nested level (0.9563ms)
✔ adversarial: structural rejection of .env material (0.1906ms)
✔ adversarial: structural rejection of private reasoning / model-thinking fields and tags (0.3299ms)
✔ adversarial: structural rejection of full-transcript payloads (1.0694ms)
✔ adversarial: structural rejection of circular references (0.7027ms)
✔ adversarial: structural rejection of accessors (getters/setters) (0.4975ms)
✔ adversarial: structural rejection of unsafe prototypes and __proto__ poisoning (0.4752ms)
✔ adversarial: structural rejection of excessive nesting (0.5441ms)
✔ adversarial: structural rejection of oversized arrays, objects, and strings (0.759ms)
✔ adversarial: context packages and presets never widen destination, workspace, paths, or budgets (1.1166ms)
✔ acknowledgment - admission evidence only; cannot claim dispatch, completion, or verification (1.4644ms)
✔ defense-in-depth sanitization functions (0.2535ms)
✔ presets - all 7 presets build valid fresh-worker packages (9.0882ms)
✔ createCharter - creates default versioned charter (2.8776ms)
✔ createCharter - supports custom version and principles, rejects invalid (0.6166ms)
✔ createWorkerKnowledge - derives from manifest with capabilities and protocols (0.3735ms)
✔ createProjectContext - captures bounded context and rejects missing workspace (0.3925ms)
✔ createTaskPackage - validates required fields and captures route position (0.9872ms)
✔ createMasterPrompt - unites the 4 versioned layers and renders markdown (0.9398ms)
✔ presets - provides all 7 required presets (0.4837ms)
✔ presets - getPreset resolves by ID and name case-insensitively (0.5471ms)
✔ presets - applyPreset narrows work and cannot weaken authority (1.3921ms)

ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 192.4267
```

---

## 5. Final Bound Correction Receipt (Zero Silent Truncation)

- **Correction Trigger**: Elimination of the single remaining silent truncation `tools.slice(0, maxTools)` in `buildFreshWorkerPackage`.
- **Status**: `ready_for_review`
- **Zero Silent Modification Invariant**: All bound violations strictly fail-closed via `ContextPackageBoundsError`. No requested context package property is silently mutated or truncated without caller awareness.

### A. Implementation Changes
1. **Explicit Tools Bounds Check (`packages/orchestration-core/src/ifz/context-package.js`)**:
   - In `buildFreshWorkerPackage`, replaced:
     ```javascript
     const effectiveTools = Array.isArray(tools) ? tools.slice(0, MAX_ENTRY_BOUNDS.maxTools) : [];
     ```
     with:
     ```javascript
     if (Array.isArray(tools) && tools.length > MAX_ENTRY_BOUNDS.maxTools) {
       throw new ContextPackageBoundsError(
         `Tools count (${tools.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxTools})`
       );
     }
     const effectiveTools = Array.isArray(tools) ? [...tools] : [];
     ```
   - Added early validation for `worker.tools` before constructing `effectiveWorkerKnowledge`:
     ```javascript
     if (Array.isArray(worker?.tools) && worker.tools.length > MAX_ENTRY_BOUNDS.maxTools) {
       throw new ContextPackageBoundsError(
         `Worker tools count (${worker.tools.length}) exceeds bound (${MAX_ENTRY_BOUNDS.maxTools})`
       );
     }
     ```
   - Replaced slicing with defensive cloning (`[...tools]`), eliminating all implicit truncation.

2. **Focused Unit Test (`packages/orchestration-core/test/ifz-context-package.test.js`)**:
   - Added `test('bounds enforcement - rejects tools exceeding maxTools entry bound')` asserting that:
     - Passing `tools` with length > `MAX_ENTRY_BOUNDS.maxTools` (30) throws `ContextPackageBoundsError`.
     - Passing `worker.tools` with length > `MAX_ENTRY_BOUNDS.maxTools` (30) throws `ContextPackageBoundsError`.

### B. Test Execution Results

Executed command:
`node --test packages/orchestration-core/test/ifz-master-prompt.test.js packages/orchestration-core/test/ifz-context-package.test.js`

```text
✔ buildFreshWorkerPackage - generates 8-step boot package in documented order (5.3961ms)
✔ buildFreshWorkerPackage - binds package to worker, adapter, project, workspace, task, route, and versions (1.6606ms)
✔ adversarial: structural rejection of secrets and credentials at every nested level (0.9531ms)
✔ adversarial: structural rejection of .env material (0.4473ms)
✔ adversarial: structural rejection of private reasoning / model-thinking fields and tags (0.4572ms)
✔ adversarial: structural rejection of full-transcript payloads (0.7243ms)
✔ adversarial: structural rejection of circular references (0.275ms)
✔ adversarial: structural rejection of accessors (getters/setters) (0.3559ms)
✔ adversarial: structural rejection of unsafe prototypes and __proto__ poisoning (0.2778ms)
✔ adversarial: structural rejection of excessive nesting (0.5185ms)
✔ adversarial: structural rejection of oversized arrays, objects, and strings (0.399ms)
✔ adversarial: context packages and presets never widen destination, workspace, paths, or budgets (0.6341ms)
✔ acknowledgment - admission evidence only; cannot claim dispatch, completion, or verification (0.9992ms)
✔ defense-in-depth sanitization functions (0.1276ms)
✔ presets - all 7 presets build valid fresh-worker packages (4.645ms)
✔ bounds enforcement - rejects tools exceeding maxTools entry bound (0.4327ms)
✔ createCharter - creates default versioned charter (2.4125ms)
✔ createCharter - supports custom version and principles, rejects invalid (0.711ms)
✔ createWorkerKnowledge - derives from manifest with capabilities and protocols (0.39ms)
✔ createProjectContext - captures bounded context and rejects missing workspace (0.4009ms)
✔ createTaskPackage - validates required fields and captures route position (1.0785ms)
✔ createMasterPrompt - unites the 4 versioned layers and renders markdown (0.9046ms)
✔ presets - provides all 7 required presets (0.3926ms)
✔ presets - getPreset resolves by ID and name case-insensitively (0.5421ms)
✔ presets - applyPreset narrows work and cannot weaken authority (1.2124ms)

ℹ tests 25
ℹ suites 0
ℹ pass 25
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 125.8727
```



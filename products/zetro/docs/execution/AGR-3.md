# Worker Receipt: AGR-3

- **Task ID**: `W1-AGR3-dispatcher` / `W1R-AGR3-recovery` / `W1R2-AGR3-fixture-isolation` / `W2-AGR3-task-store` / `W3-AGR3-rct-adapter` / `W3R-AGR3-independent-baseline-cancel` / `W3R2-AGR3-complete-baseline-proof` / `W4-AGR3-cli-lifecycle-demo` / `W4R-AGR3-demo-assertions` / `W4R2-AGR3-demo-store-cleanup` / `W5-AGR3-artifact-review-port` / `W5R-AGR3-authoritative-review-transaction` / `W6-AGR3-worker-status-projection` / `W6R-AGR3-worker-status-hardening` / `W7-AGR3-runtime-admission-integration` / `W8-AGR3-readonly-store-projection` / `W9-AGR3-rct-host-cli`
- **Worker**: AGR-3
- **Coordinator**: Codex
- **Actual Workspace**: `E:/Veyminore/products/zetro`
- **Baseline Revision**: `90db896ea4efd67cb7eb086fcf81b35a1e5e1291`
- **Owned Paths**:
  - `packages/orchestration-core/`
  - `docs/execution/AGR-3.md`
- **Status**: `ready_for_review`
- **Live Provider Calls**: 0 (zero live Groq calls, zero live network requests, completely deterministic with local fake adapters)

---

## 1. Summary of Changes (First Pass)

Stabilized Dispatcher state transitions and hardened lifecycle invariants across `packages/orchestration-core/`:

1. **State Machine & Terminal State Immutability**:
   - Explicitly defined `TERMINAL_STATES` (`COMPLETED`, `SUBMITTED`, `FAILED`, `UNKNOWN`, `CANCELLED`) in [types.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/types.js).
   - Enforced transition validation via `_isValidTransition()` preventing any transition out of a terminal state.
   - Introduced per-task transition locking (`_transitionLocks`) in [dispatcher.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/dispatcher.js) to serialize state transitions and journal writes, eliminating asynchronous state-transition races.

2. **Active Cancellation & Protection against Late Adapter Overwrite**:
   - In `cancel(id)`: immediately filters task from pending queue, triggers `ac.abort()`, and records `CANCELLED`.
   - In `_executeTask()`: added pre-run, post-yield, and post-`Promise.race` abort/cancellation checks.
   - Fixed the critical bug where a late successful adapter return could overwrite a terminal `CANCELLED` state with `COMPLETED`. Even if an adapter ignores an abort signal and resolves with success or failure, the task remains strictly `CANCELLED`, and no corrupted transition event is journaled.

3. **Deadline Races**:
   - Fixed timeout handling to ensure that deadline expiration (`Deadline exceeded`) marks `UNKNOWN` only if the task is still in `RUNNING`.
   - Prevented race conditions between concurrent cancellations and deadlines.
   - Guaranteed that late adapter completions after deadline timeouts cannot overwrite `UNKNOWN`.

4. **Envelope Bounds & Deadline Validation**:
   - Introduced `Bounds` in `types.js` defining safe bounds: `MAX_ID_CHARS` (256), `MAX_STRING_CHARS` (4096), `MAX_OBJECTIVE_CHARS` (65536), `MAX_ARRAY_ITEMS` (1000), `MIN_DEADLINE_MS` (1), `MAX_DEADLINE_MS` (2147483647), and `MAX_BUDGET_CHARS` (100,000,000).
   - Validated `deadlineMs` as a positive safe integer within Node's timer ceiling (`1 <= deadlineMs <= 2147483647`). Rejected 0, negative, float, `NaN`, `Infinity`, and unbounded deadline values with informative errors.
   - Validated budget parameters against `NaN`, `Infinity`, and negative/zero bounds.

5. **Duplicate Task IDs**:
   - Synchronously reserved task IDs in `stateMap` during `submit()` prior to the asynchronous journal append.
   - Guaranteed that concurrent submissions with identical task IDs reject with `Duplicate Task ID` without queueing duplicate entries.
   - Restored state cleanly if journal append fails during submission.

6. **Crash Replay & Preservation of Uncertain Work**:
   - Enhanced `init()` to inspect all tasks in `stateMap` and reconcile any task left in `RUNNING` state to `UNKNOWN` with uncertainty explanation.
   - Guaranteed that `UNKNOWN` tasks are filtered out of `this.queue` and are never automatically resent or retried.
   - Deduplicated queued tasks during replay.

7. **Durability Hardening in Journal**:
   - Documented the architectural limitations of JSONL durability in JSDoc in [journal.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/journal.js).
   - Enhanced `Journal.init()` to handle truncated or corrupted trailing JSON lines caused by power loss/crash during `appendFile`, preserving valid prior records and capturing corrupt lines in `this.corruptLines`.

---

## 2. Changed Files

- `packages/orchestration-core/src/types.js`: Added `Bounds`, `TERMINAL_STATES`, `Intents`, and task/attempt/event/artifact schemas. Cleaned EOF whitespace.
- `packages/orchestration-core/src/index.js`: Exported `Dispatcher`, `Journal`, `TaskStore`, `SqliteTaskStore`, `isSqliteSupported`, `TaskManager`, `RctAdapterPort`, `FakeRctAdapter`, `States`, `Bounds`, `TERMINAL_STATES`, `Intents`. Cleaned EOF whitespace.
- `packages/orchestration-core/src/journal.js`: Documented JSONL durability limitations, added `repairFraming()`, `quarantine()`, and corrupted line diagnostics. Cleaned EOF whitespace.
- `packages/orchestration-core/src/dispatcher.js`: Implemented transition validation, per-task locking, envelope bounds, synchronous ID reservation, cancellation protection, deadline races, corruption fail-closed handling, and crash reconciliation. Cleaned EOF whitespace.
- `packages/orchestration-core/src/task-store.js`: Implemented `TaskStore` abstract interface and `SqliteTaskStore` with migration versioning, transactional state, capability detection, intent windows, and crash reconciliation. Cleaned EOF whitespace.
- `packages/orchestration-core/src/task-manager.js`: Implemented bounded library APIs (`run`, `status`, `events`, `cancel`, `evidence`) backed by `TaskStore`. Cleaned EOF whitespace.
- `packages/orchestration-core/src/rct-adapter-port.js`: Interface contract for RCT adapter execution and receipt validation. Cleaned EOF whitespace.
- `packages/orchestration-core/src/rct-conformance-fixture.js`: Conformance fake adapter fixture for next-wave integration with RCT. Cleaned EOF whitespace.
- `packages/orchestration-core/test/dispatcher.test.js`: 26 deterministic tests with per-test `mkdtemp` isolation and cleanup hooks. Cleaned whitespace.
- `packages/orchestration-core/test/task-store.test.js`: 7 deterministic tests for SQLite capability, migrations, CRUD, transactions, intent windows, and crash reconciliation. Cleaned whitespace.
- `packages/orchestration-core/test/task-manager.test.js`: 6 deterministic tests for library APIs, intent windows, kill/restart crash recovery, and no duplicate dispatch. Cleaned whitespace.
- `packages/orchestration-core/test/rct-conformance.test.js`: 6 deterministic tests for RCT adapter port validation and fake fixture modes. Cleaned whitespace.
- `docs/execution/AGR-3.md`: Receipt file.

---

## 3. Verification Evidence

### Commands Executed

```powershell
# From packages/orchestration-core:
node --test
npm test
git diff --check packages/orchestration-core/ docs/execution/AGR-3.md

# From root:
node scripts/zetro-check.js
```

### Results & Counts

- **Exit Code**: `0`
- **Total Tests in orchestration-core**: `45`
- **Passed**: `45`
- **Failed**: `0`
- **Cancelled**: `0`
- **Skipped**: `0`
- **Todo**: `0`
- **Duration**: ~2300ms
- **Deterministic Suite Runner (Root)**: 12/12 suites pass (279 passed tests across full monorepo)
- **`git diff --check`**: Clean (0 errors, 0 warnings across all owned files)

---

## 4. Limitations of JSONL Durability

The following architectural limitations of append-only JSONL files are recorded:

1. **Process Concurrency & Torn Writes**: Node's `fs.appendFile` does not acquire exclusive OS file locks (`LockFileEx` on Windows, `flock` on POSIX). Concurrent writes from multiple processes can interleave buffers or tear JSON lines.
2. **Buffer Flush & Power Loss**: `fs.appendFile` writes to OS page buffers without explicit `fsync`/`fdatasync`. Sudden process termination, kernel panics, or power loss can leave unwritten buffers or partial, truncated records at the end of the file.
3. **Integrity Validation**: JSONL records lack cryptographic checksums (e.g. CRC32, SHA-256) or framing envelopes. Truncation and corruption are detected solely via `JSON.parse` syntax errors.
4. **Scan Overhead & Lack of Compaction**: Recovery requires an $O(N)$ sequential parse of every historical record in the file. Without compaction or snapshotting, memory consumption and initialization time scale linearly with task history.
5. **Multi-Event Transactional Atomicity**: Multi-step operations across lines are non-atomic; the engine relies on compensatory transition events (`UNKNOWN`) during startup reconciliation rather than rollbacks.

---

## 5. Rework 1 (Task W1R-AGR3-recovery)

### Findings Resolved

1. **Unsafe Corruption Recovery & Resend of Executed Work**:
   - *Problem*: Silently skipping malformed records during replay left tasks with a corrupted `RUNNING` transition as `PENDING`, causing them to be re-executed by `drain()`.
   - *Fix*: In [dispatcher.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/dispatcher.js), when `journal.corruptLines.length > 0`, any task in `PENDING` or mentioned in a corrupt line is treated as uncertain and transitioned to `UNKNOWN` with `{ error: 'Journal corruption detected: uncertain execution state', uncertainty: 'Task may have been dispatched or executed prior to journal corruption' }`. Such tasks are strictly removed from `queue`, guaranteeing they are never automatically resent.

2. **Unterminated Final Fragments & Append Concatenation**:
   - *Problem*: A truncated trailing record without a trailing newline (`\n`) caused subsequent `appendFile` calls to concatenate onto the end of the partial line, corrupting both the trailing fragment and the new record.
   - *Fix*: Implemented `repairFraming()` in [journal.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/journal.js), called before any `init()` read and before any `append()`. If the file is non-empty and the last byte is not `\n` (0x0A), it appends `\n` to terminate the framing. Subsequent appends write cleanly on a new line.

3. **Quarantine & Diagnostic Evidence Preservation**:
   - *Fix*: Added `quarantine()` in [journal.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/journal.js) which creates a persistent copy `${filepath}.quarantine.${Date.now()}` when corruption is detected, retaining exact on-disk diagnostic evidence while preserving in-memory line diagnostics (`journal.corruptLines`).

4. **Whitespace Compliance**:
   - *Fix*: Removed all trailing whitespace and redundant EOF blank lines across `src/types.js`, `src/index.js`, `src/journal.js`, `src/dispatcher.js`, and `test/dispatcher.test.js`. Verified clean with `git diff --check packages/orchestration-core/`.

---

## 6. Rework 2 (Task W1R2-AGR3-fixture-isolation)

### Findings Resolved

1. **Fixture Safety & Complete Process Isolation**:
   - Refactored all 26 test cases to use `createTestJournal(t)` which creates an isolated temporary directory via `mkdtemp(join(tmpdir(), 'zetro-dispatch-test-'))`. Registered automatic teardown hooks via `t.after()` ensuring recursive deletion of the temporary directory and all generated journal/quarantine artifacts upon test completion.
2. **Cleaned Orphaned Test Quarantine Artifacts**:
   - Safely removed 35 confirmed test-generated quarantine artifacts matching `^test-journal\.jsonl\.quarantine\.\d+$` in `packages/orchestration-core/`.
3. **Sentinel Preservation Proof**:
   - Proved that two consecutive runs of `npm test` leave a sentinel `test-journal.jsonl` completely intact with `SENTINEL_DATA_PRESERVED` and generate 0 source artifacts in `packages/orchestration-core/`.
4. **Accurate Durability Guarantee Language**:
   - Corrected receipt wording: stated exact verified guarantees for framing repair and fail-closed corruption recovery; excluded unsupported claims of OS file locking, synchronous fsync, or cryptographic checksums.

---

## 7. Wave 2: Durable TaskStore and Library APIs (Task W2-AGR3-task-store)

### Architectural Decisions & Implementation

1. **Runtime Compatibility & Capability Detection**:
   - Selected Node's built-in `node:sqlite` `DatabaseSync` as the transactional storage engine. It provides zero-dependency ACID transactions, WAL mode, foreign keys, and fast synchronous prepared statements.
   - Built capability detection via `isSqliteSupported()`:
     - On Node >= 22.5.0 (including the current `v26.10.0` environment), `DatabaseSync` is natively available and supported.
     - Root `package.json` currently declares `engines: { "node": ">=20.0.0" }`. If Node 20 is targeted, coordinator/AGR-5 can bump root engines to `>=22.5.0` or add a compatible dependency. `SqliteTaskStore.init()` explicitly throws a descriptive error if `node:sqlite` is unavailable.

2. **Schema Migration & Version Handling**:
   - `schema_migrations` table records applied versions with timestamps and descriptions.
   - Version 1 initializes:
     - `tasks`: id, agent, objective, allowed_paths, context_refs, acceptance, verification, workspace_root, source_hash, assignment_digest, deadline_ms, max_context_chars, max_reply_chars, context_chars_used, reply_chars_used, state, uncertainty, error, created_at, updated_at.
     - `attempts`: attempt_id, task_id, attempt_number, intent, intent_data, state, started_at, finished_at, uncertainty, error.
     - `events`: id (AUTOINCREMENT), task_id, attempt_id, event_type, payload_json, timestamp.
     - `artifacts`: id (AUTOINCREMENT), task_id, attempt_id, artifact_type, uri, hash, metadata_json, created_at.

3. **Intent Windows & Kill/Restart Crash Reconciliation**:
   - In [task-manager.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-manager.js), `run()` immediately persists the task and attempt in `TaskStore` before calling the adapter.
   - Before remote execution, `recordIntent(taskId, attemptId, Intents.DISPATCH_CALL, data)` records the intent window.
   - On process restart, `reconcileInterruptedWork()` scans for in-flight attempts where an intent window was opened but no terminal receipt was recorded. It reconciles them to `States.UNKNOWN` with intent `Intents.RECONCILED_UNKNOWN` and uncertainty context.
   - Such reconciled tasks are NEVER automatically re-dispatched on restart.

4. **Bounded Library APIs**:
   - Implemented `TaskManager` exposing:
     - `run(envelope, options)`: Immediate durable task ID, bounded execution, intent tracking, artifact persistence.
     - `status(taskId)`: Returns state, budgets, attempt status, uncertainty, error.
     - `events(taskId, options)`: Returns audit event trail.
     - `cancel(taskId)`: Transactional cancellation of in-flight or queued work.
     - `evidence(taskId)`: Returns execution artifacts (patches, test receipts) and summary.

5. **RCT Integration Boundary**:
   - Implemented `RctAdapterPort` in [rct-adapter-port.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/rct-adapter-port.js) and `FakeRctAdapter` conformance fixture in [rct-conformance-fixture.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/rct-conformance-fixture.js).
   - Validates the adapter contract without modifying `rct-runtime`.

---

## 8. Blockers and Remaining Risks

- **Blockers**: None.
- **Remaining Risks / Root Engine Request**:
  - The built-in `node:sqlite` store runs natively on Node >= 22.5.0 (verified on Node v26). AGR-5 should align the root `package.json` `"engines"` declaration from `">=20.0.0"` to `">=22.5.0"` or coordinate a compatible dependency if Node 20 backwards compatibility is required.

---

## 9. Wave 2 Rework: Lifecycle Integrity and Identity Verification (Task W2R-AGR3-lifecycle-integrity)

### Findings Resolved

1. **Strict Receipt Validation & Identity Verification (P1)**:
   - *Problem*: `task-manager.js` accepted adapter receipts without calling strict validation, potentially allowing mismatched task IDs, intruder agent receipts, out-of-scope patch persistence, and self-declared worker completion with empty or failed checks.
   - *Fix*: Enhanced `RctAdapterPort.checkReceiptConformance()` in [rct-adapter-port.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/rct-adapter-port.js) and integrated it directly into [task-manager.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-manager.js) before ANY authoritative state or artifact writes.
   - *Enforced Criteria*:
     - Exact `receipt.id === envelope.id` (rejects mismatched task IDs).
     - Exact `receipt.agent === envelope.agent` (rejects intruder agents).
     - Path containment via `RctAdapterPort.isPathInScope()`: all `changedFiles` must be relative to `envelope.allowedPaths` with zero directory traversal (`..`) or absolute path escapes. Outside-scope modifications are rejected immediately with 0 artifacts written to storage.
     - Bounded limits enforced on `summary`, `uncertainty`, `changedFiles`, `checks`, and `evidenceRefs` against `Bounds`.
     - Independent verification enforcement: worker completion alone does NOT become independent completion. If `receipt.state === States.COMPLETED`, `receipt.checks` must be non-empty and all checks must be passed (no failure keywords or failed check objects). Empty or failed checks reject worker completion and transition the task & attempt to `States.FAILED`.

2. **Store Transition Integrity & Immutable Terminal States (P1)**:
   - *Problem*: `task-store.js` previously lacked terminal state checks and state validation on `updateAttemptState`, which allowed `COMPLETED -> RUNNING` attempt transitions and arbitrary unknown state strings, creating inconsistent state between task and attempts.
   - *Fix*:
     - Added `assertValidState(state, context)` across `createTask`, `updateTaskState`, `createAttempt`, `updateAttemptState`, and `finalizeTaskAttempt` in [task-store.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js). Any unknown or non-enumerated state throws an error immediately.
     - Enforced immutable terminal states on attempts: if `attempt.state` is in `TERMINAL_STATES` (`COMPLETED`, `FAILED`, `CANCELLED`, `UNKNOWN`, `SUBMITTED`), calls to `updateAttemptState` return the attempt unchanged, preventing illegal transitions back to `RUNNING` or `CANCELLED`.

3. **Atomic Store Lifecycle Operations & Failure Injection Recovery (P2)**:
   - *Problem*: Finalization and cancellation previously executed multiple discrete database operations across separate transactions, leaving the database vulnerable to inconsistent states (e.g. attempt finalized but task unfinalized) if interrupted.
   - *Fix*:
     - Added `finalizeTaskAttempt(taskId, attemptId, options)` to `TaskStore` and `SqliteTaskStore`: executes attempt state update, artifact insertions, task state transition, and audit event logs inside a single SQLite transaction.
     - Added `cancelTaskAttempt(taskId, attemptId, extra)`: executes intent recording, attempt cancellation, and task cancellation inside a single atomic SQLite transaction.
     - Updated `TaskManager.run()` and `TaskManager.cancel()` in [task-manager.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-manager.js) to route all terminal transitions through these atomic store operations.
     - Tested failure injection during `finalizeTaskAttempt`: simulated storage crash triggers complete transaction rollback (0 artifacts persisted, task remains in `RUNNING`). On restart, `reconcileInterruptedWork()` cleanly reconciles the interrupted task to `States.UNKNOWN` with zero duplicate dispatch.

4. **Adversarial Test Suite & Conformance Fixture**:
   - Enhanced `FakeRctAdapter` in [rct-conformance-fixture.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/rct-conformance-fixture.js) with explicit adversarial modes:
     - `intruder_agent`, `mismatched_id`, `outside_scope_patch`, `completed_no_checks`, `completed_failed_checks`, `unbounded_fields`, `invalid_state`.
   - Expanded test coverage across `orchestration-core` to 64 tests (all passing):
     - `rct-conformance.test.js`: 15 tests (8 adversarial and scope conformance tests).
     - `task-manager.test.js`: 13 tests (7 adversarial validation and atomic failure injection tests).
     - `task-store.test.js`: 11 tests (4 direct store transition, unknown state rejection, and atomic lifecycle tests).
     - `dispatcher.test.js`: 26 tests (deterministic queue and journal lifecycle tests).

---

## 10. Wave 2 Rework 2: Verification Trust and Attempt Ownership (Task W2R2-AGR3-trust-ownership)

### Review Findings Resolved

1. **Verification Trust: Untrusted Worker Claims vs Independent Verification (P1)**:
   - *Problem*: `RctAdapterPort` previously accepted `COMPLETED` receipts with string check labels (e.g. `checks: ['passed']`) or untyped objects (`checks: [{}]`) as verified. Worker labels and structured self-claims cannot supply trusted verification.
   - *Fix*:
     - Enhanced `RctAdapterPort.validateCheck(check)` in [rct-adapter-port.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/rct-adapter-port.js): rejects bare string labels (`'passed'`, `'ok'`), empty objects (`{}`), and non-boolean `passed` values (`'true'`, `1`). Strict boolean type checking (`typeof check.passed === 'boolean'`) is required.
     - Implemented `RctAdapterPort.validateVerifierEvidence(evidence, envelope, attemptId)`: validates separate injected independent verifier evidence tied to exact task identity (`evidence.taskId === envelope.id`), exact attempt identity (`evidence.attemptId === attemptId`), strict boolean `verified: true`, non-empty checks array with passing check objects, and verifies all declared checks in `envelope.declaredChecks` if provided.
     - Implemented unverified worker claim preservation: In `TaskManager.run()` in [task-manager.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-manager.js), worker completion alone NEVER grants independent completion. If a worker claims `States.COMPLETED` but separate injected independent verifier evidence is absent, the worker's work (patches, evidence refs, summary) is preserved in `TaskStore` with `uncertainty: 'Unverified worker claim: separate independent verifier evidence absent'`, but the authoritative task and attempt state is finalized to `States.SUBMITTED`.
     - Injected verifier support: When an independent verifier is injected via `TaskManager(store, adapter, { verifier })` or `run(envelope, { verifier })`, the verifier runs independently, producing verifier evidence. If valid, the task transitions to authoritative `States.COMPLETED` and records a `verifier_evidence` artifact. If the verifier rejects or fails, the task transitions to `States.FAILED`.

2. **Attempt Ownership & Cross-Task Mutation Prevention (P1)**:
   - *Problem*: `finalizeTaskAttempt('task-A', 'attempt-B1')` previously retrieved `attempt-B1` without verifying `attempt.taskId === taskId`, allowing cross-task mutation of Task A plus Task B's attempt.
   - *Fix*:
     - Enforced strict attempt ownership validation across all public APIs in `SqliteTaskStore` in [task-store.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js):
       - `finalizeTaskAttempt(taskId, attemptId, options)`: verifies `attempt.taskId === taskId` before any updates. On mismatch, throws `Attempt ownership mismatch: attempt '${attemptId}' belongs to task '${attempt.taskId}', not '${taskId}'`. Atomic transaction rollback leaves BOTH Task A and Task B completely intact.
       - `cancelTaskAttempt(taskId, attemptId, extra)`: verifies `attempt.taskId === taskId` before any updates; rolls back on mismatch.
       - `recordIntent(taskId, attemptId, intent, data)`: verifies `attempt.taskId === taskId` before writing.
       - `recordArtifact(taskId, attemptId, artifact)`: verifies `attempt.taskId === taskId` before writing.
       - `recordEvent(taskId, attemptId, eventType, payload)`: verifies `attempt.taskId === taskId` before writing.
       - `updateAttemptState(attemptId, newState, extra)`: verifies `attempt.taskId === extra.taskId` when `extra.taskId` is provided.
       - `createAttempt(attempt)`: validates parent task exists in `tasks` table before creating attempt; rejects orphaned attempts.

3. **Public API Input Validation & Defense-in-Depth**:
   - Added omitted and malformed input guards across all public methods of `SqliteTaskStore` (`getTask`, `createTask`, `updateTaskState`, `getAttempt`, `getLatestAttempt`, `recordIntent`, `updateAttemptState`, `finalizeTaskAttempt`, `cancelTaskAttempt`, `recordEvent`, `getEvents`, `recordArtifact`, `getArtifacts`). Null/undefined/non-string IDs safely return `null` or `[]` for queries and throw descriptive errors for mutations.
   - Added omitted/malformed input guards on `TaskManager` public APIs (`status`, `events`, `cancel`, `evidence`, `run`).

4. **Expanded Regression Test Suite**:
   - Total tests in `packages/orchestration-core`: **79 tests (all passing)**:
     - `rct-conformance.test.js` (19 tests): added tests for `forged_checks_strings`, `forged_checks_empty_object`, `forged_checks_malformed_boolean`, `forged_checks_number_boolean`, and `validateVerifierEvidence` (legitimate vs forged verifier evidence).
     - `task-store.test.js` (14 tests): added cross-task mutation prevention tests for `finalizeTaskAttempt`, `cancelTaskAttempt`, `recordIntent`, `recordArtifact`, `recordEvent`, `updateAttemptState`, orphaned attempt rejection, and public API malformed input guards.
     - `task-manager.test.js` (20 tests): added tests for worker claim preservation as `SUBMITTED`, authoritative completion with injected independent verifier, failing verifier rejection to `FAILED`, forged verifier evidence rejection, forged check rejection, and public API guards.
     - `dispatcher.test.js` (26 tests): passing.

---

## 11. Wave 2 Rework 3: Verifier Binding & Deadline Enforcement (Task W2R3-AGR3-verifier-binding-deadline)

### Review Findings Resolved

1. **Strict Active Attempt Identity (`rct-adapter-port.js`)**:
   - *Problem*: Missing or empty `evidence.attemptId` passed unchecked because the check `if (attemptId && evidence.attemptId && evidence.attemptId !== attemptId)` allowed omit-attempt exploits.
   - *Fix*: Enhanced `RctAdapterPort.validateVerifierEvidence(evidence, envelope, attemptId)` to require `typeof evidence.attemptId === 'string' && evidence.attemptId.trim() !== ''` and strictly verify exact equality (`evidence.attemptId === attemptId`). Missing, empty string, or mismatched attempt IDs are rejected immediately with descriptive diagnostic errors.

2. **Authoritative Declared Check Coverage & Normalization (`rct-adapter-port.js`)**:
   - *Problem*: Verifier evidence could pass with unrelated checks while ignoring the actual checks declared by the envelope (`envelope.declaredChecks` or `envelope.verification`).
   - *Fix*:
     - Implemented `RctAdapterPort.getRequiredCheckIds(envelope)` to derive authoritative required check IDs: checks `envelope.declaredChecks` first, then falls back to parsing `envelope.verification` (split by `,`, `;`, or `\n`), normalizing check names (`toLowerCase().replace(/[\s_-]+/g, '-')`). Envelopes with empty or non-string/non-array check declarations are rejected.
     - In `validateVerifierEvidence`, required every derived check ID to be present and passed (`passed === true`) in `evidence.checks`. Rejects unrelated passing checks, missing declared checks, and empty evidence trust.

3. **Verifier Deadline Preservation & Race-Safe Cancellation Boundaries (`task-manager.js`)**:
   - *Problem*: `clearTimeout(timeoutId)` was called immediately after `this.adapter.execute`, leaving independent verifier execution untimed and unbounded beyond `deadlineMs`. Late verifier completions after deadline expiry or operator cancellation could overwrite terminal state (`States.UNKNOWN` or `States.CANCELLED`).
   - *Fix*:
     - Retained active `timeoutId` throughout worker execution, receipt validation, and verifier execution.
     - Raced `verifier.verify` against both `deadlinePromise` and `verifierAbortPromise` (`abortSignal: ac.signal`) via `Promise.race`, passing `{ attemptId, abortSignal: ac.signal }` to the verifier.
     - Guarded terminal write with check: if `current?.state === States.CANCELLED || ac.signal.aborted || deadlineFired`, verifier completion is rejected, aborting with no artifact writes and preserving the existing terminal state.
     - Guaranteed `clearTimeout(timeoutId)` runs reliably in a top-level `finally` block.

4. **Direct Evidence Object Safely Handled Without Verifier Instance (`task-manager.js`)**:
   - *Problem*: Supplying `options.verifierEvidence` directly to `TaskManager.run(envelope, { verifierEvidence })` caused a `TypeError: Cannot read properties of null (reading 'name')` when `options.verifier` was not provided.
   - *Fix*:
     - Safely resolved verifier name: `const verifierName = verifier?.name || verifierEvidence.verifier || 'independent-verifier'`.
     - Explicitly recorded trusted evidence identity in `verifier_evidence` artifact and audit trail.

5. **Comprehensive Test Suite & Conformance Verification**:
   - Expanded test coverage across `orchestration-core` to **83 tests (all passing)** (up from 79):
     - `rct-conformance.test.js` (21 tests, +2):
       - `validateVerifierEvidence - strict active attempt identity (missing or empty attemptId rejected)`
       - `validateVerifierEvidence - authoritative check coverage against envelope.verification and declaredChecks`
     - `task-manager.test.js` (22 tests, +2):
       - `run() - accepts pre-existing valid verifierEvidence without crashing when verifier object is omitted (directevidence)`
       - `run() - enforces verifier deadline boundary: slow verifier aborted, transitions to UNKNOWN, late completion rejected (verifierdeadline)`
       - `cancel() - enforces verifier cancellation boundary: verifier aborted on cancel, state CANCELLED, zero artifacts (verifiercancel)`
       - `run() - rejects verifier evidence missing attemptId or with unrelated checks (missingattempt, unrelatedcheck)`
     - `task-store.test.js`: 14 tests (all passing).
     - `dispatcher.test.js`: 26 tests (all passing).

---

## 12. Wave 2 Rework 4: Exact Authoritative Check Identifier Equality (Task W2R4-AGR3-exact-check-id)

### Review Findings Resolved

1. **Exact Authoritative Check Identifier Equality (`rct-adapter-port.js`)**:
   - *Problem*: In `validateVerifierEvidence`, required-check matching previously lowercased and collapsed whitespace/underscores/dashes via `str.toLowerCase().replace(/[\s_-]+/g, '-')`. This allowed different commands and argument flags to be merged (e.g. required verification `node --test` accepted evidence `node test`; `npm-test` accepted `NPM TEST`; `test_unit` accepted `test-unit`).
   - *Fix*: Removed command normalization entirely. Enforced strict exact identifier equality against authoritative required check IDs derived from `envelope.declaredChecks` or `envelope.verification`:
     ```javascript
     const found = evidence.checks.find(c => (c.name === required || c.id === required || c.checkId === required));
     ```
   - Arbitrary command strings are never normalized to matching IDs.

2. **Canonical Check ID Consistency in Tests (`task-manager.test.js`)**:
   - Aligned `sampleEnvelope.verification` to `'npm-test'`, ensuring exact canonical check ID matching against test verifiers and fixtures without reliance on regex or casing normalization.

3. **Explicit Check ID Regressions (`rct-conformance.test.js`, `task-manager.test.js`)**:
   - Added regression test suites across both unit and integration levels covering:
     - `removeddash`: required `node --test` rejected when evidence supplies `node test` or `nodetest`.
     - `case`: required `npm-test` rejected when evidence supplies uppercase `NPM-TEST`.
     - `underscore`: required `test_unit` rejected when evidence supplies `test-unit`.
     - `argumentchanging whitespace`: required `node --test test/unit.js` rejected when verifier supplies altered whitespace/arguments (`node  --test  test/unit.js`).

4. **Preserved Invariants & Expanded Test Suite**:
   - Preserved all active attempt identity (`attemptId`), verifier deadline boundaries, cancellation race guards, and atomic SQLite store transaction guarantees.
   - Total test suite in `packages/orchestration-core`: **85 tests (all passing)**:
     - `rct-conformance.test.js` (22 tests, +1 regression suite): passing.
     - `task-manager.test.js` (23 tests, +1 regression suite): passing.
     - `task-store.test.js` (14 tests): passing.
     - `dispatcher.test.js` (26 tests): passing.

---

## 13. Wave 3: Real RCT Offline Adapter Integration & Lifecycle Verification (Task W3-AGR3-real-rct-lifecycle)

### Architectural Components Implemented

1. **`RealRctAdapter` ([real-rct-adapter.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js))**:
   - Implemented `RctAdapterPort` to integrate `orchestration-core` directly with `packages/rct-runtime` public APIs (`createSnapshot`, `runAssignment`, `sha256`) without modifying runtime or policy packages.
   - Creates private synthetic snapshots of source root (`createSnapshot`), ensuring worker execution is completely isolated and never mutates original source files.
   - Bridges `TaskEnvelope` contracts to RCT assignment definitions, preserving worker-scoped checks (`envelope.rctChecks`) and authoritative declared check IDs (`envelope.declaredChecks` / `envelope.verification`).
   - Translates runtime receipts into conformant `TaskReceipt` structures adhering to bounds, status codes, and check schemas.

2. **`createIndependentRctVerifier` ([real-rct-adapter.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js))**:
   - Implemented authoritative independent verifier operating strictly outside worker receipts.
   - Directly asserts source file immutability: `await snapshot.sourceUnchanged()` must be true.
   - Reads files directly from the isolated snapshot root, computing independent SHA-256 digests and evaluating checks against assigned criteria (`equals`, `contains`).
   - Produces trusted `verifierEvidence` bound to active `taskId` and `attemptId`.

3. **Lifecycle Scenarios Proven ([real-rct-lifecycle.test.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/real-rct-lifecycle.test.js))**:
   - **Authoritative Completion**: Real RCT worker execution with passing checks + independent verification yields `States.COMPLETED`, persists `verifier_evidence` artifact, and logs complete audit trail. Original source files remain 100% byte-identical.
   - **Submission vs Verification**: Real RCT worker claiming completion without an injected independent verifier is preserved as `States.SUBMITTED` in SQLite store with uncertainty notes; worker completion alone never grants authoritative completion.
   - **Failed Checks**: Failed worker execution transitions to `States.FAILED`. When worker claims success but independent verifier detects check failure on the snapshot files, task transitions to `States.FAILED` with strictly 0 artifacts persisted.
   - **Cancellation & Late Responses**: Active cancellation during provider execution aborts execution cleanly, transitions to `States.CANCELLED`, and rejects any late adapter responses.
   - **Crash Recovery & No Duplicate Dispatch**: In-flight crash during an open intent window (`Intents.DISPATCH_CALL`) reconciles on restart to `States.UNKNOWN` without duplicate dispatch.

### Test Suite Verification

Total test coverage in `packages/orchestration-core`: **90 tests (all passing)**:
- `real-rct-lifecycle.test.js` (5 tests): all passing.
- `rct-conformance.test.js` (22 tests): all passing.
- `task-manager.test.js` (23 tests): all passing.
- `task-store.test.js` (14 tests): all passing.
- `dispatcher.test.js` (26 tests): all passing.

---

## 14. Wave 3 Rework: Authoritative Baseline, Independent Criteria, and Cancellation Boundaries (Task W3R-AGR3-independent-baseline-cancel)

### Review Findings Resolved

1. **Independent Verifier: Strict Criteria Enforcement & Fallback Elimination (`real-rct-adapter.js`)**:
   - *Problem*: When an assignment lacked explicit machine-verifiable criteria, the verifier fallback previously copied check results from worker `receipt.checks`. Worker claims cannot supply trusted verification.
   - *Fix*: Removed the worker claim copying fallback entirely. In [`createIndependentRctVerifier()`](file:///e:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js#L210-L290), if `assignedChecks` is missing or empty, the verifier strictly rejects immediately (`verified: false`, error: `'No machine-verifiable assignment criteria declared: independent verifier strictly rejects missing criteria and never substitutes worker claims'`). Worker claims are never substituted for authoritative verification.

2. **Authoritative Admitted Baseline Validation (`real-rct-adapter.js`)**:
   - *Problem*: `envelope.sourceHash` was previously unverified before provider dispatch.
   - *Fix*: In [`RealRctAdapter.execute()`](file:///e:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js#L60-L95), authoritative admitted baselines (`envelope.sourceHashes` or `envelope.sourceHash`) are compared against actual on-disk snapshot hashes BEFORE calling the provider. On mismatch, execution throws immediately with zero provider invocations. In [`createIndependentRctVerifier()`](file:///e:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js#L210-L245), source files are re-verified against the same authoritative baseline afterward.

3. **Cancellation Race Elimination & Zero Subsequent Tool Effects (`real-rct-adapter.js`)**:
   - *Problem*: `Promise.race([runPromise, abortPromise])` returned on abort, leaving `runAssignment` running in the background with potential for late provider tool calls.
   - *Fix*:
     - Wrapped provider to listen to `abortSignal` and reject in-flight or subsequent calls immediately with `AbortError`.
     - Forwarded `signal: abortSignal` and `abortSignal` options directly into `runAssignment`.
     - Guaranteed `RealRctAdapter.execute` awaits `runPromise` completion before returning, proving zero subsequent tool effects in workspace or snapshot.

4. **Comprehensive Test Suite & Scenarios Proven ([real-rct-lifecycle.test.js](file:///e:/Veyminore/products/zetro/packages/orchestration-core/test/real-rct-lifecycle.test.js))**:
   - `no criteria`: Strict rejection when machine-verifiable criteria are omitted.
   - `forged claims`: Independent verifier directly audits snapshot files and rejects forged worker claims.
   - `hashmismatch`: Baseline hash mismatch rejected before provider execution (0 provider calls).
   - `abort lateprovider no effects`: Cancellation cleanly aborts execution and proves zero subsequent tool effects.
   - `restart`: Kill / restart intent window safely reconciles to `States.UNKNOWN` with zero duplicate dispatch.

### Test Suite Verification

Total test coverage in `packages/orchestration-core`: **91 tests (all passing)**.

---

## 15. Wave 3 Rework 2: Complete Baseline Proof & Barrier-Checked Cancellation (Task W3R2-AGR3-complete-baseline-proof)

### Review Findings Resolved

1. **Baseline Proof Hardening & Bypass Elimination ([real-rct-adapter.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js))**:
   - *Empty sourceHashes Masking Scalar sourceHash*: An empty `sourceHashes: {}` object previously bypassed validation and masked bogus scalar hashes. Resolved: [`validateSourceBaseline()`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js) strictly rejects empty proof objects (`Empty source baseline proof: sourceHashes cannot be empty`).
   - *Unknown Map Entries Skipping Absent actualHash*: Keys in `sourceHashes` referencing unadmitted paths previously evaluated `actualHash && actualHash !== expectedHash` to false because `actualHash` was `undefined`. Resolved: [`validateSourceBaseline()`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js) strictly asserts `snapshot.sourceHashes[cleanKey] !== undefined`, rejecting unknown entries immediately (`Unknown entry in source baseline proof: '<path>' is not an admitted file`).
   - *Incomplete Canonical Admitted Coverage*: Every admitted snapshot file must have an entry in `sourceHashes`. Any missing file is strictly rejected (`Incomplete source baseline proof: missing hash for admitted file '<path>'`).
   - *Multi-File Scalar Partial Match Bypass*: Previously, `allHashes.includes(expHash)` permitted a scalar hash matching only one file to admit multi-file tasks, leaving other files unbound. Resolved: in multi-file snapshots, scalar `sourceHash` MUST be the exact composite SHA-256 hash computed via [`computeCompositeSourceHash()`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js) over all canonical admitted entries. Matching single files is strictly rejected.
   - *Conflicting Proof Rejection*: If both `sourceHashes` map and scalar `sourceHash` are provided, any discrepancy between the scalar hash and the map (or its composite) is strictly rejected (`Conflicting source baseline proof`).
   - *Zero Provider Invocations on Mismatch*: Validation occurs strictly before provider wrapping and task dispatch; on any mismatch, snapshot is disposed and error thrown with 0 calls to `provider.next()`.

2. **Cancellation with Explicit Response-Completed Barrier ([real-rct-lifecycle.test.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/real-rct-lifecycle.test.js))**:
   - Implemented delayed provider test where active cancellation occurs at 80ms into a 300ms provider delay.
   - Added explicit `responseCompletedBarrier` promise that waits until the slow provider's 300ms timer completely settles.
   - Proved that even after the delayed response settles in the background, there is ZERO late tool effect and ZERO snapshot change: snapshot files remain identical to original source, and task remains strictly `States.CANCELLED` with 0 artifacts.

3. **Cancellation Between Actual Tools ([real-rct-lifecycle.test.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/real-rct-lifecycle.test.js))**:
   - Proved execution halts cleanly when cancellation is requested between Turn 1 and Turn 2.
   - Turn 1 tool (`read_slice`) executes; cancellation signal halts execution before Turn 2 tool (`propose_patch`) executes.
   - Snapshot and source files have zero modifications, and terminal state is `States.CANCELLED` with 0 artifacts.

4. **Consuming AGR-2 Signal Port Receipt ([real-rct-adapter.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/real-rct-adapter.js))**:
   - `RealRctAdapter.execute` now directly consumes the aborted receipt returned by `rct-runtime` via `options.signal`.
   - Captures `adapter.latestReceipt` preserving `state: 'unknown'`, `failureReason: 'aborted'`, and metrics.
   - Maps cleanly to conformant receipt with `States.CANCELLED` and uncertainty note without discarding receipt data.

### Test Suite Verification

Total test coverage in `packages/orchestration-core`: **98 tests (all passing)**:
- `real-rct-lifecycle.test.js` (13 tests): all passing.
- `rct-conformance.test.js` (22 tests): all passing.
- `task-manager.test.js` (23 tests): all passing.
- `task-store.test.js` (14 tests): all passing.
- `dispatcher.test.js` (26 tests): all passing.

Invariant compliance: Zero live provider calls, zero network/env reads, strict confinement to owned paths (`packages/orchestration-core/`, `docs/execution/AGR-3.md`).

---

## 16. Offline Lifecycle Demo Entrypoint & Cancellation Mutation Boundary (Task W4-AGR3-cli-lifecycle-demo)

### A. Concise Reproducible Demo Instructions

A complete executable reference demonstration is provided in [`packages/orchestration-core/src/demo.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/demo.js) with CLI entrypoint [`packages/orchestration-core/src/cli.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/cli.js).

#### Commands to Run
```bash
# Direct runner
node packages/orchestration-core/src/demo.js

# Or via CLI entrypoint
node packages/orchestration-core/src/cli.js demo
```

#### Demo Execution Output
```text
===============================================================
   ZETRO Orchestration Core - Offline Lifecycle Demo
===============================================================

[1. Workspace Setup]
    Source Root : C:\Users\...\Temp\zetro-demo-ws-OB6G4M
    Target File : src/calculator.js
    Initial Hash: 350387ae4648673c3b5b3dd88d924345ba812091f2e366d2dcab6b675a2dbc1a
    Content     : export function add(a, b) { return 0; }

[2. Authoritative Task Store]
    Database    : SQLite (node:sqlite)
    Path        : C:\Users\...\Temp\zetro-demo-db-1wIIyO\tasks.db
    Status      : Initialized with WAL durability

---------------------------------------------------------------
 Scenario A: Run -> Independent Verification -> COMPLETED
---------------------------------------------------------------
[API: run()] Dispatching TaskEnvelope: task-demo-success-1
    Result State: COMPLETED
[API: status()]
    Task ID     : task-demo-success-1
    Task State  : COMPLETED
    Attempt ID  : task-demo-success-1-att-1
    Attempt St. : COMPLETED
    Uncertainty : None
[API: events()] Audit Log (9 recorded events):
    - [TASK_CREATED] {"id":"task-demo-success-1","agent":"worker-rct-1","state":"PENDING"}
    - [ATTEMPT_STARTED] {"attemptId":"task-demo-success-1-att-1","attemptNumber":1,"state":"RUNNING"}
    - [INTENT_RECORDED] {"intent":"DISPATCH_CALL","data":{"agent":"worker-rct-1","timestamp":1792220529718},"timestamp":1792220529718}
    - [STATE_TRANSITION] {"from":"PENDING","to":"RUNNING","attemptId":"task-demo-success-1-att-1"}
    - [ATTEMPT_STATE_CHANGED] {"from":"RUNNING","to":"COMPLETED","summary":"Implemented add(a, b) in calculator.js","uncertainty":"None","error":null}
    - [ARTIFACT_RECORDED] {"artifactType":"evidence","uri":"evidence/patch-0.diff"}
    - [ARTIFACT_RECORDED] {"artifactType":"patch","uri":"src/calculator.js"}
    - [ARTIFACT_RECORDED] {"artifactType":"verifier_evidence","uri":"evidence/task-demo-success-1-verifier.json"}
    - [STATE_TRANSITION] {"from":"RUNNING","to":"COMPLETED","uncertainty":"None","error":null}
[API: evidence()] Persisted Artifacts (3):
    - [evidence] evidence/patch-0.diff
    - [patch] src/calculator.js
    - [verifier_evidence] evidence/task-demo-success-1-verifier.json
      Verified: true, Verifier: authoritative-rct-verifier
      Checks: [{"name":"src/calculator.js","passed":true,"sha256":"76f26bd292166033d02e77bdb8fe6aec01e915ccb8cb3f93b8971f9dcd78250e","path":"src/calculator.js"}]
[Source Root Integrity]
    Original Source Byte-Identical: true
[Snapshot Workspace]
    Isolated Patch Applied Cleanly: true
    Content: export function add(a, b) { return a + b; }
[Assertions: Scenario A] Verifying invariants...
    All Scenario A invariants verified.

---------------------------------------------------------------
 Scenario B: Cancel -> Barrier Settle -> Dual Inspection
---------------------------------------------------------------
[Dispatch] Starting task: task-demo-cancel-1
[API: cancel()] Operator triggers cancellation: task-demo-cancel-1
    Cancel Accepted: true
[Barrier] Awaiting explicit delayed provider response completion...
    Delayed provider response completed in background.
[Dual Inspection After Cancellation Barrier]
    Original Source Unchanged : true
    Snapshot Workspace Intact : true (zero late tool effects)
    Final Task State          : CANCELLED
    Final Attempt State       : CANCELLED
    Persisted Artifacts Count : 0
[Consumed AGR2 Signal Port Receipt]
    Receipt State             : unknown
    Failure Reason            : aborted
    Remote Usage Uncertain    : true

[Assertions: Scenario B] Verifying invariants...
    All Scenario B invariants verified.

===============================================================
   Lifecycle Demo Completed Successfully: All Invariants Pass
===============================================================
```

#### How-To: Integrating Real RCT with SQLite TaskStore
```javascript
import {
  TaskManager,
  SqliteTaskStore,
  RealRctAdapter,
  createIndependentRctVerifier
} from '@zetro/orchestration-core';

// 1. Authoritative TaskStore
const store = new SqliteTaskStore('./tasks.db');
await store.init();

// 2. Adapter with offline provider and workspace root
const adapter = new RealRctAdapter({ provider: myOfflineProvider, sourceRoot: '/path/to/src' });

// 3. Independent verifier auditing disk directly outside worker claims
const verifier = createIndependentRctVerifier();

// 4. Supervisor TaskManager
const manager = new TaskManager(store, adapter, { verifier });
await manager.init();

// 5. Dispatch task envelope with complete canonical baseline proof
const result = await manager.run({
  id: 'task-1',
  agent: 'worker-1',
  workspaceRoot: '/path/to/src',
  allowedPaths: ['src/app.js'],
  sourceHashes: { 'src/app.js': 'abc...' },
  checks: [{ type: 'equals', path: 'src/app.js', text: 'patched code\n' }],
  deadlineMs: 30000
});
```

---

### B. Exact Cancellation Mutation Boundary Evidence

Across the verified test suite, two critical cancellation boundary scenarios were executed against the active `rct-runtime` signal port:

#### Scenario 1: Delayed Response Barrier (`abort lateprovider no effects`)
- **Timing**: Operator cancellation requested at 80ms into a 300ms delayed provider response.
- **Barrier**: Test explicitly awaits `responseCompletedBarrier` promise until the background 300ms provider timer settles.
- **Recorded Outcomes**:
  - `sourceContent`: Exactly matches `initialContent` byte-for-byte.
  - `snapshotContent`: Exactly matches `initialContent` byte-for-byte (late `propose_patch` returned by delayed provider was NEVER executed).
  - `manager.status(id).state`: `States.CANCELLED`.
  - `manager.status(id).latestAttempt.state`: `States.CANCELLED`.
  - `manager.evidence(id).artifacts.length`: **0** (strictly zero unverified artifacts persisted).
  - `adapter.latestReceipt.state`: `'unknown'`.
  - `adapter.latestReceipt.failureReason`: `'aborted'`.
  - `adapter.latestReceipt.remoteUsageUncertain`: `true`.

#### Scenario 2: Cancellation Between Actual Tools (`cancellation between actual tools`)
- **Sequence**: Turn 1 executes tool `read_slice`; cancellation occurs between Turn 1 and Turn 2; Turn 2 `propose_patch` is prevented from executing.
- **Recorded Outcomes**:
  - `sourceContent`: Exactly matches `initialContent` byte-for-byte.
  - `snapshotContent`: Exactly matches `initialContent` byte-for-byte (Turn 2 patch was blocked from modifying snapshot).
  - `manager.status(id).state`: `States.CANCELLED`.
  - `manager.evidence(id).artifacts.length`: **0**.
  - `adapter.latestReceipt.failureReason`: `'aborted'`.

No blockers observed between `rct-runtime` signal port and `orchestration-core`.

---

## 17. Derived Invariant Assertions & Negative Fixture Verification (Task W4R-AGR3-demo-assertions)

### A. Problem Statement & Hardened Guarantees
In response to coordinator review of `W4-AGR3-cli-lifecycle-demo`:
1. **No Unchecked Success**: The offline demo must not merely print status fields or unconditionally return `{ success: true, failures: 0 }`. It must derive and enforce strict machine assertions (`assert.equal`, `assert.deepEqual`) across all lifecycle stages.
2. **Negative Fixtures with Non-Zero Exit**: Injected faults (such as corrupt source root bytes or late snapshot tool effects) must fail assertions, throw `AssertionError`, and terminate with a non-zero exit code (`process.exit(1)`).
3. **Guaranteed Cleanup in `finally`**: Synthetic workspace directories, SQLite database directories, managers, and adapter snapshots must be cleaned up in a `finally` block across both passing and failing runs.
4. **CLI Contract Clarity**: The entrypoint (`node packages/orchestration-core/src/cli.js demo`) exercises the 5 core lifecycle APIs (`run`, `status`, `events`, `cancel`, `evidence`) and accepts `--fault=<name>` for negative testing, without advertising nonexistent individual CLI subcommands.

### B. Derived Assertions Implemented in `demo.js`
In [`packages/orchestration-core/src/demo.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/demo.js):
- **Scenario A (Run -> Independent Verification -> COMPLETED)**:
  - `runResultA.state === States.COMPLETED`
  - `statusA.state === States.COMPLETED` and `statusA.latestAttempt?.state === States.COMPLETED`
  - Source byte integrity: `sourceUnchangedA === true` (initial SHA256 matches final SHA256)
  - Snapshot patch applied: `snapshotPatchedA === true` (content matches `export function add(a, b) { return a + b; }`)
  - Artifact count: `evidenceA.artifacts.length === 3`
  - Verifier evidence artifact: parsed payload has `verified === true`, `verifier === 'authoritative-rct-verifier'`, and check SHA256 matches disk patch digest
  - Audit trail completeness: `auditLogA.length >= 6`, includes `INTENT_RECORDED` (`DISPATCH_CALL`) and `STATE_TRANSITION` (`COMPLETED`)
- **Scenario B (Cancel -> Barrier Settle -> Dual Inspection)**:
  - `cancelResult.cancelled === true`
  - Completion barrier settlement: `delayedProviderSettled === true`
  - Source byte integrity: `sourceUnchangedB === true`
  - Snapshot byte integrity: `snapshotUnchangedB === true` (strictly zero late tool effects)
  - Task & attempt state: `statusB.state === States.CANCELLED` and `statusB.latestAttempt?.state === States.CANCELLED`
  - Artifacts count: `evidenceB.artifacts.length === 0` (strictly zero unverified artifacts persisted)
  - Signal port receipt: `rctReceipt.state === 'unknown'`, `failureReason === 'aborted'`, `remoteUsageUncertain === true`

### C. Negative Fixtures & Fault Injection Verification
Negative fixtures injected via `--fault=<name>` parameter or programmatically:
1. `--fault=corrupt_source`:
   - Mutates original source root before assertions.
   - Triggers `AssertionError: Original source root must remain 100% byte-identical (false !== true)`.
   - Exits with code `1`.
2. `--fault=late_snapshot_mutation`:
   - Mutates snapshot workspace after cancellation barrier settles.
   - Triggers `AssertionError: Snapshot workspace must remain unmodified (zero late tool effects) (false !== true)`.
   - Exits with code `1`.
3. In all fault injection cases, the `finally` block guarantees complete removal of temporary workspace directories and SQLite databases.

### D. Automated Test Coverage
Added 3 test cases to [`packages/orchestration-core/test/real-rct-lifecycle.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/real-rct-lifecycle.test.js):
1. `Real RCT Lifecycle Demo: Valid run satisfies all explicit derived assertions`
2. `Real RCT Lifecycle Demo: Negative fixture catches corrupted source invariant violation`
3. `Real RCT Lifecycle Demo: Negative fixture catches late snapshot mutation invariant violation`

**Test Suite Verification across `packages/orchestration-core`**:
- **Total tests**: **101 passed, 0 failed, 0 skipped** across 5 test suites:
  - `dispatcher.test.js`: 26 tests (all passing)
  - `rct-conformance.test.js`: 22 tests (all passing)
  - `real-rct-lifecycle.test.js`: 16 tests (all passing)
  - `task-manager.test.js`: 23 tests (all passing)
  - `task-store.test.js`: 14 tests (all passing)
- Command: `node --test packages/orchestration-core/test/*.test.js`
- Exit Code: `0`
- Zero live Groq calls, zero network/env reads, strict confinement to owned paths (`packages/orchestration-core/`, `docs/execution/AGR-3.md`).

---

## 18. SQLite Store Idempotence & Guaranteed Directory Cleanup Proof (Task W4R2-AGR3-demo-store-cleanup)

### A. Root Cause Analysis
During offline demo execution, `demo.js` called `store.init()`, then `managerA.init()` called `store.init()`, and finally `managerB.init()` called `store.init()` on the same `SqliteTaskStore` instance.
- **Previous behavior**: `SqliteTaskStore.init()` unconditionally executed `this.db = new DatabaseSyncClass(this.dbPath)`. Each subsequent call overwrote the `this.db` property, abandoning previous open connections in the native layer of `node:sqlite`.
- **Windows File Lock Impact**: Because connections 1 and 2 were abandoned without calling `.close()`, Windows held active file locks on `tasks.db`, `tasks.db-wal`, and `tasks.db-shm`.
- **Swallowed Error**: In `demo.js`, `finally` used `await rm(dbDir, ...).catch(() => {})`, which silently caught and ignored the resulting `EPERM` / `EBUSY` error, leaving leaked `zetro-demo-db-*` directories in `%TEMP%`.

### B. Implemented Fixes

1. **Idempotent Connection Lifecycle in `SqliteTaskStore`**
   - In [`packages/orchestration-core/src/task-store.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js):
     ```javascript
     async init() {
       if (!isSqliteSupported()) {
         throw new Error('SQLite storage is unsupported on this Node runtime: DatabaseSync missing (requires Node >= 22.5.0)');
       }
       // Idempotent initialization: preserve single connection lifecycle
       if (this.db) {
         return;
       }
       // ... initialize connection, WAL pragma, foreign keys, migrations
     }
     ```
   - Multiple `init()` invocations now safely reuse the single active connection without opening redundant handles or overwriting `this.db`.
   - `close()` closes the connection and explicitly sets `this.db = null`.
   - **Restart Semantics**: Calling `store.init()` after `store.close()` successfully reconnects to the database file, runs migrations idempotently, and preserves all stored tasks, attempts, events, and artifacts.

2. **Unswallowed Cleanup & Complete Resource Teardown in `demo.js`**
   - In [`packages/orchestration-core/src/demo.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/demo.js):
     - `store` is tracked in the outer scope alongside managers and adapters.
     - `finally` block executes safe teardown across `managerA`, `managerB`, `store`, `adapterA`, `adapterB`, `wsDir`, and `dbDir`.
     - Removal errors are **never silently swallowed**: errors during cleanup are collected and thrown, ensuring any failure to remove disk artifacts immediately fails the run.
     - Provided `onPathsCreated: ({ wsDir, dbDir })` hook for test introspection.

### C. Directory Cleanup Proof across Positive & Negative Runs

1. **Positive CLI Demo**:
   - `node packages/orchestration-core/src/cli.js demo`
   - Exit code: `0`.
   - Result: Both `wsDir` and `dbDir` removed. 0 temporary directories remaining in `tmpdir()`.

2. **Negative Fixture: Corrupt Source**:
   - `node packages/orchestration-core/src/cli.js demo --fault=corrupt_source`
   - Exit code: `1`.
   - `AssertionError: Original source root must remain 100% byte-identical`.
   - Result: Both `wsDir` and `dbDir` verified completely removed despite assertion failure. 0 temporary directories remaining in `tmpdir()`.

3. **Negative Fixture: Late Snapshot Mutation**:
   - `node packages/orchestration-core/src/cli.js demo --fault=late_snapshot_mutation`
   - Exit code: `1`.
   - `AssertionError: Snapshot workspace must remain unmodified (zero late tool effects)`.
   - Result: Both `wsDir` and `dbDir` verified completely removed despite assertion failure. 0 temporary directories remaining in `tmpdir()`.

### D. Automated Verification & Metrics

- Added 2 new tests in [`packages/orchestration-core/test/task-store.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/task-store.test.js):
  1. `SqliteTaskStore: init is idempotent and preserves single connection lifecycle`
  2. `SqliteTaskStore: store restart behavior is preserved across close and re-init`
- Added 1 new end-to-end CLI cleanup test and strengthened 3 demo tests in [`packages/orchestration-core/test/real-rct-lifecycle.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/real-rct-lifecycle.test.js):
  1. `CLI entrypoint: positive and negative runs guarantee workspace and db cleanup with zero leaked directories`
  2. Verified `existsSync(observedWs) === false` and `existsSync(observedDb) === false` on positive and both negative runs.
- **Suite Results**:
  - Command: `node --test packages/orchestration-core/test/*.test.js`
  - Total Tests: **104 passed, 0 failed, 0 skipped** across 5 test suites:
    - `dispatcher.test.js`: 26 tests (all passing)
    - `rct-conformance.test.js`: 22 tests (all passing)
    - `real-rct-lifecycle.test.js`: 17 tests (all passing)
    - `task-manager.test.js`: 23 tests (all passing)
    - `task-store.test.js`: 16 tests (all passing)
  - Exit code: `0`
  - Zero live Groq calls, zero network/env reads, strict confinement to owned paths (`packages/orchestration-core/`, `docs/execution/AGR-3.md`).

---

## 19. Bounded Review Artifact Ingestion Port & One-Use Approval Intent (Task W5-AGR3-artifact-review-port)

### A. Architectural Overview & Injected Contract Pattern
Implemented [`ReviewPort`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/review-port.js) in `packages/orchestration-core/` to consume runtime review patch exports (`rct.review_patch.v1`) through an injected contract interface (`validator`, `exporter`, `sourceRoot`, `maxBytes`):
1. **Contract Ingestion**: Consumes manifests exported by runtime's `exportReviewPatch` or conformant injected contracts.
2. **Exact Reference Binding**: Each ingested review binds exact immutable references:
   - `taskId`: Authoritative task identifier.
   - `attemptId`: Authoritative execution attempt identifier.
   - `sourceBaseline`: Exact mapping of `{ [path]: hash }` and composite baseline.
   - `patchDigest`: Deterministic SHA-256 digest of the manifest (`manifestHash`).
   - `independentVerification`: Certified verifier evidence (`verified: true`, check sha256, verifier identity).
3. **Immutable Review States**:
   - `ReviewStates`: `PENDING`, `APPROVED`, `REJECTED`, `DISCARDED`.
   - `TERMINAL_REVIEW_STATES`: `APPROVED`, `REJECTED`, `DISCARDED`.
   - Terminal states are strictly immutable; attempts to overwrite, transition, or re-approve terminal reviews are rejected.
4. **One-Use Approval Intent**:
   - `port.approve(reviewId, options)` records `Intents.APPROVE_PATCH` atomically in the `TaskStore` with operator, timestamp, and `patchDigest`.
   - Replay is blocked: an already `APPROVED` review cannot be re-approved.
5. **No Source Apply Yet**:
   - Zero modifications to `sourceRoot`. Ingestion and approval remain strictly read-only on the workspace source.

### B. Comprehensive Invariant Rejections

| Violation Category | Failure Mechanism | Test Coverage |
| :--- | :--- | :--- |
| **Worker Claimed Evidence** | Throws `Worker claim rejection` when `verified !== true`, checks are empty/failed, or completion source is worker claims alone. | `review-port.test.js` |
| **Stale Baseline (Pre-Ingestion)** | Throws `Stale baseline rejection` if workspace source on disk was modified after baseline hashes were recorded. | `review-port.test.js` |
| **Stale Baseline (Pre-Approval)** | Throws `Stale baseline rejection` if workspace source on disk was modified between ingestion and approval. | `review-port.test.js` |
| **Task / Attempt Mismatch** | Throws when manifest task ID does not exist in store, attempt does not belong to task, or attempt is not `COMPLETED`. | `review-port.test.js` |
| **Baseline Divergence** | Throws when baseline hashes in manifest diverge from task envelope's declared `sourceHashes`. | `review-port.test.js` |
| **Malformed Manifest** | Throws on non-object inputs, unsupported `schemaVersion`, tampered `manifestHash`, empty changes, or oversize bytes. | `review-port.test.js` |
| **Replay Ingestion** | Throws `Replay rejection` if a review with the same `patchDigest` is ingested for the same task attempt. | `review-port.test.js` |
| **Terminal Overwrite** | Throws `Terminal overwrite rejection` if attempting to approve, reject, or discard an already terminal review. | `review-port.test.js` |
| **One-Use Approval Replay** | Throws `One-use approval rejection` if calling `approve()` on an already `APPROVED` review. | `review-port.test.js` |

### C. Durable SQLite Storage & Restart Survival
- **Schema Migration 2**: Added `reviews` table and indexes (`idx_reviews_task_id`, `idx_reviews_attempt_id`) to [`SqliteTaskStore`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js).
- **Restart Verification**: Closing the store (`store.close()`) and re-initializing a new store on the same database file completely preserves all review records, states, patch digests, approval intents, and immutability rules across system restarts.

### D. Runtime Contract Mismatch Report (Zero Sibling Edits)
- **Observed Behavior**: In `packages/rct-runtime/src/review-patch.js`, `exportReviewPatch` outputs `task: { id, assignmentHash, objective, allowedPaths }`, omitting `attemptId` from the task block.
- **Orchestration Bridge**: `ReviewPort` handles this cleanly without editing sibling packages by accepting `options.attemptId`, binding the latest attempt from the authoritative task store, and asserting strict ownership against `task.id`.

### E. Test Suite Verification
- **Total Tests**: **115 passed, 0 failed, 0 skipped** across 6 test suites:
  - `dispatcher.test.js`: 26 tests (all passing)
  - `rct-conformance.test.js`: 22 tests (all passing)
  - `real-rct-lifecycle.test.js`: 17 tests (all passing)
  - `review-port.test.js`: 17 tests (all passing)
  - `task-manager.test.js`: 23 tests (all passing)
  - `task-store.test.js`: 16 tests (all passing)
- Command: `node --test packages/orchestration-core/test/*.test.js`
- Exit Code: `0`
- Zero live Groq calls, zero network/env reads, strict confinement to owned paths (`packages/orchestration-core/`, `docs/execution/AGR-3.md`).

---

## 20. Authoritative Review Ingestion & Atomic Approval Transaction (Task W5R-AGR3-authoritative-review-transaction)

### A. Architectural Invariants Hardened

1. **Authoritative Evidence Enforcement (Zero Trust for Worker Claims)**:
   - Worker labels (`manifest.workerClaims`), self-hashes (`manifest.manifestHash`), or client-declared `manifest.verification.verified = true` alone **never** serve as authority.
   - In [`ReviewPort.prototype.ingestReviewPatch`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/review-port.js):
     - **Eligible Verified Task/Attempt**: Both `task.state` and `attempt.state` must be strictly `States.COMPLETED`. Attempts in `SUBMITTED`, `FAILED`, `CANCELLED`, `UNKNOWN`, `RUNNING`, or `PENDING` states are immediately rejected with `Unverified attempt rejection`.
     - **Authoritative Stored Verifier Evidence**: Ingestion queries `this.store.getArtifacts(taskId)` and asserts that an artifact with `artifactType: 'verifier_evidence'` is authoritatively persisted in SQLite matching the target `attemptId`.
     - **Certified Integrity**: Asserts `verifier_evidence.metadata.verified === true`, verification checks are non-empty, and all checks passed (`c.passed === true`).
     - **Exact Assignment Digest**: Validates that `manifest.task.assignmentHash` matches `task.assignmentDigest`. Rejects omission of either with `Forged manifest rejection`.
     - **Path Scope Conformance**: Asserts all change paths in the manifest are within `task.allowedPaths`.
     - **Patch Digest Verification**: For each change, matches its `path` to a stored verifier check and enforces that `check.sha256 === change.afterSha256`. Rejects omitted check `sha256`. A forged manifest with altered patch contents or checks differing from the authoritative verifier check SHA-256 is rejected with `Forged manifest rejection`.

2. **Canonical Admitted Source Identity & Re-Rooting Prevention**:
   - **Schema Migration 2**: Added `source_root TEXT` column to the `reviews` table in [`SqliteTaskStore`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js), updated `createReview` and `_mapReviewRow` to persist and return `sourceRoot`.
   - **Canonical Ingestion Root**: Resolves admitted source identity prioritizing `task.workspaceRoot`. If `options.sourceRoot` or `this.sourceRoot` is supplied and differs from `task.workspaceRoot`, ingestion immediately throws `Source identity mismatch rejection`.
   - **Canonical Approval Root**: In [`port.approve()`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/review-port.js), the approval root is strictly resolved as `canonicalSourceRoot = review.sourceRoot || task?.workspaceRoot`. If callers provide a differing `options.sourceRoot` or the port was instantiated with a differing `this.sourceRoot`, approval strictly rejects with `Source identity mismatch rejection`.
   - **Zero Bypass via Alternate Root**: Approval freshness check **always** reads from `canonicalSourceRoot`. An operator or attacker cannot bypass stale source detection by pointing `options.sourceRoot` to a clean temporary replica while the authoritative canonical workspace contains stale/divergent mutations.
   - **Fail-Closed Missing Identity**: If no source identity exists anywhere (no `review.sourceRoot` and no `task.workspaceRoot`), approval and ingestion fail closed immediately.

3. **Zero Writes on Denial Guarantee**:
   - When approval fails or is rejected—whether due to source identity mismatch, stale baseline, unverified attempt, or missing verifier evidence—**zero database writes** occur.
   - All validation occurs strictly before opening or invoking the approval transaction:
     - `attempt.intent` remains `NONE` (no approval intent written).
     - `review.state` remains `PENDING` (no approval state transition).
     - `events` table contains **zero** `REVIEW_APPROVED` audit entries.
   - Verified via temp-filesystem negative regression test asserting exact state immutability across attempts, reviews, and events on denial.

4. **Atomic Multi-Table Approval Transaction with Rollback**:
   - Implemented [`SqliteTaskStore.prototype.finalizeReviewApproval`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js) inside `this.transaction(() => { ... })`:
     1. Records approval intent on attempt (`recordIntent(..., Intents.APPROVE_PATCH, intentData)`).
     2. Updates review state to `APPROVED` (`updateReviewState(reviewId, ReviewStates.APPROVED, ...)`).
     3. Records audit event (`recordEvent(..., 'REVIEW_APPROVED', ...)`).
   - Nested transaction support in `SqliteTaskStore` guarantees that any failure inside the block (or injected via `options._injectFailure`) issues an immediate `ROLLBACK;`, leaving **zero partial state** across attempts, reviews, and events tables.
   - Symmetrically implemented [`finalizeReviewRejection`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js) and [`finalizeReviewDiscard`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js) for atomic transitions.

5. **Zero Source Apply**:
   - Ingestion and approval remain strictly read-only on the workspace source. Workspace files remain 100% byte-identical.

---

### B. Invariant Rejection Matrix

| Violation Category | Failure Mechanism | Test Coverage |
| :--- | :--- | :--- |
| **Re-Rooting Bypass Attempt** | Throws `Source identity mismatch rejection` when `options.sourceRoot` or `this.sourceRoot` differs from canonical `review.sourceRoot`. Guarantees zero writes on denial. | `review-port.test.js` |
| **Ingestion Root Mismatch** | Throws `Source identity mismatch rejection` when ingestion `sourceRoot` differs from `task.workspaceRoot`. | `review-port.test.js` |
| **Omitted Assignment Hash** | Throws `Forged manifest rejection: Manifest omits required task.assignmentHash`. | `review-port.test.js` |
| **Omitted Baseline Hash** | Throws `Missing baseline hash: Manifest omits sourceBaseline.hashes`. | `review-port.test.js` |
| **Forged Patch Digest** | Throws `Forged manifest rejection` when manifest `afterSha256` diverges from stored verifier check `sha256`. | `review-port.test.js` |
| **Forged Assignment Digest** | Throws `Forged manifest rejection` when manifest `assignmentHash` diverges from task `assignmentDigest`. | `review-port.test.js` |
| **Unverified Attempt (`SUBMITTED`)** | Throws `Unverified attempt rejection` when attempt is in `SUBMITTED` state (worker claimed completion, no verifier ran). | `review-port.test.js` |
| **Missing Verifier Evidence** | Throws `Unverified attempt rejection` when no `verifier_evidence` artifact exists in store for attempt. | `review-port.test.js` |
| **Stale Source (Approval Fallback)** | Throws `Stale baseline rejection` when source file was mutated on disk before approval, even when `options.sourceRoot` is omitted. | `review-port.test.js` |
| **Missing Admitted Source Identity** | Throws `Missing admitted source identity (fail closed)` if `sourceRoot` and `task.workspaceRoot` are both missing. | `review-port.test.js` |
| **Partial Transaction Rollback** | Injected failure after intent or review update triggers atomic transaction rollback; attempt intent, review state, and events remain completely unchanged. | `review-port.test.js` |
| **Restart Durability** | Approved review, approval intent, source root, and audit events survive store closure and re-initialization. | `review-port.test.js` |

---

### C. Test Suite Verification & Metrics

- **Command**: `node --test packages/orchestration-core/test/*.test.js`
- **Total Tests**: **125 passed, 0 failed, 0 skipped, 0 todo** across 6 test suites:
  - `dispatcher.test.js`: 26 passed
  - `rct-conformance.test.js`: 22 passed
  - `real-rct-lifecycle.test.js`: 17 passed
  - `review-port.test.js`: 21 passed (added 10 new comprehensive tests for W5R/rework)
  - `task-manager.test.js`: 23 passed
  - `task-store.test.js`: 16 passed
- **Exit Code**: `0`
- **Duration**: ~2.9s
- **Formatting / Whitespace Check**: `git diff --check -- products/zetro/packages/orchestration-core/ products/zetro/docs/execution/AGR-3.md` passed with 0 errors.
- **Source Apply Invariant**: 0 apply operations executed. Workspace source files remain 100% byte-identical.
- **Live Provider Calls**: 0 (zero live Groq calls, zero network/env reads, strictly deterministic offline execution).
- **Final Status**: `ready_for_review`

---

## 21. Durable Read-Only RCT Worker Status Projection (Task W6-AGR3-worker-status-projection & W6R-AGR3-worker-status-hardening)

### A. Architectural Overview & Passive Query Design

Implemented [`WorkerStatusProjection`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/worker-projection.js) in `@zetro/orchestration-core` to provide a durable, read-only status projection of RCT workers for future frontend dashboards (such as `apps/control-center`) and external monitoring:
1. **Passive Query Architecture**:
   - Reuses the authoritative [`SqliteTaskStore`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js) and stored tasks, attempts, events, and verification artifacts.
   - Completely side-effect-free: reading worker status performs **zero database writes**, triggers zero task dispatches, makes zero model calls, runs zero HTTP servers, and exposes zero secrets or credentials.
2. **Exposed Public APIs**:
   - Exported from [`packages/orchestration-core/src/index.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/index.js):
     - [`WorkerStatusProjection`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/worker-projection.js) class
     - `WorkerStates` enumeration: `IDLE`, `RUNNING`, `COMPLETED`, `SUBMITTED`, `FAILED`, `INTERRUPTED`, `STALE`, `UNKNOWN`
     - `DEFAULT_HEARTBEAT_TIMEOUT_MS`: 30,000ms
     - `sanitizeSummary(value, fallback)`: Bounded string sanitizer and credential redactor
   - Integrated into [`TaskManager`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-manager.js):
     - `taskManager.getWorkerStatus(workerId, options)`
     - `taskManager.listWorkerStatuses(options)`
3. **Compact Safe Status Object**:
   - Every projected worker status contains strictly sanitized, safe fields:
     - `workerId`: Stable worker slot or agent identifier (e.g. `'RCT-1'`, `'worker-rct-1'`).
     - `taskId`: Active or latest task ID, or `null` if unassigned.
     - `attemptId`: Active or latest attempt ID, or `null`.
     - `state`: Current projected state (`WorkerStates`).
     - `phase`: Compact descriptive phase (e.g. `'unassigned'`, `'awaiting_dispatch'`, `'awaiting_attempt'`, `'executing'`, `'verified_completed'`, `'unverified_worker_claim'`, `'execution_failed'`, `'cancelled'`, `'crash_reconciled'`, `'heartbeat_timeout'`).
     - `verified`: Boolean flag (`true` strictly and only when certified by authoritative stored independent verification).
     - `lastEventSequence`: Monotonic integer sequence ID from SQLite `events` table (or `null` if no events).
     - `lastTimestamp`: Epoch ms timestamp of latest activity, event, or heartbeat.
     - `heartbeat`: `{ lastHeartbeatAt, stale, timeoutMs }` liveness metadata.
     - `error`: Bounded, sanitized error summary string or `null`.
     - `uncertainty`: Bounded, sanitized cancellation or crash recovery summary string or `null`.
   - **Zero Secret Leakage**: API keys, auth tokens, model prompts, file system paths, and raw execution payloads are strictly redacted and bounded.

---

### B. Reviewer Feedback Invariants Hardened (Rework W6R)

1. **Exact Attempt Identity Certification (Zero Trust for Foreign or Partial Claims)**:
   - Ingestion and projection of verifier evidence for attempt certification **never** certifies with `attemptId: null`, missing, or foreign attempts.
   - Requires BOTH `task.state === States.COMPLETED` AND `latestAttempt.state === States.COMPLETED`. Attempts or tasks in `RUNNING`, `FAILED`, `CANCELLED`, or `SUBMITTED` states fail certification closed.
   - Enforces exact stored artifact attempt identity: `artifact.attemptId === targetAttemptId` and `artifact.metadata?.attemptId === targetAttemptId`.
   - Validates meaningful independently checked identity fields consistent with authoritative verifier artifacts:
     - Strict boolean `metadata.verified === true`.
     - Non-empty `metadata.verifier` string identifier.
     - Non-empty `metadata.checks` array.
     - Every check object must contain a non-empty `path`, strict boolean `passed === true`, and a valid 64-character hex SHA-256 digest matching `/^[a-f0-9]{64}$/i`. Missing paths, malformed hashes, or empty check objects reject certification and downgrade to `WorkerStates.SUBMITTED` (`unverified_worker_claim`).

2. **Exact Heartbeat & Attempt Identity Filtering (Trusted SQLite Timestamps)**:
   - Filters events strictly to the target attempt (`e.attemptId === targetAttemptId`). Heartbeats on foreign attempts (`OTHER`) are strictly isolated and never prevent the active attempt from becoming `STALE`.
   - Enforces trusted SQLite store timestamps: reads authoritative `e.timestamp` from the database. Strictly rejects caller payload freshness (`e.payload.timestamp`).
   - Filters and rejects future timestamps (`e.timestamp > now`) and non-finite timestamps (`NaN`, `Infinity`).

3. **Sanitize Bounded Allowlisted Summaries**:
   - Implemented `sanitizeSummary(value, fallback = null)` in [worker-projection.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/worker-projection.js).
   - Redacts sensitive credentials including Groq keys (`gsk_...`), Anthropic/OpenAI keys (`sk-...`), Bearer tokens (`Bearer ...`), and generic auth/secret patterns.
   - Redacts absolute Windows drive paths (`C:\...`, `E:\...`), Unix paths (`/...`), and file URLs (`file:///...`).
   - Strips multi-line stack traces, retaining only the clean single-line error message.
   - Bounds the sanitized summary length strictly to `<= 256` characters.

4. **Negative Probes & SQLite Regression Test Suite**:
   - **Probe 1**: Null, foreign, or malformed attempt evidence must never certify attempt (proves null `attemptId`, foreign `attemptId`, blank verifier, missing path, non-hex sha256, and uncompleted task fail closed).
   - **Probe 2**: Foreign attempt heartbeat and future/nonfinite timestamps must never prevent staleness (proves foreign attempt heartbeats do not reset timeout, and future/non-finite timestamps are rejected).
   - **Probe 3**: Raw error and uncertainty containing secrets or paths are bounded and sanitized (proves Groq keys, Bearer tokens, Windows/Unix paths, file URLs, and multi-line stack traces are redacted to `[REDACTED]` and length bounded).
   - **Standalone Unit**: Verifies `sanitizeSummary` null/empty handling, clean string preservation, regex redactions, and 256-character truncation.

---

### C. Invariant Rejection & Enforcement Matrix

| Invariant | Enforcement Mechanism | Test Coverage |
| :--- | :--- | :--- |
| **Running Requires Active Attempt** | Task assignment (`PENDING`) or acknowledgment (`TASK_ACKNOWLEDGED`) alone NEVER marks worker as `RUNNING`. An active attempt in `States.RUNNING` with `finishedAt == null` is strictly required. | `worker-projection.test.js` |
| **Missing Heartbeat Stale / Unknown** | If an active attempt exceeds `heartbeatTimeoutMs` without an attempt event or heartbeat pulse, it transitions to `WorkerStates.STALE` (`phase: 'heartbeat_timeout'`). | `worker-projection.test.js` |
| **Foreign Heartbeat Isolation** | Heartbeats on foreign attempts (`OTHER`) are strictly filtered out and never prevent active attempt staleness. | `worker-projection.test.js` (Negative Probe 2) |
| **Trusted Store Timestamps** | Timestamps must come from SQLite `e.timestamp` (`<= now`). Future, non-finite, or caller payload timestamps are strictly rejected. | `worker-projection.test.js` (Negative Probe 2) |
| **Failed vs Interrupted Distinct** | Test failure or execution error projects as `WorkerStates.FAILED`. Cancellation (`CANCELLED`) and crash reconciliation (`UNKNOWN`) project distinctly as `WorkerStates.INTERRUPTED`. | `worker-projection.test.js` |
| **Authoritative Verification Required** | Both task and attempt must be `COMPLETED`, with stored `verifier_evidence` matching `targetAttemptId`, non-empty `verifier`, valid checks with path, `passed: true`, and 64-char hex `sha256`. | `worker-projection.test.js` (Negative Probe 1) |
| **Bounded Sanitized Summaries** | Error and uncertainty strings are stripped of multi-line stack traces, redacted of API keys/tokens/paths/file URLs, and bounded to `<= 256` characters. | `worker-projection.test.js` (Negative Probe 3 & Unit) |
| **Partitioned Multi-Worker Isolation** | Multiple concurrent workers (`RCT-1` through `RCT-5`) are strictly partitioned by `workerId`. Events or attempts on one worker never alter another worker's projection. | `worker-projection.test.js` |
| **Stale Event Monotonicity** | Out-of-order or older events from previous attempts never regress `lastEventSequence` or override newer active attempt states. | `worker-projection.test.js` |
| **Durable SQLite Restart Survival** | Database closure and reopening with a fresh store instance preserves 100% of worker projections, states, and event sequences. | `worker-projection.test.js` |

---

### D. Frontend Integration Instructions

For `apps/control-center` or any external dashboard service connecting to `@zetro/orchestration-core`:

```javascript
import { SqliteTaskStore, WorkerStatusProjection, sanitizeSummary } from '@zetro/orchestration-core';

// 1. Initialize store connection (points to shared tasks.db)
const store = new SqliteTaskStore('./tasks.db');
await store.init();

// 2. Instantiate read-only projection (customizable heartbeat threshold, default 30s)
const projection = new WorkerStatusProjection(store, { heartbeatTimeoutMs: 30000 });

// 3. Query all known RCT worker slots
const rctWorkers = projection.listWorkerStatuses({
  knownWorkerIds: ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5']
});

// Example output format for Control Center:
// [
//   {
//     workerId: 'RCT-1',
//     taskId: 'task-calc-1',
//     attemptId: 'task-calc-1-att-1',
//     state: 'running',
//     phase: 'executing',
//     verified: false,
//     lastEventSequence: 14,
//     lastTimestamp: 1792220530000,
//     heartbeat: { lastHeartbeatAt: 1792220530000, stale: false, timeoutMs: 30000 },
//     error: null,
//     uncertainty: null
//   },
//   {
//     workerId: 'RCT-2',
//     taskId: 'task-auth-2',
//     attemptId: 'task-auth-2-att-1',
//     state: 'completed',
//     phase: 'verified_completed',
//     verified: true,
//     lastEventSequence: 28,
//     lastTimestamp: 1792220525000,
//     heartbeat: { lastHeartbeatAt: 1792220525000, stale: false, timeoutMs: 30000 },
//     error: null,
//     uncertainty: null
//   },
//   {
//     workerId: 'RCT-3',
//     taskId: null,
//     attemptId: null,
//     state: 'idle',
//     phase: 'unassigned',
//     verified: false,
//     lastEventSequence: null,
//     lastTimestamp: null,
//     heartbeat: { lastHeartbeatAt: null, stale: false, timeoutMs: 30000 },
//     error: null,
//     uncertainty: null
//   }
// ]

// Or integrate directly via TaskManager:
const status = taskManager.getWorkerStatus('RCT-1');
const allStatuses = taskManager.listWorkerStatuses({ knownWorkerIds: ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5'] });
```

---

### E. Test Suite Verification & Metrics

- **Command**: `node --test packages/orchestration-core/test/*.test.js`
- **Total Tests**: **138 passed, 0 failed, 0 skipped, 0 todo** across 7 test suites:
  - `dispatcher.test.js`: 26 passed
  - `rct-conformance.test.js`: 22 passed
  - `real-rct-lifecycle.test.js`: 17 passed
  - `review-port.test.js`: 21 passed (source-review fix 100% intact)
  - `task-manager.test.js`: 23 passed
  - `task-store.test.js`: 16 passed
  - `worker-projection.test.js`: 13 passed (9 baseline + 4 negative regression probes and units)
- **Exit Code**: `0`
- **Duration**: ~3.0s
- **Formatting / Whitespace Check**: `git diff --check -- packages/orchestration-core/ docs/execution/AGR-3.md` passed with 0 errors.
- **Source Apply Invariant**: 0 apply operations executed. Workspace source files remain 100% byte-identical.
- **Provider Calls**: 0 live Groq calls, zero network/env reads, strictly deterministic offline execution.

---

## 8. Runtime Workspace Admission & Execution Identity Integration (W7-AGR3-runtime-admission-integration)

### A. Architectural Context & Invariants Enforced

In this work package, `@zetro/orchestration-core` (`RealRctAdapter` and `TaskManager`) was integrated with `createWorkspaceAdmission` and `executionIdentity` (`@zetro/protocol` / `@zetro/rct-runtime`), enforcing authoritative bindings and fail-closed security invariants:

1. **Authoritative Cryptographic Binding**:
   - `createWorkspaceAdmission` and `validateExecutionIdentity` are generated and validated from authoritative persisted tasks, attempts, and actual workspace directories.
   - `canonicalRoot` is bound strictly to the private isolated snapshot directory (`snapshot.root`), and `sourceBaselineRoot` is bound to the canonical workspace source repository.
   - The contract binds exact composite/scalar `sourceBaselineHash`, exact declared path scopes (`readPaths`, `writePaths`, `createPaths`), `taskId`, `attemptId`, and `workspaceId`.
   - The cryptographic `admissionDigest` (SHA-256) is generated, verified, and persisted into the durable SQLite `artifacts` table as `artifactType: 'workspace_admission'` with URI `evidence/${taskId}-admission.json`.
   - A `WORKSPACE_ADMISSION_VERIFIED` event is logged in the SQLite `events` audit table upon verified receipt.

2. **Hostile Option Rejection & Strict Fail-Closed Execution**:
   - Execution identity and admission parameters are NEVER accepted from untrusted worker claims or overridable `runtimeOptions`.
   - `RESERVED_RUNTIME_OPTIONS` (`workspaceAdmission`, `admission`, `executionIdentity`, `taskId`, `attemptId`, `workspaceId`, `sourceRoot`, `sourceBaselineRoot`, `canonicalRoot`, `signal`, `abortSignal`, `policyPort`, `authority`, `policyService`) are stripped from `this.runtimeOptions` before invoking `runAssignment()`.
   - Any conflicting or hostile options (e.g. attempting to override `sourceRoot`, `sourceBaselineRoot`, `canonicalRoot`, `taskId`, or `attemptId`) immediately fail closed with an explicit mismatch error.
   - Fail-closed rejections occur **prior to model provider dispatch**, guaranteeing exactly **0 provider calls** and **0 tool effects** on disk.

3. **Shared RctPolicyPort Integration**:
   - `RealRctAdapter` and `TaskManager` accept an injected shared `RctPolicyPort` (from `@zetro/policy`) and `authority` evaluator.
   - If `trustedPolicyPort` is provided without an attached admission, `RealRctAdapter` binds `trustedPolicyPort.admittedWorkspace = admission`, `admittedWorkspaceRoot = admission.canonicalRoot`, and `admittedSourceBaselineRoot = admission.sourceBaselineRoot`.
   - If `trustedPolicyPort.admittedWorkspace` is already bound, matching `taskId` and `attemptId` are validated; mismatches are rejected.
   - Worker claims cannot fabricate authority; hostile attempts to inject worker authority via `runtimeOptions` are stripped and rejected.

4. **Preservation of Existing Gates**:
   - Cancellation signals (`AbortController` / `AbortSignal`) and dual inspection barriers remain 100% active.
   - Accounting limits (tokens, turns, characters, wall-clock time) and independent verifier verification gates remain fully intact.
   - ReviewPort ingestion, manifest validation, and atomic transaction gates remain untouched.

---

### B. Implementation Details

- **`packages/orchestration-core/src/real-rct-adapter.js`**:
  - Imported `createWorkspaceAdmission`, `validateWorkspaceAdmission`, and `validateExecutionIdentity` from `../../rct-runtime/src/index.js`, and `RctPolicyPort` from `../../policy/src/index.js`.
  - Defined `RESERVED_RUNTIME_OPTIONS` set to prevent caller options pollution.
  - In `execute()`:
    - Derives authoritative `taskId`, `attemptId`, and `workspaceId`; rejects conflicting overrides in `runtimeOptions` or `optionsOrSignal.executionIdentity`.
    - Validates source root and snapshot roots; prevents hostile `canonicalRoot` re-rooting.
    - Creates or validates `WorkspaceAdmission` with digest verification and scope coverage check.
    - Injects `workspaceAdmission`, `executionIdentity`, and `trustedPolicyPort` into `runAssignment()`.
    - Returns conformant `TaskReceipt` containing `workspaceAdmission` and `executionIdentity`.
- **`packages/orchestration-core/src/task-manager.js`**:
  - Accepts injected `options.policyPort` and `options.authority` in constructor.
  - In `run()`: derives `attemptId` and `workspaceId`. Inside attempt lifecycle, validates incoming `options.workspaceAdmission` and `options.executionIdentity` against authoritative attempt identity; stale or mismatched attempts fail closed with zero provider calls.
  - Passes full context (`signal`, `taskId`, `attemptId`, `workspaceId`, `store`, `policyPort`, `authority`) to adapter.
  - Persists `workspace_admission` artifact into SQLite `artifacts` table and logs `WORKSPACE_ADMISSION_VERIFIED` event.
- **`packages/orchestration-core/src/rct-conformance-fixture.js`**:
  - Enhanced `FakeRctAdapter.prototype.execute` to handle both `AbortSignal` and options object containing `signal` or `abortSignal`.
- **`packages/orchestration-core/src/demo.js`**:
  - Updated artifact count verification to `>= 3` and verified `workspace_admission` artifact presence and `admissionDigest`.

---

### C. Test Suite Verification & Metrics

- **Command**: `node --test packages/orchestration-core/test/*.test.js`
- **Total Tests**: **143 passed, 0 failed, 0 skipped, 0 todo** across 7 test suites:
  - `dispatcher.test.js`: 26 passed
  - `rct-conformance.test.js`: 22 passed
  - `real-rct-lifecycle.test.js`: **22 passed** (5 new integration tests added)
    1. *Authoritative Admission & Identity: End-to-end run, status, evidence, and SQLite restart survival*
    2. *Authoritative Admission: Mismatched attempt or stale attempt denied with 0 provider calls and 0 tool effects*
    3. *Authoritative Admission: Wrong source or root overrides fail closed with 0 provider calls*
    4. *Authoritative Admission: Tampered admissionDigest or outside-scope paths fail closed before provider*
    5. *Authoritative Admission: Shared RctPolicyPort with trusted grant authority authorizes execution and rejects ungranted tools*
  - `review-port.test.js`: 21 passed
  - `task-manager.test.js`: 23 passed
  - `task-store.test.js`: 16 passed
  - `worker-projection.test.js`: 13 passed
- **Exit Code**: `0`
- **Duration**: ~3.3s
- **Formatting / Whitespace Check**: `git diff --check -- packages/orchestration-core/ docs/execution/AGR-3.md` passed with 0 errors.
- **Provider Calls**: 0 live Groq calls, zero live network requests, strictly deterministic offline execution.
- **Final Status**: `ready_for_review`

---

### D. Remaining Persistent-Service Integration Note

As requested by Coordinator Codex, remaining persistent-service integration points are documented separately:
1. **Background Service Lifecycle**: Running `TaskManager` as a standing daemon/service (e.g. within an RPC/IPC worker process or Electron background thread) with automatic reconnection to an active PolicyService daemon.
2. **Persistent Lease / Admission Revocation**: Propagating real-time admission invalidation signals from a coordinator daemon down to running worker attempts via shared IPC signals.
3. **Control Center Direct Binding**: Hooking the `WorkerStatusProjection` and `workspace_admission` artifacts into the Control Center desktop UI for real-time cryptographic audit trail visualization.

---

## 9. Explicit Read-Only SqliteTaskStore & WorkerStatusProjection Support (W8-AGR3-readonly-store-projection)

### A. Architectural Context & Invariants Enforced

To allow actual desktop frontends (such as `@zetro/control-center`), external CLI monitors, and auditing tools to observe live SQLite RCT execution states without causing database creation, locking contention, schema mutation, or corrupting lifecycle state, explicitly read-only support was implemented in `@zetro/orchestration-core`:

1. **Existing Database Path REQUIRED**:
   - `SqliteTaskStore.openReadOnly(dbPath)` and `new SqliteTaskStore(dbPath, { readOnly: true })` strictly require an existing on-disk database file path.
   - Non-existent database files fail closed immediately: `Read-only SQLite database file does not exist: '<path>'`.
   - Absent paths remain strictly absent on disk: zero directories (`mkdir`) and zero database files are created.
   - In-memory database paths (`:memory:`) or empty paths are rejected in read-only mode.

2. **Zero Database Modifications, PRAGMA Writes, or Checkpoints**:
   - The underlying SQLite connection is opened via `node:sqlite`'s `DatabaseSync(dbPath, { readOnly: true })`.
   - Never runs `PRAGMA journal_mode = WAL`, never executes checkpoints, never modifies DB headers.
   - Safely executes read-only setup (`PRAGMA foreign_keys = ON;`).
   - Database file SHA-256 hash, byte size, and `mtime` are guaranteed to remain 100% byte-identical before and after read-only queries.

3. **Strict Fail-Closed Schema Verification**:
   - `_validateReadOnlySchema()` inspects the existing database in read-only mode prior to allowing queries:
     - Verifies all required tables (`schema_migrations`, `tasks`, `attempts`, `events`, `artifacts`, `reviews`) exist in `sqlite_master`.
     - Verifies `schema_migrations` has reached expected current version (`version >= 2`).
     - Verifies required columns (such as `source_root` in `reviews`) are present.
   - If the schema is missing or incompatible, the connection is closed and throws fail-closed errors without touching the database.

4. **Rejection of All Mutating APIs in Read-Only Mode**:
   - All 16 mutating methods in `SqliteTaskStore` are guarded by `_assertWritable()` and throw fail-closed errors:
     - `transaction()`: `Cannot execute transaction in read-only SqliteTaskStore`
     - `createTask()`: `Cannot create task in read-only SqliteTaskStore`
     - `updateTaskState()`: `Cannot update task state in read-only SqliteTaskStore`
     - `createAttempt()`: `Cannot create attempt in read-only SqliteTaskStore`
     - `updateAttemptState()`: `Cannot update attempt state in read-only SqliteTaskStore`
     - `recordIntent()`: `Cannot record intent in read-only SqliteTaskStore`
     - `finalizeTaskAttempt()`: `Cannot finalize task attempt in read-only SqliteTaskStore`
     - `cancelTaskAttempt()`: `Cannot cancel task attempt in read-only SqliteTaskStore`
     - `recordEvent()`: `Cannot record event in read-only SqliteTaskStore`
     - `recordArtifact()`: `Cannot record artifact in read-only SqliteTaskStore`
     - `reconcileInterruptedWork()`: `Cannot reconcile interrupted work in read-only SqliteTaskStore`
     - `createReview()`: `Cannot create review in read-only SqliteTaskStore`
     - `updateReviewState()`: `Cannot update review state in read-only SqliteTaskStore`
     - `finalizeReviewApproval()`: `Cannot finalize review approval in read-only SqliteTaskStore`
     - `finalizeReviewRejection()`: `Cannot finalize review rejection in read-only SqliteTaskStore`
     - `finalizeReviewDiscard()`: `Cannot finalize review discard in read-only SqliteTaskStore`
   - `WorkerStatusProjection.prototype.recordHeartbeat()` similarly fails closed when backed by a read-only store.

5. **Frontend Projection & TaskManager Observer Support**:
   - Exposes `WorkerStatusProjection.openReadOnly(dbPath, options)` as a clean one-liner for frontends.
   - Exposes `SqliteTaskStore.openReadOnly(dbPath, options)` and `store.createWorkerStatusProjection()`.
   - `TaskManager.prototype.init()` detects read-only stores and skips `reconcileInterruptedWork()`, allowing `TaskManager` to be used in pure observer mode (`status`, `events`, `evidence`, `getWorkerStatus`, `listWorkerStatuses`).
   - Bounded knownworker projections (`listWorkerStatuses({ knownWorkerIds: [...] })`) operate purely in memory over read queries.

---

### B. Exact Public Usage Example for Frontend

```javascript
import { WorkerStatusProjection, SqliteTaskStore, TaskManager } from '@zetro/orchestration-core';

// Option 1: Direct one-liner projection for desktop dashboard
const projection = await WorkerStatusProjection.openReadOnly('path/to/tasks.db', {
  heartbeatTimeoutMs: 30000
});

// Bounded projection across known RCT slots (zero DB writes, zero locks)
const workerStatuses = projection.listWorkerStatuses({
  knownWorkerIds: ['RCT-1', 'RCT-2', 'RCT-3', 'RCT-4', 'RCT-5']
});
console.log(workerStatuses);

// Cleanup when dashboard unmounts or closes
projection.close();

// Option 2: Full observer TaskManager
const readOnlyStore = await SqliteTaskStore.openReadOnly('path/to/tasks.db');
const manager = new TaskManager(readOnlyStore, null);
await manager.init(); // Skips crash reconciliation, zero DB writes

const taskStatus = manager.status('task-123');
const auditEvents = manager.events('task-123');
const artifacts = manager.evidence('task-123');
readOnlyStore.close();
```

---

### C. Test Suite Verification & Metrics

- **Command**: `node --test packages/orchestration-core/test/*.test.js`
- **Total Tests**: **150 passed, 0 failed, 0 skipped, 0 todo** across 8 test suites:
  - `dispatcher.test.js`: 26 passed
  - `rct-conformance.test.js`: 22 passed
  - `real-rct-lifecycle.test.js`: 22 passed
  - `readonly-task-store.test.js`: **7 passed** (dedicated read-only integration suite)
    1. *Reopen existing DB, verify correct WorkerStatusProjection, and assert 100% byte & mtime immutability*
    2. *WorkerStatusProjection.openReadOnly: One-liner convenience factory for frontend observation*
    3. *Non-existent database path fails closed without creating files or directories*
    4. *:memory: and invalid paths rejected in read-only mode*
    5. *Incompatible or missing schema fails closed without modification*
    6. *ALL mutating methods strictly reject with zero DB writes*
    7. *TaskManager: Initialized with read-only store operates in observer mode without reconcile writes*
  - `review-port.test.js`: 21 passed
  - `task-manager.test.js`: 23 passed
  - `task-store.test.js`: 16 passed
  - `worker-projection.test.js`: 13 passed
- **Exit Code**: `0`
- **Duration**: ~3.5s
- **Formatting / Whitespace Check**: `git diff --check -- packages/orchestration-core/ docs/execution/AGR-3.md` passed with 0 errors.
- **Provider Calls**: 0 live Groq calls, zero live network requests, strictly deterministic offline execution.
- **Final Status**: `ready_for_review`

---

### D. Pending Persistent-Service Integration Note

As requested, remaining persistent-service lifecycle items are explicitly reported:
1. **Desktop Process Boundary**: Spawning or connecting `WorkerStatusProjection.openReadOnly()` within the Electron main process or a background IPC worker to stream real-time JSON updates to the Control Center frontend UI.
2. **File Change / WAL Reactive Polling**: Listening to SQLite file system change notifications or timer heartbeats in the frontend to trigger `listWorkerStatuses()` refresh without holding persistent file locks.
3. **Standing Service Coordination**: Automatic handoff between writer services (orchestration coordinator) and reader services (frontend viewers) across system restarts.

---

## 19. Persistent Single-Worker Offline RCT Host CLI (Task W9-AGR3-rct-host-cli / W9R-AGR3-lease-guard)

### A. Core Architecture & Invariant Enforcement

Implemented `RctHost` ([rct-host.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/rct-host.js)) and updated the CLI entrypoint ([src/cli.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/cli.js)) to provide an offline, single-worker execution and query interface backed by durable SQLite storage:

1. **Explicit Selected Data Directory & Database Retention**:
   - Accepts `--data-dir <dir>` (resolving to `<dir>/tasks.db`) or `--db <path>`.
   - SQLite database file is **retained on disk upon process exit** (unlike ephemeral demo cleanup), allowing the desktop frontend (`@zetro/control-center`) and external processes to inspect task receipts, worker projections, and audit logs without running an active coordinator.
   - Database location is strictly explicit; omitting both `--data-dir` and `--db` throws:
     `Explicit database location required: specify either --data-dir <dir> or --db <path>`.

2. **Zero HTTP/Network Listeners or Autostart Services**:
   - Pure CLI command and library execution model.
   - Zero background daemons, zero HTTP/WebSocket ports, zero network sockets, and zero autostart background processes.

3. **Offline / Synthetic Fixture Only**:
   - Model execution runs through deterministic synthetic fixtures (`createSyntheticFixtureProvider`).
   - Live model provider calls disabled (0 Groq/OpenAI calls).
   - Source code apply is unavailable; isolated snapshot mechanism guarantees original workspace source root remains 100% byte-identical and unmodified.

4. **Complete Subcommand Suite Supported**:
   - `run [envelope]`: Dispatches `TaskEnvelope` offline on worker slot `RCT-1`. Retains database upon completion.
   - `status [taskId]`: Queries task execution state in strictly read-only mode.
   - `events [taskId]`: Queries full audit event trail in strictly read-only mode.
   - `evidence [taskId]`: Queries execution artifacts and verifier evidence in strictly read-only mode.
   - `worker-status [workerId]`: Queries `WorkerStatusProjection` (default: `RCT-1`) in strictly read-only mode.
   - `cancel [taskId]`: Transactionally cancels an active or queued task in the database.
   - `reconcile`: Explicitly triggers crash reconciliation of interrupted in-flight attempts.
   - `demo`: Retains backward-compatible offline lifecycle demonstration.
   - `help`: Formatted CLI usage documentation.

5. **Strictly Read-Only Observer Invariants**:
   - `status`, `events`, `evidence`, and `worker-status` open the database via `SqliteTaskStore.openReadOnly(dbPath)` / `WorkerStatusProjection.openReadOnly(dbPath)` using Node's `DatabaseSync(dbPath, { readOnly: true })`.
   - Fails closed immediately if database path does not exist on disk (zero files or directories created).
   - Never triggers schema migrations, PRAGMA WAL writes, checkpoints, or startup crash reconciliations.
   - Asserts 100% byte and `mtime` immutability of the SQLite database file before and after queries.

6. **Single Dedicated Worker Slot (`RCT-1`), Durable Transactional Lease Guard & Invocation Fencing Token**:
   - Host is dedicated to worker `RCT-1`. Envelopes targeting other workers are rejected.
   - Enforces cross-process transactional single-worker capacity constraint via `worker_leases` table in SQLite (`worker_id PRIMARY KEY, owner_id, task_id, attempt_id, invocation_token, acquired_at, heartbeat_at, lease_ttl_ms, released_at`).
   - **Invocation Fencing Token**: Each lease acquisition assigns an unguessable unique `invocation_token` (`randomUUID()`). Lease release and renewal operations are bound to this invocation token; a duplicate call or usurper cannot renew or release a live invocation's lease.
   - **Local In-Flight Guard**: `RctHost.runTask()` validates `this._activeInvocation` immediately upon dispatch, rejecting duplicate calls before any lease or timer operations, ensuring rejected dispatches never trigger `finally` release blocks on active runs.
   - Before dispatching work, `acquireWorkerLease()` atomically acquires the lease and verifies that no other live host holds the slot and no unclosed active attempt exists in `attempts` table.
   - Periodic heartbeat renewal maintains lease validity; lease is atomically released upon attempt finalization or cancellation.
   - Stale telemetry **never** frees the slot: unclosed active attempts strictly block new dispatches until explicitly reconciled.

7. **Immediate Abort on Lease Renewal Failure (Anti Split-Brain)**:
   - If `renewWorkerLease()` fails (returns `false` or throws due to lost, usurped, or mismatched lease token), the host immediately calls `runAbortController.abort()` and cancels the active task attempt via `this.manager.cancel(envelope.id, { reason: 'Worker lease renewal failed: lease lost' })`.
   - Execution is halted immediately to eliminate split-brain write hazards.

8. **Graceful Restart, Live Writer Protection & Explicit Reconciliation**:
   - Restart recovery has explicit lease ownership and expiry semantics that **cannot reconcile a live writer**.
   - During `reconcileInterruptedWork()`, active writer leases with fresh heartbeats are strictly preserved.
   - Interrupted in-flight attempts from crashed or abandoned hosts are explicitly reconciled to `States.UNKNOWN` with explanation `Interrupted in-flight during crash/restart`.
   - Reconciled tasks are strictly quarantined with zero duplicate dispatch or retry.
   - Worker projection transitions to `WorkerStates.INTERRUPTED` until cleared.

9. **True Cross-Process Concurrency & Lifecycle Guard**:
   - Validated across spawned OS child processes ([writer-subprocess.js](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/helpers/writer-subprocess.js)) targeting the same on-disk SQLite database and worker `RCT-1`.
   - Synchronized through explicit finite IPC and file barriers (`*.entered`, `*.release`, `*.abort`, `*.error`).
   - Proves only 1 physical provider enters; the second spawned writer is denied immediately with single-worker capacity guard / active lease held error (0 provider calls).
   - Proves workspace source files remain 100% byte-identical.
   - Proves read-only status correctly projects live active task state (`RUNNING`).
   - Proves explicit recovery while a writer subprocess is alive is rejected (`reconciledTaskIds: []`), leaving the active writer undisturbed.
   - Proves killing the writer subprocess (crash simulation) keeps the slot occupied until the lease TTL expires; subsequent recovery safely reconciles the orphaned attempt to `UNKNOWN` (`Interrupted in-flight during crash/restart`) and frees the worker slot for subsequent runs.
   - Proves usurping the lease token in SQLite triggers immediate abort of active execution to `CANCELLED` during heartbeat renewal (anti split-brain).
   - Safe child cleanup in `finally` guarantees zero orphan processes or hangs.

10. **Persistent Offline Synthetic Demo via CLI**:
   - `node packages/orchestration-core/src/cli.js demo --data-dir <dir> --json` executes the full offline lifecycle demo (both verified completion and cancel barrier scenarios), retains `tasks.db` on disk upon completion, and allows desktop frontends to immediately inspect task receipts, audit events, and worker projections.

11. **Frontend Persistence Bridge Contract (`status-snapshot`)**:
   - Small read-only CLI command: `node packages/orchestration-core/src/cli.js status-snapshot --db <explicitpath>`.
   - Returns structured JSON snapshot for frontend desktop dashboard consumption:
     - `schemaVersion`: 1
     - `observedAt`: ISO 8601 timestamp string
     - `databasePath`: Target SQLite database path
     - `connected`: Boolean connection state
     - `status`: `'connected'` | `'disconnected'` | `'error'`
     - `workers`: Projections for known worker slots (`RCT-1`, `RCT-2`, `RCT-3`, `RCT-4`, `RCT-5`) via `WorkerStatusProjection`
     - `recentEvents`: Bounded recent audit events (max 100) with sanitized payloads (secrets, absolute paths, and stack traces redacted via `sanitizeSummary`)
     - `artifacts`: Bounded safe artifact summaries (max 100) omitting raw source code
   - Strictly read-only: zero database creation, zero table migrations, zero PRAGMA WAL writes, zero crash reconciliations, zero model provider calls, and zero source code modifications.
   - Missing paths fail closed honestly without creating any files or directories.
   - Preserves 100% byte and `mtime` immutability of the SQLite database.

---

### B. Command-Line Reference & Frontend Usage Contracts

#### 1. CLI Commands

```bash
# Frontend persistence bridge snapshot (returns known workers RCT-1..5 + bounded events + safe artifacts)
node packages/orchestration-core/src/cli.js status-snapshot --db ./my-data/tasks.db

# Execute complete offline lifecycle demo and retain SQLite database in specified directory
node packages/orchestration-core/src/cli.js demo --data-dir ./my-data --json

# Execute task offline with persistent database retention
node packages/orchestration-core/src/cli.js run ./envelope.json --data-dir ./my-data --json

# Query task status in strictly read-only mode (zero DB writes, zero locks)
node packages/orchestration-core/src/cli.js status task-123 --data-dir ./my-data --json

# Query audit event log in strictly read-only mode
node packages/orchestration-core/src/cli.js events task-123 --data-dir ./my-data --json

# Query evidence and verifier artifacts in strictly read-only mode
node packages/orchestration-core/src/cli.js evidence task-123 --data-dir ./my-data --json

# Query worker status projection in strictly read-only mode
node packages/orchestration-core/src/cli.js worker-status RCT-1 --data-dir ./my-data --json

# Cancel active task in persistent database
node packages/orchestration-core/src/cli.js cancel task-123 --data-dir ./my-data --reason "Operator cancelled" --json

# Reconcile crashed attempts
node packages/orchestration-core/src/cli.js reconcile --data-dir ./my-data --json
```

#### 2. Persistent Database Integration Contract for `@zetro/control-center`

The desktop control center frontend can directly observe the persistent database without any running backend coordinator:

```javascript
import { WorkerStatusProjection, SqliteTaskStore, RctHost } from '@zetro/orchestration-core';

// 1. One-liner frontend persistence bridge snapshot
const snapshot = await RctHost.getStatusSnapshot('path/to/my-data/tasks.db');
console.log(snapshot.workers); // Projections for RCT-1 through RCT-5
console.log(snapshot.recentEvents); // Bounded sanitized events
console.log(snapshot.artifacts); // Safe artifact summaries

// 2. Direct read-only worker projection
const projection = await WorkerStatusProjection.openReadOnly('path/to/my-data/tasks.db');
const status = projection.getWorkerStatus('RCT-1');
console.log(status);
// { workerId: 'RCT-1', state: 'idle', taskId: null, attemptId: null, phase: 'unassigned' }
projection.close();

// 3. Direct read-only task status query
const store = await SqliteTaskStore.openReadOnly('path/to/my-data/tasks.db');
const task = store.getTask('task-123');
const attempt = store.getLatestAttempt('task-123');
const artifacts = store.getArtifacts('task-123');
store.close();
```

---

### C. Test Suite Verification & Metrics

- **Command**: `node --test packages/orchestration-core/test/rct-host-cli.test.js`
- **Total Tests**: **22 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**:
  - `rct-host-cli.test.js`: **22 passed** (spawned CLI and cross-process subprocess integration suite)
    1. *CLI help: prints usage instructions and exits 0*
    2. *CLI run: executes TaskEnvelope offline on single worker RCT-1, retains tasks.db on disk, produces COMPLETED with verifier evidence*
    3. *CLI status: queries retained tasks.db in strictly read-only mode, preserves byte & mtime immutability*
    4. *CLI events: queries audit event trail in strictly read-only mode*
    5. *CLI evidence: retrieves verifier evidence and artifacts in read-only mode*
    6. *CLI worker-status: queries single-worker status projection in read-only mode*
    7. *CLI cancel: cancels active task in persistent DB and transitions state*
    8. *CLI crash recovery: reconciles interrupted in-flight attempts on startup with zero duplicate dispatch*
    9. *Single-worker capacity constraint: rejects concurrent dispatch when worker slot is busy*
    10. *Two-host same-SQLite overlapping provider barrier: proves at most 1 physical provider runs*
    11. *Stale-running attempt negative test: stale telemetry never means slot free*
    12. *Concurrent run admission: separate host init protects live writer from auto-reconciliation*
    13. *Live lease safety: duplicate call cannot release live lease and explicit recovery cannot disrupt original*
    14. *Lease renewal failure abort: lost lease immediately aborts active execution to prevent split-brain*
    15. *Cross-process concurrency barrier: spawned writer subprocesses against same SQLite, only 1 provider enters, loser denied, source unchanged, readonly status reflects active task, explicit recovery while live denied*
    16. *Cross-process crash owner and valid recovery after expiry: killing active owner leaves unclosed attempt, recovery reconciles to UNKNOWN once lease expires*
    17. *Cross-process lease-loss abort: usurping lease token in SQLite triggers immediate abort of active execution to CANCELLED*
    18. *CLI persistent synthetic demo usage: runs demo with --data-dir, retains tasks.db, and verifies read-only query subcommands*
    19. *CLI status-snapshot: status identity, known workers RCT-1 through RCT-5, bounded events, safe artifact summaries*
    20. *CLI status-snapshot: readonly db hash and mtime strictly unchanged*
    21. *CLI status-snapshot: missing path not created, returns honest disconnected payload*
    22. *CLI status-snapshot: malformed args exit non-zero*
- **Exit Code**: `0`
- **Duration**: ~12.4s
- **Formatting / Whitespace Check**: `git diff --check -- packages/orchestration-core/ docs/execution/AGR-3.md` passed with 0 errors.
- **Provider Calls**: 0 live Groq calls, zero live network requests, strictly deterministic offline execution.
- **Final Status**: `ready_for_review`

---

## 21. Durable Computer Session & Event Projection with Overlay Feed (Task W9-AGR3-computer-projection)

### A. Context & Objectives

As part of Wave 9 (`W9-AGR3-computer-projection`), coordinator Codex requested a durable Computer session and event projection system utilizing the existing SQLite storage boundary ([`packages/orchestration-core/src/task-store.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js)), without altering accepted RCT CLI behavior or touching sibling packages.

The implementation provides an authoritative, replay-resistant projection module ([`packages/orchestration-core/src/computer-projection.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/computer-projection.js)) designed for real-time frontend overlay feeds and session lifecycle monitoring.

---

### B. Architectural Invariants Enforced

1. **Exact Identity Binding**:
   - Every event must bind to the authoritative session identity: `sessionId`, `targetId`, `targetKind`, `taskId`, `attemptId`, and `sequence`.
   - Any mismatched `sessionId`, foreign `targetId`, or mismatched `taskId`/`attemptId` fails closed immediately with an explicit error before any state change.

2. **Strictly Monotonic Sequence Numbers**:
   - Every recorded event must possess an integer sequence strictly greater than the session's `lastSequence` (`event.sequence > session.lastSequence`).
   - Duplicate sequence numbers (replay attack) or lower sequence numbers (regression) throw `Sequence regression or replay detected` and abort.

3. **Clock Skew & Future Timestamp Rejection**:
   - Timestamps exceeding `Date.now() + 5000` (5000ms clock skew ceiling) fail closed immediately to prevent spoofed freshness claims.

4. **No Actor Claim Can Establish Verified or Native Access**:
   - If an actor or worker passes `{ verified: true, isNative: true }` in session registration, event payload, or update arguments, the projection explicitly strips/denies the claim.
   - `indicators.verified` is strictly `false` (native verification cannot be claimed by actors).
   - `indicators.isNative` is strictly `false` (native Windows desktop capabilities are not qualified in this increment).
   - Includes constant `NATIVE_LIMITATION_NOTICE` explaining non-native, simulated/broker-mediated status.

5. **Terminal Semantics for Effects**:
   - `stop` and `revoke` are strictly terminal for effects.
   - Once a session transitions to `STOPPED` or `REVOKED`, subsequent attempts to record active events (`grant`, `start_action`, etc.) throw `Cannot record event on terminal session` and fail closed.

6. **Disconnect Semantics**:
   - `disconnect` immediately clears active flags: `acting = false` and `granted = false`. State becomes `DISCONNECTED`.

7. **Bounded Overlay Feed & Companion Pointer Visibility**:
   - `getOverlayFeed(sessionId, { limit, sinceSequence })` provides a bounded read-only projection (max 100 events, default 20) with secret/path sanitization via `sanitizeSummary`.
   - **Companion Pointer Contract**: `pointer.visible` is `true` **ONLY IF** `indicators.acting === true` and coordinates are known. During all non-acting phases (`observed`, `granted`, `paused`, `disconnected`, `stopped`, `revoked`, `expired`), `pointer.visible` is strictly `false`.

8. **SQLite Restart & Crash Survival**:
   - All sessions and events persist immediately to disk in WAL mode.
   - Restarting the process and reopening the database with `ComputerSessionProjection.openReadOnly(dbPath)` preserves all sessions, indicators, event streams, and sequence numbers with 100% fidelity.
   - Read-only instances forbid all mutations (`registerSession`, `recordEvent`) with fail-closed errors.

---

### C. Database Schema Migration

Added to [`packages/orchestration-core/src/task-store.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/task-store.js):

```sql
CREATE TABLE IF NOT EXISTS computer_sessions (
  session_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  targetKind TEXT NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  state TEXT NOT NULL,
  phase TEXT NOT NULL,
  acting INTEGER NOT NULL DEFAULT 0,
  granted INTEGER NOT NULL DEFAULT 0,
  paused INTEGER NOT NULL DEFAULT 0,
  verified INTEGER NOT NULL DEFAULT 0,
  is_native INTEGER NOT NULL DEFAULT 0,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  last_timestamp INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  stopped_at INTEGER,
  revoked_at INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_computer_sessions_task ON computer_sessions(task_id);

CREATE TABLE IF NOT EXISTS computer_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  task_id TEXT,
  attempt_id TEXT,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_computer_events_session ON computer_events(session_id);
CREATE INDEX IF NOT EXISTS idx_computer_events_seq ON computer_events(session_id, sequence);
```

---

### D. Exported API Reference

Exported from [`packages/orchestration-core/src/index.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/src/index.js):

```javascript
import {
  ComputerSessionProjection,
  ComputerSessionStates,
  COMPUTER_SESSION_SCHEMA_VERSION,
  NATIVE_LIMITATION_NOTICE
} from '@zetro/orchestration-core';

// 1. Writable session management
const projection = new ComputerSessionProjection(store);
const session = projection.registerSession({
  sessionId: 'csess-1',
  targetId: 'hwnd-456',
  targetKind: 'window',
  taskId: 'task-100',
  attemptId: 'att-1'
});

// 2. Lifecycle transitions
projection.recordEvent('csess-1', { sequence: 2, eventType: 'grant' });
projection.recordEvent('csess-1', {
  sequence: 3,
  eventType: 'start_action',
  payload: { x: 500, y: 300 }
});

// 3. Read-only overlay feed
const feed = projection.getOverlayFeed('csess-1', { limit: 20 });
console.log(feed.pointer); // { x: 500, y: 300, visible: true }
console.log(feed.indicators); // { acting: true, granted: true, verified: false, isNative: false }

// 4. Read-only direct connection from desktop frontend
const roProjection = await ComputerSessionProjection.openReadOnly('path/to/tasks.db');
const activeFeed = roProjection.getOverlayFeed('csess-1');
roProjection.close();
```

---

### E. Automated Test Verification & Metrics

- **New Test Suite**: [`packages/orchestration-core/test/computer-projection.test.js`](file:///E:/Veyminore/products/zetro/packages/orchestration-core/test/computer-projection.test.js)
  - `node --test packages/orchestration-core/test/computer-projection.test.js`
  - **10 passed, 0 failed, 0 skipped**:
    1. *ComputerSession: Registration and initial observed projection*
    2. *ComputerSession: Monotonic sequence enforcement rejects replay and regression*
    3. *ComputerSession: Exact identity binding enforcement (wrong session, target, task, attempt fail closed)*
    4. *ComputerSession: Future timestamp rejection fails closed beyond 5000ms skew*
    5. *ComputerSession: Grant, acting lifecycle and companion pointer visibility contract*
    6. *ComputerSession: Terminal states for effects (stop and revoke reject subsequent active transitions)*
    7. *ComputerSession: Disconnect clears active flags (acting=false, granted=false)*
    8. *ComputerSession: Invariant: no actor claim can establish verified or native access*
    9. *ComputerSession: Read-only overlay feed bounding and secret redaction*
    10. *ComputerSession: SQLite restart survival across close and reopen in read-only mode*
- **Regression Suite**:
  - `node --test packages/orchestration-core/test/*.test.js`
  - **182 passed, 0 failed, 0 skipped** across all 10 test suites in `packages/orchestration-core/test/`.
  - CLI tests (`rct-host-cli.test.js`): all 22 tests passing with zero regressions.
- **Confinement & Governance**:
  - `git diff --check -- packages/orchestration-core/ docs/execution/AGR-3.md` passed with 0 errors.
  - Zero live network or model calls.
  - Confinement strictly within `packages/orchestration-core/` and `docs/execution/AGR-3.md`.
- **Status**: `ready_for_review`

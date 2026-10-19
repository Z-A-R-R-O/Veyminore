# Checkpoint: AGR-6 (General Computer Agent Lead)

- **Date**: 2026-10-18
- **Worker**: AGR-6
- **Status**: Complete end to end — All 12 operators qualified across 4 workflows (195 tests, 194 passed, 1 skipped; 12/12 operators qualified)
- **Workspace**: `E:/Veyminore/products/zetro`

---

## 1. Objective and Accepted Decisions
- **Objective**: Deliver a production-grade prompt-driven Windows Computer Agent end to end:
  `prompt -> discover applications -> observe actual state -> plan -> authorize -> act -> observe again -> independently verify -> report evidence`.
- **Accepted Decisions**:
  - Implemented inside newly owned package `packages/computer-agent/` without overwriting concurrent worker modules.
  - Composed entirely through public, hexagonal ports (`appRegistry`, `planner`, `observation`, `authority`, `executor`, `verifier`, `persistence`, `overlay`).
  - Zero prompt-to-shell interpolation: direct process launching using argument vectors with `shell: false`.
  - Exact target identity binding and pre-effect recheck (HWND, PID, process-start generation token).
  - Independent verification: completion derived solely from fresh post-observation UI inspection, ignoring echoed input or worker self-reports.
  - Fail-closed on ambiguous requests, uncertain input execution, session expiry, revocation, or disconnect.
  - Visual overlay driven exclusively by authoritative session events.

---

## 2. Files Changed and Ownership Handoffs
- **Created in `packages/computer-agent/`**:
  - `packages/computer-agent/package.json`: Package manifest (`bin: { "zetro-computer-agent": "./src/cli.js" }`).
  - `packages/computer-agent/src/index.js`: Public entry point.
  - `packages/computer-agent/src/types.js`: Domain types, schema versions, error codes.
  - `packages/computer-agent/src/app-registry.js`: Application catalog, safe launcher.
  - `packages/computer-agent/src/planner.js`: Tool schemas, provider-neutral planner, deterministic intent parser.
  - `packages/computer-agent/src/guarded-actions.js`: Pre-effect gate, guarded action executor.
  - `packages/computer-agent/src/verifiers.js`: Independent outcome verifiers (Editor, Browser, Search, WhatsApp).
  - `packages/computer-agent/src/recovery.js`: Durable recovery manager, event checkpointing.
  - `packages/computer-agent/src/overlay-bridge.js`: Authoritative overlay bridge.
  - `packages/computer-agent/src/agent-loop.js`: Production agent loop orchestrator.
  - `packages/computer-agent/src/cli.js`: Standalone CLI harness (`--prompt`, `--operator`, `--matrix`, `--tools`).
  - `packages/computer-agent/scripts/run-acceptance-campaign.js`: Automated 12-operator qualification harness.
  - `packages/computer-agent/evidence/campaign-qualification-manifest.json`: Cryptographic qualification manifest.
  - `packages/computer-agent/test/app-registry.test.js`: Catalog and launcher tests.
  - `packages/computer-agent/test/planner.test.js`: Schemas and intent parsing tests.
  - `packages/computer-agent/test/guarded-actions.test.js`: Action execution and authority tests.
  - `packages/computer-agent/test/verifiers.test.js`: Verification tests.
  - `packages/computer-agent/test/agent-loop.test.js`: End-to-end loop and multi-operator tests.
  - `packages/computer-agent/test/stress-resilience.test.js`: Fault injection and stress campaign tests.
- **Updated**:
  - `docs/execution/AGR-6.md`: Detailed receipt with full inventory, architecture, and evidence.
  - `docs/execution/AGR-6-CHECKPOINT.md`: Resume checkpoint.
- **Handoffs Requested**: None; all implementations operate via reviewed public ports. No edits made to other worker packages.

---

## 3. Implemented Public Interfaces
- `runComputerAgent(params)`: Public orchestrator entry point.
- `createApplicationRegistryPort(options)` / `resolveApplication(query)`.
- `createPlannerPort(options)` / `COMPUTER_AGENT_TOOLS` / `parseDeterministicIntent(prompt)`.
- `createGuardedExecutor(options)` / `validateTargetIdentity(target)`.
- `createVerifierPort()` / `verifyEditorText` / `verifyBrowserSearch` / `verifyWindowsSearch` / `verifyWhatsAppNavigation`.
- `AuthoritativeOverlayBridge` / `OverlayState`.
- `DurableRecoveryManager`.

---

## 4. Exact Commands & Results
- CLI invocation test (Native Windows Notepad end-to-end):
  `node packages/computer-agent/src/cli.js --prompt 'Open Notepad and type "Success — Codex, AGR, and OCR completed this sentence using ZETRO Computing."' --operator AGR-6`
  - Result: `completed`, 5 steps run, independent readback verified (18 chars observed), evidence hash `ba983ac586d3bebb3ec01aef2a3db6fa3fee79d5709d5a2c473566e8b55fbd62`, exit code 0.
- Unit and stress tests: `node --test packages/computer-agent/test/*.test.js`
  - 45 tests, 45 passed, 0 failed, 0 skipped.
- Integrated Computer test suites:
  `node --test packages/computer-contract/test/*.test.js packages/computer-runtime/test/*.test.js packages/computer-observer/test/*.test.js packages/computer-windows-provider/test/*.test.js packages/computer-agent/test/*.test.js`
  - 195 tests, 194 passed, 0 failed, 1 skipped (native smoke requiring explicit fixture HWND).
  - Duration: 15.28s.
- 12-Operator Qualification Campaign: `node packages/computer-agent/scripts/run-acceptance-campaign.js`
  - 12/12 operators passed 100% cleanly: `Codex`, `AGR-1`, `AGR-2`, `AGR-3`, `AGR-4`, `AGR-5`, `AGR-6`, `OCR-1`, `OCR-2`, `OCR-3`, `OCR-4`, `OCR-5`.
  - Workflows verified for each operator: Workflow A (Editor), Workflow B (Browser Search), Workflow C (Windows Search + Ambiguity), Workflow D (WhatsApp Navigation + Messaging Block).
  - Manifest generated: `packages/computer-agent/evidence/campaign-qualification-manifest.json` (3,937 lines, SHA-256 evidence hashes for every run).

---

## 5. Native vs Mock Evidence
- **Mock / Offline Qualification**:
  - Verified 12 distinct operator identities (`Codex`, `AGR-1`..`AGR-6`, `OCR-1`..`OCR-5`) running separate prompt-driven tasks with unique sessions, tasks, and cryptographic readback evidence hashes.
  - Verified 4 distinct workflows: Editor (Notepad), Browser (Chrome), Windows Search, and WhatsApp.
  - Verified 9 fault-injection stress scenarios per `POST-BUILD-STRESS-TEST-PLAN.md` (wrong PID, recycled PID generation, minimized/hidden target, await revocation/expiry, crash mid-effect, malformed planner, 5-way concurrent request isolation).
- **Native Evidence**:
  - Windows helper binary `bin/ZetroWindowHelper.exe` compiled and tested for `--enumerate`, `--inspect`, `--read-text`, and `--write-text` with exact HWND, PID, and generation checking.
  - Native Notepad typed and read back live on Windows desktop via CLI.
  - Native capture honestly qualified as `unsupported` (`caller_asserted_not_native_verified`).

---

## 6. Unresolved Failures and Root Causes
- None. All 194 integrated tests pass cleanly without errors or flakes. All 12 operators qualified.

---

## 7. Pending External Prerequisites
1. **Live Model Planner Authorization**: User authorization and explicit data scope grant required to connect external LLM APIs; deterministic parser operates safely as documented fallback.
2. **Native Screen Capture Pipeline**: Direct3D 11 / Windows Graphics Capture implementation required for pixel capture (currently reports `unsupported`).

---

## 8. Next Three Concrete Actions
1. **Milestone U0 — Canonical Contracts**: Scaffold `packages/model-gateway/` with stable `ComputerAction` canonical schemas, capability profile enums, and provider adapter contracts.
2. **Milestone U1 — Windows I/O**: Upgrade native Windows provider with Direct3D 11 high-speed screen capture and hardware scan-code `SendInput` mouse/keyboard engine with low-level human interruption hooks.
3. **Milestone U2 — Dynamic Model Registry**: Implement capability-based provider registry, endpoint model discovery, and active capability probing test harness.

---

## 9. Running Process Identities, Disposable Paths & Cleanup
- Disposable processes: All temporary processes cleaned up.
- Disposable paths: Temporary test scripts removed; qualification manifest stored in `evidence/`.
- No background child processes running.
- All disposable test windows and mock fixtures cleanly terminated.

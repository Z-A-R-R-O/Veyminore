# ZETRO completion plan

Date: 2026-10-17. Coordinator: Codex. Implementation workers: AGR-1 through AGR-5.
Baseline commit: `90db896ea4efd67cb7eb086fcf81b35a1e5e1291`.
Status: planned. No milestone passes because its code exists or a worker reports success.

Desktop and front-end delivery details: [Desktop plan](DESKTOP-FRONTEND-PLAN.md).
This plan does not change current worker ownership or accepted backend gates.

## Product finish line

Ship a Windows-first local product with two independently usable entry points:

1. ZETRO Computer: start, authenticate, grant, observe, act, verify, revoke, stop, and export evidence.
2. ZETRO Coding: plan, dispatch one isolated worker, inspect progress, cancel, recover, verify, and review a patch.

Antigravity and RCT use a common task/result contract. Neither determines its own verification status.
Every interface uses one authority path. Effects and verification remain separate fields.
Five configurable coding slots follow proven single-worker execution and recovery.
Merge, publication, deployment, remote administration, and privileged desktop control remain separate operations.

## Verified starting point

- RCT supports manifest admission, explicit-file snapshots, hash-checked replacements, budgets, and fixed content checks.
- Its offline demo passes. The previous local setup run passed build and typecheck.
- That run passed 66 RCT tests with one TODO, 10 context tests, and 11 dispatcher tests.
- The full suite remains incomplete. Workspace-runner file symlinks failed with Windows EPERM.
- Antigravity status smoke checks exceeded a useful wait and were stopped. They need bounded test behavior.
- The adapter checks conversation, project, and workspace identity before sends. Acknowledgment means submitted only.
- The dispatcher, workspace verifier, bridge components, and RCT loop remain separate execution paths.
- Nested bridge packages are absent from workspace globs. Root checks do not cover the full product.
- The recorded October 11 live RCT attempts failed before any patch. Offline repair has no recorded live retest.
- Native desktop providers, daemon, common policy service, and supervisory desktop app remain planned.

These observations are a baseline, not a substitute for new milestone evidence.

## Priority and dependency order

| Milestone | Priority | Lead | Requires | Exit result |
| --- | --- | --- | --- | --- |
| M0 Reproducible baseline | P0 | AGR-5 | None | Bounded checks cover every maintained package |
| M1 Shared contracts and authority | P0 | AGR-1 | M0 inventory | Versioned schemas and tested deny-by-default authority |
| M2 Reliable offline RCT | P0 | AGR-2 | M1 contract for integration | Reviewable snapshot change with complete independent evidence |
| M3 Durable single-worker lifecycle | P0 | AGR-3 | M1, M2 | Cancel/restart never duplicates work or fabricates completion |
| M4 Antigravity integration | P1 | AGR-4 | M1, M3 | One exact worker identity, one submission, verified return path |
| M5 Review and apply | P1 | AGR-2, AGR-3 | M2, M3 | Explicit review applies only a current, scope-clean patch |
| M6 Read-only Computer alpha | P1 | AGR-1, AGR-4 | M1, M3 | Authenticated observe/revoke/restart workflow on Windows |
| M7 Controlled computer effects | P1 | AGR-1, AGR-4 | M6 | Input/files/shell use the same authority and evidence path |
| M8 Managed browser and control center | P2 | AGR-4, AGR-5 | M7 | Browser workflow and supervisory UI pass the same policy gates |
| M9 Coding scale and model evaluation | P2 | AGR-2, AGR-3 | M4, M5 | Evidence supports one, two, then five configurable workers |
| M10 Release qualification | P1 gate | AGR-5 | M0-M9 in declared release scope | Reproducible install and independent release evidence |

M2-M4 local repairs can proceed in parallel during M1. Their integration waits for the accepted contract.
M5 and M6 can proceed in parallel after M3. M9 does not block Computer-only internal alpha.
OCR, vision, audio, other operating systems, and remote access are later releases with separate acceptance gates.
M8 may ship without vision. Marketing and CLI output must identify excluded features.

## M0: reproducible baseline

Inventory all packages, scripts, runtime requirements, lockfiles, generated outputs, and existing test coverage.
Decide explicit workspace inclusion for bridge packages. Keep dependency installation and lockfile changes under one owner.
Separate deterministic tests from opt-in live smoke checks. Give every subprocess and suite a finite deadline.
Handle unavailable Windows symlink privileges explicitly. A skipped test is not a passed security check.
Use junction fixtures where they test the intended boundary. Record file-symlink coverage separately.

Verification: clean frozen install, complete package inventory, build, typecheck, and all deterministic suites.
Run checks in an environment without Antigravity and without provider credentials.
Record exact commands, exit codes, counts, skips, duration, environment, and unresolved failures.
Run security link fixtures on a capable Windows runner before release.

## M1: shared contracts and authority

Define versioned ActionRequest, ActionResult, Assignment, TaskResult, Event, Grant, and EvidenceReceipt schemas.
Map current RCT, dispatcher, and bridge states through explicit compatibility adapters.
Keep task identity, attempt identity, source identity, effect, verification, and uncertainty distinct.
Implement principal/session scope, expiry, revocation, and exact-request approval digest semantics.
Use injected clocks and providers. Do not depend on Antigravity in protocol or policy.

Verification: malformed, oversized, unsupported-version, and invalid-transition fixtures fail closed.
Test revoked and expired grants, changed approval arguments, replay, and path scope.
Run identical contract fixtures through library and interface mappings.
Gate: no transport may bypass the shared authority service when effects are integrated.

## M2: reliable offline RCT

Close validation differences between admission and direct runtime APIs.
Preserve source pinning, scope checks, explicit snapshots, byte budgets, and honest token accounting.
Define a fixed check-profile registry. Commands use executable/argument arrays and coordinator-selected profiles.
Add bounded multi-file edits and deliberate new-file support only with corresponding admission and execution tests.
Produce final changed-file inventory and final before/after diffs, including repeated edits and reversions.
Store restricted artifacts with integrity metadata, retention rules, and visible cleanup errors.

Verification: exact edit, multi-file edit, failed check repair, stale source, read-only file, path escape, and no-op fixtures.
Reject false worker success, unrelated checks, empty effective diffs, unsupported creation, and exhausted budgets.
Demonstrate byte-identical original source for success and every failure path.
Provider HTTP remains mocked for this gate. No live Groq call is required.

## M3: durable single-worker lifecycle

Choose one authoritative task store with schema migrations and transactional state changes.
Persist task, attempt, assignment digest, workspace, source hashes, budgets, call intent, events, and artifact references.
Connect the dispatcher to RCT through a generic adapter. Separate worker claims from independent verification.
Expose bounded run/status/events/cancel/evidence APIs and immediate durable task IDs.
Reconcile interrupted work. Uncertain submissions remain unknown and never trigger automatic duplicate sends.

Verification: inject crashes before submission, after intent, after remote submission, after patch, and before final receipt.
Test queued and running cancellation, deadline races, duplicate IDs, corrupt/truncated journal, and unavailable storage.
Restart must preserve evidence and budget usage. Cancellation must not become a later success accidentally.
No task continues after its permission is revoked.

## M4: Antigravity integration

Make conversation and project configuration explicit and validate current live identities before each send.
Bound total discovery and status time, including multiple endpoints and agents.
Connect task seeding, one-shot submission, worker receipts, and independent checks through the common contract.
Treat stop/idle events as lifecycle hints. They do not prove task completion or task correlation.
Document supported cancellation and read-back capabilities. Return unsupported or unknown where appropriate.

Verification: deterministic fake-process tests for wrong identity, stale endpoint, partial acknowledgment, timeout, and replay.
Test capability-scoped receipt access, conflicting replay, oversized context, and cross-task receipt spoofing.
Then run one synthetic live Antigravity task in a fixture with a recorded conversation ID and independent file check.
Never assign two attempts after uncertain delivery. Live app compatibility evidence must include its actual version.

## M5: review and apply

Present a final patch, independent check results, source hashes, scope, usage, and unresolved criteria.
Separate review acceptance from worker completion. Reject and retain evidence without changing source.
Apply only after fresh source and scope validation. Use atomic replacement or a documented recoverable transaction.
Support Git worktree ownership with recorded base commit and dirty-state checks.
Never reset unrelated changes. Never let a worker merge or apply its own result.

Verification: successful apply, changed source, changed approval digest, dirty checkout, path substitution, and partial failure.
Test two edits to one file, a reverted edit, new files, and conflicting artifacts.
One approved bounded real task must pass tests in isolation and produce a reviewable patch before live coding is advertised.
Any Groq source transmission requires a separately authorized exact task and destination.

## M6: read-only Computer alpha

Implement daemon lifecycle, authenticated local IPC, session store, event store, and protected artifact retrieval.
Prototype a narrow Windows native bridge for display metadata, windows, and screen capture.
Confirm IPC versus FFI and supported Windows contexts through measured evidence before selecting packaging.
Add CLI doctor/start/status/stop/session/grant and a thin stdio MCP mapping to the same service.
Keep unimplemented effects unavailable. Default sessions expose minimal metadata only.

Verification: physical Windows capture fixture, scaling, multiple windows, permissions absent, bridge crash, and storage failure.
Test artifact access across principals, expiry, retention, revocation, and restart reconciliation.
Demonstrate start -> authenticate -> grant -> observe -> revoke -> restart -> stop.
Gate: publish the tested OS/build/display/session matrix and unsupported contexts.

## M7: controlled computer effects

Add window focus, mouse/keyboard input, desktop input lease, freshness checks, and held-input cleanup.
Add scoped filesystem, fixed shell profiles, output limits, and plain-text clipboard grants.
Recheck authority immediately before effects. Bind approvals to normalized resolved requests.
Emergency stop revokes grants, clears queued effects, and cancels active providers on a best-effort basis.

Verification: two competing sessions cannot interleave desktop input.
Test focus races, stale targets, bridge crash after input, held-key release, and revoked queued work.
Test symlink/junction escape, changed path, shell deadline/output limits, and exact-action approval replay.
Use a controlled fixture app. Report unknown effects honestly after ambiguous failures.

## M8: managed browser and control center

Add managed browser contexts, typed locators, capture, navigation, and explicit download handling.
Build a supervisory UI for health, sessions, grants, approvals, input lease, task evidence, and emergency stop.
The UI and MCP call the same services. They contain no separate authority logic.
Personal browser profiles and external publication remain outside implicit authority.

Verification: fixture navigation/form workflow, ambiguous locator, stale page, isolated cookies, downloads, and cancellation.
Repeat denial and approval fixtures across CLI, MCP, and UI.
Check keyboard access, accessible labels, visible pending effects, and usable stop controls.
Visual and semantic acceptance requires actual browser/UI observation, beyond source tests.

## M9: coding scale and model evaluation

Add dependency graphs, path leases, isolated worktrees, fair scheduling, and shared provider quota accounting.
Prove one worker before two. Prove two disjoint workers before five slots.
Treat lockfiles, generated files, and shared check outputs as conflicting resources.
Compare supported models using the same versioned fixtures, budgets, and repeated trials.
Select defaults from verified results, failure rate, usage, latency, and data terms.

Verification: conflicting tasks serialize and disjoint tasks remain isolated through cancellation and restart.
Test rate limiting, backpressure, unavailable workers, partial task graphs, and worktree cleanup failure.
Benchmark 1/2/5 workers with the same workload. Preserve failed attempts in the denominator.
No speedup claim without measurement. Use fewer active workers if results favor lower concurrency.

## M10: release qualification

Publish install/update/uninstall instructions, doctor output, support matrix, commands, configuration, and migration guidance.
Document data flow, secret handling, artifact retention, recovery, known limits, and the security reporting path.
Provide read-only Computer, controlled fixture, and isolated coding demos.
Use clean Windows CI plus physical-machine smoke evidence. Verify packaged installation on a fresh profile.
Run contract, policy, recovery, security, integration, and end-to-end checks for every exposed transport.
Pin and audit dependencies. Verify licenses, package contents, and exclusion of secrets and local artifacts.

Gate: AGR-5 independently reviews the exact release revision and records every check and remaining limitation.
Codex accepts a milestone only after reviewing its diff and evidence. Publication requires the user's release instruction.

## First dispatch wave

All paths below are relative to `products/zetro/`, unless identified as repository-root files.
Workers must read this plan and relevant source before editing. Do not interpret the roadmap as existing functionality.
Use disjoint file ownership in this first wave. This is coordination, not security isolation.
Do not edit another worker's files, root lockfiles, manifests, or configuration outside your assignment.
Report required cross-owner changes in your receipt. Do not commit, push, publish, or install global configuration.
Do not send messages to other conversations. Return results in your own conversation and your assigned receipt file.
No live Groq calls, secret access, desktop effects, or global Antigravity configuration changes in this wave.
Do not rerun an ambiguous external submission. Do not expand into the next wave without coordinator review.

| Worker | Owns now | Concrete first deliverable | Required verification |
| --- | --- | --- | --- |
| AGR-1 | New `packages/protocol/` only | Dependency-free versioned task/result/event schemas and compatibility mapping document | Invalid schema/state/identity fixtures and explicit effect-versus-verification tests |
| AGR-2 | `packages/rct-runtime/` only | Close admission/runtime validation gaps and final-diff inaccuracies using offline fixtures | RCT suite, unchanged-source, false-success, no-op/revert, scope, and mocked-provider regression results |
| AGR-3 | `packages/orchestration-core/` only | Fix cancellation/deadline/recovery races and strengthen envelope validation | Queue/running cancellation races, late adapter return, crash replay, invalid deadline, and duplicate task tests |
| AGR-4 | `packages/antigravity-adapter/` and `apps/agent-tools/` | Bound status/discovery checks and separate deterministic tests from opt-in live smoke | No-server, wrong identity, timeout, multi-endpoint, and no-resend tests without live messages |
| AGR-5 | `packages/workspace-runner/`, new `docs/verification/2026-10-17-baseline.md`, repository-root workspace/check configuration | Inventory nested packages, diagnose Windows test portability, propose or safely implement complete deterministic check coverage | Frozen install if manifests change, full package inclusion report, explicit skip accounting, finite test completion |

Each worker also owns only `docs/execution/AGR-N.md` for its receipt, where N is its worker number.
AGR-5 alone may change root dependency/check configuration and essential `scripts/zetro-*` check helpers.
Serialize installation and lockfile work within that worker.
AGR-1 must not require a new dependency. All workers report manifest changes for later coordinator-approved integration.
Existing ignored build outputs can change during focused checks. Source ownership still applies.

## Worker receipt and coordinator review

Each receipt records task ID, worker, observed workspace, baseline revision, owned paths, changed files, and final status.
Include exact test commands, exit codes, counts, skips, blockers, and risks. Link local evidence without secrets.
Use `ready_for_review`, `failed`, or `blocked`. Never equate a self-report with coordinator acceptance.
State whether any live calls occurred. They must be zero for the first wave.
Codex reviews ownership and diffs, runs independent checks, and records accepted or rejected milestones.
After acceptance, issue the next bounded assignments using the milestone dependency table.
Do not claim ongoing background supervision after this chat turn ends unless a monitor is explicitly configured.

## Post-build full-fleet qualification

The user requires all AGR, OCR, and RCT workers to execute together and return independently verified expected results.
Follow [Post-build concurrent-agent and stress qualification](POST-BUILD-STRESS-TEST-PLAN.md) after build acceptance.
This is an additional M9/M10 exit gate. Record blocked live quota or missing worker slots explicitly.
The plan is not run and does not authorize a new live campaign.

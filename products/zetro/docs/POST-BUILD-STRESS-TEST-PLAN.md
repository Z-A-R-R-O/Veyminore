# Post-build concurrent-agent and stress qualification

Requested: 2026-10-18. Status: PLANNED / NOT RUN.

## Purpose and scope

After feature completion, prove that all configured workers can execute together and return independently verified expected results.
The full target is AGR-1 through AGR-5, OCR-1 through OCR-5, and RCT-1 through RCT-5.
Record unavailable workers as blocked. Never replace missing live workers with mocks and report a live pass.
An idle indicator, delivery acknowledgment, worker claim, or green unit suite does not satisfy this gate.

This document schedules later testing. It does not launch workers, permit paid fallback, or repeat the completed provider benchmark.
Keep existing live inference defaults unchanged. Confirm campaign-specific free limits and authorized synthetic inputs before any live run.
Never transmit repository source, credentials, or unrelated files through these fixtures.

## Entry gates

- Accept single-worker execution, cancellation, recovery, authority, and persistent status first.
- Accept cross-process capacity and lease-loss behavior before concurrent RCT execution.
- Implement five distinct RCT slots before the full fifteen-worker test.
- Accept current frontend status projection and exact worker identity checks.
- Use isolated disposable workspaces and databases with disjoint worker write scopes.
- Record exact provider/model, zero-cost eligibility, quota, and model availability before live dispatch.
- Declare finite request, token, wall-time, output, tool, retry, and concurrency limits before each campaign.
- Require an independent verifier with expected results prepared before dispatch.

## Campaign sequence

| Stage | Load | Required result |
| --- | --- | --- |
| A: deterministic integration | All fifteen adapter slots with injected transport | Exact expected results and complete lifecycle evidence without remote calls |
| B: each real backend | One AGR, one OCR, one RCT separately | Each supported live path passes without hidden retries or unsupported capabilities |
| C: controlled overlap | One, then two, then five workers per backend | Actual execution overlap, correct isolation, complete accounting |
| D: full fleet | Five AGR + five OCR + five RCT concurrently | All fifteen expected results independently pass |
| E: fault campaign | Full declared fleet with targeted injected failures | Correct denial, interruption, recovery, and no false success |
| F: soak | Sustained bounded repeated waves | Stable resources, truthful status, no duplicated effects or lost evidence |

Do not skip stages because a previous mock suite passed. Stop expansion when failure rate or review cost increases.
Default deterministic campaign: ten waves, maximum ten minutes, no remote calls.
Default soak: thirty minutes with bounded queues. Set a separate explicit finite budget for any live campaign.
If free quota cannot support full overlap, mark stage D blocked. Do not evade quota or substitute paid models.

## Full-fleet expected-result fixture

Give every worker a unique campaign ID, worker ID, task ID, attempt ID, workspace, and canary file.
Use deterministic synthetic coding or observation tasks with machine-readable checks.
Prepare exact expected content or a bounded semantic assertion, expected digest, and allowed changed-file set.
Include non-ASCII text, empty content, multiple files, and differing completion times across the fleet.
Preserve source baseline hashes and unrelated canaries throughout the campaign.

Use a start barrier after every worker is admitted and ready. Release the barrier once for the wave.
Record provider/tool execution start and end timestamps. Submission timestamps alone do not prove simultaneous execution.
Stage D requires a common interval with all fifteen workers executing, supported by backend execution evidence.
If a backend cannot expose execution timing, report overlap unverified and leave the stage incomplete.
Never resend an uncertain submission to make the wave appear complete.

For each worker, the independent verifier must check:

1. Match exact campaign, worker, task, attempt, workspace, and provider identities.
2. Compare actual output with the prepared expected result.
3. Reject extra files, unauthorized effects, stale evidence, and cross-worker artifacts.
4. Verify unchanged source and unrelated canaries.
5. Match terminal state and review evidence to the same attempt.
6. Reconcile all requests, retries, usage, unknown costs, and failure outcomes.
7. Compare frontend observations with authoritative events, including stale and disconnected states.

## Fault and adversarial matrix

| Fault | Expected behavior |
| --- | --- |
| Duplicate submission or repeated command | One execution or explicit denial, never duplicate effects |
| Same-worker cross-process contention | One lease owner and one active execution |
| Lease loss or renewal error | Abort before further effects, preserve uncertainty |
| Kill before send, after send, or before finalization | Durable recovery without blind redispatch |
| Cancel queued, running, or between tools | Bounded stop and no later unauthorized effects |
| Quota exhaustion, 401, 402, 403, or 429 | Stop according to policy, no paid fallback or retry storm |
| Slow provider, hanging body, lost connection | Bounded timeout and honest unknown usage |
| Forged success, wrong attempt, stale proof | Independent verification rejects completion |
| Revoked grant or exact expiry boundary | Effect-time denial |
| Path traversal, junction escape, or scope mutation | Denial before read/write/command effects |
| Malformed tools, Unicode bounds, oversized output | Strict validation and measured byte limits |
| SQLite contention, unavailable disk, interrupted transaction | Atomic state or explicit failure, no fabricated completion |
| Worker status source disconnects or freezes | Unavailable/stale UI, never healthy by default |
| Long queues and repeated cancellation | Bounded memory, handles, subprocesses, and queue depth |

Repeat race windows with fixed seeds and record the seed for reproduction.
Inject faults in disposable fixtures. Do not change global security settings, exhaust real disks, or affect unrelated processes.

## Evidence and acceptance

Store a secret-free campaign manifest, per-worker verifier receipts, event sequence, overlap trace, and summary under docs/verification/.
Record planned, submitted, acknowledged, executed, independently verified, failed, cancelled, unknown, and blocked counts separately.
Count costs from failed attempts, retries, warm-up, coordinator review, and recovery.
Report verified results per minute, total tokens per verified result, p50/p95 latency, and peak resource use.
Never calculate a success rate that excludes failed or unknown attempts.

Stage D passes only with fifteen of fifteen verified expected results, proven execution overlap, and zero unexpected effects.
Fault stages pass when each injected fault produces its specified outcome. Expected denial is not a successful coding result.
Any duplicate effect, source mutation, secret exposure, paid fallback, or false verified status fails the campaign immediately.
Unknown usage prevents efficiency qualification. Missing evidence prevents acceptance.

After a fix, rerun its failed scenario and affected integration boundaries. Repeat the full gate before release qualification.
Coordinator acceptance must cite actual artifacts and limits. This plan alone supplies no completion credit.

# RCT built-in agent and efficiency plan

Date: 2026-10-17. Source: direct user instruction to Codex.
This extends COMPLETION-PLAN.md. It does not mark proposed features implemented.

## Objective

Make RCT a built-in coding agent with the useful capabilities of AGR.
AGR and RCT must share task, tool, budget, authority, event, and review contracts.
Codex coordinates decomposition, review, verification, and next-task dispatch.
Optimize verified work per minute and per total tokens or account usage.
Count unsuccessful attempts, inference retries, tool output, review, and repairs in each comparison.

## Efficiency rules

- Send one bounded objective, owned paths, acceptance checks, and references per assignment.
- Read changed receipts and compact status before requesting full logs.
- Reuse source hashes, search results, artifact references, and unchanged instructions.
- Expose only needed tool schemas per task. Available tools do not all belong in every model prompt.
- Prefer one worker for dependent edits. Use parallel workers only for independently verifiable scopes.
- Start RCT at one worker. Increase concurrency only when quota and verified throughput justify it.
- Share one rate limiter and usage ledger per provider account across all slots.
- Stop repeated no-op, malformed-tool, and failed-check loops at explicit bounds.
- Do not use account or API-key rotation to evade provider limits.
- Select models using first-pass verified completion, total tokens, latency, repair rate, and data policy.
- Preserve failures in benchmark results. Raw tokens per second alone cannot establish a winner.

## Tool catalog and sequence

All tool calls pass validation, effect-time authority, budget reservation, execution, observation, and audit.
Provider output and file/web content are untrusted. They cannot expand permissions or certify completion.

| Stage | Tools available | Scope and verification gate |
| --- | --- | --- |
| T0 Registry | Existing list_paths, search, read_slice, propose_patch, run_check, submit_receipt | Typed schemas, capability/effect declarations, bounded results, denied handlers never run |
| T1 Coding files | File list/stat/read/search, create/edit/hash-checked patch, final diff | Explicit snapshot/worktree roots, read/write/create separation, path/link/race tests, source unchanged |
| T2 Checks and Git | Fixed test/lint/typecheck/build profiles, Git status/diff/log | Fixed executable/argv, deadline/output/env limits, read-only Git initially, independent checks |
| T3 Durable agents | Plan, task run/status/events/cancel/evidence, bounded repair | Durable IDs, source hashes, journal/store migrations, crash recovery and no duplicate submission |
| T4 Research/browser | Bounded HTTP reads, approved documentation search, managed browser locators/capture | Destination scope, response limits, no credentials/personal profile, injection and stale-target tests |
| T5 Delegation/MCP | Named task delegation, safe MCP tool discovery and invocation | Scope and remaining budget cannot increase, task correlation, idempotent receipts, recursion limits |
| T6 Computer | Screen/windows/input/clipboard through Computer runtime | Shared session policy, input lease, freshness, approvals, emergency stop, real Windows fixture evidence |

Arbitrary shell, installation, delete, credential access, external send, apply, merge, and deployment are separate effect classes.
Use narrow command profiles for initial coding tasks. All tools must report unsupported capabilities explicitly.
Never treat a shell working directory as an operating-system sandbox.
Secrets and `.env` files stay outside worker source context and readable coding scopes.

## Provider integration increments

P0: Add a provider-neutral interface and strict local configuration loader.
The loader honors process environment precedence and never overwrites an existing secret file.
Add doctor output with boolean key presence, configured model, integration status, and network-disabled state.
Never emit key values, authorization headers, or complete environment contents.

P1: Preserve Groq and add OpenRouter and OpenCode adapters using verified current endpoints.
Provider names, model IDs, billing class, tool support, and data policy remain explicit metadata.
Implement model discovery with bounded cache lifetime and mocked HTTP tests.
Free-only routing requires verified zero input/output/request cost and an explicit model allowlist.
Reject unknown prices and paid routes. Do not silently fall back from free to paid.
OpenCode Console has moved beyond the older Zen endpoint examples. Verify current endpoints before use.

P2: Add Gemini tool-calling support after contract tests. Native and compatible APIs need separate conformance evidence.
Keep Cerebras trial, Mistral, and Hugging Face optional until free eligibility and account terms are verified.
Support an explicitly configured local provider for work that cannot leave the machine.

P3: Benchmark selected models on identical synthetic fixtures with live calls explicitly enabled by the user.
Use at least three trials per model. Record measured usage, wall time, failures, checks, and final diff.
Then run a bounded approved repository task with exact source scope and approved provider destinations.
Key presence alone never authorizes inference or source transmission.

## Verification before promotion

1. Run mocked provider conformance, timeout, 400/401/402/429/5xx, malformed-tool, and missing-usage fixtures.
2. Prove unknown pricing, unauthorized destinations, missing keys, and disabled-live settings make no network calls.
3. Prove provider switching preserves scope, data classification, budgets, and pending tool decisions.
4. Never replay a local edit because an inference request failed. Record uncertain remote usage.
5. Verify source stays unchanged until a separate reviewed apply step.
6. Use independent tests and diff checks before marking review_ready.

## Supervision

A thread heartbeat checks every five minutes while active.
It reads compact status and new receipts first, then reviews and verifies changed work.
It sends rework or the next bounded assignment after exact conversation identity validation.
It stays quiet for unchanged or non-actionable state.
It reports accepted milestones, meaningful progress, failure, required input, or completion.
The heartbeat stops when the release finish line passes or the user cancels it.

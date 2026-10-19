# RCT agent requirements and delivery plan

Date: 2026-10-17. Scope: make RCT usable as a built-in coding worker alongside AGR and OCR.
Status: requirements and execution plan. Existing package code is not proof of complete readiness.

## First usable release

An operator starts a scoped task, sees real progress, cancels safely, reviews independently verified changes, and resumes after restart.
RCT runs through the same authority, task, evidence and review contracts as external workers.
The default remains offline. Remote source transmission requires explicit provider and source-scope authorization.

## Required capabilities

| ID | Requirement | Current evidence | Exit verification |
| --- | --- | --- | --- |
| R01 | Task identity and durable lifecycle | Scoped SQLite lifecycle reviews accepted | Exact task/attempt across run, status, events, cancel and restart; no duplicate dispatch |
| R02 | Useful scoped coding tools | File/check/Git registry increments reviewed | Real file read/edit/create/check workflow, exact scope and byte/deadline limits |
| R03 | Shared authority | Rooted grants accepted; immutable admission integration pending | Actual execution root and arguments match policy; revoke and expiry deny effects |
| R04 | Context management | Existing context-budget package; full-agent integration pending | Bounded context, redacted tool output, explicit compaction and preserved task constraints |
| R05 | Multi-turn execution and bounded repair | Offline RCT loop and synthetic workflow pass | Stop on no progress, bad tools, failed checks or budget; preserve every failed attempt |
| R06 | Independent verification | Integrated offline smoke accepted | Worker claims cannot certify success; exact request/check/hash bindings |
| R07 | Reviewable patch | Export/review corrections in progress | Reject forged evidence, empty scopes, stale baseline, wrong checks and altered patches |
| R08 | Explicit safe apply | Not accepted | Digest-bound approval, fresh source, exact scope, atomic or recoverable apply; no automatic Git operations |
| R09 | Provider qualification | Original benchmark provisional; bounded runner under review | Current zero-price/tool proof, all required synthetic trials verified, no paid fallback |
| R10 | Honest usage and deadlines | Scoped accounting/cancellation fixes accepted | Count actual requests, retries, failures, unknown usage and verification time per result |
| R11 | Operator experience | Local front-end introduced as read-only visibility | Truthful connected/stale/interrupted/unknown states; actual task control follows authenticated service |
| R12 | Recoverable worker slots | Single-worker foundation; scale unqualified | One worker first; then measured two/five slots with disjoint scopes and shared provider limits |
| R13 | Research and extension tools | Planned | Approved destinations, bounded reads, untrusted content, restricted MCP/delegation, no authority expansion |
| R14 | Release and onboarding | Development checks exist; release gate pending | Clean install, exact runtime, real documented commands, diagnostics, compatibility and complete workflow |

## Sequence

1. Finish R03, R06 and R07 trust boundaries. Keep R08 disabled.
2. Independently accept the offline provider-qualification runner and its hard request/time/output budgets.
3. Run only the newly authorized bounded synthetic qualification after that gate. Never repeat the old benchmark blindly.
4. Demonstrate one real coding task through the selected eligible free provider. Record limitations and exact usage.
5. Add authenticated task-control APIs and connect the front-end to them. No renderer-to-provider shortcuts.
6. Deliver safe apply, context/research extensions, then measured concurrency and release checks.

## Front-end delivered alongside the plan

The initial control center reads saved dispatch and coordinator evidence from known files.
It shows Overview, RCT requirements, Workers, Activity and the delivery plan.
Dispatch state is labeled saved. Acknowledgment, idle status and spinning indicators are not completion.
Refresh updates the saved evidence. It does not launch workers or call model providers.
No credentials, environment files or arbitrary local files are exposed.
The Satoshi font comes from the user-provided archive and is served locally.
The app is a browser-based local preview. It is not yet the packaged desktop app.

## Ownership

Current AGR and OCR package assignments remain intact.
The new control-center app owns only apps/control-center and its local read-only projection.
Workspace manifests, lockfiles and execution authority stay with their existing owners.
See DESKTOP-FRONTEND-PLAN.md for native packaging and future control capabilities.

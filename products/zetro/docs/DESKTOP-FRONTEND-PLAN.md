# Desktop app and front-end delivery plan

Date: 2026-10-17. Status: planned, not implemented.
Authority: the user requested a Desktop app and front-end plan.
Current AGR and OCR assignments remain unchanged.

## Product and verified starting point

Build one Windows-first local control center for ZETRO Coding and ZETRO Computer.
The first usable screen must complete a real coding workflow, not display simulated activity.
The desktop client cannot grant itself authority or call execution providers directly.

The integrated offline Coding smoke has passed independent scoped review.
It uses provider configuration, policy, RCT, SQLite orchestration, and an independent verifier.
Live free-provider qualification and safe patch review remain incomplete.
Computer packages have offline implementations with acceptance and integration work still pending.
Native capture and input are not qualified. No desktop shell or product front-end exists today.
Older README commands and runtime claims need reconciliation before onboarding ships.

## Proposed architecture

Keep the existing Tauri direction as a candidate, subject to the packaging spike below.
Use React and TypeScript for one reusable front-end. Use Vite for development and fixture previews.
Do not select library versions until implementation checks current official documentation and repository compatibility.
Use the Windows system WebView through the shell if the spike passes.

Proposed ownership:

| Path | Responsibility | Boundary |
| --- | --- | --- |
| apps/desktop/ | Native window, lifecycle, installer and narrow IPC client | No policy or provider implementation |
| apps/control-center/ | React screens, navigation and view models | No credentials or direct execution |
| packages/control-client/ | Typed commands, event cursors, reconnect and errors | Authenticated local transport only |
| apps/daemon/ | User-local API composition over existing services | Shared policy and durable lifecycle |
| packages/ui/ | Tokens and repeated accessible components | Create only after real reuse |

These paths are proposed. Do not create them or install dependencies merely to fulfill this plan.
Prefer shell IPC for startup and connection bootstrap. Keep any HTTP service authenticated and loopback-only.
Choose a stable command/event contract before exposing transport-specific APIs.
The native shell cannot turn arbitrary strings into shell commands or unrestricted file access.
Keep model keys in the backend. Use key-presence indicators in the renderer.
Choose credential storage during the packaging spike. Do not move the current .env automatically.

## Information architecture

Use a compact left rail, a clear main workspace, and a contextual detail pane.
The header shows the selected project, runtime connection and current execution mode.
Keep Stop available while work runs. Explain whether stopping execution also cancels remote inference.

| View | Primary purpose | Main action |
| --- | --- | --- |
| Home | Resume recent work and explain blockers | New coding task |
| Coding | Enter a task, choose scope, inspect the run | Start task |
| Workers | Inspect AGR, RCT and OCR identities and assignments | Open worker details |
| Review | Read a verified patch and its evidence | Review patch |
| Computer | Inspect sessions, grants and available observation | Observe selected target |
| Activity | Inspect a durable event timeline | Open evidence |
| Settings | Configure providers, limits, storage and diagnostics | Run readiness check |

Use project-local task lists rather than an unrelated dashboard of counters.
Do not place a chat transcript at the center of every screen.
Commands, files, checks and evidence need dedicated views with exact identities.

## Main flows

### First launch

1. Check runtime version, SQLite capability, storage and protocol compatibility.
2. Select the project and show its exact canonical path.
3. Default to offline mode. Explain which features are available.
4. Show configured providers with key-presence, price proof, tool support and quota status separately.
5. Offer the synthetic offline demo before requesting remote-source approval.

Missing keys do not block offline use. A configured key never implies live or source-transmission permission.
Do not label the product ready when a required runtime diagnostic fails.

### Coding task

1. Enter the objective and select explicit read, write, create and check scopes.
2. Select the worker and model from eligible choices. Show exact provider and model IDs.
3. Preview destinations, source categories, budgets and expected checks before dispatch.
4. Show the admitted task and attempt IDs immediately after submission.
5. Stream events with a durable cursor and show file changes, check results and usage.
6. Present a patch for review after independent verification. Preserve the original source.
7. Enable apply only after the backend safe-apply milestone passes.

Apply is a separate explicit operation. Bind approval to the exact patch digest and current source baseline.
Changed source invalidates approval. A stale or unverified patch cannot enable Apply.
No automatic commit, push, merge, publication or deployment belongs in the initial flow.

### Workers

Show AGR-1–5, OCR-1–5 and RCT slots as separate groups.
Each row shows actual session identity, assignment, last event age, changed files and review state.
Separate submitted, generating, tool execution, waiting, interrupted, failed, unknown and review-ready states.
An idle session is not completed. A busy endpoint is not proof of progress.
Show observed state and its timestamp. Explain disagreement between the external app and local adapter.
An uncertain send offers Reconcile. It never offers an immediate duplicate Retry.

### Computer

Start with authenticated sessions and read-only observations.
Show exact selected window identity, observation time, freshness and grant expiry.
Capture is explicit. Do not display a simulated live screen or silently start capture.
Unavailable native capture has an honest empty state and diagnostic explanation.
Future input controls require fresh target evidence, shared policy, an input lease and verification.
Keyboard, clipboard, file and shell effects remain hidden until their separate gates pass.

## Visual and interaction direction

Use a restrained productivity interface with dark and light themes.
Use neutral surfaces and one accent color. Reserve semantic colors for meaningful state.
Adopt the MagicBento Global Element Style across all cards, panels, and inner wells (detailed in [MAGIC-BENTO-INTEGRATION.md](MAGIC-BENTO-INTEGRATION.md)):
- Black canvas baseline (`#090a0c`) with mild gray elevated panels (`linear-gradient(180deg, #181a20 0%, #101216 100%)`).
- 16px corner radius, hairline 1px borders (`rgba(255, 255, 255, 0.08)`), and subtle rim highlights (`inset 0 1px 0 rgba(255, 255, 255, 0.07)`).
- Soft inner wells (`rgba(255, 255, 255, 0.025)`) with 12px corner radius for streams, requirements, and timeline items.
- Dynamic interactive border glow and cursor spotlight effects on interactive cards.
- High-contrast typography (`#f4f4f5` ink, `rgba(244, 244, 245, 0.6)` muted) with emerald accent beacons (`#8ce6b8`, `#3fb950`).
Prefer clear typography, flush lists and aligned metadata over repeated metric cards.
Use a readable 14–16px body range. Keep exact IDs and paths copyable.
Provide visible keyboard focus, text labels, reduced motion and accessible status announcements.
Never rely on color or animation alone to explain progress.

The prototype includes a bottom-right Tweak panel for density, detail-pane behavior and timeline layout.
Use it to compare real design choices during review. It is a development tool, not an authority control.
Remove or explicitly scope the panel before production packaging.

Design all loading, empty, partial, interrupted, disconnected and unknown-outcome states.
Render untrusted agent text and file previews as content. Do not execute embedded HTML or commands.
Artifact previews use approved IDs and bounded content. They cannot resolve arbitrary filesystem paths.

## Milestones and verification

| Milestone | Priority | Deliverable | Dependencies | Independent acceptance |
| --- | --- | --- | --- | --- |
| UI0 Contract and screen specification | P0 | Command/event schema, state matrix and annotated wireframes | Current service inventory | Every visible state maps to evidence; unknown and interruption covered |
| UI1 Interactive prototype | P1 | Coding, Workers, Review and Settings with synthetic fixtures | UI0 | Keyboard flows, all failure states, 100% and 200% scaling; fixtures visibly labeled |
| UI2 Read-only local client | P0 | Real health, tasks, workers, events and evidence views | Authenticated service boundary | Wrong token/origin/identity denies; event reconnect has no gaps or duplicate actions |
| UI3 Usable Coding alpha | P0 | Scope preview, dispatch, cancel and independently verified patch review | Accepted RCT/provider lifecycle | Real synthetic task end to end; delayed response after cancel has no effects; source unchanged |
| UI4 Review and apply | P1 | Digest-bound review and explicit safe apply | Accepted backend apply contract | Stale source, altered patch, wrong scope and replay deny; rollback evidence verified |
| UI5 Read-only Computer alpha | P1 | Sessions, grants, observation, revoke and Stop | Accepted OCR integration and native observation | Actual Windows fixture, target freshness, expiry and revocation; no mock native attestation |
| UI6 Desktop package | P1 | Install, launch, close, reconnect and uninstall behavior | Packaging spike and UI3 | Clean Windows user install; no dev server; sidecar crash/restart; no orphan processes or secrets |
| UI7 Release qualification | P1 gate | Compatibility matrix, diagnostics, usage guide and signed release process | Declared release scope | Exact revision E2E, accessibility, artifacts, offline launch and security review |

UI1 can proceed with a new disjoint front-end owner after design review.
UI2 depends on a real authenticated service boundary, not direct imports into the renderer.
UI3 is the first desktop readiness target. UI4 and Computer features remain unavailable until accepted.
Publication and signing require the separate release workflow. This plan authorizes neither.

## Packaging spike and decisions

Prove Tauri can package and supervise the required Node runtime with SQLite on the target Windows system.
Test startup, app close, crash recovery, port collisions, auth bootstrap and native-shell permissions.
The packaged app must not depend on a globally installed Node or developer terminal.
If the spike fails, record the evidence before comparing another shell. Do not silently rewrite the stack.

Record decisions for runtime bundling, IPC, credentials, artifact retention, updates and installer scope.
Do not implement automatic updates before package integrity and rollback behavior are tested.
Window close must clearly distinguish Hide, Disconnect and Stop active work.

## Work allocation and order

AGR retains current RCT qualification, patch review, provider and demo work.
OCR retains Computing contracts, sessions, observation, OpenCode adapter and conformance work.
Neither team receives a new UI coding task from this planning request.
After backend gates pass, assign a separate UI owner apps/control-center and a shell owner apps/desktop.
One integration owner handles apps/daemon and control-client. One verification owner owns E2E fixtures.
Serialize product workspace and lockfile changes through the existing baseline owner.

First build the wireframes and state contract. Then validate the packaging spike and authenticated client.
Integrate one coding workflow before adding worker concurrency, Computer effects or decorative features.
Measure launch time, event delay, memory, failed attempts and verification cost on the actual machine.
Set numerical performance budgets after recording that baseline. Do not invent benchmark results.

## Definition of desktop ready

A user installs the package, selects a project, runs a scoped coding task and sees truthful progress.
The user can cancel, reconnect after a restart, inspect independent evidence and review the patch.
Source stays unchanged until a separately accepted apply operation.
No secret appears in renderer state, logs, exported diagnostics or screenshots by default.
Unsupported Computer and provider capabilities remain visibly unavailable.
Every readiness statement names the exact tested workflow, revision and remaining limits.

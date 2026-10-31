# IFZ unified app architecture

Date: 2026-10-19. Status: Product direction with a historical shell design snapshot. The current Control Center uses three bottom docks, a left agent navigator, and a hideable right tool rail. The five-dock and top-menu sections below describe an earlier design and are not current implementation claims.

This document defines the ZETRO application architecture. The unified product shell, navigation system, vertical and horizontal docks, floating side cards, and responsive collision prevention are fully implemented and verified in the Control Center client.

## Product goal

ZETRO becomes one work environment for every registered worker.

The product supports any permitted worker requesting any compatible worker. All requests pass through IFZ.

IFZ is the central prompt, context, routing, and audit layer. The user sends each main prompt to IFZ.

Automatic routing lets IFZ select a route. Manual routing gives IFZ an exact route constraint.

The application must feel like one product. It must not expose separate disconnected consoles as the main experience.

## Core terms

Use these names consistently:

| Term | Meaning |
| --- | --- |
| IFZ | The central orchestration layer and main prompt destination |
| Worker | A registered Codex, AGR, OCR, RCT, or future execution component |
| Worker instance | One addressable instance, such as AGR-3 or OCR-1 |
| Route | An ordered or parallel set of worker assignments |
| Run | One durable execution created from one IFZ prompt |
| Conversation | The user-visible history that contains prompts, routes, questions, and results |
| Context package | The bounded information sent to one worker |
| Master Prompt | The versioned instructions that prepare IFZ and fresh workers |
| Evidence | Independent checks, receipts, hashes, and verified effects |

## Any-to-any routing

Every registered worker can request another compatible worker through IFZ.

Examples:

- Codex requests one AGR worker and one RCT reviewer.
- AGR-2 requests OCR-1 for a computer task.
- OCR-1 requests Codex for code review.
- RCT requests five AGR workers in parallel.
- AGR-5 requests AGR-1, OCR-2, and RCT in sequence.

Workers do not send directly to each other. They submit a route request to IFZ.

IFZ checks the destination, capability, workspace, scope, authority, limits, and delivery history before dispatch.

This rule gives the product one place to stop circular routes, duplicate sends, scope growth, and conflicting writes.

## Worker registry

Each adapter registers a worker manifest.

The manifest contains:

- A stable worker identity.
- A worker type and adapter identity.
- Current availability and observation time.
- Supported actions and tools.
- Supported context and attachment types.
- Project and workspace identity.
- Read, write, create, execute, and external-send capabilities.
- Concurrency and usage limits.
- Delegation permissions.
- Cancellation and resume support.
- Health and qualification evidence.

The interface builds worker choices from this registry. It must not hardcode AGR, OCR, RCT, or Codex relationships.

A future adapter can register another worker without a navigation redesign.

## Task envelope

IFZ creates one task envelope for each assignment.

The envelope contains:

- A task identity.
- A run identity.
- A conversation identity.
- A parent task identity when delegated.
- A source worker identity.
- One or more destination identities.
- The user objective.
- The selected Master Prompt version.
- The permitted context package.
- The project and canonical workspace.
- Read, write, create, check, and external scopes.
- Execution strategy.
- Worker, depth, time, and usage limits.
- Required checks and receipt format.
- A cancellation identity.

The envelope cannot increase authority when a worker delegates.

## Routing modes

The IFZ prompt bar supports three modes.

### Automatic

IFZ selects compatible workers and proposes a route.

The route appears before submission when worker choice changes the effect or shared context.

### Manual

The user selects exact workers or fleets.

The prompt still enters IFZ. IFZ dispatches only to the selected destinations.

### Saved workflow

The user selects a reusable route template.

Initial execution strategies are:

- Parallel.
- Sequential.
- Review chain.
- First verified result.
- Compare results.
- Bounded delegation.

## Routing controls

IFZ enforces these controls:

- A maximum delegation depth.
- A maximum worker count.
- A maximum active branch count.
- No repeated worker-task pair.
- No circular route.
- One run identity across the route.
- Exact workspace binding.
- Context-sharing records.
- Effect-time authority checks.
- Usage reservation before external inference.
- Cancellation propagation.
- Idempotent delivery receipts.
- Conflict control for shared files.
- Reconciliation before retry after uncertain delivery.

Idle, connected, or self-reported completion does not prove accepted completion.

## Master Prompt system

The application includes a Master Prompt section under Settings.

The Master Prompt has four layers.

### ZETRO Charter

The Charter defines the product purpose, IFZ authority, verification rules, privacy rules, and delegation limits.

Only the user can replace the Charter.

### Worker Knowledge

ZETRO generates this layer from the worker registry.

It explains the worker identity, capabilities, tools, message protocol, delegation method, and receipt format.

### Project Context

This layer contains the current product structure, milestone, accepted work, pending work, ownership, relevant files, and checks.

The context is bounded and versioned. A fresh worker does not receive an uncontrolled full transcript.

### Task Package

This layer contains the exact user request, route position, owned paths, allowed actions, limits, checks, and required output.

## Fresh-worker boot package

IFZ sends this ordered package to a fresh worker:

1. Send the ZETRO Charter.
2. Send the worker identity and capability contract.
3. Send the current project context.
4. Send the selected Master Prompt preset.
5. Send the task package.
6. Send the allowed tools and scope.
7. Send the required evidence.
8. Send the delegation and receipt protocols.

The worker acknowledges its identity, workspace, context version, task, and scope before IFZ marks the dispatch submitted.

## Master Prompt presets

The first presets are:

| Preset | Purpose |
| --- | --- |
| ZETRO Standard | Normal product work |
| ECO Mode | Small context, focused reads, and bounded checks |
| Build Mode | Implementation with focused verification |
| Review Mode | Read-only inspection and evidence |
| Design Mode | Product and interface work |
| Qualification Mode | Strict independent testing |
| Recovery Mode | Inspect interrupted work before dispatch |
| Custom | User-managed instructions |

A preset changes task guidance. It cannot weaken authority or security policy.

Each run records its Master Prompt version and context versions.

## Product information architecture

The product has six primary pages.

| Page | Purpose |
| --- | --- |
| Work | IFZ conversations, prompts, routes, and active execution |
| Workers | Worker registry, fleets, capabilities, assignments, and qualification |
| Runs | Queued, active, completed, failed, cancelled, and uncertain routes |
| Computer | ZETRO computer sessions, permissions, status, and evidence |
| Evidence | Independent checks, receipts, changes, and route history |
| Settings | Master Prompt, adapters, permissions, providers, limits, and appearance |

Work is the default page.

The current Overview content becomes a compact empty-work state. It is not a separate primary page.

RCT Readiness moves into the RCT worker detail and Evidence pages.

Activity becomes the Runs timeline.

Roadmap moves out of primary navigation.

Component showcases and simulations move into a marked development lab.

## Work page

The Work page contains:

- A conversation list.
- One unified conversation stream.
- IFZ route plans and dispatch receipts.
- Worker public status events.
- Worker results and questions.
- Expandable delegation branches.
- Change and check summaries.
- The fixed IFZ prompt bar.

The conversation shows actual events. It cannot invent progress from a worker state.

Private model reasoning never appears. Workers send short public status text.

## IFZ prompt bar

The prompt bar follows the compact Codex composer pattern.

It supports multiline text, attachments, files, images, project context, and route selection.

The left controls are:

- Add context.
- Open the IFZ routing menu.
- Select a Master Prompt preset.

The right controls are:

- Inspect the route preview.
- Send the prompt.
- Stop the active run.

Manual worker choices appear as compact route chips.

Advanced route controls remain inside the IFZ menu.

The prompt bar can suggest a route. It cannot dispatch until the user sends the prompt.

## Conversation events

The conversation supports these event types:

- User prompt.
- IFZ route plan.
- Worker request.
- Worker public status.
- Worker result.
- Verification result.
- Handoff.
- Question.
- Approval request.
- Failure.
- Cancellation.

Each entry records the producing worker and requesting worker.

## Workers page

The Workers page shows each worker in aligned rows.

Each row shows:

- Worker identity.
- Adapter.
- Availability.
- Current assignment.
- Last observation age.
- Active run count.
- Review state.

The product distinguishes idle, available, running, reported complete, verified complete, unavailable, interrupted, and uncertain.

The worker detail shows capabilities, route permissions, workspace, limits, current task, recent runs, and evidence.

## Runs page

A run represents the complete route created from one IFZ prompt.

The run detail shows:

- The original prompt.
- The Master Prompt version.
- The route plan.
- Worker branches.
- Dispatch receipts.
- Public status events.
- Results and errors.
- File changes.
- Checks and evidence.
- Cancellation and recovery state.
- Final acceptance.

## Computer page

The Computer page shows one focused computer session.

It includes:

- The access state.
- The ZETRO Orb.
- A simple lifecycle state.
- Smart public subtext.
- The current computer task.
- Requested permissions.
- Stop and Escape controls.
- Recent actions and evidence.

The page clearly labels simulation and native access.

Cursor, Orb, and component experiments belong in the development lab.

## Evidence page

Evidence is grouped by run.

It shows verification receipts, checks, hashes, changed files, effects, and acceptance limits.

Worker self-reports remain separate from independent verification.

## Settings page

Settings contains:

- The ZETRO Charter.
- Worker Knowledge templates.
- Project Context versions.
- Task Package templates.
- Master Prompt presets.
- Worker adapters.
- Route limits.
- Context-sharing rules.
- Computer permissions.
- Provider configuration.
- Appearance.
- Diagnostics.

## Product shell

The shell uses a unified five-dock system paired with non-disturbing floating side cards:

- **Floating top navigation bar (`CardNav`)**: Centered top pill with expandable megamenu, constrained to `max-width: 980px`, pinned at `top: 14px`, with dynamic collision clearance padding.
- **Central bottom navigation dock (`.dock-center`)**: Primary route switcher (7 destinations + refresh) with interactive spring magnification.
- **Left bottom utility dock (`.dock-bottom-left`)**: Horizontal utility launcher (Notifications, Search, Conversations, Command Palette).
- **Right bottom utility dock (`.dock-bottom-right`)**: Horizontal utility launcher (Route, Context, Inspector, Appearance, Fullscreen, Workspaces, More).
- **Left vertical compact dock (`.dock-side-left`)**: Duplicated from the left bottom dock, positioned vertically over the top-left area (`top: 14px`, `left: 32px` on desktop, `18px` on $\le 1280\text{px}$), width `68px`, pill roundness 1 (`border-radius: 34px`), springing rightwards (`+X`).
- **Right vertical compact dock (`.dock-side-right`)**: Duplicated from the right bottom dock, positioned vertically over the top-right area (`top: 14px`, `right: 32px` on desktop, `18px` on $\le 1280\text{px}$), width `68px`, pill roundness 1 (`border-radius: 34px`), springing leftwards (`-X`).
- **Left floating card (`aside.left-side-card`)**: Floating panel (`width: 260px` matching Command Palette geometry, `top: 14px`, `border-radius: 24px`, `max-height: calc(100vh - 112px)`), completely free of modal dark scrims.
- **Right floating card (`aside.right-side-card`)**: Floating panel (`width: 420px`, `top: 14px`, `border-radius: 24px`, `max-height: calc(100vh - 112px)`), tabbed for Route, Context, and Inspector.

The IFZ prompt bar sits above the center dock on the Work page.

### Motion, Physics, and Global Intro Sequence

All five docks share unified spring physics `{ mass: 0.1, stiffness: 150, damping: 12 }` and transition timing `cubic-bezier(0.22, 1, 0.36, 1)`.
- **Opposite Direction Springs**: Bottom dock items hop upwards (`-Y`), left vertical dock items hop rightwards (`+X`), and right vertical dock items hop leftwards (`-X`).
- **CardNav-Style Expand/Collapse**: Expanding from vertical compact dock to side card executes custom CSS keyframe spring unrolls (`cardNavSideExpandLeft`/`cardNavSideCollapseLeft` and `cardNavSideExpandRight`/`cardNavSideCollapseRight`) mirroring the top CardNav opening physics.
- **Global Intro Orchestration**: Component mounts execute a choreographed staggered unroll:
  1. Top Nav (`CardNav`): Delay `0ms`
  2. Center Dock: Delay `60ms`
  3. Left Side Dock: Delay `120ms`
  4. Right Side Dock: Delay `150ms`
  5. Bottom Utility Docks: Delay `180ms`

### Mutual Exclusivity and Collision Clearance

To guarantee zero visual collision between the expanded top megamenu and floating side cards across all viewports:
- **Mutual Exclusivity Protocol**: Expanding either side card dispatches `window.dispatchEvent(new CustomEvent('zetro:close-top-nav'))`. Opening the top megamenu dispatches `window.dispatchEvent(new CustomEvent('zetro:collapse-panels'))`.
- **Dynamic Wrapper Clearance**: When a side card expands, DOM attributes `data-left-expanded` or `data-right-expanded` are set on `document.body`. The top navigation container dynamically transitions its padding:
  - `body[data-left-expanded] .cardnav-wrapper { padding-left: 312px; }` (preserving a 20px–52px clearance margin)
  - `body[data-right-expanded] .cardnav-wrapper { padding-right: 472px; }` (preserving a 20px–52px clearance margin)
- **Base Padding**: `.cardnav-wrapper` uses `padding: 0 116px` (desktop), `0 100px` ($\le 1280\text{px}$), and `0 14px` ($\le 768\text{px}$).

### Smart Responsive Shrink (Horizontal & Vertical)

To ensure zero overlap across all viewport dimensions, the shell employs multi-tier responsive scaling:
- **Bottom Docks Horizontal Scaling**: Dynamically adjusts item sizes (`50px` $\rightarrow$ `44px` $\rightarrow$ `38px` $\rightarrow$ `32px`), gaps (`10px` $\rightarrow$ `8px` $\rightarrow$ `6px` $\rightarrow$ `4px`), and panel heights (`68px` $\rightarrow$ `60px` $\rightarrow$ `52px` $\rightarrow$ `46px`). This guarantees a minimum floating clearance of `33px` to `124px` between the center and right utility docks across laptop screens (1440px, 1366px, 1280px, 1150px, 1050px).
- **Proportional Icon Resizing**: SVG icons inside dock buttons automatically scale via `calc(var(--dock-base) * 0.42)`.
- **Vertical Floating Card Clearance**: Both floating side cards are bounded to `max-height: calc(100vh - 112px)` (`top: 14px`, `bottom: 98px`), ensuring a guaranteed 8px–24px floating gap above bottom docks.
- **Vertical Compact Dock Scaling**: Compact vertical docks scale down item sizes at short viewport heights ($\le 680\text{px}$: `40px`, $\le 540\text{px}$: `34px`) and sit cleanly above bottom docks with $> 150\text{px}$ clearance.

### Dynamic Accent Badge Reflection

Docks and side card badges dynamically reflect the active theme accent (`mint`, `cyan`, `violet`, `amber`, `rose`, `silver`):
- Dock badges use `var(--dock-badge, var(--accent, #3fb950))` with `var(--dock-badge-ink, #ffffff)` and glow `rgba(var(--mb-glow-rgb), 0.45)`.
- High-contrast compliance: The `silver` accent automatically switches badge ink to `#090a0c` for WCAG AA contrast.
- Side card indicators (`.left-nav-item-badge.active`, `.right-nav-tab-badge.active`, `.right-nav-diff-badge`, `.right-nav-pulse-dot`) observe `data-accent` mutations on `<html>` and dynamically harmonize colors and box-shadow glows.

## Center dock

The center dock contains these destinations in order:

1. Work with the IFZ Orb icon.
2. Conversations.
3. Workers.
4. Runs.
5. Computer.
6. Evidence.
7. Settings.
8. Refresh.

Keeps active pill indicators, dock magnification, and spring physics. RCT Readiness and Roadmap are moved to secondary inspection.

## Left utility dock and panel

The left utility system provides dual representations:
- **Compact Vertical Dock (`.dock-side-left`)**: Positioned at `top: 14px`, `left: 32px` (`18px` on $\le 1280\text{px}$), width `68px`, with icons for Notifications, Global Search, Conversations, and Command Palette. Hover spring direction hops $+X$ into the canvas.
- **Floating Left Card (`aside.left-side-card`)**: Unrolls from the compact dock to `width: 260px` (matching the Command Palette modal geometry). Contains recent conversations, project workspaces, and saved routes. Transparent non-disturbing shield (`.left-nav-shield`) enables click-away collapse without darkening the canvas.
- **State Persistence**: Remembers open/collapsed state across sessions via `localStorage.getItem('zetro_left_panel_collapsed')`.

## Right utility dock and panel

The right utility system provides dual representations:
- **Compact Vertical Dock (`.dock-side-right`)**: Positioned at `top: 14px`, `right: 32px` (`18px` on $\le 1280\text{px}$), width `68px`, with icons for Route, Context, Inspector, Appearance, Fullscreen, Workspace Switcher, and More. Hover spring direction hops $-X$ into the canvas.
- **Floating Right Card (`aside.right-side-card`)**: Unrolls from the compact dock to `width: 420px`. Contains tabbed views for Route, Context, and Inspector. Transparent non-disturbing shield (`.right-nav-shield`) allows the operator to maintain continuous visual supervision of active agent streams or computer sessions.
- **State Persistence**: Remembers open/collapsed state and selected tab via `localStorage.getItem('zetro_right_panel_collapsed')` and `localStorage.getItem('zetro_right_panel_tab')`.

## Top navigation and menu

The floating top navigation (`CardNav`) sits at `top: 14px`, centered, constrained to `max-width: 980px`.

The closed state shows:
- Menu button on the left.
- The ZETRO mark and current page in the center.
- Connection, workspace, and IFZ on the right.

The open megamenu expands downwards using card unroll physics, grouping links under Product, IFZ, and System:
- **Product**: Work, Workers, Runs, Computer, Evidence.
- **IFZ**: Master Prompt, Presets, Saved Routes, Worker Registry.
- **System**: Connections, Permissions, Appearance, Diagnostics, Development Lab.

Opening the menu automatically collapses side panels to prevent collisions.

## One navigation registry

Define one route registry for the application.

The top menu, center dock, side docks, page title, keyboard shortcuts, and responsive menu consume the same registry.

The canonical route names are:

- work
- workers
- runs
- computer
- evidence
- settings

Worker groups, conversations, and saved routes use dynamic registries.

Remove duplicate hardcoded labels and route handling from individual components.

## Global visual system

Use Satoshi throughout the product.

Use a black, white, and graphite palette.

| Token | Value |
| --- | --- |
| Canvas | #08090A |
| Surface | #111216 |
| Raised surface | #17181D |
| Primary text | #F4F4F2 |
| Secondary text | #9B9DA4 |
| Quiet text | #696C74 |
| Divider | rgba(255,255,255,0.09) |
| Active | #FFFFFF |

Use semantic green, amber, and red only for real state.

Use one 4px spacing scale: 4, 8, 12, 16, 24, 32, and 48px.

Use 14px to 16px product text. Reserve 12px for metadata and dense controls.

Place information on surfaces. Avoid unnecessary nested cards.

Keep dock magnification. Reduce decorative motion while work runs.

Support reduced motion, visible focus, keyboard navigation, and high contrast.

Keep the Tweak panel as a development tool for density and panel layout review.

## Responsive behavior

Wide desktop can keep both side panels open.

A standard laptop opens one side panel at a time.

Tablet uses overlay side sheets.

Mobile uses one compact bottom dock. Conversations and Inspector open as full-height sheets.

The IFZ prompt remains the main mobile action.

## Adapter boundary

Each worker type implements one adapter contract.

The contract supports:

- Register capability.
- Check availability.
- Submit a task.
- Stream public events.
- Return a structured result.
- Cancel a task.
- Resume or reconcile when supported.
- Report usage.
- Submit evidence.
- Request another worker through IFZ.

The renderer never receives provider credentials.

Live inference remains disabled until its existing authorization and provider checks pass.

## Initial complete routes

The first sequential route is:

User to IFZ to RCT to AGR implementation to RCT review to the Work page.

The first parallel route is:

User to IFZ to AGR-1, AGR-2, and OCR-1 to RCT synthesis.

The first fleet route is:

User to IFZ to five AGR instances with one bounded task per instance.

## Delivery phases

### Phase 0: Contracts

Define the worker manifest, task envelope, events, route plan, context package, and receipt contracts.

### Phase 1: Product shell (Completed & Verified)

Build the global route registry, top menu, three horizontal bottom docks, two vertical compact docks, non-disturbing floating side cards, unified spring physics, dynamic accent badge reflections, responsive smart shrink, and mutual exclusivity collision clearance.
*(Status: Fully implemented and verified across 20 test suites and headless browser audits.)*

### Phase 2: Work page (Completed & Verified)

Build conversations, the IFZ prompt bar, route preview, branch display, and public status events.
*(Status: Fully implemented and verified. Integrates React Bits `<PromptBar />` with morphing SendGlyph physics, canvas particle sparks at Max effort, `@` fleet mentions, `/` commands, route preview modal, expandable worker sub-task branches, and truthful dry-run execution stream. Guaranteed 10px floating clearance above bottom docks with zero overlap.)*

### Phase 3: Worker and run models

Build the worker registry, Workers page, run store, Runs page, cancellation, and recovery views.

### Phase 4: Adapters

Connect AGR, OCR, RCT, and Codex through the shared adapter contract.

Do not claim Codex dispatch support until the available Codex interface proves controlled submission and observation.

### Phase 5: Master Prompt (Completed & Verified)

Build versioned Charter, Worker Knowledge, Project Context, Task Package, presets, and fresh-worker acknowledgment.
*(Status: Fully implemented and verified. Features 4-layer Master Prompt Modal Inspector covering Layer 1 ZETRO Charter, Layer 2 Worker Knowledge, Layer 3 Project Context, Layer 4 Task Package, and instant 8-preset switcher synchronized across composer and navigation.)*

### Phase 6: Evidence and Computer

Move verification into Evidence. Refactor the Computer preview into a qualified session page.

### Phase 7: IFZ automatic routing

Add capability-based route suggestions and automatic routing after manual routes pass acceptance.

### Phase 8: Product qualification

Test all-worker execution, cancellation, unavailable workers, partial failure, uncertain delivery, duplicate prevention, conflicts, context limits, accessibility, and responsive layouts.

## Acceptance requirements

The update is accepted only when:

- One route registry controls every navigation surface.
- The top menu and docks always share active state.
- Browser back, forward, refresh, and copied routes work.
- The IFZ prompt preserves content across page changes.
- Manual routing dispatches only to selected workers.
- Automatic routing shows its route and evidence.
- Any permitted worker can request any compatible worker through IFZ.
- Delegation cannot expand authority or budgets.
- Uncertain delivery cannot cause a blind retry.
- Cancellation reaches every active branch.
- A fresh worker receives the exact versioned boot package.
- Conversations show real events and public status only.
- Worker self-report remains separate from independent verification.
- Simulation and native computer states remain distinct.
- Side panels, docks, menus, and prompt controls work by keyboard.
- Product layouts pass desktop, laptop, tablet, and mobile review.

## Current implementation boundary

The existing control center is a local read-only preview with hash-based views and duplicate navigation definitions.

The current three docks, top navigation shape, Satoshi typography, Orb, and status design are reusable product assets.

The current dashboard content, component showcases, preview controls, and duplicated route definitions are not the target product architecture.

This document authorizes planning and implementation design. It does not authorize provider transmission, native input, deployment, publication, or automatic Git operations.

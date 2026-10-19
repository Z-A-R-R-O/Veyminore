# Worker AGR-5: IFZ Work Page & Master Prompt Composer

## 1. Overview & Architectural Isolation
In accordance with `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` (Phase 2: Work Page), isolated source modules were constructed for the unified Work page and composer:
- **Scope strictly bounded**: Built isolated modules without integrating them into the live app in this wave.
- **Preserved existing components**: Left `MagicRings.jsx`/`.css`, `ThoughtLine.jsx`/`.css`, `Orb.jsx`/`.css`, `orb-island.jsx`, `server.mjs`, and generated bundles 100% untouched.
- **Zero new dependencies**: Built with existing React and modern CSS without external packages.
- **Zero live network or model calls**: Operates with honest local state fixtures and dry-run submission guards.

---

## 2. Core Components & Implementations

### A. IFZ Work Model (`apps/control-center/src/ifz-work-model.js`)
1. **Central Orchestrator Targeting**:
   - Invariant: The prompt *always* targets IFZ (`target: 'IFZ (Central Orchestrator)'`).
   - Supports 3 routing modes:
     - `automatic`: IFZ plans and selects compatible workers dynamically.
     - `manual`: User constrains IFZ to specific worker destinations (e.g., `['AGR-1', 'RCT-1']`). Manual selection constrains IFZ; it does *not* bypass IFZ.
     - `saved_workflow`: Pre-defined reusable execution strategies (e.g. `Sequential Review Chain`, `Parallel Fleet`, `First Verified Result`, `Bounded Delegation`).
2. **Master Prompt Presets**:
   - Integrates 8 versioned presets: `ZETRO Standard`, `ECO Mode`, `Build Mode`, `Review Mode`, `Design Mode`, `Qualification Mode`, `Recovery Mode`, and `Custom`.
3. **Draft State Persistence**:
   - Persists draft text, attachments, manual worker constraints, presets, and route modes across fixture switches and page-model transitions.
4. **8 Honest State Fixtures**:
   - `empty`: Idle session with zero events and quick-start prompt suggestions.
   - `loading`: Loading context package and worker manifests.
   - `disconnected`: Clear offline warning banner when the IFZ gateway is unreachable.
   - `running`: Active execution with elapsed timer, live worker status, and Stop control.
   - `partial_failure`: Multi-worker run where implementation succeeded but visual verification timed out.
   - `uncertain`: Uncertain delivery requiring reconciliation before retry (no blind retries).
   - `cancelled`: Clean cancellation propagation after user Stop / Esc.
   - `complete`: Fully verified and accepted run with independent RCT receipts.
5. **Worker Branching & Privacy**:
   - Models expandable worker sub-tasks (`branchId` with nested sub-events).
   - Invariant enforced: Zero private model reasoning or raw tokens in public status text.

### B. Compact IFZ Prompt Bar (`apps/control-center/src/ifz-prompt-bar.jsx`)
1. **Codex Composer Pattern**:
   - Auto-expanding multiline textarea (40px to 220px max).
   - Clean route chips bar showing target (`To: IFZ`), constraint tag, worker chips with remove buttons, workflow badges, and attachment chips.
   - Public route preview card (`Inspect route preview`) showing destination, strategy, hops, and authority scope.
2. **Controls**:
   - Left: File attachment button (`📎`), Routing mode dropdown with worker toggle chips, Master Prompt preset dropdown.
   - Right: Active Stop button (`■ Stop Esc`) when running, Send button (`Send ↑`).
3. **Accessibility & Hotkeys**:
   - `Enter` submits prompt (when not empty).
   - `Shift+Enter` inserts new line.
   - `Escape` closes menus/popovers, returns focus to trigger buttons, or stops active execution if running.
   - Accessible roles (`aria-label`, `aria-expanded`, `aria-haspopup`, `aria-modal`).

### C. Unified Work Page View (`apps/control-center/src/ifz-work-page.jsx`)
1. **Header**:
   - Connection indicator (`IFZ Gateway Online` / `Gateway Offline`).
   - Run status badge and active run identifier.
   - Interactive fixture selector allowing coordinator to preview all 8 honest states.
2. **Conversation Stream**:
   - Unified feed of structured event cards: `user_prompt`, `ifz_plan`, `worker_request`, `worker_status`, `worker_result`, `verification_result`, `handoff`, `question`, `failure`, `cancellation`.
   - Distinct visual stamps for independent verification (`✔ VERIFIED` vs `✖ FAILED`).
   - Expandable worker branches with toggle buttons and clean nested sub-event logs.
3. **Footer**:
   - Fixed composer positioned above dock area with semi-transparent backdrop gradient.

### D. Styling (`apps/control-center/public/ifz-work.css`)
- Styled in accordance with ZETRO's Satoshi, black/white/graphite palette (`#08090A` canvas, `#111216` surface, `#17181D` raised surface, `#F4F4F2` text).
- 4px spacing scale and subtle dividers (`rgba(255, 255, 255, 0.09)`).
- Full support for `prefers-reduced-motion` with instant transitions.

---

## 3. Verification & Results

### A. Model Unit Tests
Run command: `node --test apps/control-center/test/ifz-work-model.test.mjs`
```
✔ ifz-work-model: initial state and snapshot structure (1.95ms)
✔ ifz-work-model: route preview always targets IFZ across all route modes (1.68ms)
✔ ifz-work-model: draft text and parameters persist across fixture switches and updates (0.55ms)
✔ ifz-work-model: manual worker constraint toggle keeps at least one worker (0.45ms)
✔ ifz-work-model: attachments can be added and removed (0.43ms)
✔ ifz-work-model: worker branch expansion toggling (0.30ms)
✔ ifz-work-model: all 8 honest fixtures are valid, structured, and contain zero private reasoning (0.56ms)
✔ ifz-work-model: dry-run submission guard does not perform live network calls (1.85ms)
✔ ifz-work-model: stopActiveRun halts execution and appends cancellation event (0.67ms)
ℹ tests 9
ℹ pass 9
ℹ fail 0
```

### B. Control-Center Full Suite
Run command: `pnpm --filter @zetro/control-center test`
- All 20 tests passed (including `server.test.mjs`, navigation tests, and `ifz-work-model.test.mjs`).

### C. Temporary In-Memory esbuild Syntax Check
Run command:
```bash
node -e "import('esbuild').then(esbuild => esbuild.build({
  entryPoints: ['src/ifz-work-page.jsx', 'src/ifz-prompt-bar.jsx'],
  bundle: true, write: false, outdir: 'virtual_out', format: 'esm', jsx: 'automatic',
  external: ['react', 'react-dom']
})).then(res => console.log('Temporary in-memory esbuild syntax check PASSED! Output files:', res.outputFiles.length))"
```
Result:
```
Temporary in-memory esbuild syntax check PASSED! Output files: 2
```
Zero tracked bundles or build configurations were modified.

---

## 4. Integration Limits & Next Steps
- **Current Wave**: Modules remain isolated in `apps/control-center/src/` and `public/ifz-work.css`.
- **Live App Boundary**: The current live application (`server.mjs`, `index.html`, `app.js`) continues serving the existing control center and computer preview without disruption.
- **Future Integration Wave**:
  - Expose `/work` route in navigation registry.
  - Mount `IfzWorkPage` root when navigation route is `'work'`.
  - Connect live adapter websocket/polling stream when Phase 4 adapter endpoints are activated.

---

## 5. Rework & Hardening Receipt (Wave 2)

Following review against `docs/IFZ-UNIFIED-APP-ARCHITECTURE.md` and strict production guidelines, the following hardening and truthfulness rework was executed:

### A. Truthful Defaults
- **Default State**: Initial state without supplied fixture is now strictly `DEFAULT_UNVERIFIED_STATE`:
  - `status: 'unknown'`
  - `connection: 'unknown'`
  - `events: []`
  - `activeRun: null`
  - `stats: { totalEvents: 0, verifiedCount: 0, pendingCount: 0 }`
- **Zero Hallucinated Evidence**: The page never renders as connected, running, accepted, or verified unless explicit, validated evidence is supplied.

### B. Icon Accessibility & High-Fidelity SVGs
- **Complete Emoji Elimination**: All emoji/text symbols (`📎`, `✕`, `→`, `×`, `⚡`, `■`, `↑`, `▾`, `⚠️`, `✦`, `✔`, `✖`) were replaced with clean, lightweight inline SVGs:
  - `PaperclipIcon`, `CloseIcon`, `ArrowUpIcon`, `StopSquareIcon`, `ArrowRightIcon`, `ChevronDownIcon`, `ChevronRightIcon`, `WorkflowIcon`, `AlertTriangleIcon`, `SparkleIcon`, `CheckCircleIcon`, `XCircleIcon`.
- **Accessible Attributes**: Every icon button has an explicit, accessible `title` tooltip and matching `aria-label`. Decorative SVG elements carry `aria-hidden="true"`.

### C. Developer Lab Fixture Isolation
- **Product UI Purity**: Developer fixture dropdowns are hidden by default (`devLab: false`).
- **Gated Rendering**: The fixture selector in `ifz-work-page.jsx` renders strictly when `{isDevLabActive && ...}`, isolating testing controls from user-facing UI.

### D. Truthful Dry-Run Mutation Guard
- **Visibly Truthful**: The composer bar displays a permanent `.dry-run-status-text` badge ("Dry-run preview") with a tooltip indicating live mutation APIs require authenticated IFZ tokens.
- **Dry-Run Notice**: Submissions return `{ success: true, dryRun: true, notice: '...' }` and append dry-run envelope notices to the local stream without simulating synthetic completions or invoking network mutations.

### E. Deterministic Clocks & ID Generators
- **Dependency Injection**: `createIfzWorkModel({ clock, idGenerator })` accepts deterministic clock and ID generator functions.
- **Zero Nondeterminism**: All calls to `Date.now()` and `Math.random()` were excised from the domain model.

### F. Routing Invariants & Suggestion Safety
- **Central IFZ Recipient**: All route previews and envelopes target IFZ (`target: 'IFZ (Central Orchestrator)'`).
- **Manual Constraint**: Manual worker selection constrains IFZ (`isConstrained: true`), never bypassing IFZ orchestration.
- **No Auto-Send**: Empty state prompt suggestions and preset menu clicks strictly populate draft text; they never auto-send or mutate the event stream without explicit user submission.

### G. Test Verification & Receipts
- **Unit Test Suite**: `node --test apps/control-center/test/ifz-work-model.test.mjs`
  - 14 focused tests verifying truthful defaults, devLab isolation, deterministic clocks/IDs, suggestion safety, branch toggling, and dry-run boundaries. All 14 passed.
- **Control Center Suite**: `pnpm --filter @zetro/control-center test`
  - All 28 package tests passed.
- **In-Memory esbuild JSX Syntax Check**:
  - `esbuild.build({ entryPoints: ['src/ifz-work-page.jsx', 'src/ifz-prompt-bar.jsx'], bundle: true, write: false, outdir: 'virtual_out', format: 'esm', jsx: 'automatic', external: ['react', 'react-dom'] })`
  - Passed cleanly with 0 disk writes and 0 errors.

---

## 6. Truthful-Default Hardening Receipt (Wave 2 Rework 2)

Following UI review of truthful-default violations, four strict adjustments were implemented:

### 1. Workspace Neutrality in `DEFAULT_UNVERIFIED_STATE`
- Excised invented name `"Default Workspace"`: `name: null` and `workspace: null`.
- Excised `"Bounded to current workspace"` claim: `authorityScope` is now strictly `null` (rendering neutral `"Authority: Unavailable (no admitted workspace)"`) unless valid, admitted workspace evidence is provided.

### 2. Manual Mode Zero-Worker Invalidation & Send Rejection
- Default `draft.manualWorkers` is `[]` (empty array); completely removed silent fallback to `['AGR-1']`.
- Toggling manual workers allows deselecting all workers without artificial lower bounds.
- When `manualWorkers` is empty in manual mode:
  - `routePreview.isValid` is `false`, with `validationError: 'Manual route constraint requires at least one selected worker'`.
  - Chips bar displays `.route-invalid-tag` with `"No worker selected"`.
  - Send button is disabled (`disabled={isSendDisabled}`) with accessible explanatory title.
  - `submitPrompt()` rejects with `{ success: false, reason: 'Manual route constraint requires at least one selected worker' }`.

### 3. Removal of Route & Worker Claims from Empty-State Example Cards
- Relabeled all empty-state cards as `"EXAMPLE TEMPLATE · <CATEGORY>"`.
- Removed all premature worker and route claims (`AGR-3`, `RCT-1`, `AGR-2`, `OCR-1`, sequential workflow receipt claims).
- All cards now truthfully state: `"Example prompt · Routing planned by IFZ upon dispatch"`.

### 4. Zero Connected/Worker/Route Claims in Default No-Fixture State
- Default `.conn-dot` is neutral quiet gray (`#696c74`), turning green strictly when `connection === 'connected'`.
- Header connection text in unknown state is `"Connection Unknown · No Evidence"`.
- `availableWorkers` is `[]` in the default unverified state; dropdown renders `"No admitted workers registered"` instead of falsely asserting 10 online workers.
- `routePreview.assignedWorkers` is `[]` and `routePreview.authorityScope` is `null`.

### 5. Verification Results
- **Focused Unit Tests**: `node --test apps/control-center/test/ifz-work-model.test.mjs`
  - 15/15 tests passing, including dedicated tests for workspace neutrality, manual zero-worker invalidation and rejection, and zero connected/worker/route claims from default state.
- **Control Center Package Tests**: `pnpm --filter @zetro/control-center test`
  - 35/35 tests passing cleanly.
- **In-Memory esbuild JSX Syntax Check**:
  - `entryPoints: ['src/ifz-work-page.jsx', 'src/ifz-prompt-bar.jsx']`
  - 0 errors, 0 disk writes (`write: false`).



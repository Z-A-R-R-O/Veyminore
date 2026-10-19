# Receipt: IFZ Product Shell Modules

- **Task**: IFZ product shell modules
- **Worker**: AGR-4
- **Coordinator**: Codex
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Files**:
  - [`apps/control-center/src/product-shell.jsx`](file:///E:/Veyminore/products/zetro/apps/control-center/src/product-shell.jsx)
  - [`apps/control-center/src/product-navigation.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/product-navigation.js)
  - [`apps/control-center/public/product-shell.css`](file:///E:/Veyminore/products/zetro/apps/control-center/public/product-shell.css)
  - [`apps/control-center/test/product-navigation.test.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/test/product-navigation.test.mjs)
  - [`docs/execution/AGR-4-ifz-product-shell.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-4-ifz-product-shell.md)
- **Status**: `ready_for_review`
- **Baseline Revision**: `90db896ea4efd67cb7eb086fcf81b35a1e5e1291`

---

## 1. Architectural Summary & Scope Boundaries

Per [`docs/IFZ-UNIFIED-APP-ARCHITECTURE.md`](file:///E:/Veyminore/products/zetro/docs/IFZ-UNIFIED-APP-ARCHITECTURE.md) and the review rework specifications in [`docs/execution/AGR-4-ifz-product-shell-rework.task.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-4-ifz-product-shell-rework.task.md), the product shell architecture has been implemented as **isolated source modules** without integrating them into live application bundles in this wave.

### Preserved Boundaries & Invariants
- **Unmodified Files**: `src/nav-island.jsx`, `src/dock-island.jsx`, `public/app.js`, `public/style.css`, `build.mjs`, and generated bundles (`public/dock.js`, `public/nav.js`, `public/bento.js`, etc.) remain completely untouched.
- **AGR-5 & Worker Paths**: No files in other workers' assigned scopes or shared work page files were modified.
- **Dependencies**: Zero new npm/pnpm dependencies added.

---

## 2. Review Rework Findings & Corrective Implementations

### Rework 1: Truthful Shell Defaults & Focus Return Tracking
1. **Truthful Connection Resolution**:
   - `resolveConnectionStatus(state)`: missing, undefined, null, or malformed values evaluate to `status: 'unknown'`, label `Connection unknown`, and `pulse: false`.
   - Stale observations (`now - connectionObservedAt > ttl` or `stale: true`) evaluate to `status: 'stale'`, label `Connection stale`, `pulse: false`.
   - Active pulse glow (`ps-status-dot--pulse`) renders **strictly** when explicitly verified `connected === true` and unexpired.
2. **Truthful Workspace, Worker Counts, and IFZ Evidence**:
   - `resolveWorkspaceStatus(evidence)`: caller providing no evidence returns `{ id: null, name: 'No workspace', path: null, admitted: false }`. Zero invented paths (`E:/Veyminore/products/zetro`), IDs (`workspace-local`), or labels (`Local workspace`).
   - `resolveIfzStatus(evidence)`: returns `IFZ Unknown` / inactive unless explicitly verified `ifzActive === true`.
   - Neutral props in `ProductShell`: `initialWorkerCount = null`, `initialActiveRunCount = null`, `workspaceName = null`, `connected = undefined`, `ifzActive = undefined`.
3. **Strict Nonnegative Integer Count Badge Formatting**:
   - `formatCountBadge(value)`: accepts strictly integers `> 0`. Rejects `0` (no ghost zero badge), negative numbers, non-integers, strings, booleans, null, or undefined (returns `null`).
4. **Opener Focus Return on Escape**:
   - Deterministic HTML IDs assigned to opener controls (`#ps-menu-trigger`, `#ps-center-tile-*`, `#ps-left-tile-*`, `#ps-right-tile-*`).
   - Reducer tracks `openerId` and populates `returnFocusTo` upon closing transitions and `CLOSE_ALL` (Escape).
   - Component hook refocuses the opener DOM element and dispatches `CLEAR_FOCUS_RETURN`.

### Rework 2: Reliable Tab Exclusion, Focus Traps & Pure URL/History State Helpers
1. **Reliable Side Panel Tab Exclusion**:
   - Closed side panels must not expose focusable controls.
   - Enforced at three levels:
     1. **HTML `inert` attribute**: `<aside id="ps-left-panel" inert={state.leftPanel !== 'conversations' ? '' : undefined}>` and `<aside id="ps-right-panel" inert={!state.rightPanel ? '' : undefined}>`.
     2. **CSS exclusion**: `.ps-panel:not(.ps-panel--open) { visibility: hidden; pointer-events: none; }` completely removes all descendant elements from keyboard focus and the accessibility tree across all browser engines.
     3. **Control tabIndex**: All buttons inside the side panels receive `tabIndex={isOpen ? 0 : -1}` to guarantee zero sequential focus exposure in non-DOM test runners.
2. **Meaningful First Control Focus on Open**:
   - When Left Panel opens: focus automatically moves to `leftCloseRef.current` (close button).
   - When Right Panel opens: focus automatically moves to `rightCloseRef.current` (close button).
   - When Top Menu modal opens: focus automatically moves to the first interactive menu link/button.
   - When Tweak modal opens: focus automatically moves to the first interactive select/button.
3. **Modal Dialog Focus Trapping**:
   - Implemented `trapFocus(container, event)` for modal Top Menu and Tweak dialogs (`role="dialog"`, `aria-modal="true"`).
   - Traps `Tab` and `Shift+Tab` cycles strictly within the active dialog, wrapping between the first and last focusable controls.
   - `Escape` dismisses the modal and restores focus to the opener via `returnFocusTo`.
4. **Pure Canonical URL / Hash / History State Helpers**:
   - Implemented pure, deterministic navigation helpers in [`product-navigation.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/product-navigation.js) with zero DOM/history side effects, keeping wiring isolated for the integration owner:
     - `formatCanonicalHash(routeId)`: Produces `#<routeId>`.
     - `formatCanonicalUrl(routeId, baseUrl)`: Produces canonical URL strings (e.g. `http://localhost:4000/#workers`).
     - `createNavigationHistoryState(routeId, meta)`: Produces pure history state objects (`routeId`, `routeLabel`, `canonicalHash`, `canonicalUrl`, `timestamp`).
     - `parseRouteFromUrl(input, fallback)`: Resolves canonical route from full URLs, relative hashes, pathnames, search params, and Location-like objects (`{ hash, pathname, href }`). Safely handles legacy aliases (`overview` -> `work`, `activity` -> `runs`).
     - `resolveInitialRoute(locationInput)`: Pure helper for route load.
     - `resolveRouteTransition(currentRouteId, targetInput, options)`: Pure helper for forward navigation transitions, returning route changes, canonical URLs, hashes, and history state descriptors.
     - `handlePopState(eventState, locationInput)`: Pure helper for back/forward navigation (`window.onpopstate`), giving priority to valid history state objects and falling back to location parsing.
     - `resolveRefreshRoute(persistedState, locationInput)`: Pure helper for page refresh / rehydration, prioritizing explicit location deep links, then persisted state, then canonical default `work`.
     - `formatShareableRouteUrl(routeId, baseUrl)` & `resolveCopiedRouteUrl(urlString, baseUrl)`: Formats and parses shareable / copied URLs, validating parameters, stripping noise, and identifying canonical targets.

---

## 3. Core Architecture & Requirements Implemented

### 1. Unified Route Registry ([`product-navigation.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/product-navigation.js#L1-L85))
- Defined `CANONICAL_ROUTES`:
  1. `work` (default primary route)
  2. `workers`
  3. `runs`
  4. `computer`
  5. `evidence`
  6. `settings`
- Explicitly removed from primary routes:
  - `readiness` (RCT Readiness moved into RCT worker detail and Evidence pages).
  - `roadmap` / `requirements` (Roadmap moved out of primary navigation into Development Lab / Planning).
  - `orb-preview` (Removed as header CTA; moved into Computer page / Development Lab).
- Backward compatibility: `overview` aliases to `work`; `activity` aliases to `runs`.

### 2. Navigation Projections ([`product-navigation.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/product-navigation.js#L150-L330))
- **Top Menu**: Grouped strictly under `Product`, `IFZ`, and `System`. Header CTA: `null`.
- **Center Main Dock**: Exactly 8 destinations in strict architectural order:
  1. `work` (with IFZ Orb icon indicator)
  2. `conversations` (toggles left panel)
  3. `workers` (with worker count badge)
  4. `runs` (with active run count badge)
  5. `computer`
  6. `evidence`
  7. `settings`
  8. `refresh` (refresh evidence action)
- **Left Utility Dock**: `notifications`, `search (Ctrl+K)`, `conversations`, `command-palette (Ctrl+Shift+P)`.
- **Right Utility Dock**: `route`, `context`, `inspector`, `appearance`, `fullscreen`, `workspaces`, `more`.
- **Responsive Navigation**: Compact routes, mobile bottom sheets, persistent IFZ prompt bar action.

### 3. Isolated React Product Shell ([`product-shell.jsx`](file:///E:/Veyminore/products/zetro/apps/control-center/src/product-shell.jsx))
- Three-dock floating bottom layout with dock tile magnification, active dot indicator, tooltips, and badges.
- Top floating navigation bar with brand mark, active route label, status dot, and grouped flyout menu.
- Sliding Left Panel: Conversations, Workspaces, Saved Routes with `inert` and reliable tab exclusion when closed.
- Sliding Right Panel: Route Plan, Context Package, Run Inspector with `inert` and reliable tab exclusion when closed.
- Modal Dialogs: Grouped Top Menu and Development Tweaks with focus traps (`trapFocus`) and first-control focus.
- Keyboard support: `Escape` closes all overlays and returns focus to opener; `Ctrl+K` invokes quick search.
- Semantic HTML landmarks: `<header role="banner">`, `<nav aria-label="...">`, `<main id="main-content">`, `<aside aria-label="...">`, `role="toolbar"`, `role="tablist"`, `role="dialog"`, `aria-modal="true"`.

### 4. Visual System & Tokens ([`product-shell.css`](file:///E:/Veyminore/products/zetro/apps/control-center/public/product-shell.css))
- Typography: Satoshi throughout with clean system fallbacks.
- Palette: Black (`#08090A` canvas), White (`#FFFFFF` active / `#F4F4F2` primary text), Graphite (`#111216` surface, `#17181D` raised surface, `#9B9DA4` secondary text, `#696C74` quiet text).
- Accents: Green (`#3fb950`), Amber (`#d29922`), Red (`#f85149`), Focus ring (`rgba(140, 230, 184, 0.9)`).
- 4px spacing scale: 4, 8, 12, 16, 24, 32, 48px.
- Accessibility: `@media (prefers-reduced-motion: reduce)` disables dock magnification and transitions; visible focus rings on `:focus-visible`.

### 5. Scoped Development Tweaks
- Display controls (density, detail level, dev lab) are marked with `scope: 'development'`, `authoritative: false`, and render with a prominent warning banner stating that visual preview tweaks cannot weaken security or execution authority.

---

## 4. Verification & Evidence

### 1. Focused Unit Tests ([`test/product-navigation.test.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/test/product-navigation.test.mjs))
```
Command: node --test apps/control-center/test/product-navigation.test.mjs
✔ CANONICAL_ROUTES defines exactly the 6 approved primary product routes (2.15ms)
✔ Legacy and non-primary routes are removed from primary navigation registry (0.41ms)
✔ Route resolution and alias migration handles hashes and invalid inputs (0.23ms)
✔ resolveConnectionStatus handles omitted, false, true, malformed, and stale observations truthfully (0.42ms)
✔ resolveWorkspaceStatus handles omitted, partial, and explicit valid evidence without inventing paths (0.31ms)
✔ resolveIfzStatus does not assume IFZ is active without explicit evidence (0.26ms)
✔ formatCountBadge formats nonnegative integers and rejects omitted/malformed/negative values (0.28ms)
✔ Top menu projection does not invent workspace or connection when caller supplies empty state (0.39ms)
✔ Center dock projection outputs 8 destinations in strict order without inventing badges (0.30ms)
✔ Left and right utility docks format badges strictly from nonnegative integers (1.54ms)
✔ Responsive navigation projection preserves compact routes, sheets, and persistent IFZ action (0.29ms)
✔ Development tweak controls are clearly scoped from product authority (0.36ms)
✔ Navigation state reducer tracks opener control and returns focus on Escape (CLOSE_ALL) (0.54ms)
✔ formatCanonicalHash and formatCanonicalUrl generate pure canonical hashes and URLs (0.37ms)
✔ parseRouteFromUrl and resolveInitialRoute handle route load across hashes, paths, queries, and aliases (0.57ms)
✔ resolveRouteTransition generates pure navigation descriptors without side effects (0.28ms)
✔ handlePopState resolves target route from history state or location fallback during back/forward (0.16ms)
✔ resolveRefreshRoute and resolveCopiedRouteUrl handle refresh and copied share links safely (0.31ms)
✔ Closed side panels and modals guarantee null panel state and clean focus return in reducer (0.28ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 133.59
```

### 2. In-Memory esbuild Syntax & Bundling Check (Zero Disk Writes)
```
Command: node -e "import('./apps/control-center/node_modules/esbuild/lib/main.js').then(async esbuild => { const res = await esbuild.build({ entryPoints: ['apps/control-center/src/product-shell.jsx'], bundle: true, write: false, format: 'esm', target: 'es2022', jsx: 'automatic', external: ['react', 'react-dom', '@hugeicons/react', '@hugeicons/core-free-icons'] }); console.log('Build success, outputs in memory:', res.outputFiles.length); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })"
Result: Build success, outputs in memory: 1
Proof Limits: 1 output file compiled in memory; zero files written to disk; tracked bundles untouched.
```

### 3. Existing Test Regression Check
```
Command: node --test apps/control-center/test/server.test.mjs
✔ local preview protects its read-only projection and exposes only declared evidence (98.16ms)
ℹ tests 1, pass 1, fail 0
```

---

## 5. Integration Limits & Handoff

- **Isolated Status**: All modules are authored and tested strictly in isolation under `apps/control-center/src/` and `apps/control-center/public/`.
- **Handoff to Integration Wave**:
  - Live app bundles (`public/app.js`, `public/nav.js`, `public/dock.js`, `build.mjs`) have not been touched and continue running the existing local preview.
  - Pure navigation and history helpers (`resolveInitialRoute`, `resolveRouteTransition`, `handlePopState`, `resolveRefreshRoute`, `resolveCopiedRouteUrl`) are isolated and ready to be connected to the browser `popstate` / `hashchange` listeners during Phase 1 integration.

# Receipt: IFZ UI Integration

- **Task**: IFZ UI Integration
- **Worker**: AGR-4
- **Coordinator**: Codex
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Files**:
  - [`apps/control-center/build.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/build.mjs)
  - [`apps/control-center/src/index.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/index.js)
  - [`apps/control-center/src/live-integration.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/live-integration.js)
  - [`apps/control-center/public/index.html`](file:///E:/Veyminore/products/zetro/apps/control-center/public/index.html)
  - [`apps/control-center/server.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/server.mjs)
  - [`apps/control-center/test/server.test.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/test/server.test.mjs)
  - [`apps/control-center/test/ui-integration.test.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/test/ui-integration.test.mjs)
  - [`docs/execution/AGR-4-ifz-ui-integration.md`](file:///E:/Veyminore/products/zetro/docs/execution/AGR-4-ifz-ui-integration.md)
- **Status**: `ready_for_review`
- **Baseline Revision**: `90db896ea4efd67cb7eb086fcf81b35a1e5e1291`

---

## 1. Architectural Integration Summary

The accepted IFZ product shell (`ProductShell`) and Work page (`IfzWorkPage`) have been integrated into the live control center application.

### Key Integration Deliverables
1. **Default Live Route (`work`)**:
   - `work` is the default canonical route on live app startup.
   - `IfzWorkPage` mounts directly inside `ProductShell`'s `.ps-work-view` container via dynamic React portals, preserving full React event propagation and lifecycle management.
2. **Preserved UI Identity & Docks**:
   - The three floating bottom docks (Left utility, Center 8-destination main dock, Right utility), sliding side panels (Conversations & Workspaces drawer, Route Context & Run Inspector drawer), and floating top navigation bar are preserved.
   - CSS assets `product-shell.css` and `ifz-work.css` are imported and served by `server.mjs` and linked in `public/index.html`.
3. **Canonical Hash & History Wiring**:
   - Initial load resolves URL/hash via `resolveInitialRoute`. If hash is unformatted, `history.replaceState` canonicalizes the address bar to `#work`.
   - Forward navigation updates history via `resolveRouteTransition` and `history.pushState`.
   - Browser Back / Forward buttons trigger `popstate`, resolved via `handlePopState`, seamlessly updating the shell.
   - Page refresh / rehydration preserves deep-links via `resolveRefreshRoute`.
   - Copied or shared URLs are sanitized and validated via `resolveCopiedRouteUrl`.
4. **Truthful Read-Only Status Projection**:
   - `mapStatusProjection(data)` consumes the `/api/status` read-only snapshot.
   - `workspaceName` reflects `data.workspace` (`Veyminore / ZETRO`).
   - `workspacePath` remains strictly `null` (not declared in snapshot; zero invented filesystem paths).
   - `workspaceId` remains strictly `null`.
   - `connected` evaluates to `false` (boundaries state `liveInference: false`, no persistent daemon connected; pulse inactive).
   - `ifzActive` evaluates to `false` (protected read-only).
   - `workerCount` reflects `data.workers.length`.
   - `activeRunCount` strictly counts verified active workers (`busy`/`running`/`working`), or evaluates to `null` if 0 (no ghost zero count badges).
   - Omitted evidence leaves fields safely `unknown` or `null`.
5. **Strict Read-Only Authority & Dry-Run Composer**:
   - `server.mjs` permits only `GET` and `HEAD` methods; any mutation request (`POST`/`PUT`/`DELETE`) is rejected with `403 Forbidden`.
   - The IFZ prompt bar Composer remains visibly dry-run with preview dispatching; zero unauthenticated write endpoints exist.
6. **Preserved Computer Page & Orb Preview Boundaries**:
   - Navigating to `#computer` renders session details with explicit `SIMULATED RUNTIME · READ-ONLY PREVIEW` disclaimers.
   - Links directly to `/computer-preview/` for standalone desktop and orb simulation without asserting unverified native proof.
7. **Developer Lab Isolation**:
   - `resolveDevLabFlag` ensures developer fixtures, fixture selectors, and dev appearance tweaks remain strictly hidden unless explicitly enabled via query parameter (`?dev=true`) or hash (`#lab`).

---

## 2. File Level Changes

| File | Scope of Change |
|---|---|
| [`apps/control-center/build.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/build.mjs) | Added `buildProductShell()` bundling `src/index.js` into `public/product-shell.js` with JSX loader enabled. Updated `buildAll()`. |
| [`apps/control-center/src/index.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/index.js) | Live entry module wiring `ProductShell`, `IfzWorkPage`, dynamic portals, history synchronization, status polling, and auto-mounting to `#app-root`. |
| [`apps/control-center/src/live-integration.js`](file:///E:/Veyminore/products/zetro/apps/control-center/src/live-integration.js) | Pure helper module for status projection mapping (`mapStatusProjection`) and developer lab flag resolution (`resolveDevLabFlag`). |
| [`apps/control-center/public/index.html`](file:///E:/Veyminore/products/zetro/apps/control-center/public/index.html) | Mounted `#app-root`, linked `product-shell.css` and `ifz-work.css`, loaded `product-shell.js`. |
| [`apps/control-center/server.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/server.mjs) | Added GET/HEAD routes for `/product-shell.js`, `/product-shell.css`, and `/ifz-work.css`. |
| [`apps/control-center/test/server.test.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/test/server.test.mjs) | Added server integration assertions for `product-shell.js`, `product-shell.css`, `ifz-work.css`, and `#app-root` HTML verification. |
| [`apps/control-center/test/ui-integration.test.mjs`](file:///E:/Veyminore/products/zetro/apps/control-center/test/ui-integration.test.mjs) | Comprehensive integration test suite verifying default live route, status mapping, devLab flag, history navigation, and simulated preview limits. |

---

## 3. Verification & Evidence

### 1. Production Bundle Build
```
Command: node apps/control-center/build.mjs
Output: Control center islands and Product Shell built successfully.
Artifact: apps/control-center/public/product-shell.js (318 KB)
```

### 2. Comprehensive Test Suite Execution
```
Command: node --test apps/control-center/test/*.test.mjs
✔ ifz-work-model: default unverified state is truthful and unpopulated without evidence (2.31ms)
✔ ifz-work-model: explicit fixture loading and snapshot structure (0.61ms)
✔ ifz-work-model: devLab flag controls developer fixture visibility and isolation (0.37ms)
✔ ifz-work-model: fixture switching cleanly resets or restores unverified state (0.45ms)
✔ ifz-work-model: route preview always targets IFZ across all route modes (0.48ms)
✔ ifz-work-model: manual mode with zero selected workers is invalid and rejects send without silent AGR-1 fallback (0.51ms)
✔ ifz-work-model: empty state template prompts do not assert premature worker routes (0.20ms)
✔ ifz-work-model: deterministic clock and idGenerator injection eliminate nondeterminism (1.48ms)
✔ ifz-work-model: route suggestions and presets never auto-send or mutate event stream (0.39ms)
✔ ifz-work-model: draft text and parameters persist across fixture switches and updates (1.99ms)
✔ ifz-work-model: attachments can be added and removed (0.43ms)
✔ ifz-work-model: worker branch expansion toggling (0.24ms)
✔ ifz-work-model: all 8 honest fixtures are valid, structured, and contain zero private reasoning (0.40ms)
✔ ifz-work-model: dry-run submission guard does not perform live network calls (0.25ms)
✔ ifz-work-model: stopActiveRun halts execution and appends cancellation event deterministically (0.23ms)
✔ CANONICAL_ROUTES defines exactly the 6 approved primary product routes (2.14ms)
✔ Legacy and non-primary routes are removed from primary navigation registry (0.34ms)
✔ Route resolution and alias migration handles hashes and invalid inputs (0.23ms)
✔ resolveConnectionStatus handles omitted, false, true, malformed, and stale observations truthfully (0.33ms)
✔ resolveWorkspaceStatus handles omitted, partial, and explicit valid evidence without inventing paths (0.25ms)
✔ resolveIfzStatus does not assume IFZ is active without explicit evidence (0.63ms)
✔ formatCountBadge formats nonnegative integers and rejects omitted/malformed/negative values (0.34ms)
✔ Top menu projection does not invent workspace or connection when caller supplies empty state (0.65ms)
✔ Center dock projection outputs 8 destinations in strict order without inventing badges (0.50ms)
✔ Left and right utility docks format badges strictly from nonnegative integers (1.99ms)
✔ Responsive navigation projection preserves compact routes, sheets, and persistent IFZ action (0.33ms)
✔ Development tweak controls are clearly scoped from product authority (0.45ms)
✔ Navigation state reducer tracks opener control and returns focus on Escape (CLOSE_ALL) (0.82ms)
✔ formatCanonicalHash and formatCanonicalUrl generate pure canonical hashes and URLs (0.72ms)
✔ parseRouteFromUrl and resolveInitialRoute handle route load across hashes, paths, queries, and aliases (0.92ms)
✔ resolveRouteTransition generates pure navigation descriptors without side effects (0.50ms)
✔ handlePopState resolves target route from history state or location fallback during back/forward (0.24ms)
✔ resolveRefreshRoute and resolveCopiedRouteUrl handle refresh and copied share links safely (0.40ms)
✔ Closed side panels and modals guarantee null panel state and clean focus return in reducer (0.18ms)
✔ local preview protects its read-only projection and exposes only declared evidence (107.00ms)
✔ Live integration: default live route is Work (1.86ms)
✔ Live integration: mapStatusProjection supplies only real observed data without inventing evidence (1.34ms)
✔ Live integration: devLab flag remains strictly hidden unless explicitly requested (0.42ms)
✔ Live integration: wires canonical hash, history state, and popstate navigation cleanly (1.16ms)
✔ Live integration: Computer page and orb preview boundaries are preserved without claiming native proof (0.43ms)
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 287.89
```

---

## 4. Integration Limits & Handoff

- **Read-Only Authority**: Local control center projection remains strictly read-only (`boundaries.readOnly = true`, `boundaries.liveInference = false`). Zero mutation endpoints exist.
- **Simulated Computer Preview**: Computer sessions and orb components operate under sandbox preview rules; native desktop execution is not claimed or asserted as verified native proof.
- **Dry-Run IFZ Composer**: Prompt dispatching and route suggestions preview execution flow without live model inference or remote mutation calls.
- **Coordinator Gate**: Browser end-to-end integration remains the coordinator gate for Phase 2 runtime attachment.

# Worker AGR-5: Minimal ThoughtLine Below 120px MagicRings

## 1. Overview & Architectural Scope
In response to coordinator review and screenshot feedback, the presentation below the 120px `MagicRings` in `apps/control-center/` was streamlined to a clean, minimal design:
- Preserved exact upstream sources of `ThoughtLine.jsx`/`.css` and `MagicRings.jsx`/`.css` (100% unchanged).
- Preserved core controller contract `packages/computer-agent/src/smart-status.js` and test suite (untouched).
- Kept 120px orb and graphite-silver palette (`#303b51`, `#68758d`).
- No new dependencies, no live SendInput, no model calls, no quota wastage.

---

## 2. Design Improvements Implemented

1. **Single Centered Primary Status Line with Visually Separate Elapsed**:
   - Primary status rendered via `ThoughtLine` in Satoshi 16px font (`--tl-font: 16px`).
   - `showTimer={false}` inside `ThoughtLine` to eliminate collision and duplicate display.
   - Visually separate elapsed indicator rendered alongside the primary text as a subtle, muted pill (`12px`, tabular numbers, `#71766c`, light rounded background `rgba(0, 0, 0, 0.04)`).
   - Zero duplicated elapsed time fields.

2. **Secondary Details Toggle**:
   - Replaced verbose status repetitions (`Finished · Completed` / `Ready when you are`) with a single low-contrast text button:
     `Details (3)` (with step count) or `Details` + tiny chevron (11px).
   - Removed duplicate subtitle `#description` to keep visual noise minimal.
   - Single simulation disclaimer retained at the top of the viewport.

3. **Plain Compact Activity Log (No Developer Fields / No Boxed Cards)**:
   - Removed card border, background fill, box-shadow, and technical key:value fields (`Intent:`, `Phase:`, `key: value`).
   - Clean, unboxed monochrome activity lines:
     - Proven steps: checkmark (`✔ Verified folder location`, `#2e7d32`).
     - Current step: subtle pending bullet (`● Moving pointer...`, `#b45309`), with no implied verification or fake percent/ETA.
     - Empty state: italicized subtle label `No activity yet`.
   - Max height capped at exactly 4 line heights (`max-height: 76px`, ~18px per line) with `overflow-y: auto`.

4. **Smart Autoscroll & User Control**:
   - Container follows newly appended steps only when the user is within 12px of the bottom.
   - Scrolling up suspends auto-follow immediately and displays a subtle `↓ Jump to latest` button.
   - Clicking `Jump to latest` scrolls to the bottom and re-engages follow.
   - Honors `prefers-reduced-motion` with instantaneous scrolling (`behavior: 'instant'`).

5. **Immediate Terminal Transitions & Screen Reader Sync**:
   - `settleDuration={0}` applied immediately for terminal and urgent states (`stopped`, `paused`, `cancelled`, `failed`, `completed`), eliminating unwanted settle blur/delay on stop/escape or completion.
   - Normal working state maintains smooth slowed animations (`breathPeriod=2.2s`, `shimmerDuration=2.6s`, `settleDuration=450ms`).
   - Keyed render on `ThoughtLine` (`key={isTerminalOrUrgent ? 'term-...' : 'work-...'}`) unmounts active working state and remounts fresh terminal state, ensuring the internal `role="status"` element announces the true final text without retaining stale intermediate steps (e.g., "Checking folder").
   - Unobtrusive Stop (`Esc`) button positioned below the details section.

---

## 3. Verification & Build Receipt
- **Bundle Rebuild**:
  `node build.mjs` completed:
  - `apps/control-center/public/computer-preview/orb.js` (332,607 bytes)
  - `apps/control-center/public/computer-preview/orb.css` (4,109 bytes)
- **ESM Export Check**:
  Clean module exports verified: `[ 'ZetroOrb', 'createSmartStatus' ]`.
- **Focused Server Test**:
  `pnpm --filter @zetro/control-center test`: 1/1 passed (111ms).
- **Core Unit Tests**:
  `node --test packages/computer-agent/test/smart-status.test.js`: 9/9 passed (120ms).
- **Component Preservation**:
  `git diff apps/control-center/src/components/` -> 0 changes.

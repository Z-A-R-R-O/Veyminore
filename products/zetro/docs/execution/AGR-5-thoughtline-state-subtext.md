# Worker AGR-5: ThoughtLine State & Subtext Hierarchy Receipt

## 1. Overview
Refined the ZETRO Control Center status presentation under the 120px `MagicRings` to establish a clean three-tiered visual and accessible hierarchy:
1. **Primary Line**: Lifecycle state only (`Working…`, `Paused`, `Done`, `Stopped`, `Needs attention`, `Ready when you are`). Never mentions task-specific actions or targets while active.
2. **Secondary Line**: Smart, task-specific public status derived from safe snapshot text (`Finding Downloads…`, `Checking the folder…`, `‘hello’ is ready.`), accompanied by subtle elapsed time (`· 1.8s`).
3. **Details**: Expandable unboxed verified/current activity log with smart autoscroll and `Jump to latest` recovery.

---

## 2. Invariants & Preservation
- **Upstream Files**: `MagicRings.jsx`/`.css` and `ThoughtLine.jsx`/`.css` in `apps/control-center/src/components/` remain **100% UNCHANGED**.
- **Core Status Controller**: `packages/computer-agent/src/smart-status.js` and all test suites preserved untouched.
- **Privacy & Safety**: Zero raw prompts, typed content, private reasoning, fake progress bars, or fake ETAs.
- **Orb & Colors**: Preserved 120px sizing and graphite-silver palette (`#303b51`, `#68758d`).
- **Dependencies & Server**: Zero new dependencies, zero server route changes.

---

## 3. Implementation Details

### Primary Line (Lifecycle State)
- Rendered via `ThoughtLine` with `fontSize={16}`, medium weight (500), Satoshi font.
- Uses `renderLabel={() => primaryLifecycleLabel}` so the visible label strictly displays calm product lifecycle language:
  - `working === true` -> `Working…`
  - `completed` -> `Done`
  - `paused` -> `Paused`
  - `stopped` / `cancelled` -> `Stopped`
  - `blocked` / `failed` / `uncertain` -> `Needs attention`
  - `off` -> `Ready when you are`
- Maintains calm `breathPeriod=2.2s` and `shimmerDuration=2.6s`.
- On terminal or Escape states (`stopped`, `paused`, `completed`, `failed`), `settleDuration={0}` is applied immediately for zero-lag instant state updates.

### Secondary Line (Smart Task Subtext)
- Displayed directly beneath the primary line in 12.5px muted typography (`#6a7165`), centered, capped at max two visual lines (`-webkit-line-clamp: 2`).
- Formatted as `smartSubtext` + subtle tabular-nums elapsed time (`· 1.8s`).
- Marked `aria-hidden="true"` to prevent redundant screen reader announcements.

### Screen Reader & Accessibility
- Screen readers receive a single live region (`role="status"`) through `ThoughtLine`.
- The announcement is passed as `${primaryLifecycleLabel} — ${smartSubtext}`, announcing both lifecycle and public task context in a single calm sentence (e.g., `Working… — Finding Downloads…` or `Done — ‘hello’ is ready.`).
- Avoids duplicate live regions and eliminates stale or tripled announcements.

---

## 4. Verification Receipts
- **Bundle Rebuild**:
  `node build.mjs` executed in `apps/control-center/`:
  - `public/computer-preview/orb.js` (332,977 bytes)
  - `public/computer-preview/orb.css` (4,109 bytes)
- **ESM Export Validation**:
  `[ 'ZetroOrb', 'createSmartStatus' ]` cleanly resolved.
- **Focused Server Tests**:
  `pnpm --filter @zetro/control-center test` -> 1/1 passed (87.5ms).
- **Core Controller Tests**:
  `node --test packages/computer-agent/test/smart-status.test.js` -> 9/9 passed (99.2ms).

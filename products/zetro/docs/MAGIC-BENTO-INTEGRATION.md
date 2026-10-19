# MagicBento Component Integration & Global Element Style

Date: 2026-10-19. Status: Implemented and Verified.
Authority: User request to integrate the open-source `<MagicBento />` component from React Bits, apply its element style globally across the Control Center, and document the architectural design.

---

## 1. Overview & Architecture

`<MagicBento />` is an interactive bento grid component adapted from [React Bits](https://reactbits.dev) (JavaScript + CSS variant with `@hugeicons/react` and `@hugeicons/core-free-icons`).

### Package Architecture
- **Component Source**: [`apps/control-center/src/components/MagicBento.jsx`](file:///e:/Veyminore/products/zetro/apps/control-center/src/components/MagicBento.jsx)
- **Component Styles**: [`apps/control-center/src/components/MagicBento.css`](file:///e:/Veyminore/products/zetro/apps/control-center/src/components/MagicBento.css)
- **Mount Island**: [`apps/control-center/src/bento-island.jsx`](file:///e:/Veyminore/products/zetro/apps/control-center/src/bento-island.jsx) — provides `mountMagicBento(container, options)`
- **Bundle Target**: Built by `apps/control-center/build.mjs` via esbuild to `public/bento.js` and `public/bento.css`
- **Server Route**: Registered in `apps/control-center/server.mjs` (`routes.get('/bento.js')`, `routes.get('/bento.css')`)
- **Shell Integration**: Embedded in `apps/control-center/public/app.js` and rendered inside `<div id="bento-root" class="bento-showcase"></div>` on the Overview screen.

---

## 2. MagicBento Props Reference

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `MagicBentoItem[]` | Default feature cards | Cards to show. Accepts `title`, `label`, `description`, `visual`, `content`, `image`, `href`, `onClick`, `colSpan`, `rowSpan`. |
| `items[].visual` | `ReactNode \| string` | - | Artwork between header and description (`analytics`, `dashboard`, `collaboration`, `automation`, `integration`, `security`). |
| `columns` | `number` | `4` | Grid columns on desktop displays. Automatically cascades to 2 and 1 on narrower viewports. |
| `rowHeight` | `number` | `190` | Height in pixels for a single grid row. |
| `gap` | `number` | `14` | Spacing between bento cards in pixels. |
| `radius` | `number` | `16` | Corner radius of the cards in pixels. |
| `theme` | `'dark' \| 'light'` | `'dark'` | Color theme. Tuned for Zetro's black theme and mild gray surfaces. |
| `glowColor` | `string` | `'#8ce6b8'` | Cursor border glow and spotlight accent color (mint/emerald). |
| `enableBorderGlow` | `boolean` | `true` | Dynamic border illumination near the cursor, spanning across adjacent cards. |
| `enableSpotlight` | `boolean` | `true` | Soft cursor-following radial gradient spotlight within hovered card. |
| `spotlightRadius` | `number` | `320` | Radius in pixels of the cursor spotlight. |
| `clickEffect` | `boolean` | `true` | Emits a glowing light wave across the grid on click and triggers card spring replay. |
| `textAutoHide` | `boolean` | `true` | Restrains title to single line and description to two lines with ellipsis. |
| `intro` | `boolean` | `true` | Staggered entrance animation when cards enter viewport. |
| `onItemClick` | `(item, index) => void` | - | Callback fired on card click. Linked to view navigation in Zetro Control Center. |

---

## 3. Zetro Capabilities Card Mapping

In the Control Center, `<MagicBento />` showcases Zetro's 6 foundational platform capabilities:

1. **Fleet Observation** (`visual: 'analytics'`, `colSpan: 1`):
   Live monotonic session sequences, timestamp freshness, and verification progress across 10 active workers.
2. **Orchestration Hub** (`visual: 'dashboard'`, `colSpan: 1`):
   Multi-fleet coordination across RCT, AGR-6, and OCR teams in a unified reactive workspace.
3. **Human-in-the-Loop Policy** (`visual: 'collaboration'`, `colSpan: 2`, `rowSpan: 2`):
   Autonomous execution for non-consequential operations with mandatory human authority for sensitive actions.
4. **Prompt-Driven Computer Agent** (`visual: 'automation'`, `colSpan: 2`, `rowSpan: 2`):
   End-to-end Windows workflow: Prompt → Discover → Observe → Plan → Authorize → Act → Verify → Report Evidence.
5. **MCP & Native Bridges** (`visual: 'integration'`, `colSpan: 1`):
   Isolated stdio/SSE communication, Antigravity bridge, and Windows UI Automation provider.
6. **Read-Only Containment** (`visual: 'security'`, `colSpan: 1`):
   Zero paid fallback leaks, zero arbitrary shell injection, strict boundary policy enforcement.

---

## 4. Exact Global MagicBento Adoption Across Every Card & Element

Per user directive (*"I mean that card style. Completely exact the style and adopt it globally"*), the exact visual anatomy, tokens, dynamic lighting, and inner tile structures of MagicBento were applied **globally** across every card, panel, fleet team, metric block, requirement, timeline, and modal in the application (`apps/control-center/public/style.css` & `app.js`):

### 1. Exact Design Tokens (`:root`)
```css
:root {
  --mb-surface: linear-gradient(180deg, #1a1820 0%, #121116 100%);
  --mb-edge: rgba(255, 255, 255, 0.07);
  --mb-highlight: rgba(255, 255, 255, 0.06);
  --mb-shadow: 0 24px 48px -28px rgba(0, 0, 0, 0.85), 0 8px 18px -12px rgba(0, 0, 0, 0.6);
  --mb-tile: linear-gradient(180deg, #3a3644 0%, #27242f 100%);
  --mb-tile-edge: rgba(255, 255, 255, 0.07);
  --mb-tile-highlight: rgba(255, 255, 255, 0.12);
  --mb-tile-shadow: 0 4px 10px -4px rgba(0, 0, 0, 0.7);
  --mb-well: rgba(255, 255, 255, 0.03);
  --mb-well-edge: rgba(255, 255, 255, 0.06);
  --mb-ink: #f4f4f5;
  --mb-muted: rgba(244, 244, 245, 0.6);
  --mb-faint: rgba(244, 244, 245, 0.3);
  --mb-line: rgba(244, 244, 245, 0.1);
  --mb-glow-rgb: 140, 230, 184;
  --mb-glow-alpha: 0.85;
  --mb-spot-alpha: 0.07;
  --mb-radius: 20px;
  --mb-inner-radius: 12px;
  --mb-spring: cubic-bezier(0.34, 1.4, 0.64, 1);
}
```

### 2. Universal Card Anatomy (`.panel`, `.fleet-team`, `.metric-card`, `.plan-phase`, `dialog#worker-dialog`)
- **Surface**: `var(--mb-surface)` (`linear-gradient(180deg, #1a1820 0%, #121116 100%)`)
- **Dual Hairline Rim**: `box-shadow: var(--mb-shadow), inset 0 0 0 1px var(--mb-edge), inset 0 1px 0 var(--mb-highlight)`
- **Corner Radius**: `20px` (`var(--mb-radius)`)
- **Dynamic Spotlight** (`::before`): Radial gradient anchored to `--mouse-x` and `--mouse-y` dynamically shining across hovered cards.
- **Dynamic Masked Border Glow** (`::after`): Hairline border gradient with `-webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0); -webkit-mask-composite: xor;` illuminating edges near pointer.

### 3. Elevated MagicBento Inner Tiles (`.stream-row`, `.fleet-worker`, `.requirement`, `.timeline-item`, `.next-step`)
- **Surface**: `var(--mb-tile)` (`linear-gradient(180deg, #3a3644 0%, #27242f 100%)`)
- **Dual Rim**: `inset 0 0 0 1px var(--mb-tile-edge), inset 0 1px 0 var(--mb-tile-highlight)`
- **Shadow**: `var(--mb-tile-shadow)` (`0 4px 10px -4px rgba(0, 0, 0, 0.7)`)
- **Corner Radius**: `12px` (`var(--mb-inner-radius)`)
- **Hover Physics**: Translates `-1px` on spring with heightened rim highlights and ambient drop shadow.

### 4. Metrics Bento Grid (`.metrics-bento-grid`, `.metric-card`)
- Replaced monolithic divider bar with 3 standalone MagicBento cards (`PLAN ASSIGNMENTS`, `EVIDENCE AUDIT`, `SECURITY GATE`).
- Features large numbers (`34px`), bold semantic subtitles, muted summaries, and uppercase headers.

---

## 5. Mild Gray Surface Refinement & Changeable Accent System

Following user direction (*"make magic bento mild and changable accent"*), the design was refined to a calm, mild, neutral aesthetic with a reactive accent switcher:

### 1. Mild Gray Neutral Surfaces (Zero Purple Cast)
- **Card Surface**: Updated from purple-tinted `#1a1820` / `#121116` to neutral mild graphite:
  `--mb-surface: linear-gradient(180deg, #15161a 0%, #0d0e11 100%)`
- **Inner Tile Surface**: Updated from purple `#3a3644` / `#27242f` to clean mild dark gray:
  `--mb-tile: linear-gradient(180deg, #1f2228 0%, #14161b 100%)`
  Tile hover: `linear-gradient(180deg, #262932 0%, #181a20 100%)`
- **Softened Dynamic Lighting**:
  - Border glow opacity `--mb-glow-alpha` relaxed from harsh `0.85` to subtle `0.55`.
  - Cursor spotlight `--mb-spot-alpha` softened from `0.07` to atmospheric `0.045`.

### 2. Multi-Palette Changeable Accent System
The application supports 6 curated accent palettes:
- **Mint** (Default): Hex `#8ce6b8`, RGB `140, 230, 184`, Beacon `#3fb950`, Soft `rgba(62, 115, 88, 0.2)`
- **Cyan** (Sky): Hex `#38bdf8`, RGB `56, 189, 248`, Beacon `#0ea5e9`, Soft `rgba(14, 116, 144, 0.25)`
- **Violet** (Purple): Hex `#a78bfa`, RGB `167, 139, 250`, Beacon `#8b5cf6`, Soft `rgba(109, 40, 217, 0.25)`
- **Amber** (Warm): Hex `#fbbf24`, RGB `251, 191, 36`, Beacon `#f59e0b`, Soft `rgba(180, 83, 9, 0.25)`
- **Rose** (Pink): Hex `#fb7185`, RGB `251, 113, 133`, Beacon `#f43f5e`, Soft `rgba(190, 18, 60, 0.25)`
- **Silver** (Monochrome): Hex `#e2e8f0`, RGB `226, 232, 240`, Beacon `#cbd5e1`, Soft `rgba(148, 163, 184, 0.2)`

### 3. Dual-Control Switching & Persistence
- **Appearance Popover (`.tweak`)**: Interactive circular color chips (`.accent-chip`) with active white borders and glow rings.
- **Bottom Dock Menu**: Quick-select radio items in the "Appearance" dock menu and right "Display Settings" dock menu.
- **Dynamic Variable Injection**: Updates `--mb-glow-rgb`, `--accent`, `--green`, and `--soft-green`.
- **Live React Island Update**: Communicates directly with mounted `<MagicBento />` island via `bentoController.setGlowColor(accent.hex)`.
- **Persistence**: Preserves choice across reloads via `localStorage.getItem('zetro_accent')`.
- **CSP Compliance**: Fully respects strict `style-src 'self'` Content Security Policy without inline style violations.

---

## 7. Smart Magic Bento Hover on Top Bar & Floating Docks

Per user instruction (*"make magic bento hover for top bar and docks smartly too"*), the exact Magic Bento dynamic spotlight and hairline masked border glow system was brought to the **Top Bar (`CardNav`)** and the **Bottom Floating Docks (Left, Center, and Right)**:

### 1. Unified Dynamic Spotlight & Hairline Masked Border Glow
- **Top Bar (`.card-nav__panel`)**:
  - **Dynamic Spotlight (`::before`)**: A soft $320\text{px}$ radial gradient that tracks `--mouse-x` and `--mouse-y` behind the bar controls, illuminating the frosted glass panel with atmospheric depth.
  - **Masked Border Glow (`::after`)**: A $1\text{px}$ hairline edge glow conforming to the top bar's contour using `-webkit-mask` / `mask` exclusion, dynamically lighting up along the outer perimeter near the pointer.
- **Bottom Docks (`.dock`, `.dock-island-left`, `.dock-island-center`, `.dock-island-right`)**:
  - **Pill Tray Spotlight (`::before`)**: A $220\text{px}$ radial spotlight that tracks cursor position behind the dock items and separators, giving each dock a soft, luminous under-glow.
  - **Hairline Contour Glow (`::after`)**: A $200\text{px}$ masked radial border glow tracing the exact pill curvature of each dock container.
  - **Accent Tile Face Reaction**: Individual `.dock-item:hover .dock-face` tiles subtly tint their inner rim with the active accent color (`rgba(var(--mb-glow-rgb), 0.38)`).

### 2. Smart Proximity & Performance Architecture
- **Proximity Falloff**: Bounding box distance (`Math.hypot`) calculates a continuous hot factor ($0.0 \to 1.0$) across a $160\text{px}$ proximity radius. As the cursor approaches a dock or the top bar, the edge begins glowing *before* the cursor enters, eliminating abrupt popping and creating a natural, fluid magnetic feel.
- **Continuous Multi-Dock Transfer**: Moving the cursor horizontally across the bottom smoothly cross-fades the hairline glow from one dock to the next.
- **rAF Throttling**: Pointer tracking is coordinated via `requestAnimationFrame` to ensure zero CPU overhead and silky-smooth $60/120\text{Hz}$ rendering.
- **Dynamic Accent Reactivity**: Top bar and dock glows instantly adapt when switching among Mint, Cyan, Violet, Amber, Rose, and Silver.

---

## 8. Verification & Visual Proofs

- **Top Bar Dynamic Spotlight & Hairline Border Glow**: [`docs/verification/magic-bento-topbar-hover.png`](file:///e:/Veyminore/products/zetro/docs/verification/magic-bento-topbar-hover.png)
- **Center Dock Dynamic Spotlight & Masked Rim Glow**: [`docs/verification/magic-bento-dock-hover.png`](file:///e:/Veyminore/products/zetro/docs/verification/magic-bento-dock-hover.png)
- **Left Satellite Dock Perimeter Illumination**: [`docs/verification/magic-bento-dock-left-hover.png`](file:///e:/Veyminore/products/zetro/docs/verification/magic-bento-dock-left-hover.png)
- **Center Dock Glow Switched to Sky Cyan**: [`docs/verification/magic-bento-dock-cyan-hover.png`](file:///e:/Veyminore/products/zetro/docs/verification/magic-bento-dock-cyan-hover.png)
- **Mild Gray MagicBento (Mint Accent)**: [`docs/verification/mild-magic-bento-mint.png`](file:///e:/Veyminore/products/zetro/docs/verification/mild-magic-bento-mint.png)
- **Appearance Panel with Accent Color Chips**: [`docs/verification/mild-magic-bento-accent-picker.png`](file:///e:/Veyminore/products/zetro/docs/verification/mild-magic-bento-accent-picker.png)
- **Atmospheric Spotlight & Masked Border Glow on Capabilities**: [`docs/verification/mild-magic-bento-hover-glow.png`](file:///e:/Veyminore/products/zetro/docs/verification/mild-magic-bento-hover-glow.png)



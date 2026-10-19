# Worker Receipt: AGR-5 (React Bits Orb JS-CSS Installation & Island)

- **Worker ID**: AGR-5
- **Task ID**: `AGR5-react-bits-orb`
- **Coordinator**: Codex
- **Role**: Computer Access Preview UI Engineer
- **Workspace**: `E:/Veyminore/products/zetro`
- **Owned Scope**: `apps/control-center/` exclusively, plus root `pnpm-lock.yaml`
- **Status**: `ready_for_review`
- **Live Provider / Network Calls**: `0` (zero live model calls, zero live SendInput, zero external CDNs)

---

## 1. Executive Summary

AGR-5 executed the local installation of the exact React Bits **Orb (JS-CSS)** component into the ZETRO Control Center, replacing the previous standalone canvas with a WebGL2 React island while preserving:
- Smart Intent-Status state text and synthetic task sequences.
- Existing manual buttons (`Wake`, `Think`, `Observe`, `Act`, `Pause`, `End`).
- Immediate `Escape`, `Stop`, and `visibilitychange` cancellation.
- True freeze semantics on `Quiet` mode and `prefers-reduced-motion`.
- Label-free precision cursor (SVG only, zero badge text).
- Clear visual simulation disclaimer (`VISUAL SIMULATION · No computer access`).
- Normal document flow for the 600px desktop showcase section (zero fixed overlays covering controls).

---

## 2. Upstream Registry Provenance & Exact Source Invariant

The upstream component was retrieved directly from the official React Bits registry endpoint:
- **Registry Endpoint**: `https://reactbits.dev/r/Orb-JS-CSS.json`
- **Upstream Author**: David Haz (React Bits)
- **License**: MIT
- **Target Location**: `apps/control-center/src/components/`

### Exact File Hashes (Unmodified Upstream Source)
| File | Size (Bytes) | SHA-256 Digest |
| :--- | :--- | :--- |
| `src/components/Orb.css` | 195 | `7F1DD853EE98801256AABA5DB5BB08BD738593EA76DD42E993D1403F6887816A` |
| `src/components/Orb.jsx` | 14,067 | `B3548D6FD0C47F3C600307DE3E4F3BBE2D369AA30086FE2FD191AE8104CF58DA` |

*Provenance record saved at [Orb-JS-CSS.provenance.json](file:///e:/Veyminore/products/zetro/apps/control-center/src/components/Orb-JS-CSS.provenance.json).*

---

## 3. Architecture & React Island Integration

### A. Island Wrapper (`apps/control-center/src/orb-island.jsx`)
- Wraps the untouched `Orb.jsx` component inside a container matching the user example:
  ```jsx
  <div style={{ width: '100%', height: '100%', position: 'relative' }}>
    <Orb
      colors={["#000000", "#ffffff", "#000000"]}
      hoverIntensity={1}
      trail={1}
      rotateOnHover={true}
      followCursor={true}
      paused={isPaused}
      forceHoverState={isForceHover}
      speed={speed}
      glow={glow}
      wobble={wobble}
    />
  </div>
  ```
- **Quiet Mode & Reduced Motion True Freeze**:
  - `isPaused = mode === 'paused' || mode === 'stopped' || quiet || reducedMotion`
  - In `Quiet` mode or when `prefers-reduced-motion: reduce` matches, the orb is truly frozen (`paused: true`), stopping the animation loop and rendering a static WebGL2 frame.
- **Exported Interface**:
  - Exports `class ZetroOrb` providing `setState(mode)`, `setQuiet(quiet)`, and `destroy()` methods, keeping `app.js` completely modular and plug-and-play.

### B. Build Pipeline (`apps/control-center/build.mjs`)
- Uses `esbuild` 0.28.2 configured with:
  - `entryPoints: ['src/orb-island.jsx']`
  - `format: 'esm'`
  - `target: 'es2022'`
  - `jsx: 'automatic'` (automatically uses React 19 JSX runtime so upstream `Orb.jsx` compiles without classic `React is not defined` errors)
  - `bundle: true`, `minify: true`
  - `define: { 'process.env.NODE_ENV': '"production"' }`
  - Outputs `public/computer-preview/orb.js` and `public/computer-preview/orb.css`
- Wired into `apps/control-center/package.json` under `"build"` and `"prestart"`.

### C. Server & CSP Compliance (`apps/control-center/server.mjs`)
- Served via existing local routes:
  - `/computer-preview/orb.js` (`text/javascript; charset=utf-8`)
  - `/computer-preview/orb.css` (`text/css; charset=utf-8`)
- Strictly adheres to CSP:
  `default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`
- Zero external CDN links or remote script tags.

### D. 600px Normal Document Flow Showcase (`style.css` & `index.html`)
- Positioned in normal document flow inside `<main>` immediately following the task controls:
  ```html
  <div class="control-heading"><span>05 — REACT BITS ORB SHOWCASE</span><small>WebGL2 Interactive Preview</small></div>
  <section class="orb-presence-section" role="status" aria-live="polite">
    <div id="zetro-orb" class="orb-showcase" aria-hidden="true"></div>
    <div class="status-container">
      <strong id="state">Ready when you are</strong>
      <small id="description">Orb preview · no computer access</small>
    </div>
    <button id="emergency" aria-label="Stop simulation immediately">Stop <kbd>esc</kbd></button>
  </section>
  ```
- **Styling**:
  ```css
  .orb-presence-section {
    position: relative;
    width: 100%;
    max-width: 600px;
    margin: 18px auto 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    pointer-events: none;
  }
  #zetro-orb {
    position: relative;
    width: 100%;
    max-width: 600px;
    height: 360px;
    margin: 0 auto;
    filter: drop-shadow(0 12px 32px #12151a14);
    pointer-events: auto;
    overflow: hidden;
    border-radius: 18px;
  }
  @media(min-width: 768px) {
    #zetro-orb { height: 600px; }
  }
  ```
- Eliminates any fixed overlay clipping or covering interactive buttons; all task and state controls remain distinct and fully visible.

---

## 4. Verification & Checks

### 1. Control Center Unit & Route Tests
```powershell
pnpm test
```
- **Exit Code**: `0`
- **Output**:
  ```
  ✔ local preview protects its read-only projection and exposes only declared evidence (87.7415ms)
  ℹ tests 1
  ℹ pass 1
  ℹ fail 0
  ```
- Verified that `/computer-preview/`, `/computer-preview/orb.js`, and `/computer-preview/orb.css` return HTTP 200 with appropriate content types.

### 2. Node.js Fixture Probe
```powershell
node scratch/test-app-import.mjs
```
- **Exit Code**: `0`
- **Output**:
  ```
  Testing app.js imports and fixtures...
  All synthetic fixture checks passed cleanly!
  ```

### 3. Upstream Source Hash Verification
- Verified both `src/components/Orb.css` and `src/components/Orb.jsx` have identical SHA-256 hashes matching the upstream registry record.

### 4. Build Artifacts
- `public/computer-preview/orb.js`: 237 KB (ESM bundle containing React 19 automatic JSX runtime, WebGL2 shaders, and island wrapper).
- `public/computer-preview/orb.css`: 158 bytes (Clean `.orb-container` and `.orb-canvas` styles).

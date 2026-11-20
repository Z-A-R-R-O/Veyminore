# Production deployment guide: live Vercel and service boundaries

Current contract and deployment guide. Reconciled 20 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Account services](ACCOUNT-SERVICES.md) · [Cloud-save recovery](CLOUD-SAVE-RECOVERY.md) · [Open gaps](GAME-EXPERIENCE-GAPS.md).

## 1. Production architecture and live status

AROWGO is deployed to production as a high-performance, client-only Single Page Application (SPA). The live game runs with **zero server dependencies** on the public web.

- **Public production URL**: https://arowgo.vercel.app
- **Vercel Project**: `zarros-projects-e983b612/arowgo`
- **Git Repository**: `Z-A-R-R-O/Veyminore` (root: `products/interfrozt/games/arowgo`)
- **Hosting Tier**: Vercel Static Edge CDN
- **Build Output**: Vercel Build Output API version 3 (`.vercel/output`)
- **Active Gameplay Baseline**: 100 levels across 5 worlds, full mechanics, local guest profile, crate shop, 30 avatars, 30 frames, and badge achievements.

```
                               PUBLIC INTERNET
                                      |
                                      v
                        +---------------------------+
                        |     Vercel Edge CDN       |
                        |   https://arowgo.vercel.app
                        +---------------------------+
                                      |
                        Static HTML, CSS, JS, Assets
                                      |
                                      v
                        +---------------------------+
                        |      Client Browser       |
                        |                           |
                        |   - React UI & Views      |
                        |   - Phaser & SVG Board    |
                        |   - Domain Rules Engine   |
                        |   - Checked-in 100 Levels |
                        |   - Local Storage (Saves) |
                        +---------------------------+
                                      |
                         (No backend calls in prod)
                                      x
                                 [No Server]
```

---

## 2. Separation of live gameplay vs development account services

A critical architectural principle of AROWGO is the strict isolation between the live production game and development-only experimental services.

### Service boundary comparison

| Feature / Service | Live Production (`arowgo.vercel.app`) | Development (`localhost:4173`) |
| --- | --- | --- |
| **Hosting Model** | Prebuilt static CDN assets | Local Vite server + Local Node.js backend |
| **Backend Service** | **None**. No server, serverless functions, or edge routes | Node.js HTTP server on `127.0.0.1:4174` (`server/account/start.mjs`) |
| **API Endpoints** | None (`/api/*` returns 404) | `/api/arowgo/v1/account/*` and `/api/arowgo/v1/economy/*` |
| **100-Level Campaign** | Fully playable (Levels 1–100) | Fully playable + Developer level selector |
| **Game Mechanics** | All active (Snakes, Keys, Anchors, Ice, Gates, Deadlines) | All active |
| **Save Persistence** | Browser `localStorage` on `arowgo.vercel.app` origin | Browser `localStorage` on `localhost:4173` origin |
| **Player Profile** | Local guest profile, 30 avatars, 30 frames | Local guest profile + Account linking UI |
| **Cosmetics & Shop** | 15 skins, 3 crates, local coin/gem balances | 15 skins, 3 crates + Server SQLite wallet preview |
| **Google Identity** | **Disabled / Not present** | Google OIDC token exchange (`google-web` client ID) |
| **PlayFab Cloud Sync** | **Disabled** (`autoSyncEnabled = false`) | Entity Object snapshots (`116A87`, `arowgo-save-v1`) |
| **Server Ledger** | **None** | SQLite database (`.local/economy.sqlite`) |

### Code-level safety guards

The development services cannot accidentally run in production:

1. **Backend production rejection guard**:
   In `server/account/start.mjs`:
   ```javascript
   if (process.env.NODE_ENV === "production")
     throw new Error("Development authentication spike cannot run in production");
   ```
   The backend server explicitly crashes if booted in production mode.

2. **Frontend auto-sync environment guard**:
   In `src/account/auto-sync.ts`:
   ```typescript
   export const autoSyncEnabled =
     import.meta.env.DEV &&
     import.meta.env.VITE_AROWGO_AUTO_SYNC === "1" &&
     import.meta.env.VITE_AROWGO_CLOUD_SYNC === "1" &&
     location.origin === "http://localhost:4173";
   ```
   In a production build (`import.meta.env.DEV === false`) or on the production Vercel origin, `autoSyncEnabled` evaluates to `false` and no network sync engine is instantiated.

3. **Origin storage isolation**:
   Browser `localStorage` is strictly isolated by origin. Progress made on `http://localhost:4173` or `http://127.0.0.1:4173` never leaks to or affects `https://arowgo.vercel.app`.

---

## 3. Build and deployment pipeline

Deployments use Vercel's Build Output API v3. Source TypeScript, tests, server code, and Android files are excluded from the upload package.

### Build and deploy procedure

From `products/interfrozt/games/arowgo` in PowerShell:

```powershell
# 1. Clean build and typecheck
pnpm typecheck
pnpm build

# 2. Package into Vercel Build Output API v3 format
node scripts/prepare-vercel.mjs

# 3. Deploy prebuilt artifact directly to Vercel production
npx --yes vercel@65.14.0 deploy --prebuilt --prod
```

### Packaging script (`scripts/prepare-vercel.mjs`)

The preparation script packages `dist/` into `.vercel/output`:
- Validates that `dist/index.html` exists.
- Cleans and creates `.vercel/output/`.
- Copies `dist/` into `.vercel/output/static/`.
- Writes `.vercel/output/config.json` with `{ "version": 3 }`.
- Preserves `.vercel/project.json` for stable project linking.
- Strictly refuses to touch any directory outside the AROWGO workspace.

---

## 4. Historical deployment record

| Date | Deployment ID | Git Commit | Milestone & Highlights |
| --- | --- | --- | --- |
| 10 Nov 2026 | `dpl_EKyVHtLzVXvRWrP8RArMUtjyC8sd` | `2e0fb84` | Initial Vercel production release; static Vite build; Satoshi fonts. |
| 10 Nov 2026 | `dpl_4d4G6hkHjyYG6SqU75YYKorjPCsY` | `203f62c` | Curved snake recoil motion, animated Hint and Erase assistance tools. |
| 10 Nov 2026 | `dpl_BVbKM9RBPEoDGgeZE2sBHJEoEjX2` | `4c66813` | Mobile viewport fit; 390×844 portrait and 844×390 rotation support. |
| 10 Nov 2026 | `dpl_GtoKY33r5re9EKpRrWX9Q16EBRGW` | `6c82b03` | v0.1 campaign refresh; 5 hub pages; Practice mode; Hint ring. |
| 10 Nov 2026 | `dpl_8Az1sSe3NG7Xa24U6P3FzvY44YUo` | `88d86aa` | Generated-art integration; transparent hero island, hearts, victory art. |
| 10 Nov 2026 | `dpl_Cy1gKYY9iixhZK9amjvmFnZVyUBK` | `2ce3698` | Guest profiles, cosmetic shop with 4 arrow skins, settled result screens. |
| 13 Nov 2026 | `dpl_BaiE7W1QWbZM5eM45Qfm23K7cSuH` | `78621e6` | Scenic Worlds redesign with multi-page map navigation. |
| 13 Nov 2026 | `dpl_7Gr9NE6VCuBwyiZ2trH2ifGTscmS` | `78621e6` | Home page redesign and ambient floating particles layer. |
| 13 Nov 2026 | `dpl_Un8waCJypeaBCyvttazv8M33coXz` | `78621e6` | Crate shop (Common, Rare, Epic), arrow glow effects, 15 skins. |
| Current | Target baseline | `8517e94` | 100 levels across 5 worlds, Sanctum finale, hold inspection, 30 avatars, 30 frames, achievement badges. |

---

## 5. Pre-deployment and post-deployment checklist

### Pre-deployment verification (local)

- [ ] `pnpm typecheck` exits 0 with zero TypeScript diagnostic errors.
- [ ] `pnpm build` completes cleanly, generating `dist/index.html` and bundled assets.
- [ ] `python scripts/check-doc-links.py` verifies all documentation links and status coverage.
- [ ] `node scripts/prepare-vercel.mjs` populates `.vercel/output/static` and writes `config.json`.
- [ ] Inspect `.vercel/output/static`: confirm no `.env`, `.git`, or secret files are present.

### Post-deployment verification (live CDN)

Run anonymous verification on `https://arowgo.vercel.app` (incognito window):

- [ ] **HTTP 200 & Headers**: `https://arowgo.vercel.app` returns HTTP 200 with proper `content-type: text/html`.
- [ ] **Asset Loading**: Satoshi and Matcha display fonts load without 404 errors. Scenery and arrow SVGs render crisply.
- [ ] **Canvas Initialization**: Phaser game board mounts cleanly; canvas renders without WebGL or console errors.
- [ ] **First Playable**: Tap an arrow on Level 01; verify snake exit motion and clear.
- [ ] **Heart Loss Feedback**: On a blocked arrow, verify 1 Story heart is lost, accompanied by camera shake and recoil.
- [ ] **Persistence**: Refresh browser; verify cleared level state and earned stars are retained in `localStorage`.
- [ ] **Mobile Viewport Fit**: Emulate mobile device (390×844 and landscape); verify no page scrolling or HUD clipping.
- [ ] **Account Boundary**: Verify no broken calls to `/api/arowgo/v1/*` appear in the network tab.

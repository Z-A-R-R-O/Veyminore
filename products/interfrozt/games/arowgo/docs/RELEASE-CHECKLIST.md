# Production release checklist

Release readiness and verification gates. Reconciled 20 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Production deployment](DEPLOYMENT-PRODUCTION.md) · [Open gaps](GAME-EXPERIENCE-GAPS.md).

## 1. Physical-device and native testing

Browser emulation in Playwright or Chrome DevTools is insufficient for native Android acceptance.

- [ ] **Physical Android Device Sampling**:
  - Test on at least 3 distinct physical devices (e.g., Pixel 7/8, Samsung Galaxy S/A series, budget device with <3GB RAM).
  - Android OS coverage: Android 12, 13, 14, 15.
- [ ] **Touch Target Accuracy & Gesture Collision**:
  - 10×10 boards with 28 arrows: verify that individual arrow heads and bodies can be tapped reliably without accidental mis-taps.
  - Hold inspection: verify that a 400ms long-press triggers cleanly on capacitive touchscreens without initiating browser text selection or OS magnifier.
- [ ] **Display Insets & Safe Areas**:
  - Test on devices with display camera cutouts, water-drop notches, and pill cutouts.
  - Verify that top HUD (Hearts, Moves, Stars, Settings) and bottom tools (Hint, Erase) clear notch and home navigation bars in both portrait and landscape orientations.
- [ ] **App Lifecycle & Backgrounding**:
  - Background app mid-level: verify that audio halts immediately.
  - Resume from background after 5 minutes: verify game canvas restores without WebGL context loss or black screens.
  - Incoming phone call interruption: verify progress is preserved in `localStorage`.
- [ ] **Capacitor Native Build & Signing**:
  - Java 21 JDK and Android SDK installed.
  - Signed release APK / Android App Bundle (`.aab`) generated with production keystore.
  - Zero sensitive development flags or test pages bundled in native web assets.

---

## 2. Performance and frame stability

- [ ] **Frame Rate (FPS)**:
  - 60 FPS sustained on target hardware during snake slither exit, camera shake, and ambient floating particles.
  - No frame drops (>16ms spikes) during level transitions or result screen entrance.
- [ ] **Cold Boot Time**:
  - < 2.5 seconds from app launch to interactive Bloom Valley Level 01 board.
- [ ] **Memory & Garbage Collection**:
  - Play 20 consecutive levels without reloading: verify JS heap remains bounded (< 80 MB) and texture memory does not leak.
- [ ] **Core Web Vitals (Web Target)**:
  - LCP (Largest Contentful Paint) < 2.0s.
  - INP (Interaction to Next Paint) < 100ms on arrow tap.
  - CLS (Cumulative Layout Shift) = 0.00.

---

## 3. Accessibility (A11y) and comfort

- [ ] **Reduced Motion Support**:
  - Respects OS `prefers-reduced-motion: reduce`.
  - In-game Settings toggle for Reduced Motion disables camera shake, particle floaters, and speeds up snake translation.
- [ ] **Visual Distinction (Color Blindness Safe)**:
  - Never use color alone to signal mechanics:
    - Anchors: Inverted gold anchor glyph.
    - Locks: Padlock badge.
    - Keys: Key badge.
    - Ice: Distinct crystalline cracking texture and numeric badge.
    - Phase gates: Alternating aurora shimmer.
- [ ] **Contrast Ratios**:
  - Text and HUD elements satisfy WCAG 2.1 AA contrast ratio (>= 4.5:1 against game background).
- [ ] **Audio & Haptics**:
  - Independent toggles for SFX and Music.
  - Mute setting persists across reloads and strictly silences all Web Audio / native audio channels.

---

## 4. Asset rights and licensing clearance

- [ ] **Typography**:
  - Satoshi: Fontshare commercial license verified.
  - Matcha: Display font license clearance verified for web and native distribution.
- [ ] **Artwork & Icons**:
  - Hero island, hearts, victory scenery: Provenance documented in `assets/generated-art.md`; commercial rights clearance signed off.
  - 30 character avatars and 30 frames: Asset origin and commercial game licensing verified.
  - UI icons: Sourced from vetted SVG icon packages without GPL or attribution obligations.
- [ ] **Audio**:
  - Tap, slither, shatter, error, and victory sound effects: License provenance confirmed; royalty-free commercial game audio.
- [ ] **Branding**:
  - Official purple arrow-v4 monogram and wordmark approved; historical blue A monogram decommissioned.

---

## 5. Production backend readiness (for future cloud rollout)

Required before transitioning from development-only account services to live production accounts:

- [ ] **Durable Cloud Infrastructure**:
  - Managed backend service (e.g. Google Cloud Run or App Engine) deployed with HTTPS, TLS 1.3, and CORS restrictions.
- [ ] **Production Database & Ledger**:
  - Production PostgreSQL / Spanner replacing local development SQLite (`economy.sqlite`).
  - Automated daily backups, point-in-time recovery, and verified restore procedures.
- [ ] **Full-History Cloud Storage Capacity**:
  - Multi-chunk entity envelope deployed to handle 100-level UUID transcripts (> 10,700 bytes) without rejection.
  - Zero-truncation guarantees verified on real production storage.
- [ ] **Authentication & Security**:
  - Production Google OAuth Client ID and PlayFab production Title ID.
  - Server-side HttpOnly, Secure, SameSite=Strict session cookies.
  - Rate limiting on auth and sync endpoints (e.g., max 10 sync calls per minute per account).
- [ ] **Monitoring & Operational Ownership**:
  - Cloud Logging, error tracking (e.g., Sentry / Google Cloud Error Reporting), and alerting on elevated 409/413/502 error rates.

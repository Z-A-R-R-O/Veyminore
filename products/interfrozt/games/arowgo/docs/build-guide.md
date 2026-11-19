# AROWGO build and verification guide

Updated 16 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Backlog](execution-backlog.md). This replaces the original one-level candidate-stack checklist.

## Workspace and runtime

Game package: products/interfrozt/games/arowgo in the active checkout. During this audit the checkout is E:/Veyminore-arowgo-preview, not the separate E:/Veyminore directory. Reuse the intended checkout and inspect Git status before editing; this branch contains substantial prior uncommitted work.

Node >=22.12 is required by this package. Use the workspace-pinned package manager and lockfile. From the workspace root run pnpm --filter @veyminore/arowgo dev --port 4173. From the game folder run pnpm dev --port 4173. Preview: http://127.0.0.1:4173.

## Boundaries

| Directory          | Responsibility                                                       |
| ------------------ | -------------------------------------------------------------------- |
| src/domain         | Versioned rules, solver, campaign, offline geometry/planning helpers |
| src/application    | Controller/session transitions, scoring, idempotent local actions    |
| src/storage        | Local profile/session validation, backups and migration              |
| src/game           | Phaser/SVG board, hit testing, animations and previews               |
| src/ui             | React navigation, tutorials, results, collection and responsive CSS  |
| content/levels     | Canonical shipped JSON and immutable previous editions               |
| content/candidates | Staged authoring output; not automatically shipped                   |
| tests              | Vitest; tests/e2e holds Playwright cases                             |
| android            | Capacitor native wrapper; separate build/device gate                 |

Domain code must not depend on React/Phaser. Runtime trusts checked-in canonical content, not random generation on entry. The proposed backend is documented in BACKEND-ACCOUNT-PLAN.md and is not an existing directory/service.

## Change workflow

1. Read CURRENT-GAME-STATE.md and relevant feature contracts.
2. For rule changes, update checker, solver, session validation, UI and tests together. Keep old definitions for save migration.
3. Author candidates separately, verify complete and alternate safe routes, then promote reviewed JSON. Never overwrite historical input archives.
4. Keep coins/best stars/claimed rewards across replacements; reset incompatible current attempts explicitly.
5. Run meaningful unit tests, type/build checks and affected browser flows. Run the broader suite for release/audit work and record actual results.
6. Inspect representative screenshots at phone and desktop sizes. Use isolated browser contexts; do not clear the user's saves.
7. Update status, feature docs, audit evidence and changelog. Keep plans distinct from implemented contracts.

## Commands from game directory

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm lint
pnpm exec playwright test
```

Lint is formatting only; it is currently a known failing gate, not silently waived. Unit/build checks and browser runs should be scheduled to avoid needless resource contention. A targeted passing test does not mean the entire suite passed. Do not claim native acceptance from Playwright phone emulation.

## Android gate

Capacitor configuration points to dist and com.veyminore.arowgo. Build web assets, run pnpm android:sync, then inspect/build with a compatible Android toolchain. The current audit found Java/JAVA_HOME available but no ANDROID_HOME or local.properties in this checkout. Verify SDK location, toolchain compatibility, signing, build output and physical-device behavior before marking native work complete. This audit passed assembleDebug using Android Studio's bundled Java 21. The default Java 17 cannot compile the current source target (invalid source release: 21). Reproduce with process-local settings from the game folder:

```powershell
$env:JAVA_HOME = 'C:/Program Files/Android/Android Studio/jbr'
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android/Sdk'
./android/gradlew.bat -p android assembleDebug
```

Use the actual compatible JDK/SDK paths on another machine. The debug APK is android/app/build/outputs/apk/debug/app-debug.apk. This does not establish release signing or device acceptance.

## Release evidence

Capture dated command results, browser project/viewport scope, device model/OS for native checks, unresolved warnings/failures and migration behavior. Generated art and supplied audio/fonts require a release rights review. Account/billing features additionally require secure identity, server authority, receipt recovery and operating ownership before activation.

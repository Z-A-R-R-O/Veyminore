# AROWGO

A playable snake-arrow puzzle under **Veyminore → InterFrozt**, with 60 campaign levels across Bloom Valley, Verdant Cove and Frostfall Peaks. React/TypeScript menus, a Phaser/SVG board, Vite tooling and a Capacitor Android wrapper.

**Historical status — 16 November 2026 (see later implementation documents for account/economy updates):** local browser prototype. Accounts, cloud saves, trusted economy, billing and public-release acceptance are not implemented. The next priority is the [account/backend foundation](docs/BACKEND-ACCOUNT-PLAN.md); the original [Frostfall proposal](docs/FROSTFALL-PEAKS-PLAN.md) is superseded for Levels 41–60 by the [implemented world](docs/FROSTFALL-PEAKS.md), using existing mechanics.

## Run locally

From the repository root, install the pinned workspace dependencies and run:

```powershell
pnpm install
pnpm --filter @veyminore/arowgo dev --port 4173
```

Open [AROWGO](http://127.0.0.1:4173). The package requires Node >=22.12; use the package-manager version pinned in the repository root.

## Play

Tap an arrow whose head has a clear forward path; its body follows like a snake. Keys and anchors add prerequisites. From Level 10, marked barrels introduce move allowances; from Level 25, two deadlines require coordinating routes. The allowance counts successful removals, including its own removal, not seconds. Hold an arrow to preview; keyboard users can focus an arrow and press Enter, or hold P to inspect.

Story has three mistake hearts. Practice has unlimited mistakes but still follows puzzle deadline rules and grants no campaign rewards. Hint selects a safe continuation; confirmed Erase consumes a removal and marks the attempt assisted. Both are currently free. Stars reward completion, zero mistakes and speed separately; assistance does not cap stars. The base speed target is eight seconds per arrow, minimum 60 seconds.

First Story clear grants 25 coins once per level: 1,500 total coins and 180 possible stars. Progress is browser/device-local. Profiles have 15 cosmetic arrow skins and three prototype crates, with coin/gem spending and a Time Boost. These balances are client-controlled prototypes, not verified paid entitlements.

## Development tools

In `pnpm dev`, use the draggable purple **DEV** bug button for an isolated level sandbox, layout outlines and local bug-report downloads. These controls are excluded from production builds. See [Development mode](docs/DEVELOPMENT-MODE.md).

## Checks

```powershell
pnpm --filter @veyminore/arowgo typecheck
pnpm --filter @veyminore/arowgo test
pnpm --filter @veyminore/arowgo lint
pnpm --filter @veyminore/arowgo exec playwright install chromium
pnpm --filter @veyminore/arowgo test:e2e
pnpm --filter @veyminore/arowgo build
```

Lint is a Prettier formatting check. See the [current audit](docs/AUDIT-2026-11-16.md) for actual outcomes; listing commands does not mean all checks pass. Browser emulation does not certify native devices. No root-workspace-wide validation is claimed.

## Android

The native project is in android/; app ID is com.veyminore.arowgo. Run android:sync after building and open it with Capacitor/Android Studio. As of this audit, Java is installed and JAVA_HOME is set. ANDROID_HOME and android/local.properties are absent in this checkout; the standard SDK directory is present. Current native sync and assembleDebug passed using Android Studio’s bundled Java 21; the default Java 17 failed with invalid source release: 21. Historical reports of missing Java no longer describe the current host. Launcher assets exist, but neither asset sync nor generated project files prove a device release is ready.

## Start with these documents

- [Current implementation](docs/CURRENT-GAME-STATE.md)
- [Audit and verification limits](docs/AUDIT-2026-11-16.md)
- [Backend/account plan](docs/BACKEND-ACCOUNT-PLAN.md)
- [Planning difficulty](docs/PLANNING-DIFFICULTY.md) and [snake rules](docs/SNAKE-MOVEMENT.md)
- [Masterplan](MASTERPLAN.md), [execution backlog](docs/execution-backlog.md), [documentation index](docs/README.md)

Original references remain historical evidence. AROWGO is a working name; release ownership, asset licensing review, native acceptance and production operating gates remain open.

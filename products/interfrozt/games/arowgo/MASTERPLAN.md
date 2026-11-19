# AROWGO — Current delivery plan

Updated 16 November 2026. Parent: InterFrozt / Veyminore. Implementation truth is [Current game state](docs/CURRENT-GAME-STATE.md); verification truth is the [dated audit](docs/AUDIT-2026-11-16.md). Earlier 2.x reference plans and prototype reports are historical/design context.

## Current product

Forty local campaign levels: Bloom Valley 1–20 and Verdant Cove 21–40. Snake head-ray movement, keys, anchors, move-count deadlines, tutorials, safe hints, results, local profiles, three crates and fifteen skins are implemented. Levels 10–40 use content 9 planning constraints. Accounts, cloud sync, backend economy, billing, rankings and multiplayer are not implemented. Android debug assembly is verified with Java 21; physical-device/release and human difficulty acceptance remain open.

## Delivery priority

1. **Account and cloud foundation:** implement the [backend plan](docs/BACKEND-ACCOUNT-PLAN.md), including guest-to-account linking, safe legacy migration, conflict handling and server-owned valuable rewards.
2. **Verification and release readiness:** resolve the audit's failed checks and native setup gaps; validate on physical devices; review asset rights, economy and player comprehension.
3. **World 3:** resume the [Frostfall Peaks proposal](docs/FROSTFALL-PEAKS-PLAN.md) after the account foundation. Prototype rules and a small reviewed puzzle set before all twenty levels.
4. **Collection expansion:** five chest tiers, Ethereal and 100 skins remain [planned](docs/CHEST-AND-SKIN-LAUNCH-PLAN.md). Current odds must not silently change to a planning table.
5. **Later services:** additional login providers, rankings, PGS, daily/endless, social and multiplayer need their own acceptance gates.

## Architectural boundaries

Keep the TypeScript domain separate from React/Phaser rendering. Preserve versioned saves and stable level IDs. Generation and planning are offline authoring steps; ship reviewed JSON. Use Capacitor adapters for native integration. The proposed trusted backend reuses canonical rule validation and owns account/economic commands. No Kotlin rewrite is required.

## Definition of done

Each milestone needs implementation evidence, relevant tests, explicit migration/rollback behavior and current documentation. A passing solver is not human difficulty validation. A build is not native certification. Local prototype balances are not verified purchases. No planned feature is advertised as live until it exists.

See the [backlog](docs/execution-backlog.md) and [decision register](docs/decisions/README.md). Source references in references/ remain unchanged. No delivery dates, staffing, production budget or external provisioning are implied by this plan.

B01 is now in progress: isolated contracts, disabled web transport and raw legacy capture are implemented. Live credential/linking proof remains open. See [account implementation](docs/ACCOUNT-FOUNDATION.md).

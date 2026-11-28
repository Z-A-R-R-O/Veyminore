# Current game state

Updated 27 November 2026. This is the current implementation summary; older design documents and dated test reports are not competing contracts. [Index](README.md) · [Verification](ECLIPSE-FOUNDRY-AUDIT.md) · [Open gaps](GAME-EXPERIENCE-GAPS.md).

## Campaign

| Chapter | Levels | Current guide |
| --- | --- | --- |
| Bloom Valley | 1–20 | [Movement](SNAKE-MOVEMENT.md), [planning](PLANNING-DIFFICULTY.md) |
| Verdant Cove | 21–40 | [Cove](VERDANT-COVE.md) |
| Frostfall Peaks | 41–60 | [Frostfall](FROSTFALL-PEAKS.md), [timing](FROSTFALL-TIMING.md) |
| Amber Dunes | 61–80 | [Dunes](AMBER-DUNES.md) |
| Amber Sanctum | 81–100 | [Sanctum](AMBER-SANCTUM.md) |
| Clockwork Citadel | 101–140 | [Clockwork](CHAPTER-SIX-PLAN.md) |
| Astral Observatory | 141–180 | [Astral](ASTRAL-OBSERVATORY.md) |
| Eclipse Foundry | 181–220 | [Foundry](ECLIPSE-FOUNDRY.md) |

The campaign has 220 stable level IDs, 660 available stars and 5,500 first-clear coins. Worlds unlock sequentially and show ten level markers per map page. Level 80 continues to 81; Level 100 continues to 101; Level 140 continues to 141; Level 180 continues to 181; Level 220 reaches the finale. Worlds after 100 contain forty levels each. Sanctum reuses Amber artwork. Canonical content is checked-in JSON selected by `src/domain/campaign.ts`; generation does not run on entering a level.

Generator version 4 supports dense authoring. Levels 30–80 use the content-12 density pass; Sanctum uses content 12, 28 arrows on 10×10 boards, with keys, anchors, ice, phase gates and removal-count deadlines. Versions differ across earlier content; do not relabel the whole campaign as one content version. [Dense campaign](DENSE-CAMPAIGN.md) and [Sanctum](AMBER-SANCTUM.md) record acceptance measurements. Solver probability measures arbitrary legal-play outcomes, not human success or IQ. Human tuning remains necessary.

## Play behavior

Snake movement follows the head's exit ray and then the body path. Blocked taps cost Story hearts; Practice permits unlimited mistakes. Mechanic deadlines count removals rather than elapsed seconds. Hint and blocked taps do not consume removals; Erase does. Hints may reveal a solver-safe choice. The separate 400ms hold preview shows neutral immediate effects, never a winning route; release cancels inspection and a separate tap commits. See [hold preview](HOLD-PREVIEW.md).

Three stars are independent: finish, no mistakes, and finish within the target (eight seconds per arrow, minimum 60 seconds). Assistance does not cap stars. Hint/Erase remain free in this prototype. Time Boost costs three gems for 30 extra seconds. Practice grants no campaign rewards. Repeat clears do not grant another first-clear payment.

## Presentation and collection

Home, Worlds, Modes, play, results, Profile, Shop, Settings and finale are implemented. Multiplayer is a coming-soon placeholder, not network play. Profile supports 30 supplied character portraits, 30 frames, badges and explicit appearance Save. Avatar/Frame choices scroll; background editing was removed. Legacy background assets/parsing remain for compatibility. Appearance (avatar, frame, display name) is synchronized across devices via the server ledger with optimistic revision locking, and restored into the local profile during account restore. [Profile history](PROFILE-AVATARS.md), [badges](BADGES.md), and [account continuity](ACCOUNT-CONTINUITY-AND-CONFLICTS.md) describe assets and synchronization behavior.

Current branding uses the purple arrow-v4 artwork; the blue A monogram is historical. Matcha display fonts and Satoshi support the interface. Existing supplied audio and generated art still require release rights review. Move feedback, unlock bubbles and reduced-motion behavior are implemented. The collection currently contains 15 arrow skins and three crates; five chest tiers, Ethereal and a 100-skin launch catalog remain a [proposal](CHEST-AND-SKIN-LAUNCH-PLAN.md).

## Accounts, storage and currency

There are distinct modes; do not mix their authority or restore behavior:

| Mode | Authority and limits |
| --- | --- |
| Legacy local play | Device saves own progress and currency; no online identity required. |
| Development PlayFab snapshot sync | Google sign-in plus explicit initial cloud association; automatic completion uploads when enabled. Revision conflicts pause for resolution; snapshots do not merge currency. |
| Reviewed account-wallet preview | SQLite server ledger owns balances, inventory, appearance and clear receipts. Account-scoped local saves preserve legacy originals. Explicit second-device restore recreates cleared boards, stars, equipped skins, and appearance; uncompleted boards restart cleanly at move 0 to prevent state corruption. Legacy snapshot uploads pause in this mode. See [account continuity](ACCOUNT-CONTINUITY-AND-CONFLICTS.md). |

Google ID tokens are verified server-side and exchanged through PlayFab OIDC `google-web`. The old authorization-code experiment is superseded. Live identity success and an isolated real PlayFab save/restore probe were user-confirmed; those checks do not certify large-history sync or production operation. See [account services](ACCOUNT-SERVICES.md).

The cloud envelope accepts at most 512 KiB raw and 150,000 bytes packed, using a multi-chunk PlayFab fragmentation scheme (up to 30 indexed chunk objects of 7,000 characters each). Realistic UUID-rich move histories for 100 completed levels, backups, and migration archives compress to ~15–80 KiB packed, comfortably fitting within capacity. Atomic current/previous generations and optimistic concurrency are preserved. Oversized saves are rejected without truncation; local data remains intact. See [cloud recovery guide](CLOUD-SAVE-RECOVERY.md).

The account server supports both localhost development and containerized production modes (`AROWGO_PRODUCTION_SERVER=1`). Production infrastructure provides durable SQLite sessions (`sessions.sqlite`), IP sliding-window rate limiting, automated ledger point-in-time snapshots (`VACUUM INTO`), cryptographic manifests, balance invariant verification, and container health probes (`/health`). Signed-in identity alone never authorizes importing legacy balances. Reviewed migration, recovery copies, idempotent receipts and explicit account binding protect existing saves. See [production infrastructure](PRODUCTION-ACCOUNT-INFRASTRUCTURE.md), [server economy](SERVER-ECONOMY.md), and [production deployment](DEPLOYMENT-PRODUCTION.md).

## Engineering and verification

Node >=24, TypeScript, React, Vite, Phaser, Vitest, Playwright and Capacitor Android. Domain rules are separate from UI and persistence. Developer tools provide isolated level selection through 220 and downloadable screenshot bug reports; reports require manual sending.

Latest verification: 940 tests across 71 files, typecheck and production build passed. Eight Foundry levels completed on both Desktop Chrome and emulated Pixel 7; four-page map and prior-save checks pass at 320px, 390px and desktop widths. Short-phone switch lesson and reduced-motion checks also pass. See the [Foundry audit](ECLIPSE-FOUNDRY-AUDIT.md) for the targeted gameplay scope and remaining limits. Full browser-suite, physical-device, production deployment and human difficulty acceptance are not asserted.

## Development tools

DEV displays versioned numeric structural difficulty for all 220 campaign levels. DEV play stays memory-only and reward-free. The five earlier Chapter 6 candidates remain historical artifacts. See [Clockwork design](CHAPTER-SIX-PLAN.md).

Clockwork uses content 13, three-beat gates and inclusive opening windows. It retains 28 arrows per dense board. The frozen structural rating remains version 1; its risk analysis sees the new rules, while its timing component remains a keg-slack measure. Clockwork currently reuses Amber scenery with a dusk palette.

Astral Observatory adds forty dense puzzles with progressively tighter combinations of taught timing rules. It has generated portrait/wide maps and a matching home island. See [Astral design](ASTRAL-OBSERVATORY.md).

Astral content 14 uses a globally nondecreasing 862–951 curve, above the previous campaign peak. Content-13 Astral saves migrate with coins and best stars preserved; changed boards restart their current attempt. See [hardening](ASTRAL-HARDENING.md).

Foundry content 15 adds numbered linked switches and gates. Removing a matching switch toggles gates; ordinary moves do not. The gate state is derived from active arrows, preserving the existing save schema. Levels 1–180 are unchanged. See [Foundry rules and authoring](ECLIPSE-FOUNDRY.md).

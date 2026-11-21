# Current game state

Updated 20 November 2026. This is the current implementation summary; older design documents and dated test reports are not competing contracts. [Index](README.md) · [Verification](AUDIT-2026-11-20.md) · [Open gaps](GAME-EXPERIENCE-GAPS.md).

## Campaign

| Chapter | Levels | Current guide |
| --- | --- | --- |
| Bloom Valley | 1–20 | [Movement](SNAKE-MOVEMENT.md), [planning](PLANNING-DIFFICULTY.md) |
| Verdant Cove | 21–40 | [Cove](VERDANT-COVE.md) |
| Frostfall Peaks | 41–60 | [Frostfall](FROSTFALL-PEAKS.md), [timing](FROSTFALL-TIMING.md) |
| Amber Dunes | 61–80 | [Dunes](AMBER-DUNES.md) |
| Amber Sanctum | 81–100 | [Sanctum](AMBER-SANCTUM.md) |

The campaign has 100 stable level IDs, 300 available stars and 2,500 first-clear coins. Worlds unlock sequentially and show ten level markers per map page. Level 80 continues to 81; Level 100 reaches the finale. Sanctum reuses Amber artwork. Canonical content is checked-in JSON selected by `src/domain/campaign.ts`; generation does not run on entering a level.

Generator version 4 supports dense authoring. Levels 30–80 use the content-12 density pass; Sanctum uses content 12, 28 arrows on 10×10 boards, with keys, anchors, ice, phase gates and removal-count deadlines. Versions differ across earlier content; do not relabel the whole campaign as one content version. [Dense campaign](DENSE-CAMPAIGN.md) and [Sanctum](AMBER-SANCTUM.md) record acceptance measurements. Solver probability measures arbitrary legal-play outcomes, not human success or IQ. Human tuning remains necessary.

## Play behavior

Snake movement follows the head's exit ray and then the body path. Blocked taps cost Story hearts; Practice permits unlimited mistakes. Mechanic deadlines count removals rather than elapsed seconds. Hint and blocked taps do not consume removals; Erase does. Hints may reveal a solver-safe choice. The separate 400ms hold preview shows neutral immediate effects, never a winning route; release cancels inspection and a separate tap commits. See [hold preview](HOLD-PREVIEW.md).

Three stars are independent: finish, no mistakes, and finish within the target (eight seconds per arrow, minimum 60 seconds). Assistance does not cap stars. Hint/Erase remain free in this prototype. Time Boost costs three gems for 30 extra seconds. Practice grants no campaign rewards. Repeat clears do not grant another first-clear payment.

## Presentation and collection

Home, Worlds, Modes, play, results, Profile, Shop, Settings and finale are implemented. Multiplayer is a coming-soon placeholder, not network play. Profile supports 30 supplied character portraits, 30 frames, badges and explicit appearance Save. Avatar/Frame choices scroll; background editing was removed. Legacy background assets/parsing remain for compatibility. Appearance remains device-local in account-wallet restoration. [Profile history](PROFILE-AVATARS.md) and [badges](BADGES.md) describe assets and rollout.

Current branding uses the purple arrow-v4 artwork; the blue A monogram is historical. Matcha display fonts and Satoshi support the interface. Existing supplied audio and generated art still require release rights review. Move feedback, unlock bubbles and reduced-motion behavior are implemented. The collection currently contains 15 arrow skins and three crates; five chest tiers, Ethereal and a 100-skin launch catalog remain a [proposal](CHEST-AND-SKIN-LAUNCH-PLAN.md).

## Accounts, storage and currency

There are distinct modes; do not mix their authority or restore behavior:

| Mode | Authority and limits |
| --- | --- |
| Legacy local play | Device saves own progress and currency; no online identity required. |
| Development PlayFab snapshot sync | Google sign-in plus explicit initial cloud association; automatic completion uploads when enabled. Revision conflicts pause for resolution; snapshots do not merge currency. |
| Reviewed account-wallet preview | SQLite server ledger owns balances, inventory and clear receipts. Account-scoped local saves preserve legacy originals. Explicit second-device restore recreates cleared boards/stars; partial boards and appearance are not synchronized. Legacy snapshot uploads pause in this mode. |

Google ID tokens are verified server-side and exchanged through PlayFab OIDC `google-web`. The old authorization-code experiment is superseded. Live identity success and an isolated real PlayFab save/restore probe were user-confirmed; those checks do not certify large-history sync or production operation. See [account services](ACCOUNT-SERVICES.md).

The cloud envelope accepts at most 512 KiB raw and 10,700 bytes packed. Realistic UUID-rich histories already exceed the packed cap at 80 completed levels. Oversized saves are rejected without truncation; local data remains intact. Compact synthetic full-campaign fixtures do not establish real capacity. This is the highest current cloud gap.

The account server is localhost-only and refuses production mode. Its wallet is a development SQLite service, not deployed PlayFab Economy. Signed-in identity alone never authorizes importing legacy balances. Reviewed migration, recovery copies, idempotent receipts and explicit account binding protect existing saves. See [server economy](SERVER-ECONOMY.md).

## Engineering and verification

Node >=24, TypeScript, React, Vite, Phaser, Vitest, Playwright and Capacitor Android. Domain rules are separate from UI and persistence. Developer tools provide isolated level selection through 100 and downloadable screenshot bug reports; reports require manual sending.

Latest recorded runtime evidence: 393 unit tests across 56 files; 10 targeted Desktop Chrome/emulated Pixel 7 checks; typecheck and build passed. This documentation cleanup does not rerun those runtime checks. Full browser-suite, formatting, physical-device, production deployment and human difficulty acceptance are not asserted. See [dated evidence](AUDIT-2026-11-20.md).

## Development addition - 21 November 2026

DEV now displays versioned numeric structural difficulty for the 100 shipped levels and five isolated Chapter 6 candidates (101-105). The latter are not campaign levels and earn no persistent rewards. See [chapter plan and scoring model](CHAPTER-SIX-PLAN.md). The campaign count and production content remain unchanged.

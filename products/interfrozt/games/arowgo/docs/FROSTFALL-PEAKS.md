> Latest update: [Ice Seals and Aurora Gates, content 10](FROSTFALL-TIMING.md) replace the original Frostfall puzzles with harder timing challenges. Earlier content-9 details below are historical.

# Frostfall Peaks — Levels 41–60

Implemented 19 November 2026. Third campaign world, unlocked by completing Level 40. Twenty new puzzles; the original forty level files and IDs remain unchanged. Amber Dunes remains a locked coming-soon destination.

## Gameplay and difficulty

Uses existing, already-taught mechanics: one key/lock pair, one anchor group, and two move-count deadlines. Levels 41–45 have one anchored dependent; later puzzles have two. Boards contain 16–18 arrows. No new rule is silently introduced.

Seeded connected placement produces distinct geometry. The deadline planner scores consequential choices, including legal moves that leave the puzzle unwinnable. The target random-legal-move win probability decreases from 8% to 2.5%. This is a generator diagnostic, not a prediction of player success or proof of enjoyment. Human playtesting is still needed.

Reproduce candidates with `AROWGO_FROST=1 pnpm exec vitest run tests/author-frost.test.ts` (set the environment variable using your shell). Candidate and promoted files use rulesVersion 2 and contentVersion 9, required by the existing mechanics validator. The author validates the final serialized version, not only its intermediate board. Existing planning targets for Levels 10–40 are unchanged.

## Safety and integration

Campaign and server reward manifests both include all sixty levels. New IDs are frost-41 through frost-60. First-clear reward remains 25 coins, awarded once; no balances or unlocks are granted by installing the update. Level 40 now leads to Level 41, and Level 60 leads to the adventure finale. Existing achievement thresholds remain unchanged.

Save keys, account linking, and cloud conflict handling are unchanged. Tests use isolated in-memory/browser saves and synthetic cloud snapshots; they do not modify the user's account. Sixty completed saves with recovery copies must fit the existing 8,000-byte packed snapshot limit and round-trip unchanged. This does not guarantee every unusually large historical snapshot fits; existing rejection/recovery behavior remains active.

## Artwork

Created with the built-in image generator. Map exported to `public/assets/frostfall-peaks.webp`; transparent home island exported to `public/assets/generated/frostfall-home.webp`. Original generated files are retained outside the repository.

Map prompt: Portrait 2:3 premium cheerful glossy 3D fantasy puzzle world map, snowy floating terraces, turquoise ice waterfalls, blue crystals, lavender aurora sky and warm golden summit shrine. Ten broad empty landing terraces in five alternating pairs, a winding snow path, snow fir framing, no text, UI, characters or level markers.

Home prompt: Isolated floating snowy fantasy island, tiny warm gold summit shrine, icy blue crystals, two snow firs and turquoise waterfall, front three-quarter view, rounded polished mobile adventure style, entire island visible, transparent background, no words or UI.

Map controls use world-specific normalized coordinates; ten levels per page. The home page uses a quiet frost gradient behind the isolated island to preserve text readability.

## Measured candidates

| Level | Arrows | Random legal win % | Consequential states | Blocked-target decisions |
|---|---:|---:|---:|---:|
| 41 | 16 | 7.78 | 83 | 68 |
| 42 | 16 | 7.72 | 53 | 41 |
| 43 | 16 | 6.92 | 87 | 73 |
| 44 | 16 | 6.45 | 42 | 28 |
| 45 | 16 | 6.25 | 24 | 18 |
| 46 | 16 | 6.04 | 28 | 26 |
| 47 | 16 | 5.76 | 76 | 75 |
| 48 | 17 | 5.23 | 118 | 89 |
| 49 | 17 | 5.45 | 129 | 99 |
| 50 | 17 | 4.59 | 59 | 52 |
| 51 | 17 | 4.34 | 51 | 42 |
| 52 | 17 | 4.00 | 56 | 40 |
| 53 | 17 | 3.98 | 32 | 25 |
| 54 | 17 | 3.70 | 68 | 66 |
| 55 | 18 | 3.31 | 67 | 60 |
| 56 | 18 | 2.55 | 123 | 120 |
| 57 | 18 | 2.81 | 18 | 16 |
| 58 | 18 | 2.79 | 75 | 68 |
| 59 | 18 | 2.72 | 106 | 87 |
| 60 | 18 | 2.47 | 183 | 143 |


Wide map prompt: Landscape 3:2 glossy snowy mountain terraces, turquoise waterfalls, ice crystals, lavender aurora, gold shrine at upper right. Ten empty circular terraces on a path climbing from lower left to upper right; open upper-left sky for the heading; no text or UI. Export: `public/assets/frostfall-peaks-wide.webp`. Wide screens use independently measured terrace positions; short landscape screens reserve space for the top controls.

## Verification

321 unit/integration tests passed, including canonical server reward checks, all sixty solutions, unique Frostfall geometry, consequential choices, and cloud snapshot size/round-trip. Desktop and Pixel 7 browser playthroughs completed Levels 41–60 and restored 1,500 total coins / 180 stars from synthetic old progress. Existing world chooser locking checks passed. Production typecheck/build passed (existing Phaser chunk-size warning remains). No real PlayFab account or currency was modified.

Responsive map hit-target checks passed at 320×568, 390×844, 844×390 and 1280×800 in both browser projects, after correcting the landscape layout.

The existing Cove browser campaign regression also passed: completing Level 40 opens Level 41, and reload preserves the expected 1,000 coins before any Frostfall reward. Seven focused browser checks passed overall.

> Status reconciled 20 November 2026: this file preserves rollout/design history. Earlier counts, pending gates and UI descriptions below are dated snapshots. Use [current implementation](CURRENT-GAME-STATE.md) for present behavior; this history is not a current setup checklist.

# Mild difficulty ramp: Bloom Valley 6–10

> Historical document — status reconciled 16 November 2026. This records an earlier iteration, concept or verification scope. [Current game state](CURRENT-GAME-STATE.md) and the [latest audit](AUDIT-2026-11-16.md) take precedence for present behavior and checks.

Updated 14 November 2026. Five staged candidates passed solution and phone interaction checks before promotion. Live Levels 6–10 now use content version 6; all other levels retain content version 5. Movement remains rules version 2.

| Level | Score | Opening choices | Dependency depth | Arrows |
|---|---:|---:|---:|---:|
| 5 (baseline) | 83 | 8 | 5 | 16 |
| 6 | 89 | 3 | 5 | 14 |
| 7 | 94 | 4 | 5 | 14 |
| 8 | 96 | 4 | 5 | 15 |
| 9 | 102 | 4 | 6 | 15 |
| 10 | 105 | 4 | 7 | 16 |

## Generator controls

Generator 3 now accepts optional inclusive `openingMoves`, `depthRange`, and `scoreRange` bounds. Bounds contain positive safe integers and must be ordered. Unmet bounds fail the bounded search rather than returning an unsuitable puzzle. Existing calls without these options retain their deterministic output.

`connectedPlacement` biases reverse construction toward arrows that block an existing arrow. It rejects 85% of disconnected placement attempts after the first two arrows; the final quality gates still reject empty quadrants and more than one isolated arrow. This option consumes extra seeded random values and is recorded in generation metadata. `difficultyControlsVersion: 1` records the acceptance contract.

The authoring script allows 25 seeds per level, with 250 candidate boards and 500 placement attempts per board. Each chosen score must be 2–8 points above the previous one. Arrow counts are 14, 14, 15, 15, 16, so difficulty is not equated with adding more arrows. No keys, locks, or bombs are added to these five puzzles.

PowerShell regeneration: set `$env:AROWGO_MILD='1'`, run `pnpm exec vitest run tests/author-mild.test.ts`, then remove the environment variable. The script writes only `content/candidates/mild`; it never promotes files automatically. Seeds and measured metrics are in `report.json`.

## Verification and save safety

Candidate tests validate complete solutions, distinct geometry, the gradual score bounds, deterministic reproduction, invalid/impossible bounds, and 20 alternate legal clearing orders per puzzle. Browser tests mount the staged geometry in the real game UI with isolated in-memory saves, check viewport overflow, and clear every board.

Promotion changes the content version and retains campaign level IDs. Previous layouts are archived in `content/levels/archive-v5` and registered with SaveStore. Existing earned coins, best stars, and claimed/unlocked progression survive. An in-progress old board restarts on the new geometry. The raw old save remains archived under `.content-5`. Re-clearing a claimed level grants no duplicate coins.

## Remaining calibration

Scores are structural estimates, not human difficulty ratings. Level 6 has fewer obvious opening moves than Level 5; human playtesting should confirm that this transition feels mild. Level 11 remains a deliberately easier key/lock introduction (score 66), so this is a local five-level ramp, not a globally increasing twenty-level curve. Review completion times and mistakes before further increasing difficulty or changing the later mechanic lessons.

Verified: full unit suite passed (135 checks before adding the five promotion regressions); all seven candidate/promotion checks then passed. Ten staged browser checks passed across phone and desktop. After promotion, the full twenty-level phone campaign, migration, small-phone layout, and Practice isolation checks passed. TypeScript and production build passed. Human difficulty calibration remains pending.

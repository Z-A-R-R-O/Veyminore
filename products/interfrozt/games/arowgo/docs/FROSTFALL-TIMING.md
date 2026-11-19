# Frostfall timing mechanics — content 10

Implemented 19 November 2026. Levels 41–60 now use harder timing puzzles. Levels 1–40 are unchanged.

## Rules players see

- **Ice Seals:** the blue number is the number of successful removals remaining before thaw. At zero the badge turns mint; normal path blocking still applies.
- **Aurora Gates:** Sun gates open when the successful-removal count is even; Moon gates open when it is odd. A Sun/Moon indicator appears in the rules button. Every successful removal switches the phase. Closed gates have a lavender-blue badge; open gates have a mint badge. Their symbols stay fixed so color is not the only cue.
- Mistakes do not advance either mechanic. Erase counts as a removal and can change the phase or thaw ice. It still marks the run assisted.
- If a legal removal leaves no winning route, the attempt fails as stranded. There is no free wait action. Players must reserve another usable arrow to advance time.

Level 41 introduces one Ice Seal; 42–45 use two. Level 46 introduces one Aurora Gate alongside ice. Levels 51–55 use two gates; 56–60 use three. Existing keys, anchors and two deadlines remain. Each mechanic has a first-visit native modal with a small interactive move demonstration and a persistent Rules button. Guides can be reopened; seen flags are device-local. Reduced-motion behavior remains supported.

## Solver and authoring

The dynamic state is the active-arrow set; removed count is derived from its size. No separate timer or phase field is persisted. checkExit, solver search, safe hints, planning analysis, session failure checks, preview warnings and server completion replay all account for timing. Static geometric dependencies remain independent of phase; the dynamic legality filter applies afterward. Timing boards are capped at twenty arrows for bounded bitmask search.

Author with AROWGO_TIMING=1 and tests/author-timing.test.ts. It starts from the archived content-9 Frostfall geometry, assigns distinct free arrows to seals and gates, explores up to 160 deterministic variants per level, optionally tightens a deadline, checks solvability and chooses the closest measured random-legal-play win rate to a target descending from 3.5% to 0.4%. Generation metadata and timing-report.json record actual results. These are diagnostic probabilities, not predicted human success rates. Some adjacent levels provide a gentler beat; the curve is not strictly monotonic. Every revised level measures below 80% of its original probability. Human playtesting is still required.

## Save and backend compatibility

Content version is now 10. Original Frostfall boards are archived in content/levels/frost-before-timing.json. Loading an old Frostfall attempt starts the revised board, preserving coins, best stars and the first-clear claim. The original raw save is retained in its content-9 recovery key. Completed levels stay unlocked. Existing profile currencies and inventory are untouched.

Cloud validation accepts the known archived version and preserves its raw data for normal migration on load. Unknown versions remain rejected. The server accepts replay proofs for already-issued content-9 attempts against archived server-owned boards; new attempts use content 10. First-clear uniqueness remains keyed by account and level, so an update cannot award coins twice.

## Measured difficulty

| Level | Random legal win % | Consequential states |
|---|---:|---:|
| 41 | 3.60 | 71 |
| 42 | 5.30 | 53 |
| 43 | 2.73 | 40 |
| 44 | 2.33 | 41 |
| 45 | 2.18 | 19 |
| 46 | 2.08 | 8 |
| 47 | 1.74 | 76 |
| 48 | 3.98 | 93 |
| 49 | 1.44 | 153 |
| 50 | 1.26 | 52 |
| 51 | 1.07 | 35 |
| 52 | 0.93 | 30 |
| 53 | 1.20 | 24 |
| 54 | 1.09 | 9 |
| 55 | 0.66 | 46 |
| 56 | 0.67 | 80 |
| 57 | 0.59 | 12 |
| 58 | 0.53 | 50 |
| 59 | 0.43 | 101 |
| 60 | 0.38 | 294 |

## Verification

328 unit/integration tests passed, followed by a passing additional per-move reload regression, including independent snake simulation with timing, gates without deadlines, stranded detection, ice/mistake behavior, malformed content, all old Frostfall save migrations, archived server replay acceptance, cloud restore compatibility, sixty-level solutions and first-clear rewards. Desktop and Pixel 7 browser playthroughs passed all twenty revised levels, restoring 1,500 coins and 180 stars after reload. Both projects also passed the legacy-save migration, guide and badge checks at 320×568, 390×844, 844×390 and 1280×800. Production typecheck/build passed; the existing Phaser chunk-size advisory remains.


Timing-save validation replays each recorded select/erase to check active arrows, mistakes, erased arrows and result status. It does not reuse the old monotone test that hypothetically reinserts cleared arrows at the final phase. That assumption is invalid for alternating gates. A regression round-trips every intermediate and completed state of every Frostfall puzzle and rejects forged empty histories. The interactive guide keeps ice thawed as further demonstration moves toggle the aurora.

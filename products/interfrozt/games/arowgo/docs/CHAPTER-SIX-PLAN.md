# Levels 101-120 and DEV difficulty

Updated 21 November 2026. Status: implementation started; first five candidates are built and staged for playtesting. Campaign remains 100 levels. No existing IDs, saves, rewards or wallet manifests are replaced.

## Twenty-level progression

- 101-105: denser dependency chains, starting below Level 100's sharp spike but above the regular late-Sanctum baseline.
- 106-110: interwoven key, anchor and ice prerequisites with fewer forgiving orders.
- 111-115: phase windows and countdown planning with delayed consequences.
- 116-120: multi-stage capstones combining existing taught mechanics.

Retain 10x10 boards and the solver's tested 28-arrow maximum. Aim for 90-92 occupied cells; reject candidates below 89. Packing is bounded and actual density must be reported rather than assumed. Reject unreadable or repetitive filler. A new theme/name/art is not yet selected.

## Rating implementation

DEV displays an offline numeric structural score from 0 to 1000, model version 1. Weights: planning risk 300, failure horizon 250, dependency depth 200, timing pressure 150, density 100. Calibration is frozen from the shipped 100-level baseline: each component uses 1.25 times its 95th-percentile value (floor .01); contributions clamp to their weights. Do not silently recalibrate existing ratings after new levels arrive.

Risk is negative log10 exact random-legal-play success. Failure horizon is the maximum number of legal removals until failure after the earliest witnessed losing choice, including that choice. This is a delayed-consequence proxy, not proven required human lookahead. Timing uses summed inverse structural deadline slack; it does not include phase/ice schedule slack. Density is occupied/total cells. Scores are comparable only within the same rating version and are not human success predictions or IQ.

The detailed panel shows arrow/cell counts, dependency depth, horizon, opening winning/losing counts, structural slack, probability and component points. It contains no solution IDs. Offline analysis has explicit budgets; exhaustion fails export, never produces an invented score. Missing content-version measurements display “not measured.” No solver runs when opening the DEV panel.

## Authoring and acceptance

Set AROWGO_RATE=1 and run `pnpm exec vitest run tests/export-difficulty.test.ts` to export ratings. Calibration is reused when it already exists. Set AROWGO_CHAPTER6=1 and run `pnpm exec vitest run tests/author-chapter6.test.ts --maxWorkers=1` to author the first five candidates under content/candidates/chapter6.

First milestone: score all existing levels, expose DEV details, and make five distinct candidate puzzles available only in isolated DEV Practice. Validate solutions, structural planning decisions, unchanged campaign content, mobile layout and touch interaction. Human review follows before authoring/promoting the remaining fifteen. The plan deliberately does not publish 20 unreviewed campaign levels.

Promotion requires validated all-twenty content, gradual rating bands and human difficulty review, world/map/finale integration, new stable IDs, backend reward-manifest coverage and save-preservation regressions. Existing full-history cloud capacity is still a separate blocker; this work must not enable sync or truncate snapshots.

## First candidate batch

Ordered by measured structural score after generation; random-play probability alone does not determine order. All use existing mechanics and temporary Amber scenery.

| DEV level | Rating v1 | Arrows | Occupied cells | Dependency depth |
| --- | ---: | ---: | ---: | ---: |
| 101 | 619 | 28 | 91/100 | 11 |
| 102 | 626 | 28 | 90/100 | 9 |
| 103 | 724 | 28 | 90/100 | 10 |
| 104 | 739 | 28 | 92/100 | 9 |
| 105 | 818 | 28 | 91/100 | 9 |

## Verification - 21 November 2026

The broad unit run passed 393 tests and hit five timeout failures; rerunning those five files with one worker passed all 138 tests in those files. New rating tests reproduce exported scores, check monotone candidate ordering, verify stored solutions and distinguish density from planning risk. TypeScript/production build passes (existing large-chunk warning).

Desktop keyboard and emulated Pixel 7 touch each completed all five candidates, opened rating details and retained campaign storage byte-for-byte in isolated contexts. An initial browser run targeted another checkout; a subsequent mobile run was interrupted by source hot reload reopening the sandbox tutorial. Final runs used the dedicated preview and unchanged source. Mobile board/panel screenshots were visually reviewed. Physical-device and human difficulty acceptance remain open. Documentation check passes for 82 files and 400 relative file links.

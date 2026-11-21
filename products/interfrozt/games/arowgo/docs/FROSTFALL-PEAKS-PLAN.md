> Status reconciled 20 November 2026: this file preserves rollout/design history. Earlier counts, pending gates and UI descriptions below are dated snapshots. Use [current implementation](CURRENT-GAME-STATE.md) for present behavior; this history is not a current setup checklist.

Frostfall 41–60 is now implemented; see [shipped chapter](FROSTFALL-PEAKS.md).

> Update 19 November 2026: Levels 41–60 now ship in [Frostfall Peaks](FROSTFALL-PEAKS.md) using existing keys, anchors and deadlines. Any new mechanics below remain proposals.

# Frostfall Peaks — World 3 proposal

Status: planned, not implemented. Documented 16 November 2026. Account/cloud foundations now take priority. The current world selector contains a locked placeholder; there are no Levels 41–60 or new mechanics in shipped data.

## Direction

Icy cliffs, turquoise crystals, frozen waterfalls and aurora skies. Generate distinct home illustration, calm play background and responsive map artwork. Keep ten map stops per page and cloud cover until Level 40 is complete. Amber Dunes remains another placeholder.

## Proposed mechanics

- Crystal gates: blue and amber states alternate after every successful clear; closed gates block head paths. Flip only after the snake finishes exiting. Blocked taps and hints do not flip gates.
- Frost seals: frozen arrows become available after a visible number of successful clears. Plan enough usable moves to thaw an important route. There is no real-time countdown.

Before implementation, define Erase semantics, occupied gate cells, gate/body interactions, frozen key/anchor targets, deadlocks, replay state and save versions. Existing runtime rules do not support these mechanics yet. Extend the solver, validator, preview and renderer together before authoring campaign levels.

| Levels | Intended learning goal                        |
| ------ | --------------------------------------------- |
| 41–43  | Small gate lesson and forgiving practice      |
| 44–46  | Alternate routes through gate phases          |
| 47–49  | Introduce thawing and reserve useful moves    |
| 50     | First gate/frost combination                  |
| 51–54  | Mix with a familiar key or anchor             |
| 55–57  | Carefully add move-count barrel pressure      |
| 58–59  | Longer planning sequences with viable choices |
| 60     | Distinctive combination finale                |

Target mostly 14–18 arrows; additional difficulty must come from choices. First milestone when resumed: gates, interactive lesson and three reviewable puzzles. Test six representative puzzles before authoring all twenty. Human review is required alongside solver checks.

Preserve Levels 1–40 and current rewards. With unchanged reward rules, the eventual 60-level campaign would total 1,500 first-clear coins and 180 stars; these are planned totals, not today's 1,000/120. Require isolated saves, version migration, no duplicated claims, full campaign playthrough and responsive artwork checks before promotion.

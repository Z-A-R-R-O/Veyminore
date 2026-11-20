> Status reconciled 20 November 2026: this file preserves rollout/design history. Earlier counts, pending gates and UI descriptions below are dated snapshots. Use [current implementation](CURRENT-GAME-STATE.md) for present behavior; this history is not a current setup checklist.

# Challenge campaign — content 8

> Historical document — status reconciled 16 November 2026. This records an earlier iteration, concept or verification scope. [Current game state](CURRENT-GAME-STATE.md) and the [latest audit](AUDIT-2026-11-16.md) take precedence for present behavior and checks.

Updated 15 November 2026. Levels 5–40 replace the previous boards; Levels 1–4 remain unchanged.

## Design

Boards use 18–20 arrows, connected placement, at most five initially legal moves, and dependency depth of at least five. The difficulty comes from reading prerequisites, planning unlocks and managing later keg deadlines. Movement rules, hearts and star timing remain unchanged (eight seconds per arrow, minimum 60 seconds). Key, anchor and keg introduction levels retain their existing teaching sequence. Compatible practice blocks are sorted by score; mechanic introductions deliberately break a strictly increasing numeric curve.

Score is a structural heuristic, not a human difficulty rating. Every replacement scores above its previous board. Human playtesting is still needed to tune frustration, clarity and completion times.

## Authoring and validation

Opt-in authoring: AROWGO_CHALLENGE=1 pnpm exec vitest run tests/author-challenge.test.ts. Candidates are cached under content/candidates/challenge; generation does not automatically promote them. Existing candidate files are reused. Explicitly remove only a selected candidate if intentionally reauthoring it, then review the report and sorting before promotion. The checked-in candidates are the reviewed source of truth; some were authored with earlier arrow-count targets.

Keys and anchors occupy separate arrow tails. Kegs are added against a solved order with one or two spare moves, then the full combined board is solved again. Tests check three alternate safe routes per board, distinct geometry, badge separation, content integrity and save round trips.

## Save compatibility

archive-before-challenge.json preserves all 40 previous boards. The controller includes these definitions when loading saves. Replaced in-progress attempts restart on content 8; coins, claimed rewards, best stars, mode and unlocks survive. Raw previous saves are archived under their content-version suffix. Replays cannot duplicate first-clear rewards. Profile data and currency are unchanged.

## Measurements

| Level | Arrows | Previous → new score | Dependency depth | Opening moves |
|---|---|---|---|---|
| 5 | 18 | 83 → 118 | 6 | 4 |
| 6 | 18 | 89 → 121 | 6 | 4 |
| 7 | 18 | 94 → 123 | 7 | 4 |
| 8 | 18 | 96 → 131 | 7 | 4 |
| 9 | 18 | 102 → 131 | 7 | 4 |
| 10 | 18 | 105 → 146 | 8 | 4 |
| 11 | 18 | 66 → 129 | 6 | 3 |
| 12 | 18 | 75 → 117 | 6 | 5 |
| 13 | 18 | 81 → 126 | 7 | 5 |
| 14 | 18 | 81 → 125 | 6 | 5 |
| 15 | 18 | 84 → 119 | 6 | 5 |
| 16 | 18 | 77 → 130 | 7 | 5 |
| 17 | 19 | 91 → 156 | 10 | 4 |
| 18 | 19 | 81 → 124 | 7 | 5 |
| 19 | 19 | 99 → 134 | 8 | 5 |
| 20 | 19 | 102 → 128 | 7 | 5 |
| 21 | 19 | 104 → 133 | 7 | 5 |
| 22 | 19 | 105 → 138 | 7 | 5 |
| 23 | 19 | 109 → 145 | 8 | 4 |
| 24 | 19 | 86 → 135 | 7 | 3 |
| 25 | 19 | 116 → 141 | 8 | 4 |
| 26 | 20 | 118 → 152 | 8 | 3 |
| 27 | 19 | 120 → 154 | 9 | 3 |
| 28 | 20 | 121 → 156 | 9 | 4 |
| 29 | 19 | 131 → 160 | 9 | 4 |
| 30 | 19 | 124 → 169 | 10 | 4 |
| 31 | 19 | 88 → 166 | 11 | 3 |
| 32 | 19 | 125 → 157 | 9 | 4 |
| 33 | 19 | 129 → 167 | 10 | 4 |
| 34 | 19 | 131 → 179 | 10 | 3 |
| 35 | 19 | 133 → 194 | 13 | 1 |
| 36 | 19 | 137 → 203 | 12 | 1 |
| 37 | 19 | 135 → 160 | 8 | 3 |
| 38 | 19 | 143 → 165 | 9 | 4 |
| 39 | 19 | 155 → 176 | 10 | 3 |
| 40 | 19 | 157 → 176 | 11 | 3 |

## Verification

173 unit tests pass, including every replacement and saved completed, practice and unfinished attempts. Production build passes. Browser playthrough and viewport evidence are recorded alongside this document after verification.

Browser verification: both complete campaign runs passed (Bloom 1–20 and Cove 21–40), including lessons, first-clear rewards and persistence. The challenge migration/layout test passed at 320×568, 390×844 and 1280×800 for Levels 5, 10, 20, 30 and 40. It preserves 1,000 prior coins and verifies the archived old save. Screenshots are in docs/verification/challenge-*.png. Visual inspection covered Level 5 on a normal phone and Level 40 on a small phone. The migration notice now uses a compact stacked footer so it cannot squeeze the board beside the mode button.

> Status reconciled 20 November 2026: this file preserves rollout/design history. Earlier counts, pending gates and UI descriptions below are dated snapshots. Use [current implementation](CURRENT-GAME-STATE.md) for present behavior; this history is not a current setup checklist.

Current authoring uses generator version 4, static reviewed JSON and up to 28 arrows. See [dense campaign](DENSE-CAMPAIGN.md) and [Sanctum authoring/acceptance](AMBER-SANCTUM.md) for current generation and promotion checks.

Current difficulty: [Planning pass and measured order decisions](PLANNING-DIFFICULTY.md), content 9 for Levels 10–40. Geometry is unchanged from content 8; Levels 1–9 are preserved. Generation is offline; shipped puzzles are solver-verified JSON. The current geometry engine is version 3 under snake movement rules.

The generator history below records earlier iterations. Current contracts are CURRENT-GAME-STATE.md, PLANNING-DIFFICULTY.md and SNAKE-MOVEMENT.md.

# Puzzle generation and authoring

Historical snapshot from 14 November 2026: this section describes generator version 2 and campaign content version 3, not the current shipped version. See CURRENT-GAME-STATE.md for the full game contract and KEYS-AND-LOCKS.md for the new mechanic.

## Architecture

Generation is an offline authoring step. Players load checked-in JSON; generation never blocks the game screen or silently changes a level. Each generated file contains board geometry, arrow IDs, a complete solution and generation metadata. Levels 1–5 are unchanged. Levels 6–10 are generated candidates selected and ordered by measured difficulty.

`src/domain/generator.ts` exports `generatePuzzle`, `evaluateDifficulty` and `evaluateLayout`. `rules.ts` owns geometry validation, the swept collision checker, dependency construction and solver. Generator v1 is retained in `generatorV1.ts` for reproducing its output.

## Deterministic inputs and bounds

`generatePuzzle(seed, count, targetScore, levelId)` accepts an unsigned 32-bit integer seed, 4–20 arrows and a finite nonnegative target score. A fixed 32-bit linear congruential PRNG supplies all random choices. The same inputs and generator version produce the same candidate. No wall-clock time or ambient randomness is involved.

Version 2 examines at most 250 candidate boards, each with at most 500 placement attempts, on a 10×10 grid. It fails explicitly if no candidate meets the constraints. A difficulty target is approximate, not a guarantee. The board dimensions and shape vocabulary are intentionally limited in this version.

## Construction and validation

1. Sample a straight or one-bend arrow with segments of one or two grid units.
2. Reject out-of-bounds geometry and initial overlap with accepted arrows.
3. Accept a new arrow only if its complete rigid footprint can exit through the existing arrows. Consequently the most recently placed arrow can leave first; reverse placement is a constructive solution.
4. Require the requested arrow count. Solve the board through the dependency graph.
5. Replay that solution using `validateLevel`, which checks every move with the stepped swept-footprint collision checker.
6. Apply layout gates and rank surviving candidates.

The dependency graph is built independently from pairwise cell rays, while the collision checker translates every occupied cell step by step. Agreement is useful protection against generator/solver mistakes. Under removal-only rules, clearing a legal arrow cannot add a blocker; any legal sequence can progress. This is why a topological solver suffices and why these puzzles do not yet contain irreversible strategic traps.

## Difficulty metrics

| Metric | Meaning |
| --- | --- |
| Depth | Longest chain of prerequisites, including the arrow itself |
| Edges | Total blocking relationships |
| Bends | Total direction changes across shapes |
| Initial choices | Number of arrows with a legal exit on the starting board |
| Forced steps | States with one legal exit along the deterministic solver order |

Score = depth × 8 + edges × 2 + bends + forced steps × 3. Forced-step counts depend on the chosen solution order. Scores are an internal ranking heuristic, not a player-tested difficulty rating. Arrow count alone does not define difficulty.

## Layout quality

For boards with at least ten arrows, reject candidates if more than half the arrows are initially free, more than one arrow is isolated from the dependency graph, or any board quadrant is empty. Count occupied cells per quadrant and penalize imbalance. Selection cost is absolute distance from the target score + five times isolated arrows + 0.3 times quadrant imbalance.

These checks encourage spatial coverage and related arrows without compressing hit targets. They do not guarantee aesthetic quality, perfect spacing or enjoyment; visually inspect candidates and play them before release. Tiny visible arrow IDs are removed from gameplay. Accessible IDs remain for keyboard control and tests.

## Current campaign batch

World expansion: Bloom Valley now contains 20 levels. Existing 1–10 layouts are preserved. Levels 11–20 are a second sorted batch of generator-v2 candidates, accepted at score 91 or above with 16–20 arrows. Each file records its exact seed and grade. Generate this batch only with `AROWGO_EXPAND=1` and `pnpm exec vitest run tests/expand-world.test.ts`; clear the environment variable afterwards. This writes only 11–20. Do not rerun the original batch to expand the world. The map displays two ten-stop sections without shrinking tap targets. Existing ten-level saves unlock level 11 once level 10 is claimed; totals are 60 stars and 500 first-clear coins, with the finale after level 20.

The batch uses seeds 6106, 6243, 6380, 6517 and 6654, counts 11–15, and targets 70, 82, 94, 106 and 118. Candidates are sorted by actual grade before assigning Levels 6–10. Current grades are 59, 78, 81, 87 and 91; all five have zero isolated arrows. Consult each JSON for its final seed/count association and metrics.

Intended progression: find related exits, compare bent footprints, work through blocking chains, then combine several chains. These are design intentions. Human difficulty and comprehension review remain open.

## Rebuilding candidates

From the game directory in PowerShell:

```powershell
$env:AROWGO_GENERATE='1'
pnpm exec vitest run tests/generate-content.test.ts
Remove-Item Env:AROWGO_GENERATE
```

This explicit authoring command writes only `content/levels/bloom-06.json` through `bloom-10.json`. Normal tests do not rewrite content. The authoring check requires strictly increasing grades before writing. Inspect the JSON diff and generated screenshots, run unit tests, play the campaign, and review save compatibility before accepting new layouts. Replacing published geometry requires a new content version and archived definitions; algorithm changes require a generator version increment.

## Save migration

Current sessions use content version 3. Original mirrored layouts remain in `legacyCampaign.ts`; the prior generated layouts are in `content/levels/archive-v2` and exposed by `campaignV2.ts`. A save must fully validate against a known previous layout before migration. Its original data is archived under the save key plus `.content-1` or `.content-2`.

Migration starts the changed board fresh while carrying best stars, coins, claimed status and mode. It resets the active board, processed commands, mistakes and attempt timing. Completion of an already-claimed level never awards a second 25 coins. Current saves retain their existing key names; `contentVersion` disambiguates their layout. Corrupt saves are not used as reward ledgers.

## Testing and limitations

Coverage includes repeatable seeds, twenty-seed sampling, geometric validation, complete solutions, layout gates, increasing campaign grades, original levels unchanged, migration from content 1 and 2, and no duplicate coin awards after replay. Browser tests complete all ten levels and inspect saved totals; screenshot captures check rendered boards. These are representative checks, not an exhaustive proof over every possible seed or device.

The generator currently emits ordinary arrows only. Key/lock rules are implemented separately in a Practice lesson: prerequisites remain monotone and fit the dependency graph. Generator placement of keys is not enabled yet. Move-count bombs, linked arrows, daily seeds and endless play remain future work. Bombs will require explicit countdown state, failure semantics and state-aware validation before they can be generated safely.

## Optional key/lock generation (mechanics version 1)

Call `generatePuzzle(seed, count, targetScore, levelId, { keyLockPairs: 1 })` to generate one key/lock pair. The default remains zero, preserving existing plain-puzzle seed output and campaign content. Only zero or one pair is accepted: the current shared badge artwork does not distinguish several matching pairs.

For each completed geometric candidate, the generator computes its dependency graph and enumerates ordered pairs of distinct arrows. It rejects a pair when the lock already depends transitively on the key (redundant mechanic), or when the key depends transitively on the lock (would create a cycle). The seeded random stream selects a surviving pair, assigns `requires`, and solves the augmented graph. Candidates without a valid pair or complete solution are discarded within the existing 250-candidate budget.

Difficulty and layout metrics are evaluated after placement, so key edges contribute to depth, choices, forced steps and score. The final authored solution is validated against lock rules and swept geometry. Output records `generation.mechanicsVersion: 1` and `generation.keyLockPairs: 1` alongside generator version 2. Reproduction requires the same options as well as seed/count/target. Generated IDs must be unique to new content; this API does not migrate or replace campaign saves.

Tests cover reproducibility, twelve seeds with full legal solution replay, exactly one pair, key-before-lock ordering, and a geometry-only replay proving the new lock adds a constraint. Existing keys tests cover cyclic authored content, Hint, Erase and persistence. Campaign integration now uses this option for Levels 11, 14, 17, 19 and 20 with content version 4. See KEYS-AND-LOCKS.md for the rollout, first-encounter preview and migration contract.

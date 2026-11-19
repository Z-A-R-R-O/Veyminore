# Planning difficulty — content 9

Implemented 16 November 2026. This supersedes the content-8 challenge ramp for Levels 10–40. Levels 1–9 remain identical. No arrows were added or moved: keys, anchors, shapes, grid sizes and arrow counts stay intact.

## Why the previous ramp felt easy

A dependency chain makes an arrow harder to locate but does not make any legal clear strategically wrong. Without deadlines, every legal removal order eventually succeeds. The old score rewarded edges, chain depth and forced steps; those measure visual/dependency complexity, not planning.

## Current progression

- Levels 10–14: one visible move-count barrel, generous spare moves and no forced loss from an early legal choice. A separate three-arrow lesson teaches clearing the barrel's blocker first.
- Levels 15–24: one barrel with progressively more selective move ordering, combined with existing keys and the anchor introduction at 24.
- Levels 25–40: two meaningful deadlines. Players must coordinate their prerequisite routes. Removing either deadline measurably makes each puzzle easier.

The barrel number includes its own removal. Every successful removal, including Erase, consumes one move. Blocked taps and hints do not. There is no countdown while thinking. A clear path can still be the wrong choice; the hold preview shows only observable routes and immediate mechanic changes, hints choose a safe continuation, and failure explains an expired or unreachable barrel. Existing hearts, snake movement and star timing are unchanged.

## Generator and acceptance criteria

src/domain/planning.ts is an offline planning pass on the archived content-8 geometry. It chooses initially blocked targets with at least two prerequisites, excludes all existing key/anchor badge roles, and searches bounded integer move allowances. Level 25 onward requires two targets with different prerequisite sets; nested chains are allowed, but redundant deadlines are rejected.

The exact state-space analysis averages over uniformly random legal choices. This random-legal win rate distinguishes planning constraints from density: a plain monotone board scores 100%. It is NOT a human completion-rate estimate. The target falls exponentially from 60% at Level 10 to 6% at Level 40. Candidate selection chooses the nearest valid rate; five-level block averages tighten gradually rather than pretending every human will find each subsequent level strictly harder.

Each accepted board must be solvable, have a reachable state with both safe and losing legal choices, and contain such a decision while a marked target is still blocked. Early introduction boards must have at least two safe initial moves before any legal choice can strand the route. Tests compare a recorded decision witness against the runtime solver, so a larger arrow count or a forced single path cannot qualify alone.

Authoring command (PowerShell): set $env:AROWGO_PLANNING='1', then run pnpm exec vitest run tests/author-planning.test.ts. Candidates and report go to content/candidates/planning. This never promotes files automatically. Validate tests/planning.test.ts before copying reviewed candidates into the campaign. The input archive is immutable; repeated authoring is deterministic.

## Measurements

The final column is the earliest move at which a legal choice can lose solvability, not a real-time limit.

| Level | Deadlines | Random-legal win rate | First consequential move |
|---|---|---|---|
| 10 | G: 9 moves / 2 prerequisites | 59.6% | 8 |
| 11 | I: 11 moves / 3 prerequisites | 54.9% | 9 |
| 12 | A: 15 moves / 7 prerequisites | 51.1% | 10 |
| 13 | J: 10 moves / 2 prerequisites | 44.9% | 8 |
| 14 | D: 14 moves / 7 prerequisites | 44.4% | 11 |
| 15 | F: 13 moves / 6 prerequisites | 43.6% | 7 |
| 16 | F: 12 moves / 5 prerequisites | 37.9% | 8 |
| 17 | J: 8 moves / 2 prerequisites | 34.8% | 7 |
| 18 | B: 13 moves / 4 prerequisites | 32.1% | 9 |
| 19 | G: 8 moves / 2 prerequisites | 27.4% | 6 |
| 20 | N: 8 moves / 2 prerequisites | 27.7% | 6 |
| 21 | C: 17 moves / 9 prerequisites | 25.5% | 8 |
| 22 | I: 13 moves / 4 prerequisites | 23.2% | 9 |
| 23 | J: 12 moves / 4 prerequisites | 22.3% | 9 |
| 24 | E: 9 moves / 4 prerequisites | 19.5% | 5 |
| 25 | C: 17 moves / 7 prerequisites; E: 15 moves / 3 prerequisites | 19.0% | 9 |
| 26 | F: 12 moves / 5 prerequisites; J: 12 moves / 3 prerequisites | 17.8% | 5 |
| 27 | A: 18 moves / 13 prerequisites; K: 15 moves / 8 prerequisites | 16.5% | 15 |
| 28 | D: 9 moves / 2 prerequisites; N: 11 moves / 2 prerequisites | 14.8% | 6 |
| 29 | F: 9 moves / 3 prerequisites; O: 10 moves / 2 prerequisites | 14.5% | 4 |
| 30 | G: 15 moves / 12 prerequisites; H: 16 moves / 11 prerequisites | 13.3% | 14 |
| 31 | E: 8 moves / 2 prerequisites; H: 14 moves / 6 prerequisites | 13.2% | 6 |
| 32 | D: 9 moves / 3 prerequisites; I: 11 moves / 3 prerequisites | 11.0% | 6 |
| 33 | G: 11 moves / 5 prerequisites; L: 11 moves / 3 prerequisites | 8.8% | 6 |
| 34 | N: 6 moves / 2 prerequisites; O: 8 moves / 2 prerequisites | 9.8% | 4 |
| 35 | A: 8 moves / 5 prerequisites; R: 7 moves / 2 prerequisites | 8.8% | 5 |
| 36 | I: 10 moves / 7 prerequisites; K: 8 moves / 3 prerequisites | 7.7% | 6 |
| 37 | E: 8 moves / 3 prerequisites; K: 10 moves / 3 prerequisites | 7.4% | 5 |
| 38 | E: 16 moves / 10 prerequisites; P: 10 moves / 2 prerequisites | 6.5% | 8 |
| 39 | B: 17 moves / 14 prerequisites; K: 7 moves / 2 prerequisites | 6.1% | 6 |
| 40 | A: 9 moves / 4 prerequisites; D: 17 moves / 10 prerequisites | 5.6% | 7 |

## Persistence

archive-before-planning.json retains all content-8 boards. Controllers include it alongside older archives. Levels 10–40 migrate to content 9: completed awards, coins, best stars, claimed flags, mode and unlocks survive; current attempts reset because deadlines changed. The original raw save is preserved under its version suffix. Existing rewards cannot be claimed again. Profile gems, skins and purchases are untouched.

## Validation and limits

Tests cover an independently countable choice tree, every campaign witness, three alternate safe routes per board, both counters being meaningful, a gradual band average, exact preservation of Levels 1–9 and geometry, and migration of completed, practice and unfinished saves. Browser checks cover teaching, wrong-order failure, retry, full campaign, counters and viewport fit. Human playtesting remains necessary; the model does not measure visual recognition, enjoyment or solve time.

Verified 16 November 2026: 178 unit tests passed. Both full browser campaigns passed (all 40 levels, rewards, lessons and persistence). The Level 10 lesson, wrong-order loss, safe retry and Next level flow passed. A migrated content-8 profile retained all 1,000 earned coins; replaced saves were archived. Layout checks passed at 320×568, 390×844 and 1280×800 for Levels 10, 15, 25, 35 and 40. Counter labels now use larger high-contrast numerals, with a low-move color, and their rendered text height is checked at a minimum 11 px. Final layout and interaction rechecks passed after the visual change. Evidence: docs/verification/planning-*.png. Production build passed; the pre-existing Phaser bundle-size warning remains.

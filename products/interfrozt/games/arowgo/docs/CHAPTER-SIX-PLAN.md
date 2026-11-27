# Clockwork Citadel — Levels 101–140

Updated 27 November 2026. Supersedes the earlier five-candidate / twenty-level proposal.

## World policy

Levels 1–100 keep five twenty-level worlds and their existing IDs, solutions, rewards and saves. Every world after 100 has forty levels: 101–140, 141–180, and so on. Maps show ten stops per page; Clockwork has four pages.

## Mechanics and progression

- 101–110: one three-beat gate, dense existing key/anchor/ice/phase/countdown combinations.
- 111–120: two three-beat gates and one opening-window gate, with two moves of scheduling slack around its authored solution position.
- 121–130: three three-beat gates and two windows, with one move of window slack.
- 131–140: four three-beat gates and three exact-move windows. These are the mastery puzzles.

A three-beat gate opens on its displayed beat (1/3, 2/3, 3/3). Successful removals, including Erase, advance the beat. Mistakes and hints do not. A gold square window gate opens only during its inclusive removal-count interval; its badge counts until opening, then remaining opportunities, then shows ×. Neither attachment guarantees a clear geometric exit. The rules dialog and hold preview explain observable state, never the winning move.

Each level has a unique 10×10 layout, 28 arrows and at least 89 occupied cells. This stays within the exact solver's supported 28-arrow bound. Difficulty increases through scheduling constraints, not arbitrary arrow counts. Ten-level blocks are sorted by the frozen version-one structural score; transitions introduce rules and may provide a measured-score breather. Scores are not player IQ or predicted completion times. Human playtesting remains necessary.

## Delivery and audit

Canonical files: `content/levels/clockwork/level-101.json` through `level-140.json`. The old five Chapter 6 DEV candidates remain historical source material and are not extra campaign levels. New content uses version 13; old content is unchanged. Backend reward validation must use the same canonical files.

Before completion: validate every solution, recompute ratings, prove losing legal choices exist, replay saves after each move, verify first-clear/replay rewards, test mobile and desktop interaction, and check world boundaries. Record actual results in the audit report. No production deployment is implied by a Git push.

## Remaining limitations

Existing legacy cloud packed-size limits remain a separate issue; adding levels does not fix cloud capacity. Oversized saves must continue to fail safely. Artwork currently reuses the Amber map with a dusk palette; bespoke Clockwork scenery is a later art task.

## Reproduction

The opt-in authoring test uses deterministic geometry and timing seeds; it resumes existing canonical files. `AROWGO_CLOCKWORK=1` runs `tests/author-clockwork.test.ts`. `AROWGO_REPAIR_CLOCKWORK=1` runs `tests/repair-clockwork.test.ts` to separate attachments from key/anchor sources, tighten loose schedules and refresh block ordering. `AROWGO_RATE=1` runs `tests/export-difficulty.test.ts` to regenerate the offline DEV ratings without changing the frozen calibration. Run these only for an intentional content revision, then run the forty-level audit and browser checks. Normal tests do not regenerate content.

Primary audit: `tests/clockwork.test.ts`. Browser interaction sample: `tests/e2e/clockwork.spec.ts` (101, 110, 111, 120, 121, 130, 131, 140 on desktop and phone). World boundaries and legacy save preservation: `tests/e2e/clockwork-worlds.spec.ts`.

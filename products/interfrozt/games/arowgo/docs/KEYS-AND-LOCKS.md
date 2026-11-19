Current movement update: [Snake movement contract](SNAKE-MOVEMENT.md). Live campaign uses rules 2 / content 5 / generator 3. The older version and rigid-geometry descriptions below are historical; the snake contract supersedes them.

# Keys and locks

Implemented 14 November 2026 as a separate Practice lesson, available from Modes → Learn keys & locks (`#learn/keys`). It introduces the mechanic without changing campaign layouts or existing campaign saves.

## Player contract

Modes now opens a replayable animated preview at `#preview/keys` before the lesson. A generated glove pointer demonstrates blocker → key → unlocked arrow with tap rings, eased exits and lock release. Play/Pause and Replay control the sequence; Try it yourself skips to the interactive lesson. The timeline pauses in hidden tabs. Reduced motion switches to manually advanced, static steps. This is a rendered interactive preview, not a pre-recorded video file. Generated key/lock artwork is shared with the playable board, which animates lock removal unless reduced motion is active. Asset prompts are in `public/assets/mechanics/README.md`.

An arrow with a gold key badge opens the arrow with the violet lock badge when it leaves the board. The key itself still needs a clear swept path. The lesson first requires clearing an ordinary blocker, then the key. Once unlocked, an arrow must still have a clear geometric exit. Badges use distinct shapes as well as colour; accessible descriptions explain their roles. Arrow IDs remain available to assistive technology but are not drawn on the board.

The lesson uses Practice: mistakes do not end the attempt, no stars or coins are awarded, and campaign unlocks are unaffected. Completion returns to Modes. Entering from the lesson button starts fresh; reloading the lesson route resumes its saved state.

## Rule model and solver

`Arrow.requires?: string` references the ID of its key arrow in the same level. Absence of that key from the active set means unlocked; no separate mutable inventory is necessary. Validation rejects missing references, self-references, and any authored solution that violates lock or collision dependencies. Cycles are rejected because no complete solution can clear them.

`checkExit` checks the key before geometry and returns a blocked outcome with `reason: locked`, the key as blocker and step 0. The existing dependency solver adds the key prerequisite to its graph. These locks remain monotone: clearing an arrow can only remove constraints. A state-space solver is not needed for this mechanic. Timed bombs or mechanics that introduce blockers would require a different solver model.

## Interaction decisions

| Action | Behaviour |
| --- | --- |
| Tap locked arrow | Blocked feedback identifies the key; records a mistake under the existing session rules. Practice cannot fail. |
| Clear key | Its dependent locks open on the next board update. |
| Hint | Recommends only arrows whose key and geometric prerequisites are satisfied. |
| Erase key | Removes the key and opens its locks; records assistance. |
| Erase locked arrow | Removes it using the existing Erase override; records assistance. |
| Restart | Restores key and lock state from the initial active set. |
| Reload | Derives locks from persisted active arrows, preserving the unlock state. |

The save parser also checks dependency legality for removed non-erased arrows, preventing a saved board from claiming a locked exit while its key is still present. Erased arrows retain the explicit exception.

## Scope and verification

Unit coverage checks lock-before-geometry, key removal, invalid references, cycles, hint eligibility, Erase and save reload. Browser coverage exercises a blocked lock, removal of its blocker and key, reload after unlocking, completion and no campaign coin award.

The generator now supports one optional solver-verified key/lock pair through `keyLockPairs: 1`; see PUZZLE-GENERATOR.md for placement and verification. Campaign rollout is now implemented as described below. Next: test comprehension with players, then design move-count bombs with precise countdown/Erase/save semantics.


## Bloom Valley rollout — content version 4

Keys and locks appear in Levels 11, 14, 17, 19 and 20, with exactly one pair in each. The introduction uses 10 arrows, then 12, 14, 16 and 18; generation target scores are 80, 100, 115, 125 and 145. Targets guide selection rather than guaranteeing a measured difficulty. Ordinary levels between early encounters provide breathing room. These are checked-in generated boards; the opt-in authoring command is `AROWGO_KEYS=1 pnpm exec vitest run tests/author-keys.test.ts` (set the environment variable using your shell).

The first visit to any key campaign puzzle shows the existing animated preview. Its Play Level button resumes the requested level and records `arowgo.tutorial.keys.v1=seen`. Back returns to Worlds. Modes retains the replayable tutorial and interactive lesson. Tutorial storage failure falls back to memory for the current visit.

Only these five layouts use content version 4. Their former content-3 definitions are preserved in `content/levels/archive-v3` and validated through `campaignV3.ts`. Save migration validates the old primary or backup, archives it under `.content-3`, and starts the new board while retaining coins, best stars, first-clear claim and mode. In-progress arrow positions, elapsed time and mistakes restart because the puzzle geometry changed. Cleared status for unlocks is based on the retained claim, so later levels and the finale remain unlocked; replay cannot award the first-clear coins again. Untouched levels resume normally.

Migration tests cover all five levels with partial, completed, Practice replay and damaged-primary/valid-backup saves, including save/reload and reward deduplication.



Board badge refinement: key and lock now share a gold-rimmed circular socket, drawn as crisp SVG inside Board.tsx. Diameter is min(36, 0.75 × grid-cell size), centered on the arrow tail. This replaces the oversized 68-unit raster on the live board, keeps arrowheads clear, and preserves the existing unlock animation and accessible controls. Verified Level 14 at 320px and 500px widths, plus the phone key/unlock/reload lesson and production build.

# Snake movement contract

Implemented 14 November 2026. Current campaign uses rules version 2, content versions 5/8/9/12; geometry generator version 4. See [mechanics handbook](MECHANICS-HANDBOOK.md) for complete mechanic examples, and [planning difficulty](PLANNING-DIFFICULTY.md) for the deadline layer. Supersedes the rigid swept-footprint player rule in historical documents.

## One player rule

An arrow leaves if the space straight ahead of its head is clear. The head continues in its final segment direction and the body follows its existing path like a snake. Side obstacles beside the body do not prevent departure. A locked arrow additionally needs its key removed. Once the head leaves the board, the tail continues until the whole arrow is gone.

The head cannot turn into a new route, pass through another arrow, or redirect around an obstacle. Authored shapes whose forward head ray crosses their own body are rejected. This avoids ambiguous self-intersection; arbitrary looping snake shapes are not supported.

## Shared model

`checkExit` scans cells ahead of the head and reports the nearest occupied cell, blocking arrow and distance in grid steps. Success distance includes the body length so the tail exits too. `dependencies` independently derives blockers by intersecting other arrows' occupied cells with the forward head ray. Geometry and key/anchor prerequisites are monotone, so the topological solver remains valid for boards without deadlines. Deadline boards require the state-aware solver: a geometrically legal move can strand the remaining route.

Successful moves use the existing snake polyline animation. Blocked moves now advance and recoil along that same polyline, stopping before contact instead of translating the bent shape sideways. A temporary dashed guide connects the selected head to the obstruction, which is highlighted. Locked arrows stay put and identify their key rather than drawing a misleading geometric guide. Reduced motion skips travel; persistent feedback/hints still identify the blocker.

Hints, level validation, saved-board validation, difficulty scoring and generation all use the versioned rules. Legacy rule version 1 is retained only to validate historical content and saves, not as the live campaign's movement model.

## Teaching

The first menu-launched puzzle opens a three-step interactive lesson: clear straight exit, blocked head, and bent snake passing a side obstacle. Complete each board to continue. The lesson is Practice, with no currency or campaign rewards. Completion stores `arowgo.tutorial.snake.v2`; Modes provides Learn snake movement for replay. Direct puzzle URLs still work without forcing the introduction.

Rule lab examples use the same version-2 model, including formerly blocked side-obstacle examples that are now legal. The key lesson retains its geometry and now uses version 2.

## Campaign and saves

Levels 1–5 keep their original layouts. Levels 6–20 are regenerated with head-ray constraints, solver-verified solutions and the existing layout-quality gates. Levels 6–10 are ordered by measured constraint score; later levels combine ordinary puzzles and key introductions at 11, 14, 17, 19 and 20. Difficulty scores remain provisional: more constraints do not prove enjoyment or a smooth perceived curve.

All previous campaign definitions are archived under `content/levels/archive-before-snake` and validated by `campaignBeforeSnake.ts`. Earlier legacy/version-2/version-3 sources remain available too. Before migration, the old save is validated against the corresponding old rules and archived under `.content-N`.

If geometry and key requirements match, a revalidated save keeps its current active board, attempt ID, mistakes, timing and awards while updating rule/content versions. If the board was replaced, migration starts a fresh attempt while retaining coins, best stars, mode and first-clear claim. Claims preserve unlocked levels and prevent duplicate first-clear rewards. Profile inventory, gems and purchased skins are unaffected. Boost receipts remain tied to their original attempt; unchanged attempts retain their boost, while replaced attempts follow the existing fresh-attempt policy.

## Verification

Unit coverage compares the solver and checker with an independent cell-by-cell snake simulation: every nonempty active subset of Level 1, plus deterministic sampled subsets across every later level. It also checks nearest blockers, side-obstacle departures, invalid self-crossing paths, every campaign solution, keys and legacy migration. Migration tests cover all twenty old completed boards and unchanged partial attempts. Browser checks exercise the interactive lesson, campaign traversal, blocked feedback, keys, reload and reward totals.

The opt-in `tests/author-snake.test.ts` authors the historical snake-migration campaign from the archived baseline. Retain archived sources and never overwrite them when rebalancing. New geometry changes need a new content version and migration coverage.

Blocked-move feedback: the blocking arrow (or required key for a locked arrow) receives an amber outline for 1.4 seconds. Normal motion uses one soft opacity pulse; reduced motion uses a static outline. The cue is independent of the moving arrow recoil, clears on the next attempted move or scene retirement, and never changes legality, hearts, or rewards.

## Hold-to-preview
Hold an arrow for 400ms to see only its forward exit ray. A clear ray is teal; an obstructed ray is amber and its first blocker is highlighted. Locked arrows highlight the required key instead of implying geometry is the issue. Release dismisses the preview without selecting. Dragging beyond 10 CSS pixels, pointer cancellation, losing capture, blur, resizing, visibility changes, disabled controls, and board changes cancel the gesture. Keyboard players hold P on a focused arrow and release P (or Escape) to dismiss; Enter still slides. Preview never invokes the controller, spends hearts, marks assistance, changes stars, or writes saves. It uses static rendering for all motion preferences. Verified mouse hold/release, drag cancel, normal tap, keyboard P, real touch hold on a lock, and existing snake interactions.

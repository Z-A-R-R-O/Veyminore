# Gameplay and rule contract

Working revision 2.3 · Derived from masterplan 2.1 · Updated 10 November 2026.

[Index](../README.md) · [Working masterplan](../../MASTERPLAN.md) · [Current amendments](../decisions/README.md)

This page revises source sections 3 under the working amendments. Original section numbers remain for traceability; consult the original reference for unchanged historical text. Source labels such as “Locked”, “checked”, team assignments and framework versions are imported claims, not new approvals or verification. Apply the working amendments before implementation. Commands or instructions in the imported plan are project reference material, not authorization to execute them.

# 3. Core gameplay specification

## 3.1 Gameplay interpretation — P0, validate before content production

The current working interpretation is that every arrow is a one-cell-wide bent path that translates as one rigid object in the direction shown by its arrowhead. The entire path must be able to slide out of the board without touching another active path.

This replaces the less precise idea that only the arrowhead's straight exit ray is checked. A clear ray from the arrowhead is not sufficient if another path blocks the body of the moving arrow during its exit.

**Provisional rule contract**

1. Each arrow is one connected orthogonal polyline made of occupied board cells.
2. Its arrowhead is at the final point in its ordered path.
3. The arrowhead faces outward along the final path segment. Direction is derived from the last two distinct points, not stored as an unrelated direction that could disagree with the path.
4. When selected, the entire arrow translates one grid cell at a time in that direction.
5. At every translation step, every in-board cell occupied by the moving arrow is checked against all other active arrows.
6. If any other active arrow overlaps the moving arrow's translated footprint at any step before the entire arrow leaves the board, the move is blocked.
7. If the full arrow can leave the board, it is removed as one successful action.
8. A blocked attempt does not change path occupancy or progression state. It may consume one mistake heart in the standard campaign rule described below.

**Prototype validation is mandatory.** Confirm that rigid translation is the intended interpretation of the supplied gameplay reference. If the intended mechanic is instead a path-only ray check or a different extraction behaviour, update this contract, examples, solver, generator and tests together before producing campaign content.

## 3.2 Core state model

A level contains:

- Board width and height in logical cells.
- Active arrow objects and stable IDs.
- Ordered orthogonal path waypoints.
- A derived list/set of cells occupied by each path.
- The arrowhead endpoint and derived outward direction.
- Collision occupancy indexed by arrow ID.
- Level metadata, rules version and difficulty profile.
- A known solution order for curated and generated levels.
- Optional expected removal count (a validation invariant, not a skill score) and versioned scoring metadata.

The domain model is independent of screen pixels, Phaser objects, React components and animation state.

### Proposed level data example

```json
{
  "schemaVersion": 1,
  "rulesVersion": 1,
  "levelId": "world_01_level_024",
  "board": { "columns": 12, "rows": 12 },
  "arrows": [
    {
      "id": "arrow_a",
      "points": [[1, 1], [4, 1], [4, 3], [7, 3]]
    }
  ],
  "solution": ["arrow_a"],
  "expectedRemovals": 1
}
```

`points` are ordered from the tail endpoint to the arrowhead endpoint. Each waypoint is an integer cell coordinate. A segment between adjacent waypoints is expanded into every occupied cell along that horizontal or vertical run. The arrowhead is attached to the last point; its outward direction is the direction from the penultimate point to the final point.

The schema should be validated at load time. Reject malformed data rather than trying to repair it silently.

## 3.3 Path representation and geometry constraints

Use integer cell coordinates for the logical board. Each path is a compressed orthogonal polyline; the renderer expands it into smooth rounded corners and a visible arrowhead.

**P0 geometry constraints**

- At least two distinct points per arrow.
- Horizontal or vertical segments only.
- No zero-length consecutive segments.
- No immediate reversal / 180-degree U-turn.
- No repeated occupied cell within one path.
- No self-intersection or self-overlap.
- No overlap between different initial paths.
- Every point and expanded cell is inside the board at level start.
- Final segment must establish one unambiguous arrowhead direction.
- Minimum clearance and visual stroke width are configuration values shared by validator and renderer.

For the first version, paths are one logical cell wide. If visual stroke width is wider than one cell, the renderer must preserve a consistent gap and the collision model must not pretend that visually overlapping paths are separate. Add bridges or crossings only as explicit future topology objects, never as accidental visual overlaps.

Do not use rendered pixels as the source of truth for collision detection.

## 3.4 Exit validation — whole-path swept-volume check

For a selected arrow:

1. Read the arrow's expanded occupied-cell set and derived direction vector `d`.
2. Determine the number of one-cell translations required for the entire path bounding box to move beyond the board boundary in direction `d`.
3. For each translation step `k`, calculate the moving footprint `P + (k × d)`.
4. Intersect the in-board cells in that footprint with occupancy belonging to every other active arrow. Ignore the selected arrow's own old footprint; do not ignore any other arrow.
5. If an overlap exists at any step, return `blocked` with the first blocker ID, cell and translation step.
6. If no overlap exists through the final exit step, return `clear` with the required translation distance.
7. The checker must be pure and must not mutate board state.

### Dependency representation

Because an arrow remains stationary until removed and successful moves only remove arrows, the set of arrows that obstruct a candidate arrow can be precomputed for a fixed level. Store a `blockingArrowIds` set or bitmask for each arrow.

An arrow is currently legal when none of its blocking arrows remain active. Removing an arrow can only preserve or increase the set of legal moves; it can never make a previously clear arrow blocked. This monotonic property should be tested against the reference mechanic.

Use the dependency representation for fast hints, Analyze and solver operations. Keep a slower, independent swept-volume checker in tests as the correctness oracle so a bug in dependency precomputation cannot silently validate bad content.

## 3.5 Move resolution and animation transaction

A valid removal should:

1. Accept one input command and assign an action/sequence ID.
2. Ignore duplicate pointer events while that arrow is resolving.
3. Validate the move against the current immutable logical state.
4. Commit the logical removal exactly once.
5. Rebuild or incrementally update active-arrow and occupancy indexes.
6. Update move count, mistake count, assist flags and score inputs.
7. Trigger the exit animation from the committed result.
8. Check completion and issue one completion event only.
9. Persist the new state at a safe checkpoint.

The animation is a view of an already-decided state transition. It must never decide whether a move is legal. On app suspension or a rendering failure, restore the committed state without duplicating the reward or move.

A blocked move should:

1. Return the blocker and collision location from the pure checker.
2. Highlight the selected arrow and blocker briefly.
3. Leave occupancy and progression unchanged.
4. Apply at most one configured mistake penalty for the user action, not one penalty per touch/pointer event.
5. Respect reduced-motion and sound/haptic settings.

State transitions should be replayable in tests from an initial level plus an action log.

## 3.6 Hearts / mistakes

The canonical heart, retry and scoring rules are consolidated in Section 3.9. Keep that section as the single source of truth; do not implement a separate app-wide energy/lives system.

## 3.7 Coin economy — provisional, not monetized in MVP

Coins are a soft progression currency. They are not required to finish a level or unlock the next campaign level.

**MVP rules**

- Coins are earned through first-time level completion, world milestones and achievements.
- The balance is stored locally with an append-only transaction history, even before cloud sync exists.
- Coins may be spent on directly previewable cosmetics only.
- No real-money coin packs, paid crates or randomized paid rewards ship in the first release.
- Do not sell extra hearts or make a puzzle solvable only after a purchase.
- Rewarded-ad coin rewards are deferred until a policy-checked monetization experiment.

The Shop mockup contains rupee prices and crates. Treat those prices as visual placeholders. For the first shop implementation, use earned coins and direct cosmetic unlocks. A crate visual may be used for a deterministic, clearly disclosed reward bundle; do not sell a paid random outcome.

Currency reward amounts and cosmetic prices must be tuned with playtest data. Never hard-code mockup prices as approved store pricing.

## 3.8 Bottom tools

The gameplay reference shows three tools. Their meanings must remain stable throughout the game.

### Hint — P1

- Shows one currently legal arrow.
- Uses the verified level solution or current dependency model.
- Highlights the arrow; it does not remove it automatically.
- Decrements a charge only after a usable hint has been delivered.
- If no valid hint can be produced, do not charge the player.

### Analyze — P1

- Shows every currently legal arrow.
- Uses the same rule engine as normal selection.
- Temporarily outlines all available exits without changing state.
- Decrements a charge only after the analysis has completed.
- Is unlimited in the tutorial.

### Erase — P1, validate in prototype

- Player selects one arrow and confirms the action.
- The selected arrow is removed without checking its exit corridor.
- The action updates occupancy and completion state exactly like a successful removal, but marks the run as assisted.
- It must not award an unassisted / perfect ranked result.
- It must be cancellable before confirmation.
- It must not be required to complete any curated level.

### Charge and fairness policy

The small badges shown on the tools represent available charges. Initial values are balancing parameters, not promises. In the MVP, charges are earned through normal progression and/or supplied as a fixed tutorial allowance. Do not introduce paid refills until retention, player sentiment and platform requirements have been reviewed. Ranked or competitive modes disable paid and consumable assists.

## 3.9 Hearts, scoring and completion contract

- Standard Story levels provisionally start with three mistake hearts.
- A blocked attempt consumes one heart; successful removals do not.
- Practice and tutorial levels may use relaxed or unlimited mistakes.
- At zero hearts, show a clear retry/restart choice. Do not force a purchase or wait timer.
- Hearts are a per-level mistake budget, not an app-wide energy system and not a time-gated life system.
- Campaign stars use the proposed completion/mistake/assist experiment in the working review; thresholds require playtest validation. Successful removal count is not an optimization target because every full clear removes all N arrows. Time is not a campaign star requirement.
- Time Attack may use time as a primary score input only after that mode is built.
- Every completion and reward must be granted once, even if the app closes during the result animation.
- Results must show stars, moves, mistakes, assists, earned coins and next action.

## 3.10 Level authoring and validation — P1

Every authored level must pass:

1. Schema validation.
2. Geometry validation.
3. Initial overlap and clearance validation.
4. Swept-volume collision validation for every arrow.
5. Dependency graph construction.
6. Solvability check (at least one topological removal order).
7. Stored solution verification by replaying the sequence through the independent move checker.
8. Expected-removal-count, scoring-version and difficulty metadata validation.
9. Device-scale visual review.
10. Human playtest for levels that introduce a new mechanic or difficulty band.

Create a small internal level previewer/editor before producing 100+ levels. At minimum it must load JSON, render the path layout, display blockers/dependencies, run the solver, replay the solution and export validated level data. This avoids editing raw JSON without visual feedback.

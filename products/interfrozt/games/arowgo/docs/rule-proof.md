# Rigid-arrow rule proof

[Build evidence](verification/first-playable.md) · [Working decision](decisions/0001-first-playable.md)

The prototype uses integer cells. Waypoints run from tail to head. The final segment determines direction. Every occupied cell translates together; any overlap with another active arrow at any step blocks the entire action. A successful arrow is removed; it is never partially advanced. Removing arrows can only preserve or increase legal exits.

## Reproducible examples

Open **Rule lab** in the running game. The fixtures live in `src/domain/fixtures.ts` and are exercised by `tests/rules.test.ts`.

| Example | Initial expectation for A | What it establishes |
| --- | --- | --- |
| North | Clear | Straight upward exit |
| East | Clear | Bent rigid translation right |
| South | Clear | Entire body leaves below |
| West | Clear | Multi-bend translation left |
| Head blocker | Blocked by B | Simple obstruction |
| Body blocker | Blocked by B at (3,1), step 3 | Head ray alone is insufficient |
| Multiple blockers | Blocked; remains blocked after B is removed | All dependencies matter |
| Last-step blocker | Blocked near the far boundary | Continue checking after the head exits |
| Boundary | Clear after 3 steps | A head at the edge does not mean its tail is outside |

Coordinates are zero-based with positive Y downward. The body-only fixture has A at `[(0,1),(0,3),(2,3)]`, pointing right, and B at `[(3,1),(3,0)]`, pointing up. Row 3 to the right of A's head is empty. Nevertheless, A's vertical body reaches B at `(3,1)` after three translations. Remove B first and A exits in six translations.

## Independent validation

`checkExit` explicitly steps every moving cell and checks a fresh occupancy map. `dependencies` independently uses collinear cell rays and positive directional distances to construct prerequisites. The solver uses that graph; the stored solution is checked by the stepped oracle. Tests compare both formulations for every active subset of the ten-arrow level, rather than letting one implementation certify itself.

Tests also reject diagonals, zero-length segments, reversal/self-intersection, invalid coordinates, overlapping arrows, duplicate IDs, incompatible versions and incorrect solutions. A cyclic dependency board has no solver result. State tests cover blocked penalties, three-heart failure, practice, assists, idempotency, stale commands, replay rewards and save recovery.

This proves the implementation of the chosen discrete rule. It cannot prove that a still image depicts the same mechanic, that the puzzle is fun, or that every future board is valid. All new content still needs validation and human review.

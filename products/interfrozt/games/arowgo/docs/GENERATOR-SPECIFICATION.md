# Puzzle generator specification

Current specification and authoring contract. Reconciled 20 November 2026. [Current state](CURRENT-GAME-STATE.md) · [Mechanics](SNAKE-MOVEMENT.md) · [Sanctum authoring](AMBER-SANCTUM.md) · [Dense campaign](DENSE-CAMPAIGN.md).

## 1. Overview and generator architecture

Generation in AROWGO is strictly an **offline authoring pipeline**. Players load static, pre-verified JSON files checked into `content/levels/`. Dynamic procedural generation never executes on the client device during gameplay or level loading.

- **Current Generator Engine**: Version 4 (`GENERATOR_VERSION = 4` in `src/domain/generator.ts`)
- **Rules Version**: Version 2 (Snake-movement exit rules: head ray exits first, body follows path)
- **Active Content Version**: Content Version 12 (Levels 81–100 Amber Sanctum); earlier worlds use stable reviewed content versions (1, 4, 7, 10, 12)
- **Maximum Arrow Count**: 28 arrows on 10×10 boards

```
+--------------------------------------------------------------------------+
|                     Offline Authoring Pipeline                           |
|                                                                          |
|  1. Deterministic PRNG Seed & Grid Space (10x10)                         |
|     - Math.imul(seed, 1664525) + 1013904223                              |
|                                                                          |
|  2. Constructive Reverse Placement (Up to 28 arrows)                     |
|     - Straight, single-bend, double-bend footprints                      |
|     - Reverse exit guarantee: new arrow exits through existing arrows    |
|                                                                          |
|  3. Mechanic Binding (Key/Lock, Anchors, Ice, Phase, Deadlines)          |
|     - Transitive prerequisite validation (no redundant edges/cycles)     |
|     - Move removal-count deadlines (kegs)                                |
|                                                                          |
|  4. Layout & Density Quality Gates                                       |
|     - Minimum occupied cells (e.g. >= 68 cells)                          |
|     - Quadrant balance & empty quadrant rejection                        |
|                                                                          |
|  5. Dual Verification (Swept Simulation vs Dependency Graph)             |
|     - checkExit() ray-sweep simulation                                   |
|     - solveDeadlines() bitmask exhaustive pruning solver                 |
|                                                                          |
|  6. Planning Curve Evaluation (evaluatePlanning)                         |
|     - Monotonic random-legal win rate decrease                           |
|                                                                          |
|  7. Staged Promotion (content/candidates/ -> content/levels/)            |
|     - Static JSON check-in, referenced in src/domain/campaign.ts         |
+--------------------------------------------------------------------------+
```

---

## 2. Deterministic PRNG and candidate bounds

`generatePuzzle(seed, count, targetScore, levelId, options)` accepts:
- `seed`: Unsigned 32-bit integer PRNG seed.
- `count`: Target arrow count (4 to 28).
- `targetScore`: Target difficulty score (e.g., 260–380 for Sanctum).
- `levelId`: Canonical string identifier (e.g., `"sanctum-81"`).
- `options`: Optional constraint object (`GenerationOptions`).

```typescript
export interface GenerationOptions {
  openingMoves?: readonly [number, number];
  depthRange?: readonly [number, number];
  scoreRange?: readonly [number, number];
  connectedPlacement?: boolean;
  minimumOccupiedCells?: number;
  keyLockPairs?: 0 | 1;
}
```

### Determinism guarantee

The PRNG uses a standard 32-bit linear congruential generator:
$$\text{seed}_{n+1} = (\text{seed}_n \times 1664525 + 1013904223) \pmod{2^{32}}$$
All coordinate picks, shape variations, orientations, and key-lock pair selections derive strictly from this sequence. Given the same generator version, seed, count, target, and options, the generator outputs byte-identical JSON. Ambient clock or platform entropy is forbidden.

---

## 3. Reverse constructive placement

To guarantee that every generated board has at least one valid solution, the generator places arrows in **reverse solution order**:

1. Start with an empty grid.
2. Select an arrow footprint (head coordinate, segments, direction).
3. Validate bounds (must fit within `board.columns` and `board.rows`, typically 10×10).
4. Validate non-overlap: no cell may occupy an already-placed cell.
5. **Reverse exit check**: The new arrow must be able to leave the board through the currently placed arrows according to `checkExit()`.
6. Because the new arrow can exit through all previously placed arrows, the reverse order of placement forms a constructive legal solution.
7. Repeat until `count` arrows are placed, or abort and retry with the next candidate seed if candidate budgets (e.g., 250 boards, 500 placements) are exceeded.

---

## 4. Mechanic placement rules

### Key-Lock pairs (`placeKeyLock`)

- When `options.keyLockPairs === 1`, the generator evaluates candidate key/lock arrow pairs:
  - Constructs the current transitive dependency graph.
  - Rejects pairs where the lock already depends on the key (redundant edge adding no decision).
  - Rejects pairs where the key depends on the lock (would introduce an unsolvable cycle).
  - Assigns `requires = key.id` to the lock arrow.
  - Verifies that `solve(level)` finds a complete solution under lock rules.

### Anchors (`anchorRequires`)

- Anchored arrows cannot exit until their anchor arrow is cleared.
- The generator binds anchors to earlier arrows in the topological order (`anchorRequires = source`), ensuring the anchor must be cleared before the dependent arrows can move.
- Rendered with an inverted gold anchor symbol on the arrow body.

### Ice seals (`thawAfter`)

- An arrow is encased in frost and cannot be extracted until a specified number of other arrows have been removed:
  $$\text{removed} \ge \text{arrow.thawAfter}$$
- `thawAfter` must be an integer between 1 and `arrows.length - 1`.

### Phase gates (`phase`)

- An arrow passes through an Aurora phase barrier that alternates on every removal:
  $$\text{removed} \pmod 2 = \text{arrow.phase} \quad (\text{phase} \in \{0, 1\})$$
- Forces players to plan removals so that the move count arrives at the correct parity when the arrow must be cleared.

### Removal deadlines / Keg countdowns (`deadline`)

- An arrow has an explosive countdown fuse:
  $$\text{removed} < \text{arrow.deadline}$$
- If `removed >= arrow.deadline` and the keg arrow remains on the board, `expiredKeg()` returns `true` and the attempt fails.
- All mechanic deadlines count **removals** (successful clears), **not elapsed clock seconds**. Hint and blocked taps do not consume removals; Erase does.

---

## 5. Difficulty and layout metrics

### Layout quality metrics (`evaluateLayout`)

```typescript
export function evaluateLayout(level: Level) {
  // Returns:
  // isolated: arrows with no blockers and blocking nothing
  // emptyQuadrants: count of 5x5 quadrants with 0 occupied cells
  // imbalance: max quadrant cells - min quadrant cells
  // occupiedCells: total grid cells covered by all arrow bodies
}
```

- **Isolated arrows**: Penalized heavily. Puzzles should feature dense, interrelated blocking chains rather than independent islands.
- **Empty quadrants**: Rejected. Boards must distribute arrows across the full grid.
- **Minimum occupied cells**: In Sanctum authoring, candidates must cover at least 68 cells on a 10×10 board.

### Graph difficulty score (`evaluateDifficulty`)

```typescript
export function evaluateDifficulty(level: Level) {
  // Evaluates:
  // depth: longest chain of prerequisites in dependency graph
  // edges: total blocking relationships
  // bends: total direction changes across arrow shapes
  // initialChoices: count of legal exits on starting board
  // forcedSteps: count of single-choice steps along solution
  // score = depth * 8 + edges * 2 + bends + forcedSteps * 3
}
```

$$\text{Difficulty Score} = 8 \cdot \text{depth} + 2 \cdot \text{edges} + \text{bends} + 3 \cdot \text{forcedSteps}$$

### Planning metric (`evaluatePlanning` / `randomLegalWinRate`)

Graph score measures structural complexity, but does not capture strategic consequence. A puzzle with many edges might be trivial if any random legal move leads to a win.

`evaluatePlanning` measures the **Random Legal Win Rate**: the probability that a player making arbitrary legal moves without backtracking will successfully clear the board.
- **High win rate (e.g. 80%)**: Forgiving puzzle; order matters little.
- **Low win rate (e.g. 0.01%–0.5%)**: Highly unforgiving puzzle; premature removal of key arrows leads to dead ends (freezing, missed deadlines, or blocked anchors).
- The Sanctum authoring pipeline enforces a strict **monotonic decrease** in random legal win rate from Level 81 down to Level 100.

---

## 6. Solver and validation architecture

Two independent algorithms validate every level:

### 1. Ray-sweep exit checker (`checkExit` in `src/domain/rules.ts`)

- Checks the head cell's exit ray along `direction(arrow)`.
- Verifies that no other active arrow intersects the exit path before exiting the board boundary.
- Verifies that timing constraints (`thawAfter`, `phase`), keys (`requires`), and anchors (`anchorRequires`) are satisfied.

### 2. Bitmask deadline & timing solver (`solveDeadlines`)

- Bitmask state representation (`1 << i` for up to 28 arrows).
- Precomputes transitive ancestor bitmasks for pruning.
- Urgency-sorted branch search: prioritizes arrows nearing deadlines.
- Memoized state cache (up to 512 entries).
- Search budget limit: 1,100,000 visited states. Throws if budget exhausted.

Both solvers must agree on a complete, valid solution path before a level is promoted.

---

## 7. Staged candidate promotion workflow

1. **Candidate generation**: Authoring tests run with explicit environment gates (e.g., `AROWGO_SANCTUM=1 pnpm test tests/author-sanctum.test.ts`). Candidates are written to `content/candidates/<world>/level-<id>.json`.
2. **Quality verification**:
   - `validateLevel(candidate)` passes schema and geometry checks.
   - Dual-solver agreement confirmed.
   - Alternate legal branches analyzed (`evaluatePlanning`) to ensure no unsolvable branches exist without clear feedback.
3. **Promotion**: Candidate JSON is copied into `content/levels/<world>-<id>.json`.
4. **Registry binding**: Level is registered in `src/domain/campaign.ts` with its canonical ID and difficulty target.
5. **Reward preservation**: Shipped levels award 25 coins for the first clear and up to 3 stars. Replacing or reordering levels must preserve existing player stars and coin balances via migration.

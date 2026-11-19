import {
  checkExit,
  dependencies,
  expand,
  solve,
  validateLevel,
  type Arrow,
  type Cell,
  type Level,
} from "./rules";

export const GENERATOR_VERSION = 4;
export interface GenerationOptions {
  /** Hard acceptance bounds; unmet constraints exhaust the bounded search. */
  openingMoves?: readonly [number, number];
  depthRange?: readonly [number, number];
  scoreRange?: readonly [number, number];
  connectedPlacement?: boolean;
  /** Minimum occupied cells for dense campaign authoring. */
  minimumOccupiedCells?: number;
  /** One pair keeps the shared key/lock artwork unambiguous. */
  keyLockPairs?: 0 | 1;
}

function placeKeyLock(level: Level, pick: (n: number) => number): boolean {
  const graph = dependencies(level);
  const dependsOn = (
    id: string,
    prerequisite: string,
    seen = new Set<string>(),
  ): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    return [...graph.get(id)!].some(
      (next) => next === prerequisite || dependsOn(next, prerequisite, seen),
    );
  };
  const pairs: { key: string; lock: string }[] = [];
  for (const key of level.arrows)
    for (const lock of level.arrows) {
      if (key.id === lock.id) continue;
      // An existing prerequisite would add no decision; the reverse would create a cycle.
      if (dependsOn(lock.id, key.id) || dependsOn(key.id, lock.id)) continue;
      pairs.push({ key: key.id, lock: lock.id });
    }
  if (!pairs.length) return false;
  const { key, lock } = pairs[pick(pairs.length)];
  level.arrows.find((a) => a.id === lock)!.requires = key;
  const solution = solve(level);
  if (!solution) return false;
  level.solution = solution;
  return true;
}
export function evaluateLayout(level: Level) {
  const graph = dependencies(level);
  const connected = new Set(
    [...graph].flatMap(([id, blockers]) =>
      blockers.size ? [id, ...blockers] : [],
    ),
  );
  const cells = level.arrows.flatMap(expand);
  const quadrants = [0, 0, 0, 0];
  for (const [x, y] of cells) quadrants[Number(x >= 5) + 2 * Number(y >= 5)]++;
  return {
    isolated: level.arrows.length - connected.size,
    emptyQuadrants: quadrants.filter((n) => n === 0).length,
    imbalance: Math.max(...quadrants) - Math.min(...quadrants),
    occupiedCells: cells.length,
  };
}
export function evaluateDifficulty(level: Level) {
  const solution = solve(level);
  if (!solution) throw new Error("Unsolvable puzzle");
  const graph = dependencies(level);
  const depths = new Map<string, number>();
  let active = level.arrows.map((a) => a.id);
  const choices: number[] = [];
  for (const id of solution) {
    choices.push(
      active.filter((a) => checkExit(level, active, a).clear).length,
    );
    depths.set(
      id,
      1 + Math.max(0, ...[...graph.get(id)!].map((b) => depths.get(b)!)),
    );
    active = active.filter((a) => a !== id);
  }
  const depth = Math.max(...depths.values());
  const edges = [...graph.values()].reduce((n, s) => n + s.size, 0);
  const bends = level.arrows.reduce((n, a) => n + a.points.length - 2, 0);
  const forcedSteps = choices.filter((n) => n === 1).length;
  return {
    depth,
    edges,
    bends,
    initialChoices: choices[0],
    forcedSteps,
    score: depth * 8 + edges * 2 + bends + forcedSteps * 3,
  };
}

/** Removal-only rules are monotone: removing a legal arrow cannot create a blocker.
 * Reverse construction gives every accepted board a complete solution. */
export function generatePuzzle(
  seed: number,
  count: number,
  targetScore: number,
  levelId = `seed-${seed}`,
  options: GenerationOptions = {},
) {
  const keyLockPairs = options.keyLockPairs ?? 0;
  for (const range of [
    options.openingMoves,
    options.depthRange,
    options.scoreRange,
  ]) {
    if (
      range &&
      (range.length !== 2 ||
        range.some((n) => !Number.isSafeInteger(n) || n < 1) ||
        range[0] > range[1])
    )
      throw new Error("Invalid difficulty bounds");
  }
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isInteger(count) ||
    count < 4 ||
    count > 28 ||
    !Number.isFinite(targetScore) ||
    targetScore < 0 ||
    (options.minimumOccupiedCells !== undefined &&
      (!Number.isInteger(options.minimumOccupiedCells) ||
        options.minimumOccupiedCells < 0 ||
        options.minimumOccupiedCells > 100)) ||
    ![0, 1].includes(keyLockPairs)
  )
    throw new Error("Invalid generation options");
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pick = (n: number) => Math.floor(random() * n);
  const dirs: Cell[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  let best:
    | {
        level: Level;
        difficulty: ReturnType<typeof evaluateDifficulty>;
        quality: ReturnType<typeof evaluateLayout>;
        cost: number;
      }
    | undefined;
  for (
    let candidate = 0;
    candidate < (options.minimumOccupiedCells ? 80 : 250);
    candidate++
  ) {
    const level: Level = {
      schemaVersion: 1,
      rulesVersion: 2,
      contentVersion: 5,
      levelId,
      board: { columns: 10, rows: 10 },
      arrows: [],
      solution: [],
    };
    const occupied = new Set<string>();
    for (
      let attempt = 0;
      attempt < (options.minimumOccupiedCells ? 800 : 500) &&
      level.arrows.length < count;
      attempt++
    ) {
      const points: Cell[] = [[pick(10), pick(10)]];
      let dir = pick(4);
      const segments = random() < 0.6 ? 2 : 1;
      for (let s = 0; s < segments; s++) {
        if (s) dir = dir < 2 ? 2 + pick(2) : pick(2);
        const [x, y] = points.at(-1)!;
        const length = count >= 24 ? 1 : 1 + pick(2);
        points.push([x + dirs[dir][0] * length, y + dirs[dir][1] * length]);
      }
      if (points.some(([x, y]) => x < 0 || y < 0 || x >= 10 || y >= 10))
        continue;
      const arrow: Arrow = {
        id:
          level.arrows.length < 26
            ? String.fromCharCode(65 + level.arrows.length)
            : `A${String.fromCharCode(65 + level.arrows.length - 26)}`,
        points,
      };
      const cells = expand(arrow);
      if (cells.some((c) => occupied.has(c.join(",")))) continue;
      const trial = { ...level, arrows: [...level.arrows, arrow] };
      if (
        !checkExit(
          trial,
          trial.arrows.map((a) => a.id),
          arrow.id,
        ).clear
      )
        continue;
      if (
        options.connectedPlacement &&
        level.arrows.length >= 2 &&
        random() < 0.85 &&
        ![...dependencies(trial)].some(
          ([id, blockers]) => id !== arrow.id && blockers.has(arrow.id),
        )
      )
        continue;
      level.arrows.push(arrow);
      cells.forEach((c) => occupied.add(c.join(",")));
    }
    if (level.arrows.length !== count) continue;
    if (keyLockPairs && !placeKeyLock(level, pick)) continue;
    level.solution = solve(level)!;
    if (options.minimumOccupiedCells)
      level.arrows = fillUnusedCells(
        level,
        options.minimumOccupiedCells,
      ).arrows;
    validateLevel(level);
    const difficulty = evaluateDifficulty(level);
    const quality = evaluateLayout(level);
    if (
      [
        [options.openingMoves, difficulty.initialChoices],
        [options.depthRange, difficulty.depth],
        [options.scoreRange, difficulty.score],
      ].some(([range, value]) => {
        const bounds = range as readonly [number, number] | undefined;
        return (
          bounds &&
          ((value as number) < bounds[0] || (value as number) > bounds[1])
        );
      })
    )
      continue;
    if (quality.occupiedCells < (options.minimumOccupiedCells ?? 0)) continue;
    // Reject boards dominated by unrelated, immediately free arrows.
    if (
      count >= 10 &&
      (difficulty.initialChoices > Math.floor(count * 0.5) ||
        quality.isolated > 1 ||
        quality.emptyQuadrants > 0)
    )
      continue;
    const cost =
      Math.abs(difficulty.score - targetScore) +
      quality.isolated * 5 +
      quality.imbalance * 0.3;
    if (!best || cost < best.cost) best = { level, difficulty, quality, cost };
  }
  if (!best)
    throw new Error("Generation budget exhausted; choose another seed");
  return {
    ...best.level,
    generation: {
      version: GENERATOR_VERSION,
      seed,
      count,
      targetScore,
      difficulty: best.difficulty,
      quality: best.quality,
      ...(options.connectedPlacement ? { connectedPlacement: true } : {}),
      ...(options.openingMoves || options.depthRange || options.scoreRange
        ? {
            difficultyControlsVersion: 1,
            openingMoves: options.openingMoves,
            depthRange: options.depthRange,
            scoreRange: options.scoreRange,
          }
        : {}),
      ...(keyLockPairs ? { mechanicsVersion: 1, keyLockPairs } : {}),
    },
  };
}
/** Fill spare cells without changing the puzzle's dependency graph or timing decisions. */
export function fillUnusedCells(source: Level, targetCells: number): Level {
  const level = structuredClone(source);
  const signature = (l: Level) =>
    JSON.stringify(
      [...dependencies(l)].map(([id, blockers]) => [id, [...blockers].sort()]),
    );
  const graph = signature(level);
  const directions: Cell[] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (
    let round = 0;
    round < 100 && evaluateLayout(level).occupiedCells < targetCells;
    round++
  ) {
    let added = false;
    const occupied = new Set(
      level.arrows.flatMap(expand).map((c) => c.join(",")),
    );
    for (const arrow of level.arrows) {
      if (evaluateLayout(level).occupiedCells >= targetCells) break;
      const [x, y] = arrow.points[0];
      for (const [dx, dy] of directions) {
        const cell: Cell = [x + dx, y + dy];
        if (
          cell[0] < 0 ||
          cell[1] < 0 ||
          cell[0] >= level.board.columns ||
          cell[1] >= level.board.rows ||
          occupied.has(cell.join(","))
        )
          continue;
        arrow.points.unshift(cell);
        if (signature(level) === graph) {
          try {
            validateLevel(level);
            occupied.add(cell.join(","));
            added = true;
            break;
          } catch {
            /* Reject self-crossing head rays. */
          }
        }
        arrow.points.shift();
      }
    }
    if (!added) break;
  }
  for (const arrow of level.arrows) {
    arrow.points = arrow.points.filter((point, i, points) => {
      if (i === 0 || i === points.length - 1) return true;
      const before = points[i - 1],
        after = points[i + 1];
      return (
        (point[0] - before[0]) * (after[1] - point[1]) !==
        (point[1] - before[1]) * (after[0] - point[0])
      );
    });
  }
  validateLevel(level);
  return level;
}

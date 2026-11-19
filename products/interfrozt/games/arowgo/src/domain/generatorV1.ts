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

export const GENERATOR_VERSION = 1;
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
) {
  if (
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 0xffffffff ||
    !Number.isInteger(count) ||
    count < 4 ||
    count > 20 ||
    !Number.isFinite(targetScore) ||
    targetScore < 0
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
    | { level: Level; difficulty: ReturnType<typeof evaluateDifficulty> }
    | undefined;
  for (let candidate = 0; candidate < 50; candidate++) {
    const level: Level = {
      schemaVersion: 1,
      rulesVersion: 1,
      contentVersion: 2,
      levelId,
      board: { columns: 10, rows: 10 },
      arrows: [],
      solution: [],
    };
    const occupied = new Set<string>();
    for (
      let attempt = 0;
      attempt < 500 && level.arrows.length < count;
      attempt++
    ) {
      const points: Cell[] = [[pick(10), pick(10)]];
      let dir = pick(4);
      const segments = random() < 0.6 ? 2 : 1;
      for (let s = 0; s < segments; s++) {
        if (s) dir = dir < 2 ? 2 + pick(2) : pick(2);
        const [x, y] = points.at(-1)!;
        const length = 1 + pick(2);
        points.push([x + dirs[dir][0] * length, y + dirs[dir][1] * length]);
      }
      if (points.some(([x, y]) => x < 0 || y < 0 || x >= 10 || y >= 10))
        continue;
      const arrow: Arrow = {
        id: String.fromCharCode(65 + level.arrows.length),
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
      level.arrows.push(arrow);
      cells.forEach((c) => occupied.add(c.join(",")));
    }
    if (level.arrows.length !== count) continue;
    level.solution = solve(level)!;
    validateLevel(level);
    const difficulty = evaluateDifficulty(level);
    if (
      !best ||
      Math.abs(difficulty.score - targetScore) <
        Math.abs(best.difficulty.score - targetScore)
    )
      best = { level, difficulty };
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
    },
  };
}

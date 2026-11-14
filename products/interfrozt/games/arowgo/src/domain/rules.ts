export type Cell = readonly [number, number];
export interface Arrow {
  id: string;
  points: Cell[];
}
export interface Level {
  schemaVersion: 1;
  rulesVersion: 1;
  contentVersion: number;
  levelId: string;
  board: { columns: number; rows: number };
  arrows: Arrow[];
  solution: string[];
}
export type Exit =
  | { clear: true; distance: number }
  | { clear: false; blocker: string; cell: Cell; step: number };
const key = ([x, y]: Cell) => `${x},${y}`;

export function direction(arrow: Arrow): Cell {
  const last = arrow.points.at(-1)!;
  const previous = arrow.points.at(-2)!;
  return [Math.sign(last[0] - previous[0]), Math.sign(last[1] - previous[1])];
}

export function expand(arrow: Arrow): Cell[] {
  if (arrow.points.length < 2) throw new Error(`${arrow.id}: needs two points`);
  const cells: Cell[] = [arrow.points[0]];
  const seen = new Set([key(cells[0])]);
  for (let i = 1; i < arrow.points.length; i++) {
    const [x, y] = arrow.points[i - 1];
    const [tx, ty] = arrow.points[i];
    if (![x, y, tx, ty].every(Number.isInteger))
      throw new Error(`${arrow.id}: non-integer coordinate`);
    if ((x === tx) === (y === ty))
      throw new Error(`${arrow.id}: diagonal or zero-length segment`);
    const dx = Math.sign(tx - x),
      dy = Math.sign(ty - y);
    for (let n = 1; n <= Math.abs(tx - x) + Math.abs(ty - y); n++) {
      const cell: Cell = [x + dx * n, y + dy * n];
      if (seen.has(key(cell)))
        throw new Error(`${arrow.id}: self-overlap or reversal`);
      cells.push(cell);
      seen.add(key(cell));
    }
  }
  return cells;
}

export function validateLevel(value: unknown): Level {
  if (!value || typeof value !== "object") throw new Error("Missing level");
  const level = value as Level;
  if (
    level.schemaVersion !== 1 ||
    level.rulesVersion !== 1 ||
    level.contentVersion !== 1 ||
    typeof level.levelId !== "string" ||
    !level.levelId ||
    !level.board ||
    !Array.isArray(level.arrows) ||
    !level.arrows.length ||
    level.arrows.length > 128 ||
    !Array.isArray(level.solution)
  )
    throw new Error("Unsupported level schema/version");
  if (
    ![level.board.columns, level.board.rows].every(
      (n) => Number.isInteger(n) && n >= 2 && n <= 32,
    )
  )
    throw new Error("Board dimensions must be 2–32");
  const occupied = new Set<string>(),
    ids = new Set<string>();
  for (const arrow of level.arrows) {
    if (
      !arrow ||
      typeof arrow.id !== "string" ||
      !arrow.id ||
      ids.has(arrow.id) ||
      !Array.isArray(arrow.points) ||
      arrow.points.length > 1024 ||
      arrow.points.some((p) => !Array.isArray(p) || p.length !== 2)
    )
      throw new Error("Invalid/duplicate arrow");
    ids.add(arrow.id);
    // Bound points before expanding to avoid expensive malformed input.
    if (
      arrow.points.some(
        ([x, y]) =>
          !Number.isInteger(x) ||
          !Number.isInteger(y) ||
          x < 0 ||
          y < 0 ||
          x >= level.board.columns ||
          y >= level.board.rows,
      )
    )
      throw new Error("Out of bounds");
    for (const cell of expand(arrow)) {
      if (occupied.has(key(cell))) throw new Error("Initial overlap");
      occupied.add(key(cell));
    }
  }
  if (
    level.solution.length !== ids.size ||
    new Set(level.solution).size !== ids.size ||
    level.solution.some((id) => !ids.has(id))
  )
    throw new Error("Solution must contain every arrow exactly once");
  let active = [...ids];
  for (const id of level.solution) {
    if (!checkExit(level, active, id).clear)
      throw new Error(`Solution blocked at ${id}`);
    active = active.filter((a) => a !== id);
  }
  return level;
}

/** Slow, explicit swept-footprint checker. No renderer or mutation. */
export function checkExit(
  level: Level,
  active: readonly string[],
  id: string,
): Exit {
  const arrow = level.arrows.find((a) => a.id === id);
  if (!arrow || !active.includes(id)) throw new Error("Arrow is not active");
  const cells = expand(arrow),
    [dx, dy] = direction(arrow);
  const occupancy = new Map<string, string>();
  for (const other of level.arrows)
    if (other.id !== id && active.includes(other.id))
      for (const cell of expand(other)) occupancy.set(key(cell), other.id);
  // One dimension's length suffices to move any initial footprint completely outside.
  for (
    let step = 1;
    step <= Math.max(level.board.columns, level.board.rows);
    step++
  ) {
    let inside = false;
    for (const [x, y] of cells) {
      const cell: Cell = [x + dx * step, y + dy * step];
      if (
        cell[0] < 0 ||
        cell[1] < 0 ||
        cell[0] >= level.board.columns ||
        cell[1] >= level.board.rows
      )
        continue;
      inside = true;
      const blocker = occupancy.get(key(cell));
      if (blocker) return { clear: false, blocker, cell, step };
    }
    if (!inside) return { clear: true, distance: step };
  }
  throw new Error("Exit bound exceeded");
}

/** Independent dependency construction: pairwise collinear cell rays, no stepped simulation. */
export function dependencies(level: Level): Map<string, Set<string>> {
  return new Map(
    level.arrows.map((arrow) => {
      const blockers = new Set<string>(),
        [dx, dy] = direction(arrow);
      for (const other of level.arrows)
        if (other !== arrow) {
          if (
            expand(arrow).some(([x, y]) =>
              expand(other).some(([ox, oy]) =>
                dx !== 0
                  ? y === oy && (ox - x) * dx > 0
                  : x === ox && (oy - y) * dy > 0,
              ),
            )
          )
            blockers.add(other.id);
        }
      return [arrow.id, blockers];
    }),
  );
}

export function solve(
  level: Level,
  initial = level.arrows.map((a) => a.id),
): string[] | null {
  const graph = dependencies(level),
    active = new Set(initial),
    result: string[] = [];
  while (active.size) {
    const next = [...active]
      .sort()
      .find((id) => ![...graph.get(id)!].some((b) => active.has(b)));
    if (!next) return null;
    result.push(next);
    active.delete(next);
  }
  return result;
}

export function legalArrows(level: Level, active: readonly string[]): string[] {
  return active.filter((id) => checkExit(level, active, id).clear);
}

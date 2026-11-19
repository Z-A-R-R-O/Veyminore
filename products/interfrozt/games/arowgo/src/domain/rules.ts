export type Cell = readonly [number, number];
export interface Arrow {
  id: string;
  points: Cell[];
  requires?: string;
  anchorRequires?: string;
  deadline?: number;
  thawAfter?: number;
  phase?: 0 | 1;
}
export interface Level {
  schemaVersion: 1;
  rulesVersion: 1 | 2;
  contentVersion: number;
  levelId: string;
  board: { columns: number; rows: number };
  arrows: Arrow[];
  solution: string[];
}
export type Exit =
  | { clear: true; distance: number }
  | {
      clear: false;
      blocker: string;
      cell: Cell;
      step: number;
      reason?: "locked" | "anchored" | "frozen" | "phase";
    };
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
    ![1, 2].includes(level.rulesVersion) ||
    ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(level.contentVersion) ||
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
    if (level.rulesVersion === 2) {
      const [hx, hy] = arrow.points.at(-1)!,
        [dx, dy] = direction(arrow);
      if (
        expand(arrow)
          .slice(0, -1)
          .some(([x, y]) =>
            dx ? y === hy && (x - hx) * dx > 0 : x === hx && (y - hy) * dy > 0,
          )
      )
        throw new Error("Snake head ray crosses its own body");
    }
  }
  if (
    level.solution.length !== ids.size ||
    new Set(level.solution).size !== ids.size ||
    level.solution.some((id) => !ids.has(id))
  )
    throw new Error("Solution must contain every arrow exactly once");
  for (const arrow of level.arrows) {
    if (
      arrow.requires !== undefined &&
      (typeof arrow.requires !== "string" ||
        !ids.has(arrow.requires) ||
        arrow.requires === arrow.id)
    )
      throw new Error("Invalid key reference");
  }
  for (const arrow of level.arrows) {
    if (
      arrow.anchorRequires !== undefined &&
      (typeof arrow.anchorRequires !== "string" ||
        !ids.has(arrow.anchorRequires) ||
        arrow.anchorRequires === arrow.id ||
        arrow.requires)
    )
      throw new Error("Invalid anchor reference");
    if (
      arrow.deadline !== undefined &&
      (!Number.isSafeInteger(arrow.deadline) ||
        arrow.deadline < 1 ||
        arrow.deadline > level.arrows.length ||
        level.arrows.length > 20)
    )
      throw new Error("Invalid keg deadline");
    if (
      (arrow.anchorRequires || arrow.deadline !== undefined) &&
      (level.rulesVersion !== 2 || level.contentVersion < 7)
    )
      throw new Error("Mechanics require content 7");
  }
  for (const a of level.arrows) {
    if (a.phase !== undefined && a.phase !== 0 && a.phase !== 1)
      throw Error("Invalid phase");
    if (
      a.thawAfter !== undefined &&
      (!Number.isInteger(a.thawAfter) ||
        a.thawAfter < 1 ||
        a.thawAfter >= level.arrows.length)
    )
      throw Error("Invalid thaw count");
    if (
      (a.phase !== undefined || a.thawAfter !== undefined) &&
      (level.contentVersion < 10 ||
        level.rulesVersion !== 2 ||
        level.arrows.length > 20)
    )
      throw Error("Timing mechanics require content 10 and at most 20 arrows");
  }
  let active = [...ids];
  for (const id of level.solution) {
    if (!checkExit(level, active, id).clear)
      throw new Error(`Solution blocked at ${id}`);
    active = active.filter((a) => a !== id);
    if (expiredKeg(level, active))
      throw new Error("Solution misses keg deadline");
  }
  return level;
}

/** Version 2 checks the head ray; version 1 retains rigid sweeps for archived-save validation. */
export function checkExit(
  level: Level,
  active: readonly string[],
  id: string,
): Exit {
  const arrow = level.arrows.find((a) => a.id === id);
  if (!arrow || !active.includes(id)) throw new Error("Arrow is not active");
  const removed = level.arrows.length - active.length;
  if (!timingOpen(arrow, removed))
    return {
      clear: false,
      blocker: id,
      cell: arrow.points[0],
      step: 0,
      reason: removed < (arrow.thawAfter ?? 0) ? "frozen" : "phase",
    };
  if (arrow.anchorRequires && active.includes(arrow.anchorRequires))
    return {
      clear: false,
      blocker: arrow.anchorRequires,
      cell: level.arrows
        .find((a) => a.id === arrow.anchorRequires)!
        .points.at(-1)!,
      step: 0,
      reason: "anchored",
    };
  if (arrow.requires && active.includes(arrow.requires)) {
    return {
      clear: false,
      blocker: arrow.requires,
      cell: level.arrows.find((a) => a.id === arrow.requires)!.points.at(-1)!,
      step: 0,
      reason: "locked",
    };
  }
  const cells =
      level.rulesVersion === 2 ? [arrow.points.at(-1)!] : expand(arrow),
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
    if (!inside)
      return {
        clear: true,
        distance:
          step + (level.rulesVersion === 2 ? expand(arrow).length - 1 : 0),
      };
  }
  throw new Error("Exit bound exceeded");
}

/** Independent dependency construction: pairwise collinear cell rays, no stepped simulation. */
export function dependencies(level: Level): Map<string, Set<string>> {
  return new Map(
    level.arrows.map((arrow) => {
      const blockers = new Set<string>(),
        [dx, dy] = direction(arrow);
      if (arrow.requires) blockers.add(arrow.requires);
      if (arrow.anchorRequires) blockers.add(arrow.anchorRequires);
      for (const other of level.arrows)
        if (other !== arrow) {
          if (
            (level.rulesVersion === 2
              ? [arrow.points.at(-1)!]
              : expand(arrow)
            ).some(([x, y]) =>
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

export function timingOpen(a: Arrow, removed: number) {
  return (
    removed >= (a.thawAfter ?? 0) &&
    (a.phase === undefined || removed % 2 === a.phase)
  );
}
export function hasTiming(level: Level) {
  return level.arrows.some(
    (a) =>
      a.deadline !== undefined ||
      a.phase !== undefined ||
      a.thawAfter !== undefined,
  );
}

export function solve(
  level: Level,
  initial = level.arrows.map((a) => a.id),
): string[] | null {
  if (hasTiming(level)) return solveDeadlines(level, initial);
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

export function expiredKeg(level: Level, active: readonly string[]): boolean {
  const removed = level.arrows.length - active.length;
  return level.arrows.some(
    (a) =>
      a.deadline !== undefined &&
      active.includes(a.id) &&
      removed >= a.deadline,
  );
}
function solveDeadlines(level: Level, initial: string[]): string[] | null {
  const ids = level.arrows.map((a) => a.id),
    graph = dependencies(level);
  const bits = new Map(ids.map((id, i) => [id, 1 << i]));
  const blockers = ids.map((id) =>
    [...graph.get(id)!].reduce((mask, b) => mask | bits.get(b)!, 0),
  );
  const failed = new Set<number>();
  let visited = 0;
  function search(mask: number): string[] | null {
    if (!mask) return [];
    if (failed.has(mask)) return null;
    if (++visited > 1100000)
      throw new Error("Deadline solver budget exhausted");
    const removed = ids.length - ids.filter((_, i) => mask & (1 << i)).length;
    if (
      level.arrows.some(
        (a, i) =>
          a.deadline !== undefined && mask & (1 << i) && removed >= a.deadline,
      )
    )
      return null;
    const candidates = ids
      .map((_, i) => i)
      .filter(
        (i) =>
          mask & (1 << i) &&
          !(blockers[i] & mask) &&
          timingOpen(level.arrows[i], removed),
      )
      .sort(
        (a, b) =>
          (level.arrows[a].deadline ?? 999) - (level.arrows[b].deadline ?? 999),
      );
    for (const i of candidates) {
      const rest = search(mask & ~(1 << i));
      if (rest) return [ids[i], ...rest];
    }
    failed.add(mask);
    return null;
  }
  return search(initial.reduce((mask, id) => mask | bits.get(id)!, 0));
}
export function safeArrows(level: Level, active: readonly string[]): string[] {
  const legal = legalArrows(level, active);
  if (!hasTiming(level)) return legal;
  return legal.filter(
    (id) =>
      solve(
        level,
        active.filter((a) => a !== id),
      ) !== null,
  );
}

import { describe, expect, it } from "vitest";
import data from "../content/levels/bloom-01.json";
import {
  checkExit,
  dependencies,
  expand,
  solve,
  validateLevel,
  type Level,
} from "../src/domain/rules";
import { fixtures } from "../src/domain/fixtures";
const level = validateLevel(data);
describe("rigid-path proof", () => {
  it.each(fixtures)("$name: $description", (f) => {
    const active = f.level.arrows.map((a) => a.id);
    const before = JSON.stringify(f.level);
    expect(checkExit(f.level, active, f.selected).clear).toBe(f.clear);
    expect(JSON.stringify(f.level)).toBe(before);
  });
  it("blocks the bent body even when the arrowhead ray is completely empty", () => {
    const f = fixtures[5];
    expect(checkExit(f.level, ["A", "B"], "A")).toEqual({
      clear: false,
      blocker: "B",
      cell: [3, 1],
      step: 3,
    });
    expect(checkExit(f.level, ["A"], "A")).toEqual({
      clear: true,
      distance: 6,
    });
  });
  it("keeps the second blocker after the first is removed", () => {
    expect(checkExit(fixtures[6].level, ["A", "C"], "A").clear).toBe(false);
    expect(checkExit(fixtures[6].level, ["A"], "A").clear).toBe(true);
  });
  it("waits for the tail at a boundary", () =>
    expect(checkExit(fixtures[8].level, ["A"], "A")).toEqual({
      clear: true,
      distance: 3,
    }));
  it.each([
    [[0, 0]],
    [
      [0, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [0, 0],
    ],
    [
      [0, 0],
      [2, 0],
      [1, 0],
    ],
    [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ],
    [
      [0, 0],
      [1.5, 0],
    ],
  ])("rejects malformed geometry %j", (...points) => {
    expect(() =>
      expand({ id: "bad", points: points as unknown as [number, number][] }),
    ).toThrow();
  });
  it("rejects initial overlaps, duplicate IDs, outside points, wrong versions and wrong solutions", () => {
    const mutations = [
      (l: Level) => {
        l.arrows[1].points = l.arrows[0].points;
      },
      (l: Level) => {
        l.arrows[1].id = l.arrows[0].id;
      },
      (l: Level) => {
        l.arrows[0].points[0] = [-1, 0];
      },
      (l: Level) => {
        (l as { rulesVersion: number }).rulesVersion = 2;
      },
      (l: Level) => {
        l.solution = ["B", "A", ...l.solution.slice(2)];
      },
      (l: Level) => {
        l.solution[1] = "A";
      },
    ];
    for (const mutate of mutations) {
      const candidate = structuredClone(level);
      mutate(candidate);
      expect(() => validateLevel(candidate)).toThrow();
    }
  });
  it("independent dependency rays agree with swept simulation for every level subset", () => {
    const graph = dependencies(level),
      ids = level.arrows.map((a) => a.id);
    for (let mask = 1; mask < 2 ** ids.length; mask++) {
      const active = ids.filter((_, i) => mask & (1 << i));
      for (const id of active)
        expect(checkExit(level, active, id).clear).toBe(
          ![...graph.get(id)!].some((b) => active.includes(b)),
        );
    }
  });
  it("replays a complete deterministic solver result through the independent checker", () => {
    const solution = solve(level)!;
    expect(solution).toEqual(solve(level));
    let active = level.arrows.map((a) => a.id);
    for (const id of solution) {
      expect(checkExit(level, active, id).clear).toBe(true);
      active = active.filter((a) => a !== id);
    }
    expect(active).toEqual([]);
  });
  it("detects a dependency cycle", () => {
    const cycle: Level = {
      ...level,
      board: { columns: 4, rows: 2 },
      arrows: [
        {
          id: "A",
          points: [
            [0, 0],
            [1, 0],
          ],
        },
        {
          id: "B",
          points: [
            [3, 0],
            [2, 0],
          ],
        },
      ],
      solution: ["A", "B"],
    };
    expect(solve(cycle)).toBeNull();
    expect(() => validateLevel(cycle)).toThrow();
  });
});

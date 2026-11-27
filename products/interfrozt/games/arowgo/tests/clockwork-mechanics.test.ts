import { inspectArrow } from "../src/domain/preview";
import { it, expect } from "vitest";
import {
  timingOpen,
  validateLevel,
  solve,
  type Level,
} from "../src/domain/rules";
import {
  worldForLevel,
  worldStart,
  worldSize,
} from "../src/domain/worldLayout";
it("cycles three beats and enforces inclusive opening windows", () => {
  const a = {
    id: "A",
    points: [
      [0, 0],
      [1, 0],
    ] as [number, number][],
    pulse: 1 as const,
  };
  expect(Array.from({ length: 7 }, (_, n) => timingOpen(a, n))).toEqual([
    false,
    true,
    false,
    false,
    true,
    false,
    false,
  ]);
  expect(
    Array.from({ length: 6 }, (_, n) =>
      timingOpen({ ...a, pulse: undefined, window: [2, 3] }, n),
    ),
  ).toEqual([false, false, true, true, false, false]);
});
it("preserves five legacy worlds and uses forty thereafter", () => {
  expect([99, 100, 139, 140, 179].map(worldForLevel)).toEqual([4, 5, 5, 6, 6]);
  expect([worldStart(5), worldSize(5), worldStart(6), worldSize(6)]).toEqual([
    100, 40, 140, 40,
  ]);
});
it("solver respects pulse and window order, validation rejects invalid attachments", () => {
  const l: Level = {
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 13,
    levelId: "test",
    board: { columns: 3, rows: 3 },
    arrows: [
      {
        id: "A",
        points: [
          [0, 0],
          [1, 0],
        ],
        pulse: 1,
      },
      {
        id: "B",
        points: [
          [0, 1],
          [1, 1],
        ],
        window: [0, 0],
      },
      {
        id: "C",
        points: [
          [0, 2],
          [1, 2],
        ],
      },
    ],
    solution: ["B", "A", "C"],
  };
  expect(validateLevel(l)).toBe(l);
  expect(solve(l)).toEqual(l.solution);
  expect(solve(l, ["A", "B"])).toBeNull();
  expect(() => validateLevel({ ...l, contentVersion: 12 })).toThrow();
  expect(() =>
    validateLevel({
      ...l,
      arrows: l.arrows.map((a) =>
        a.id === "B" ? { ...a, window: [2, 1] } : a,
      ),
    }),
  ).toThrow();
});

it("hold preview describes timing without revealing a winning choice", () => {
  const l: Level = {
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 13,
    levelId: "preview",
    board: { columns: 3, rows: 3 },
    arrows: [
      {
        id: "A",
        points: [
          [0, 0],
          [1, 0],
        ],
        pulse: 1,
      },
      {
        id: "B",
        points: [
          [0, 1],
          [1, 1],
        ],
        window: [0, 0],
      },
      {
        id: "C",
        points: [
          [0, 2],
          [1, 2],
        ],
      },
    ],
    solution: ["B", "A", "C"],
  };
  const preview = inspectArrow(l, ["A", "B", "C"], "A");
  expect(preview.title).toContain("Beat 2/3");
  expect(preview.route.clear).toBe(true);
  expect(preview).not.toHaveProperty("solution");
  expect(inspectArrow(l, ["A", "B"], "B").title).toContain("expired");
});

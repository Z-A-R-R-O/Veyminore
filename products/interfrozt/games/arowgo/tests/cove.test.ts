import {beforeChallengeLevels} from "../src/domain/campaignBeforeChallenge";
import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  validateLevel,
  solve,
  safeArrows,
  expiredKeg,
  checkExit,
  type Level,
} from "../src/domain/rules";
import { newSession, resolve, parseSession } from "../src/application/session";
const candidates = Array.from({ length: 20 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(`content/candidates/cove/level-${i + 21}.json`, "utf8"),
    ),
  ),
);
it("all twenty staged candidates solve, save and supply safe hints at every step", () => {
  expect(new Set(candidates.map((l) => JSON.stringify(l.arrows))).size).toBe(
    20,
  );
  for (const level of candidates) {
    let state = newSession(level, "test");
    const path = solve(level)!;
    expect(path).toHaveLength(level.arrows.length);
    for (const id of path) {
      expect(safeArrows(level, state.active)).toContain(id);
      state = resolve(level, state, {
        id,
        attemptId: "test",
        type: "select",
        arrowId: id,
      }).state;
      expect(state.status).not.toBe("failed");
      expect(parseSession(JSON.stringify(state), level)).toEqual(state);
    }
    expect(state.status).toBe("complete");
    expect(state.coins).toBe(25);
  }
}, 30000);
const timed: Level = {
  schemaVersion: 1,
  rulesVersion: 2,
  contentVersion: 7,
  levelId: "deadline",
  board: { columns: 5, rows: 5 },
  arrows: [
    {
      id: "A",
      points: [
        [0, 1],
        [0, 0],
      ],
      deadline: 1,
    },
    {
      id: "B",
      points: [
        [2, 1],
        [2, 0],
      ],
    },
    {
      id: "C",
      points: [
        [4, 1],
        [4, 0],
      ],
    },
  ],
  solution: ["A", "B", "C"],
};
it("deadlines constrain legal choices, hints stay safe, failure persists and erase ticks once", () => {
  validateLevel(timed);
  expect(safeArrows(timed, ["A", "B", "C"])).toEqual(["A"]);
  let state = newSession(timed, "t");
  expect(
    resolve(timed, state, { id: "h", attemptId: "t", type: "hint" }).hints,
  ).toEqual(["A"]);
  state = resolve(timed, state, {
    id: "b",
    attemptId: "t",
    type: "select",
    arrowId: "B",
  }).state;
  expect(state.failureReason).toBe("keg");
  expect(state.mistakes).toBe(0);
  expect(expiredKeg(timed, state.active)).toBe(true);
  expect(parseSession(JSON.stringify(state), timed)).toEqual(state);
  const erased = resolve(timed, newSession(timed, "e"), {
    id: "e",
    attemptId: "e",
    type: "erase",
    arrowId: "A",
  }).state;
  expect(erased.status).toBe("playing");
  expect(erased.active).toHaveLength(2);
});
it("one anchor releases multiple arrows without overriding geometry", () => {
  const level: Level = {
    ...timed,
    arrows: timed.arrows.map((a) => ({
      ...a,
      deadline: undefined,
      ...(a.id !== "A" ? { anchorRequires: "A" } : {}),
    })),
  };
  validateLevel(level);
  expect(checkExit(level, ["A", "B", "C"], "B")).toMatchObject({
    clear: false,
    reason: "anchored",
  });
  expect(checkExit(level, ["B", "C"], "B").clear).toBe(true);
  expect(checkExit(level, ["B", "C"], "C").clear).toBe(true);
});
it("a blocked tap never consumes a keg move", () => {
  const level = candidates.find((l) => l.arrows.some((a) => a.deadline))!;
  const s = newSession(level, "b"),
    id = s.active.find((id) => !checkExit(level, s.active, id).clear)!;
  const result = resolve(level, s, {
    id: "bad",
    attemptId: "b",
    type: "select",
    arrowId: id,
  });
  expect(result.state.active).toEqual(s.active);
  expect(result.state.mistakes).toBe(1);
});

it("archived first Cove edition matches its validated candidates and keep one badge per tail", () => {
  candidates.forEach((level, i) => {
    const live = beforeChallengeLevels[i+20];
    expect(live).toEqual(level);
    for (const a of level.arrows) {
      const roles = [
        !!a.requires,
        !!a.anchorRequires,
        a.deadline !== undefined,
        level.arrows.some((b) => b.requires === a.id),
        level.arrows.some((b) => b.anchorRequires === a.id),
      ];
      expect(roles.filter(Boolean).length).toBeLessThanOrEqual(1);
    }
  });
});

import { it, expect } from "vitest";
import {
  validateLevel,
  checkExit,
  solve,
  switchOpen,
  switchChecker,
  type Level,
} from "../src/domain/rules";
import { evaluatePlanning } from "../src/domain/planning";
import { inspectArrow } from "../src/domain/preview";
import { newSession, resolve, parseSession } from "../src/application/session";
const fixture = (): Level =>
  validateLevel({
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 15,
    levelId: "switch-proof",
    board: { columns: 8, rows: 8 },
    arrows: [
      { id: "S1", switchGroup: 1 },
      { id: "S2", switchGroup: 1 },
      { id: "G1", gate: { group: 1, initiallyOpen: false } },
      { id: "G2", gate: { group: 1, initiallyOpen: true } },
      { id: "N" },
      { id: "S3", switchGroup: 2 },
      { id: "S4", switchGroup: 2 },
      { id: "G3", gate: { group: 2, initiallyOpen: false } },
    ].map((a, y) => ({
      ...a,
      points: [
        [0, y],
        [1, y],
      ],
    })),
    solution: ["G2", "S1", "G1", "S2", "N", "S3", "G3", "S4"],
  });
it("toggles only matching gates, including a second switch closing them", () => {
  const l = fixture(),
    all = l.arrows.map((a) => a.id);
  expect(switchOpen(l, all, "G1")).toBe(false);
  expect(switchOpen(l, all, "G2")).toBe(true);
  const first = all.filter((x) => x !== "S1");
  expect(switchOpen(l, first, "G1")).toBe(true);
  expect(switchOpen(l, first, "G2")).toBe(false);
  expect(switchOpen(l, first, "G3")).toBe(false);
  expect(
    switchOpen(
      l,
      first.filter((x) => x !== "S2"),
      "G1",
    ),
  ).toBe(false);
  expect(
    switchOpen(
      l,
      all.filter((x) => x !== "N"),
      "G1",
    ),
  ).toBe(false);
});
it("agrees with an independent exhaustive state oracle for all 256 masks", () => {
  const l = fixture(),
    ids = l.arrows.map((a) => a.id),
    gateOpen = switchChecker(l),
    memo = new Map<number, number>();
  const probability = (mask: number): number => {
    if (!mask) return 1;
    if (memo.has(mask)) return memo.get(mask)!;
    const active = ids.filter((_, i) => mask & (1 << i));
    const legal = ids
      .map((_, i) => i)
      .filter((i) => mask & (1 << i) && checkExit(l, active, ids[i]).clear);
    const p =
      legal.reduce((sum, i) => sum + probability(mask & ~(1 << i)), 0) /
      (legal.length || 1);
    memo.set(mask, p);
    return p;
  };
  for (let mask = 0; mask < 256; mask++) {
    const active = ids.filter((_, i) => mask & (1 << i));
    for (const [i, a] of l.arrows.entries())
      if (a.gate) {
        const removed = l.arrows.filter(
          (s) => s.switchGroup === a.gate!.group && !active.includes(s.id),
        ).length;
        expect(gateOpen(i, mask)).toBe(
          a.gate.initiallyOpen !== (removed % 2 === 1),
        );
      }
    expect(solve(l, active) !== null).toBe(probability(mask) > 0);
  }
  expect(evaluatePlanning(l).randomLegalWinRate).toBeCloseTo(
    probability(255),
    12,
  );
});
it("restores switch state from history, keeps blocked taps unchanged, and handles Erase", () => {
  const l = fixture();
  let state = newSession(l, "test");
  state = resolve(l, state, {
    type: "select",
    id: "blocked",
    attemptId: "test",
    arrowId: "G1",
  }).state;
  expect(state.mistakes).toBe(1);
  expect(switchOpen(l, state.active, "G1")).toBe(false);
  state = resolve(l, state, {
    type: "erase",
    id: "erase",
    attemptId: "test",
    arrowId: "S1",
  }).state;
  expect(switchOpen(l, state.active, "G1")).toBe(true);
  expect(parseSession(JSON.stringify(state), l)).toEqual(state);
  expect(switchOpen(l, newSession(l, "restart").active, "G1")).toBe(false);
});
it("previews observable linked effects without revealing winning moves", () => {
  const l = fixture(),
    active = l.arrows.map((a) => a.id),
    preview = inspectArrow(l, active, "S1");
  expect(preview.linked.sort()).toEqual(["G1", "G2"]);
  expect(
    preview.changes
      .filter((c) => c.kind === "switch")
      .map((c) => [c.id, c.before, c.after]),
  ).toEqual([
    ["G1", 0, 1],
    ["G2", 1, 0],
  ]);
  expect(inspectArrow(l, active, "G1").sources.sort()).toEqual(["S1", "S2"]);
  expect(
    inspectArrow(l, active, "N").changes.filter((c) => c.kind === "switch"),
  ).toEqual([]);
});
it("rejects invalid or overlapping switch definitions", () => {
  for (const edit of [
    (l: Level) => {
      l.contentVersion = 14;
    },
    (l: Level) => {
      l.arrows[0].switchGroup = 3 as 1;
    },
    (l: Level) => {
      l.arrows[0].phase = 0;
    },
    (l: Level) => {
      l.arrows[2].gate!.group = 2;
      l.arrows[3].gate!.group = 2;
    },
  ]) {
    const l = structuredClone(fixture());
    edit(l);
    expect(() => validateLevel(l)).toThrow();
  }
});

it("ends a stranded attempt when the last switch closes a remaining gate", () => {
  const l = fixture();
  let state = newSession(l, "last-switch");
  for (const arrowId of ["G2", "S1", "S2"])
    state = resolve(l, state, {
      type: "select",
      id: arrowId,
      attemptId: state.attemptId,
      arrowId,
    }).state;
  expect(state.status).toBe("failed");
  expect(state.failureReason).toBe("stranded");
  expect(switchOpen(l, state.active, "G1")).toBe(false);
  expect(parseSession(JSON.stringify(state), l)).toEqual(state);
});

it("replays every switch-only save and rejects missing or reordered history", () => {
  const l = fixture();
  let state = newSession(l, "history");
  for (const arrowId of l.solution) {
    state = resolve(l, state, {
      type: "select",
      id: arrowId,
      attemptId: state.attemptId,
      arrowId,
    }).state;
    expect(parseSession(JSON.stringify(state), l)).toEqual(state);
  }
  expect(state.status).toBe("complete");
  expect(() =>
    parseSession(JSON.stringify({ ...state, moveLog: [] }), l),
  ).toThrow();
  expect(() =>
    parseSession(
      JSON.stringify({
        ...state,
        moveLog: ["G2", "S1", "S2", "G1", "N", "S3", "G3", "S4"].map(
          (arrowId) => ({ type: "select", arrowId }),
        ),
      }),
      l,
    ),
  ).toThrow();
});

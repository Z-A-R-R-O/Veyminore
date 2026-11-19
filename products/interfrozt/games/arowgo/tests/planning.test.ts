import { it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { beforePlanningLevels } from "../src/domain/campaignBeforePlanning";
import { evaluatePlanning, planDeadlines } from "../src/domain/planning";
import {
  validateLevel,
  solve,
  safeArrows,
  checkExit,
  type Level,
} from "../src/domain/rules";
import { newSession, resolve, parseSession } from "../src/application/session";
import { SaveStore } from "../src/storage/save";
const candidates = Array.from({ length: 31 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(`content/candidates/planning/level-${i + 10}.json`, "utf8"),
    ),
  ),
);
const toy: Level = {
  schemaVersion: 1,
  rulesVersion: 2,
  contentVersion: 9,
  levelId: "planning-test",
  board: { columns: 6, rows: 6 },
  arrows: [
    {
      id: "A",
      points: [
        [1, 3],
        [1, 2],
      ],
      deadline: 2,
    },
    {
      id: "B",
      points: [
        [1, 1],
        [3, 1],
      ],
    },
    {
      id: "C",
      points: [
        [4, 5],
        [5, 5],
      ],
    },
  ],
  solution: ["B", "A", "C"],
};
it("distinguishes planning from density, with an independently countable choice tree", () => {
  validateLevel(toy);
  expect(evaluatePlanning(toy).randomLegalWinRate).toBe(0.25); // B (1/2), then A (1/2).
  expect(
    evaluatePlanning({
      ...toy,
      arrows: toy.arrows.map(({ deadline, ...a }) => a),
    }),
  ).toMatchObject({ randomLegalWinRate: 1, decisionStates: 0 });
  expect(safeArrows(toy, ["A", "B", "C"])).toEqual(["B"]);
  expect(() => planDeadlines(toy, 9)).toThrow();
});
it("adds genuine wrong-order decisions without adding arrows or changing keys and anchors", () => {
  for (const [i, l] of candidates.entries()) {
    const old = beforePlanningLevels[i + 9],
      a = evaluatePlanning(l);
    expect(l.arrows.map(({ deadline, ...rest }) => rest)).toEqual(
      old.arrows.map(({ deadline, ...rest }) => rest),
    );
    expect(a.deadlines).toHaveLength(i + 10 < 25 ? 1 : 2);
    expect(a.randomLegalWinRate).toBeGreaterThan(0);
    expect(a.randomLegalWinRate).toBeLessThan(0.8);
    expect(a.blockedTargetDecisions).toBeGreaterThan(0);
    if (i < 5) expect(a.earliestDecisionMove).toBeGreaterThanOrEqual(3);
    const decision = a.exampleDecision!;
    expect(checkExit(l, decision.active, decision.unsafeMove).clear).toBe(true);
    expect(
      solve(
        l,
        decision.active.filter((id) => id !== decision.unsafeMove),
      ),
    ).toBeNull();
    expect(safeArrows(l, decision.active)).toContain(decision.safeMove);
    if (a.deadlines.length === 2)
      for (const d of a.deadlines) {
        expect(
          evaluatePlanning({
            ...l,
            arrows: l.arrows.map((a) =>
              a.id === d.id ? { ...a, deadline: undefined } : a,
            ),
          }).randomLegalWinRate,
        ).toBeGreaterThan(a.randomLegalWinRate + 0.001);
      }
    for (let route = 0; route < 3; route++) {
      let s = newSession(l, "test");
      while (s.active.length) {
        const safe = safeArrows(l, s.active);
        expect(safe.length).toBeGreaterThan(0);
        const id = safe[(route + s.active.length) % safe.length];
        s = resolve(l, s, {
          id,
          attemptId: "test",
          type: "select",
          arrowId: id,
        }).state;
        expect(s.status).not.toBe("failed");
        expect(parseSession(JSON.stringify(s), l)).toEqual(s);
      }
      expect(s.coins).toBe(25);
    }
  }
  const rates = candidates.map((l) => evaluatePlanning(l).randomLegalWinRate);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  for (let i = 5; i < 30; i += 5)
    expect(mean(rates.slice(i, i + 5))).toBeLessThan(
      mean(rates.slice(i - 5, i)),
    );
}, 120000);
it("preserves version-8 rewards and archives unfinished or completed saves on every replacement", () => {
  candidates.forEach((next, i) => {
    const old = beforePlanningLevels[i + 9];
    let complete = newSession(old, "old");
    for (const id of old.solution)
      complete = resolve(old, complete, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    for (const prior of [
      complete,
      newSession(old, "practice", "practice", complete),
      newSession(old, "unfinished"),
    ]) {
      const raw = JSON.stringify(prior),
        values = new Map([["save", raw]]);
      const migrated = new SaveStore(
        {
          getItem: (k) => values.get(k) ?? null,
          setItem: (k, v) => {
            values.set(k, v);
          },
        },
        next,
        "save",
        old,
      ).load().state!;
      expect(migrated).toMatchObject({
        contentVersion: 9,
        coins: prior.coins,
        bestStars: prior.bestStars,
        claimed: prior.claimed,
        mode: prior.mode,
        status: "playing",
      });
      expect(values.get("save.content-8")).toBe(raw);
      let s = newSession(next, "finish", "story", migrated);
      for (const id of next.solution)
        s = resolve(next, s, {
          id,
          attemptId: "finish",
          type: "select",
          arrowId: id,
        }).state;
      expect(s.status).toBe("complete");
      expect(s.coins).toBe(25);
      expect(s.reward).toBe(prior.claimed ? 0 : 25);
    }
  });
}, 120000);

it("promotes the reviewed planning candidates and leaves Levels 1–9 intact", async () => {
  const { levels } = await import("../src/domain/campaign");
  expect(levels.slice(0, 9)).toEqual(beforePlanningLevels.slice(0, 9));
  expect(levels.slice(9, 40)).toEqual(candidates);
});

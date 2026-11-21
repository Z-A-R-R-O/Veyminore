import { it, expect } from "vitest";
import { levels } from "../src/domain/campaign";
import { beforeDensityLevels } from "../src/domain/campaignBeforeDensity";
import { evaluateLayout, evaluateDifficulty } from "../src/domain/generator";
import { evaluatePlanning } from "../src/domain/planning";
import { solve, checkExit, type Level } from "../src/domain/rules";
import { newSession, resolve, parseSession } from "../src/application/session";
import { SaveStore } from "../src/storage/save";
import { validatePlayableRestore } from "../src/account/cloud-restore";
// @ts-expect-error Server ESM integration.
import { verifyClear } from "../server/economy/rewards.mjs";
// @ts-expect-error Server ESM integration.
import { packSnapshot, unpackSnapshot } from "../server/account/cloud.mjs";
it("dense 30–80 increase count, coverage and planning difficulty without changing grid scale", () => {
  let previous = Infinity;
  const signatures = new Set<string>();
  for (const [i, old] of beforeDensityLevels.entries()) {
    const l = levels[i + 29];
    expect(l.contentVersion).toBe(12);
    expect(l.arrows.length).toBe(20 + Math.floor((i * 8) / 50));
    expect(l.arrows.length).toBeGreaterThan(old.arrows.length);
    expect(l.board).toEqual(old.board);
    expect(evaluateLayout(l).occupiedCells).toBeGreaterThanOrEqual(
      65 + Math.floor(i * 0.25),
    );
    expect(evaluateDifficulty(l).depth).toBeGreaterThanOrEqual(
      4 + Math.floor(i / 15),
    );
    const signature = JSON.stringify(l.arrows.map((a) => a.points));
    expect(signatures.has(signature)).toBe(false);
    signatures.add(signature);
    const p = evaluatePlanning(l);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(previous);
    expect(p.randomLegalWinRate).toBeLessThan(
      evaluatePlanning(old).randomLegalWinRate,
    );
    previous = p.randomLegalWinRate;
    const d = p.exampleDecision!;
    expect(d).toBeTruthy();
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    expect(checkExit(l, d.active, d.unsafeMove).clear).toBe(true);
    expect(
      solve(
        l,
        d.active.filter((id) => id !== d.unsafeMove),
      ),
    ).toBeNull();
    expect(
      solve(
        l,
        d.active.filter((id) => id !== d.safeMove),
      ),
    ).not.toBeNull();
    expect(verifyClear(l.levelId, l.contentVersion, l.solution)).toBe(true);
    const started = performance.now();
    expect(solve(structuredClone(l))).not.toBeNull();
    expect(performance.now() - started).toBeLessThan(500);
    let state = newSession(l, "dense-proof");
    for (const id of l.solution) {
      state = resolve(l, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
      expect(parseSession(JSON.stringify(state), l)).toEqual(state);
    }
    expect(state.status).toBe("complete");
    expect(state.coins).toBe(25);
  }
}, 120000);
it("old complete and in-progress saves retain rewards, archive recovery data and fit cloud storage", () => {
  const entries: { key: string; raw: string }[] = [];
  for (const [i, old] of beforeDensityLevels.entries())
    for (const complete of [false, true]) {
      let state = newSession(old, "pre-density");
      for (const id of old.solution.slice(
        0,
        complete ? old.solution.length : 3,
      ))
        state = resolve(old, state, {
          id,
          attemptId: state.attemptId,
          type: "select",
          arrowId: id,
        }).state;
      const key = `arowgo.level.${old.levelId}.v1`,
        raw = JSON.stringify(state),
        data = new Map([[key, raw]]),
        l = levels[i + 29];
      const migrated = new SaveStore(
        {
          getItem: (k) => data.get(k) ?? null,
          setItem: (k, v) => {
            data.set(k, v);
          },
        },
        l,
        key,
        [old],
      ).load().state!;
      expect(migrated.coins).toBe(state.coins);
      expect(migrated.bestStars).toBe(state.bestStars);
      expect(migrated.claimed).toBe(state.claimed);
      expect(migrated.active).toHaveLength(l.arrows.length);
      expect(data.get(`${key}.content-${old.contentVersion}`)).toBe(raw);
      expect(
        validatePlayableRestore({
          schemaVersion: 1,
          gameId: "arowgo",
          trust: "unverified-local",
          entries: [{ key, raw }],
        }).entries[0].raw,
      ).toBe(raw);
      if (complete) {
        let replay = migrated;
        for (const id of l.solution)
          replay = resolve(l, replay, {
            id,
            attemptId: replay.attemptId,
            type: "select",
            arrowId: id,
          }).state;
        expect(replay.coins).toBe(25);
        expect(replay.reward).toBe(0);
        expect(verifyClear(old.levelId, old.contentVersion, old.solution)).toBe(
          true,
        );
        entries.push(
          { key, raw: JSON.stringify(migrated) },
          { key: key + ".backup", raw: JSON.stringify(migrated) },
          { key: `${key}.content-${old.contentVersion}`, raw },
        );
      }
    }
  for (const [i, level] of levels.slice(0, 29).entries()) {
    let state = newSession(level, `unchanged-${i}`);
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: state.attemptId,
        type: "select",
        arrowId: id,
      }).state;
    const key =
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`;
    entries.push(
      { key, raw: JSON.stringify(state) },
      { key: key + ".backup", raw: JSON.stringify(state) },
    );
  }
  const snapshot = {
    schemaVersion: 1,
    gameId: "arowgo",
    trust: "unverified-local",
    entries,
  };
  expect(unpackSnapshot(packSnapshot(snapshot)).entries).toEqual(
    [...entries].sort((a, b) => a.key.localeCompare(b.key)),
  );
}, 120000);
it("timing solver matches exhaustive legal-play search on small generated timing states", () => {
  const base: Level = {
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 12,
    levelId: "oracle",
    board: { columns: 10, rows: 10 },
    arrows: Array.from({ length: 6 }, (_, i) => ({
      id: String(i),
      points: [
        [i, 1],
        [i, 0],
      ],
    })),
    solution: [],
  };
  for (let variant = 0; variant < 24; variant++) {
    const l = structuredClone(base);
    l.arrows[4].deadline = 3 + (variant % 4);
    l.arrows[2].requires = "1";
    l.arrows[5].phase = (variant % 2) as 0 | 1;
    l.arrows[3].thawAfter = 1 + (variant % 3);
    const oracle = (active: string[]): boolean => {
      if (!active.length) return true;
      const removed = 6 - active.length;
      if (
        l.arrows.some(
          (a) =>
            active.includes(a.id) &&
            a.deadline !== undefined &&
            removed >= a.deadline,
        )
      )
        return false;
      return active.some(
        (id) =>
          checkExit(l, active, id).clear &&
          oracle(active.filter((a) => a !== id)),
      );
    };
    for (let mask = 0; mask < 64; mask++) {
      const active = l.arrows
        .filter((_, i) => mask & (1 << i))
        .map((a) => a.id);
      expect(solve(l, active) !== null).toBe(oracle(active));
    }
  }
});

it("invalidates timing cache on rule edits and does not expose cached arrays", () => {
  const l: Level = {
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 12,
    levelId: "cache",
    board: { columns: 4, rows: 4 },
    arrows: [
      {
        id: "A",
        points: [
          [0, 1],
          [0, 0],
        ],
        requires: "B",
        deadline: 2,
      },
      {
        id: "B",
        points: [
          [3, 1],
          [3, 0],
        ],
      },
    ],
    solution: ["B", "A"],
  };
  const first = solve(l)!;
  first.pop();
  expect(solve(l)).toEqual(["B", "A"]);
  l.arrows[0].deadline = 1;
  expect(solve(l)).toBeNull();
  delete l.arrows[0].requires;
  expect(solve(l)).toEqual(["A", "B"]);
});
it("evaluates every legal alternative along new solutions without exhausting the solver", () => {
  for (const level of levels.slice(29)) {
    let active = level.arrows.map((a) => a.id);
    for (const chosen of level.solution) {
      for (const id of active.filter(
        (id) => checkExit(level, active, id).clear,
      )) {
        const started = performance.now();
        solve(
          structuredClone(level),
          active.filter((a) => a !== id),
        );
        expect(
          performance.now() - started,
          `${level.levelId} after ${id}`,
        ).toBeLessThan(750);
      }
      active = active.filter((id) => id !== chosen);
    }
  }
}, 120000);

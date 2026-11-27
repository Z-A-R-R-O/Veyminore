import { expect, it } from "vitest";
import {
  checkExit,
  dependencies,
  expand,
  direction,
  validateLevel,
  solve,
  type Level,
} from "../src/domain/rules";
import { legacyFixtures } from "../src/domain/fixtures";
import { levels } from "../src/domain/campaign";
import { beforeSnakeLevels } from "../src/domain/campaignBeforeSnake";
import { newSession, resolve } from "../src/application/session";
import { SaveStore } from "../src/storage/save";
it("bent snakes leave past side blockers that obstructed rigid translation", () => {
  const old = legacyFixtures[5].level;
  const level = { ...old, rulesVersion: 2 as const };
  expect(checkExit(old, ["A", "B"], "A").clear).toBe(false);
  expect(checkExit(level, ["A", "B"], "A").clear).toBe(true);
  expect(dependencies(level).get("A")!.has("B")).toBe(false);
});
it("the nearest head-ray obstacle is reported and the next remains after removal", () => {
  const l: Level = {
    schemaVersion: 1,
    rulesVersion: 2,
    contentVersion: 5,
    levelId: "ray",
    board: { columns: 7, rows: 6 },
    arrows: [
      {
        id: "A",
        points: [
          [0, 0],
          [0, 3],
          [1, 3],
        ],
      },
      {
        id: "B",
        points: [
          [3, 4],
          [3, 2],
        ],
      },
      {
        id: "C",
        points: [
          [5, 4],
          [5, 2],
        ],
      },
    ],
    solution: ["B", "C", "A"],
  };
  validateLevel(l);
  expect(checkExit(l, ["A", "B", "C"], "A")).toMatchObject({
    clear: false,
    blocker: "B",
    cell: [3, 3],
    step: 2,
  });
  expect(checkExit(l, ["A", "C"], "A")).toMatchObject({
    clear: false,
    blocker: "C",
    step: 4,
  });
});
it("dependency solver agrees with an independent cell-by-cell snake simulation", () => {
  for (const l of levels) {
    const ids = l.arrows.map((a) => a.id),
      graph = dependencies(l);
    const masks =
      l === levels[0]
        ? Array.from({ length: 2 ** ids.length - 1 }, (_, i) => i + 1)
        : Array.from(
            { length: 128 },
            (_, i) =>
              ((Math.imul(i + 1, 2654435761) >>> 0) % (2 ** ids.length - 1)) +
              1,
          );
    for (const mask of masks) {
      const active = ids.filter((_, i) => mask & (1 << i));
      for (const id of active) {
        const arrow = l.arrows.find((a) => a.id === id)!;
        let body = expand(arrow);
        const [dx, dy] = direction(arrow);
        const occupied = new Set(
          l.arrows
            .filter((a) => a.id !== id && active.includes(a.id))
            .flatMap(expand)
            .map((c) => c.join(",")),
        );
        const removed = l.arrows.length - active.length;
        const open =
          removed >= (arrow.thawAfter ?? 0) &&
          (arrow.phase === undefined || removed % 2 === arrow.phase) &&
          (arrow.pulse === undefined || removed % 3 === arrow.pulse) &&
          (!arrow.window ||
            (removed >= arrow.window[0] && removed <= arrow.window[1]));
        let clear =
          open &&
          !(arrow.requires && active.includes(arrow.requires)) &&
          !(arrow.anchorRequires && active.includes(arrow.anchorRequires));
        for (
          let tick = 0;
          clear &&
          tick < expand(arrow).length + Math.max(l.board.columns, l.board.rows);
          tick++
        ) {
          const head = body.at(-1)!;
          const next: [number, number] = [head[0] + dx, head[1] + dy];
          if (occupied.has(next.join(","))) {
            clear = false;
            break;
          }
          body = [...body.slice(1), next];
        }
        expect(checkExit(l, active, id).clear).toBe(clear);
        expect(
          open && ![...graph.get(id)!].some((b) => active.includes(b)),
        ).toBe(clear);
      }
    }
  }
}, 30000);
it("rejects authored self-crossing head routes", () => {
  const l = {
    ...levels[0],
    arrows: [
      {
        id: "A",
        points: [
          [3, 0],
          [3, 3],
          [0, 3],
          [0, 1],
          [1, 1],
        ],
      },
    ],
    solution: ["A"],
  };
  expect(() => validateLevel(l)).toThrow("own body");
});
it.each(beforeSnakeLevels)(
  "$levelId migrates an old completed save without losing stars or coins",
  (old) => {
    let state = newSession(old, "old");
    for (const id of old.solution)
      state = resolve(old, state, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    const raw = JSON.stringify(state),
      data = new Map([["s", raw]]),
      next = levels.find((l) => l.levelId === old.levelId)!;
    const saves = new SaveStore(
      {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      next,
      "s",
      old,
    );
    const migrated = saves.load().state!;
    expect(migrated).toMatchObject({
      rulesVersion: 2,
      contentVersion: next.contentVersion,
      coins: 25,
      bestStars: 3,
      claimed: true,
    });
    expect(data.get(`s.content-${old.contentVersion}`)).toBe(raw);
    expect(saves.save(migrated)).toBe(true);
    expect(saves.load().state).toEqual(migrated);
    expect(solve(next)).toBeTruthy();
  },
);

it("preserves partial attempts when only movement rules change", () => {
  const old = beforeSnakeLevels[0];
  let state = newSession(old, "keep-attempt");
  state = resolve(old, state, {
    id: "move",
    attemptId: state.attemptId,
    type: "select",
    arrowId: old.solution[0],
  }).state;
  const data = new Map([["s", JSON.stringify(state)]]);
  const migrated = new SaveStore(
    {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    },
    levels[0],
    "s",
    old,
  ).load().state!;
  expect(migrated.active).toEqual(state.active);
  expect(migrated.attemptId).toBe(state.attemptId);
  expect(migrated.mistakes).toBe(state.mistakes);
});

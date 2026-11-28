import { expect, it } from "vitest";
import { levels } from "../src/domain/campaign";
import { newSession, resolve } from "../src/application/session";
import { rateMove } from "../src/domain/movePraise";
import { checkExit, legalArrows } from "../src/domain/rules";
it("rates actual unlocks and clean finishes across the campaign", () => {
  let praised = 0;
  for (const level of levels) {
    let state = newSession(level, "p");
    for (const id of level.solution) {
      const before = state,
        result = resolve(level, state, {
          type: "select",
          id,
          attemptId: "p",
          arrowId: id,
        });
      state = result.state;
      const rating = rateMove(level, before, result);
      const old = new Set(legalArrows(level, before.active));
      const opened = legalArrows(level, state.active).filter(
        (a) => !old.has(a),
      ).length;
      if (state.status === "complete") expect(rating).toBe("perfect");
      else if (!opened) expect(rating).toBeNull();
      else {
        expect(["good", "great", "brilliant"]).toContain(rating);
        praised++;
      }
      expect(rateMove(level, { ...before, assisted: true }, result)).toBeNull();
    }
  }
  expect(praised).toBeGreaterThan(0);
}, 60000);
it("uses question marks only for failed moves", () => {
  const level = levels[0];
  let state = newSession(level, "p");
  const id = state.active.find(
    (id) => !checkExit(level, state.active, id).clear,
  )!;
  for (let n = 0; n < 3; n++) {
    const result = resolve(level, state, {
      type: "select",
      id: String(n),
      attemptId: "p",
      arrowId: id,
    });
    expect(rateMove(level, state, result)).toBe(
      n === 2 ? "blunder" : "mistake",
    );
    state = result.state;
  }
}, 30000);

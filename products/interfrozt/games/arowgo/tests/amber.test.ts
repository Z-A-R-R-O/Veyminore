import { it, expect } from "vitest";
import { levels } from "../src/domain/campaign";
import { evaluatePlanning } from "../src/domain/planning";
import { newSession, resolve, parseSession } from "../src/application/session";
import { checkExit, solve } from "../src/domain/rules";
it("Amber Dunes adds unique planning puzzles with a gradual measured curve", () => {
  const signatures = new Set(
    levels
      .slice(0, 60)
      .map((l) => JSON.stringify(l.arrows.map((a) => a.points))),
  );
  let previous = evaluatePlanning(levels[59]).randomLegalWinRate;
  for (const l of levels.slice(60)) {
    const signature = JSON.stringify(l.arrows.map((a) => a.points));
    expect(signatures.has(signature)).toBe(false);
    signatures.add(signature);
    const p = evaluatePlanning(l);
    expect(p.randomLegalWinRate).toBeGreaterThan(0);
    expect(p.randomLegalWinRate).toBeLessThan(previous);
    previous = p.randomLegalWinRate;
    expect(p.blockedTargetDecisions).toBeGreaterThan(0);
    const d = p.exampleDecision!;
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
    expect(l.arrows.length).toBeLessThanOrEqual(18);
    let state = newSession(l, "amber-proof");
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
});

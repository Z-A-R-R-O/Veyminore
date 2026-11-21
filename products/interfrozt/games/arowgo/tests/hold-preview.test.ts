import { it, expect, vi } from "vitest";
import { inspectArrow } from "../src/domain/preview";
import * as rules from "../src/domain/rules";
import { levels } from "../src/domain/campaign";
import { evaluatePlanning } from "../src/domain/planning";
it("shows observable changes without solving or mutating the board", () => {
  const level = levels[79],
    active = level.arrows.map((a) => a.id),
    before = JSON.stringify({ level, active });
  const spy = vi.spyOn(rules, "solve").mockImplementation(() => {
    throw Error("Preview must not solve");
  });
  try {
    const p = inspectArrow(level, active, level.solution[0]);
    expect(p.exit.clear).toBe(true);
    for (const c of p.changes)
      expect(c.after).toBe(
        c.kind === "phase" ? 1 - c.before : Math.max(0, c.before - 1),
      );
    expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify({ level, active })).toBe(before);
  } finally {
    spy.mockRestore();
  }
});
it("does not distinguish winning and losing legal continuations", () => {
  const l = levels[79],
    d = evaluatePlanning(l).exampleDecision!;
  for (const id of [d.safeMove, d.unsafeMove]) {
    const p = inspectArrow(l, d.active, id);
    expect(p.title).toBe("Path open");
    expect(JSON.stringify(p)).not.toMatch(
      /winning|correct|best move|safe move/i,
    );
  }
});
it("blocked arrows predict no removal; key and anchor links stay visible", () => {
  const l = levels[79],
    active = l.arrows.map((a) => a.id);
  for (const arrow of l.arrows) {
    const p = inspectArrow(l, active, arrow.id);
    if (!p.exit.clear) expect(p.changes).toEqual([]);
    expect(p.linked).toEqual(
      l.arrows
        .filter((a) => a.requires === arrow.id || a.anchorRequires === arrow.id)
        .map((a) => a.id),
    );
  }
});

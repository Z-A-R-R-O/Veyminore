import { checkExit, switchOpen, type Level } from "../src/domain/rules";
export function switchTraps(l: Level) {
  let active = l.arrows.map((a) => a.id);
  const found = new Map<
    number,
    { active: string[]; move: string; gate: string }
  >();
  for (const move of l.solution) {
    for (const a of l.arrows.filter(
      (a) => a.switchGroup !== undefined && active.includes(a.id),
    )) {
      if (!checkExit(l, active, a.id).clear) continue;
      const after = active.filter((id) => id !== a.id),
        group = a.switchGroup!;
      const gate = l.arrows.find(
        (g) =>
          g.gate?.group === group &&
          after.includes(g.id) &&
          !switchOpen(l, after, g.id),
      );
      if (
        gate &&
        !l.arrows.some((s) => s.switchGroup === group && after.includes(s.id))
      )
        found.set(group, { active: [...active], move: a.id, gate: gate.id });
    }
    active = active.filter((id) => id !== move);
  }
  return [...found.entries()].map(([group, witness]) => ({
    group,
    ...witness,
  }));
}

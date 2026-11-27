import { switchChecker } from "./rules";
import { timingOpen, dependencies, type Level } from "./rules";

export interface PlanningDecision {
  active: string[];
  safeMove: string;
  unsafeMove: string;
}

/** Exact random-legal-play baseline, not a prediction of human success.
 * Geometry alone is monotone: it has probability 1, however dense it looks.
 * A planning decision has both a winning and a losing legal continuation.
 */
export function evaluatePlanning(level: Level) {
  const gateOpen = switchChecker(level);
  const n = level.arrows.length;
  if (n > 28) throw new Error("Planning analysis supports at most 28 arrows");
  const graph = dependencies(level);
  const ids = level.arrows.map((a) => a.id);
  const bit = new Map(ids.map((id, i) => [id, 1 << i]));
  const blockers = ids.map((id) =>
    [...graph.get(id)!].reduce((mask, id) => mask | bit.get(id)!, 0),
  );
  const memo = new Map<number, number>();
  let exampleDecision: PlanningDecision | null = null;
  let decisionStates = 0,
    blockedTargetDecisions = 0,
    earliestDecisionMove = n + 1;
  function probability(mask: number, removed: number): number {
    if (!mask) return 1;
    const cached = memo.get(mask);
    if (cached !== undefined) return cached;
    if (
      level.arrows.some(
        (a, i) =>
          mask & (1 << i) && a.deadline !== undefined && removed >= a.deadline,
      )
    )
      return 0;
    if (memo.size > 1100000)
      throw new Error("Planning analysis budget exhausted");
    const legal = ids
      .map((_, i) => i)
      .filter(
        (i) =>
          mask & (1 << i) &&
          !(blockers[i] & mask) &&
          timingOpen(level.arrows[i], removed) &&
          gateOpen(i, mask),
      );
    const outcomes = legal.map((i) =>
      probability(mask & ~(1 << i), removed + 1),
    );
    const result = outcomes.reduce((a, b) => a + b, 0) / (legal.length || 1);
    if (outcomes.some((p) => p > 0) && outcomes.some((p) => p === 0)) {
      decisionStates++;
      if (removed + 1 < earliestDecisionMove) {
        earliestDecisionMove = removed + 1;
        exampleDecision = {
          active: ids.filter((_, i) => mask & (1 << i)),
          safeMove: ids[legal[outcomes.findIndex((p) => p > 0)]],
          unsafeMove: ids[legal[outcomes.findIndex((p) => p === 0)]],
        };
      }
      if (
        level.arrows.some(
          (a, i) =>
            a.deadline !== undefined && mask & (1 << i) && blockers[i] & mask,
        )
      )
        blockedTargetDecisions++;
    }
    memo.set(mask, result);
    return result;
  }
  const randomLegalWinRate = probability((1 << n) - 1, 0);
  const prerequisites = (id: string, seen = new Set<string>()): Set<string> => {
    for (const parent of graph.get(id)!)
      if (!seen.has(parent)) {
        seen.add(parent);
        prerequisites(parent, seen);
      }
    return seen;
  };
  return {
    randomLegalWinRate,
    decisionStates,
    blockedTargetDecisions,
    exampleDecision: exampleDecision as PlanningDecision | null,
    earliestDecisionMove: decisionStates ? earliestDecisionMove : null,
    openingChoices: ids
      .filter(
        (_, i) =>
          !blockers[i] &&
          timingOpen(level.arrows[i], 0) &&
          gateOpen(i, (1 << n) - 1),
      )
      .map((id) => ({
        id,
        winning: probability(((1 << n) - 1) & ~bit.get(id)!, 1) > 0,
      })),
    analyzedStates: memo.size,
    deadlines: level.arrows
      .filter((a) => a.deadline !== undefined)
      .map((a) => ({
        id: a.id,
        prerequisiteCount: prerequisites(a.id).size,
        deadline: a.deadline!,
        spareMoves: a.deadline! - prerequisites(a.id).size - 1,
      })),
  };
}

/** Add genuine order decisions without changing geometry or increasing arrow count. */
export function planDeadlines(source: Level, number: number) {
  if (!Number.isInteger(number) || number < 10 || number > 60)
    throw new Error("Planning campaign range is 10–60");
  const base = {
    ...source,
    contentVersion: 9,
    arrows: source.arrows.map(({ deadline, ...a }) => ({ ...a })),
  };
  const graph = dependencies(base);
  const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
    for (const p of graph.get(id)!)
      if (!seen.has(p)) {
        seen.add(p);
        ancestors(p, seen);
      }
    return seen;
  };
  const eligible = base.arrows
    .filter(
      (a) =>
        !a.requires &&
        !a.anchorRequires &&
        !base.arrows.some(
          (b) => b.requires === a.id || b.anchorRequires === a.id,
        ),
    )
    .map((a) => ({ id: a.id, parents: ancestors(a.id) }))
    .filter(
      (a) => a.parents.size >= 2 && a.parents.size <= base.arrows.length - 5,
    );
  const targetWinRate =
    number <= 40
      ? 0.6 * Math.pow(0.06 / 0.6, (number - 10) / 30)
      : 0.08 * Math.pow(0.025 / 0.08, (number - 41) / 19);
  const count = number < 25 ? 1 : 2;
  let best:
    | {
        level: Level;
        analysis: ReturnType<typeof evaluatePlanning>;
        cost: number;
      }
    | undefined;
  for (let i = 0; i < eligible.length; i++)
    for (
      let j = count === 1 ? i : i + 1;
      j < (count === 1 ? i + 1 : eligible.length);
      j++
    ) {
      const selected = count === 1 ? [eligible[i]] : [eligible[i], eligible[j]];
      // Reject duplicate prerequisite sets; nested chains can still carry two distinct deadlines.
      if (
        count === 2 &&
        selected[0].parents.size === selected[1].parents.size &&
        [...selected[0].parents].every((id) => selected[1].parents.has(id))
      )
        continue;
      const minSlack = number <= 14 ? 2 : number <= 19 ? 1 : 0;
      for (let slack = minSlack; slack <= 10; slack++) {
        const level: Level = {
          ...base,
          arrows: base.arrows.map((a) => {
            const index = selected.findIndex((x) => x.id === a.id);
            return index < 0
              ? a
              : {
                  ...a,
                  deadline: Math.min(
                    base.arrows.length,
                    selected[index].parents.size + 1 + slack + (index ? 2 : 0),
                  ),
                };
          }),
        };
        const analysis = evaluatePlanning(level);
        if (
          !analysis.randomLegalWinRate ||
          analysis.randomLegalWinRate >= 0.8 ||
          !analysis.blockedTargetDecisions
        )
          continue;
        if (number <= 14 && (analysis.earliestDecisionMove ?? 0) < 3) continue;
        // Both counters must matter: removing either must improve the random-legal baseline.
        if (
          count === 2 &&
          selected.some(
            (item) =>
              evaluatePlanning({
                ...level,
                arrows: level.arrows.map((a) =>
                  a.id === item.id ? { ...a, deadline: undefined } : a,
                ),
              }).randomLegalWinRate <=
              analysis.randomLegalWinRate + 0.001,
          )
        )
          continue;
        const cost = Math.abs(
          Math.log(analysis.randomLegalWinRate / targetWinRate),
        );
        if (!best || cost < best.cost) best = { level, analysis, cost };
      }
    }
  if (!best) throw new Error("No meaningful planning candidate for " + number);
  return { ...best, targetWinRate };
}

import { switchChecker } from "./rules";
import { evaluatePlanning } from "./planning";
import { evaluateDifficulty, evaluateLayout } from "./generator";
import { dependencies, timingOpen, type Level } from "./rules";

export const RATING_VERSION = 1;
export const weights = {
  risk: 300,
  horizon: 250,
  dependency: 200,
  timing: 150,
  density: 100,
};
export type Components = Record<keyof typeof weights, number>;

/** Longest legal survival after the earliest witnessed losing choice.
 * This is a failure horizon, NOT a proof of required human lookahead. */
export function measureDifficulty(level: Level) {
  const gateOpen = switchChecker(level);
  const planning = evaluatePlanning(level);
  const geometry = evaluateDifficulty(level);
  const layout = evaluateLayout(level);
  let horizon = 0;
  if (planning.exampleDecision) {
    const { active, unsafeMove } = planning.exampleDecision;
    const graph = dependencies(level),
      ids = level.arrows.map((a) => a.id);
    const bits = new Map(ids.map((id, i) => [id, 1 << i]));
    const masks = ids.map((id) =>
      [...graph.get(id)!].reduce((v, id) => v | bits.get(id)!, 0),
    );
    const memo = new Map<number, number>();
    const walk = (mask: number, removed: number): number => {
      if (
        !mask ||
        level.arrows.some(
          (a, i) =>
            mask & (1 << i) &&
            a.deadline !== undefined &&
            removed >= a.deadline,
        )
      )
        return 0;
      const cached = memo.get(mask);
      if (cached !== undefined) return cached;
      if (memo.size > 200000)
        throw Error("Difficulty horizon analysis budget exhausted");
      let longest = 0;
      for (let i = 0; i < ids.length; i++)
        if (
          mask & (1 << i) &&
          !(mask & masks[i]) &&
          timingOpen(level.arrows[i], removed) &&
          gateOpen(i, mask)
        )
          longest = Math.max(longest, 1 + walk(mask & ~(1 << i), removed + 1));
      memo.set(mask, longest);
      return longest;
    };
    const mask = active
      .filter((id) => id !== unsafeMove)
      .reduce((m, id) => m | bits.get(id)!, 0);
    horizon = 1 + walk(mask, ids.length - active.length + 1);
  }
  const slack = planning.deadlines.map((d) => d.spareMoves);
  const density =
    layout.occupiedCells / (level.board.columns * level.board.rows);
  const components: Components = {
    risk:
      planning.randomLegalWinRate > 0
        ? -Math.log10(planning.randomLegalWinRate)
        : 0,
    horizon,
    dependency: geometry.depth,
    timing: slack.length
      ? slack.reduce((v, s) => v + 1 / (Math.max(0, s) + 1), 0)
      : 0,
    density,
  };
  return {
    components,
    solvable: planning.randomLegalWinRate > 0,
    arrows: level.arrows.length,
    occupiedCells: layout.occupiedCells,
    cells: level.board.columns * level.board.rows,
    dependencyDepth: geometry.depth,
    failureHorizon: horizon,
    randomLegalWinRate: planning.randomLegalWinRate,
    openingLegal: planning.openingChoices.length,
    openingWinning: planning.openingChoices.filter((c) => c.winning).length,
    openingLosing: planning.openingChoices.filter((c) => !c.winning).length,
    minimumSlack: slack.length ? Math.min(...slack) : null,
    analyzedStates: planning.analyzedStates,
  };
}
export function rateDifficulty(
  measurement: ReturnType<typeof measureDifficulty>,
  calibration: Components,
) {
  if (!measurement.solvable) throw Error("Cannot rate an unsolvable puzzle");
  const contributions = Object.fromEntries(
    (Object.keys(weights) as (keyof Components)[]).map((key) => [
      key,
      Math.round(
        weights[key] *
          Math.min(
            1,
            Math.max(0, measurement.components[key] / calibration[key]),
          ),
      ),
    ]),
  ) as Components;
  return {
    version: RATING_VERSION,
    status: "exact" as const,
    score: Object.values(contributions).reduce((a, b) => a + b, 0),
    contributions,
    ...measurement,
  };
}

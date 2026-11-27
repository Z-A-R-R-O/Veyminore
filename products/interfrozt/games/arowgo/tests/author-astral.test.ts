import {
  measureDifficulty,
  rateDifficulty,
} from "../src/domain/difficultyRating";
import calibration from "../content/difficulty-calibration-v1.json";
import { it, expect } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import {
  generatePuzzle,
  evaluateLayout,
  evaluateDifficulty,
  fillUnusedCells,
} from "../src/domain/generator";
import { evaluatePlanning } from "../src/domain/planning";
import {
  solve,
  validateLevel,
  dependencies,
  type Level,
} from "../src/domain/rules";
import baselineRaw from "../content/levels/clockwork/level-130.json";
const baseline = validateLevel(baselineRaw);
it("authors Astral Observatory levels", () => {
  if (process.env.AROWGO_ASTRAL !== "1") return;
  mkdirSync("content/levels/astral", { recursive: true });
  const report = [];
  let previous = evaluatePlanning(baseline).randomLegalWinRate;
  for (let number = 141; number <= 180; number++) {
    const output = `content/levels/astral/level-${number}.json`;
    if (existsSync(output)) {
      const saved = JSON.parse(readFileSync(output, "utf8"));
      validateLevel(saved);
      previous = evaluatePlanning(saved).randomLegalWinRate;
      report.push(saved.generation.metrics);
      continue;
    }
    const old = baseline;
    const count = 28;
    const target = Math.min(
      evaluatePlanning(old).randomLegalWinRate * 0.65,
      0.000001 * Math.pow(0.9, number - 141),
    );
    let best:
      | {
          level: Level;
          cost: number;
          analysis: ReturnType<typeof evaluatePlanning>;
        }
      | undefined;
    for (let retry = 0; retry < 80; retry++) {
      let base: Level;
      try {
        base = generatePuzzle(
          271126 + number * 1297 + retry * 71,
          count,
          260 + (number - 141) * 6,
          `astral-${number}`,
          {
            connectedPlacement: true,
            openingMoves: [2, 12],
            depthRange: [9, 28],
            keyLockPairs: 1,
            minimumOccupiedCells: 68,
          },
        );
      } catch (e) {
        if (String(e).includes("Generation budget")) {
          console.log("retry", number, retry);
          continue;
        }
        throw e;
      }
      console.log("geometry", number, retry, evaluateLayout(base));
      base = fillUnusedCells(base, 92);
      if (evaluateLayout(base).occupiedCells < 89) continue;
      base.contentVersion = 13;
      const order = solve(base)!;
      const used = new Set(
        base.arrows.flatMap((a) => (a.requires ? [a.id, a.requires] : [])),
      );
      const source = order.find((id) => !used.has(id))!;
      for (const id of order
        .slice(order.indexOf(source) + 2)
        .filter((id) => !used.has(id))
        .slice(0, 2))
        base.arrows.find((a) => a.id === id)!.anchorRequires = source;
      const graph = dependencies(base);
      const ancestors = (id: string, seen = new Set<string>()): Set<string> => {
        for (const p of graph.get(id)!)
          if (!seen.has(p)) {
            seen.add(p);
            ancestors(p, seen);
          }
        return seen;
      };
      const eligible = order.filter(
        (id, j) =>
          j >= 3 &&
          ancestors(id).size >= 2 &&
          !used.has(id) &&
          id !== source &&
          !base.arrows.find((a) => a.id === id)!.anchorRequires,
      );
      if (eligible.length < 2) continue;
      for (let trial = 0; trial < 60; trial++) {
        let seed = number * 8791 + retry * 331 + trial * 71;
        const rnd = (n: number) => {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          return Math.floor((seed / 4294967296) * n);
        };
        const l = structuredClone(base);
        const poolIds = [...eligible];
        for (let j = poolIds.length - 1; j > 0; j--) {
          const k = rnd(j + 1);
          [poolIds[j], poolIds[k]] = [poolIds[k], poolIds[j]];
        }
        const selected = poolIds.slice(0, number >= 151 ? 3 : 2);
        for (const id of selected)
          l.arrows.find((a) => a.id === id)!.deadline =
            trial % 2
              ? order.indexOf(id) + 1 + rnd(3)
              : ancestors(id).size + 1 + rnd(4);
        for (const a of l.arrows)
          if (a.deadline !== undefined)
            a.deadline = Math.min(count, a.deadline);
        if (number >= 41) {
          const pool = order.filter(
            (id) =>
              !selected.includes(id) &&
              !used.has(id) &&
              id !== source &&
              !l.arrows.find((a) => a.id === id)!.anchorRequires &&
              order.indexOf(id) > 1,
          );
          for (const id of pool.slice(0, 2))
            l.arrows.find((a) => a.id === id)!.thawAfter = Math.max(
              1,
              order.indexOf(id) - rnd(3),
            );
          if (number >= 46)
            for (const id of pool.slice(2, 5))
              l.arrows.find((a) => a.id === id)!.phase = (order.indexOf(id) %
                2) as 0 | 1;
        }
        try {
          let solution = solve(l);
          if (!solution) continue;
          const free = solution.filter((id) => {
            const a = l.arrows.find((a) => a.id === id)!;
            return (
              id !== source &&
              !used.has(id) &&
              a.phase === undefined &&
              a.thawAfter === undefined &&
              !a.requires &&
              !a.anchorRequires &&
              a.deadline === undefined
            );
          });
          const pulses = number >= 161 ? 5 : 4;
          for (const id of free.slice(0, pulses))
            l.arrows.find((a) => a.id === id)!.pulse = (solution.indexOf(id) %
              3) as 0 | 1 | 2;
          if (number >= 141)
            for (const id of free.slice(
              pulses,
              pulses + (number >= 151 ? 4 : 3),
            )) {
              const position = solution.indexOf(id),
                slack = number >= 161 ? 0 : 1;
              l.arrows.find((a) => a.id === id)!.window = [
                Math.max(0, position - slack),
                Math.min(27, position + slack),
              ];
            }
          solution = solve(l);
          if (!solution) continue;
          l.solution = solution;
          const analysis = evaluatePlanning(l);
          const rating = rateDifficulty(measureDifficulty(l), calibration);
          if (rating.score < 700 + Math.floor((number - 141) / 10) * 20)
            continue;
          if (
            !analysis.blockedTargetDecisions ||
            analysis.randomLegalWinRate <= 0 ||
            analysis.randomLegalWinRate >=
              evaluatePlanning(old).randomLegalWinRate
          )
            continue;
          const cost = Math.abs(Math.log(analysis.randomLegalWinRate / target));
          if (!best || cost < best.cost) best = { level: l, cost, analysis };
          if (best) break;
        } catch (e) {
          if (/budget exhausted/.test(String(e))) continue;
          throw e;
        }
      }
      if (best) break;
    }
    expect(best, `Level ${number} count ${count}`).toBeTruthy();
    if (!best) throw Error(`No candidate ${number}`);
    best.level = fillUnusedCells(
      best.level,
      Math.min(95, 92 + Math.floor((number - 141) / 10)),
    );
    validateLevel(best.level);
    expect(evaluatePlanning(best.level).randomLegalWinRate).toBe(
      best.analysis.randomLegalWinRate,
    );
    previous = best.analysis.randomLegalWinRate;
    const metrics = {
      level: number,
      count,
      ...evaluateLayout(best.level),
      ...evaluateDifficulty(best.level),
      rate: previous,
      target,
    };
    writeFileSync(
      `content/levels/astral/level-${number}.json`,
      JSON.stringify(
        {
          ...best.level,
          generation: {
            astralAuthorVersion: 1,
            metrics,
            planning: best.analysis,
          },
        },
        null,
        2,
      ) + "\n",
    );
    report.push(metrics);
    console.log(metrics);
  }
  // Stage each ten-level block in measured-score order, not generation order.
  const ordered = Array.from({ length: 40 }, (_, i) =>
    JSON.parse(
      readFileSync(`content/levels/astral/level-${141 + i}.json`, "utf8"),
    ),
  )
    .map((raw) => ({
      raw,
      rating: rateDifficulty(measureDifficulty(raw), calibration),
    }))
    .sort(
      (a, b) =>
        Math.floor((a.raw.generation.metrics.level - 141) / 10) -
          Math.floor((b.raw.generation.metrics.level - 141) / 10) ||
        a.rating.score - b.rating.score,
    );
  ordered.forEach(({ raw, rating }, i) => {
    raw.generation.sourceLevelId ??= raw.levelId;
    raw.levelId = `astral-${141 + i}`;
    raw.generation.metrics.level = 141 + i;
    raw.generation.rating = rating;
    writeFileSync(
      `content/levels/astral/level-${141 + i}.json`,
      JSON.stringify(raw, null, 2) + "\n",
    );
  });
  writeFileSync(
    "content/levels/astral/report.json",
    JSON.stringify(
      ordered.map(({ raw, rating }) => ({
        ...raw.generation.metrics,
        rating: rating.score,
      })),
      null,
      2,
    ) + "\n",
  );
}, 3600000);

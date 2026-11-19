import { it, expect } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import {
  generatePuzzle,
  evaluateLayout,
  evaluateDifficulty,
} from "../src/domain/generator";
import { evaluatePlanning } from "../src/domain/planning";
import {
  solve,
  validateLevel,
  dependencies,
  type Level,
} from "../src/domain/rules";
import { beforeDensityLevels } from "../src/domain/campaignBeforeDensity";
it("authors dense planning campaign candidates", () => {
  if (process.env.AROWGO_DENSE !== "1") return;
  mkdirSync("content/candidates/dense", { recursive: true });
  const report = [];
  let previous = Infinity;
  for (let number = 30; number <= 80; number++) {
    const output = `content/candidates/dense/level-${number}.json`;
    if (existsSync(output)) {
      const saved = JSON.parse(readFileSync(output, "utf8"));
      validateLevel(saved);
      previous = evaluatePlanning(saved).randomLegalWinRate;
      report.push(saved.generation.metrics);
      continue;
    }
    const old = beforeDensityLevels[number - 30];
    const count = 20 + Math.floor(((number - 30) * 8) / 50);
    const target = Math.min(
      evaluatePlanning(old).randomLegalWinRate * 0.65,
      previous * 0.94,
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
          191126 + number * 997 + retry * 71,
          count,
          190 + (number - 30) * 3,
          old.levelId,
          {
            connectedPlacement: true,
            openingMoves: [2, 12],
            depthRange: [4 + Math.floor((number - 30) / 15), 28],
            keyLockPairs: 1,
            minimumOccupiedCells: 52 + Math.floor((number - 30) * 0.34),
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
      base.contentVersion = 12;
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
      for (let trial = 0; trial < 180; trial++) {
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
        const selected = poolIds.slice(0, 2);
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
            for (const id of pool.slice(
              2,
              2 + Math.min(4, 1 + Math.floor((number - 46) / 10)),
            ))
              l.arrows.find((a) => a.id === id)!.phase = (order.indexOf(id) %
                2) as 0 | 1;
        }
        try {
          const solution = solve(l);
          if (!solution) continue;
          l.solution = solution;
          const analysis = evaluatePlanning(l);
          if (
            !analysis.blockedTargetDecisions ||
            analysis.randomLegalWinRate <= 0 ||
            analysis.randomLegalWinRate >= previous ||
            analysis.randomLegalWinRate >=
              evaluatePlanning(old).randomLegalWinRate
          )
            continue;
          const cost = Math.abs(Math.log(analysis.randomLegalWinRate / target));
          if (!best || cost < best.cost) best = { level: l, cost, analysis };
          if (cost < 0.2) break;
        } catch (e) {
          if (/budget exhausted/.test(String(e))) continue;
          throw e;
        }
      }
      if (best && best.cost < 0.2) break;
    }
    expect(best, `Level ${number} count ${count}`).toBeTruthy();
    if (!best) throw Error(`No candidate ${number}`);
    validateLevel(best.level);
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
      `content/candidates/dense/level-${number}.json`,
      JSON.stringify(
        {
          ...best.level,
          generation: {
            densityAuthorVersion: 1,
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
  writeFileSync(
    "content/candidates/dense/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 1800000);

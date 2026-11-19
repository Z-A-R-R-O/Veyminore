import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePuzzle } from "../src/domain/generator";
import { planDeadlines, evaluatePlanning } from "../src/domain/planning";
import {
  solve,
  validateLevel,
  dependencies,
  type Level,
} from "../src/domain/rules";
it("authors twenty distinct Amber Dunes candidates", () => {
  if (process.env.AROWGO_AMBER !== "1") return;
  mkdirSync("content/candidates/amber", { recursive: true });
  const report = [];
  let previousRate = 0.0015006261751942113;
  for (let i = 0; i < 20; i++) {
    const number = 61 + i,
      target = 0.00135 * Math.pow(0.00035 / 0.00135, i / 19);
    let best:
      | {
          level: Level;
          analysis: ReturnType<typeof evaluatePlanning>;
          score: number;
          seed: number;
        }
      | undefined;
    for (let retry = 0; retry < 30; retry++) {
      const seed = 811926 + i * 1297 + retry * 71;
      let base: Level;
      try {
        base = generatePuzzle(
          seed,
          17 + Math.floor(i / 10),
          150 + i,
          `amber-${number}`,
          { connectedPlacement: true, openingMoves: [2, 5], keyLockPairs: 1 },
        );
        const order = solve(base)!,
          graph = dependencies(base);
        const occupied = new Set(
          base.arrows.flatMap((a) => (a.requires ? [a.id, a.requires] : [])),
        );
        const source = order.find(
          (id, j) =>
            !occupied.has(id) &&
            order
              .slice(j + 1)
              .some((t) => !occupied.has(t) && !graph.get(t)!.has(id)),
        );
        if (!source) continue;
        for (const id of order
          .slice(order.indexOf(source) + 1)
          .filter((t) => !occupied.has(t) && !graph.get(t)!.has(source))
          .slice(0, 2))
          base.arrows.find((a) => a.id === id)!.anchorRequires = source;
        base = planDeadlines(base, 60).level;
      } catch (e) {
        if (
          e instanceof Error &&
          /Generation budget|No meaningful/.test(e.message)
        )
          continue;
        throw e;
      }
      const order = solve(base)!;
      const sources = new Set(
        base.arrows
          .flatMap((a) => [a.requires, a.anchorRequires])
          .filter(Boolean),
      );
      const eligible = base.arrows
        .filter(
          (a) =>
            a.deadline === undefined &&
            !a.requires &&
            !a.anchorRequires &&
            !sources.has(a.id) &&
            order.indexOf(a.id) >= 2,
        )
        .map((a) => a.id);
      if (eligible.length < 5) continue;
      for (let trial = 0; trial < 140; trial++) {
        let randomSeed = seed + trial * 193;
        const random = () => {
          randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) >>> 0;
          return randomSeed / 4294967296;
        };
        const pool = [...eligible];
        for (let j = pool.length - 1; j > 0; j--) {
          const k = Math.floor(random() * (j + 1));
          [pool[j], pool[k]] = [pool[k], pool[j]];
        }
        const l = structuredClone(base);
        l.contentVersion = 11;
        for (const id of pool.slice(0, 2))
          l.arrows.find((a) => a.id === id)!.thawAfter =
            2 + Math.floor(random() * 7);
        for (const id of pool.slice(2, 5))
          l.arrows.find((a) => a.id === id)!.phase = (order.indexOf(id) % 2) as
            | 0
            | 1;
        for (const a of l.arrows.filter((a) => a.deadline !== undefined))
          a.deadline = Math.max(1, a.deadline! - Math.floor(random() * 4));
        const solution = solve(l);
        if (!solution) continue;
        l.solution = solution;
        const analysis = evaluatePlanning(l);
        if (
          analysis.randomLegalWinRate <= 0 ||
          analysis.randomLegalWinRate >= previousRate ||
          !analysis.blockedTargetDecisions
        )
          continue;
        const score = Math.abs(Math.log(analysis.randomLegalWinRate / target));
        if (!best || score < best.score)
          best = { level: l, analysis, score, seed };
        if (score < 0.12) break;
      }
      if (best && best.score < 0.12) break;
    }
    expect(best, `Level ${number}`).toBeTruthy();
    if (!best) throw Error(`No candidate ${number}`);
    validateLevel(best.level);
    previousRate = best.analysis.randomLegalWinRate;
    writeFileSync(
      `content/candidates/amber/level-${number}.json`,
      JSON.stringify(
        {
          ...best.level,
          generation: {
            amberAuthorVersion: 1,
            seed: best.seed,
            targetWinRate: target,
            planning: best.analysis,
          },
        },
        null,
        2,
      ) + "\n",
    );
    report.push({
      level: number,
      seed: best.seed,
      rate: previousRate,
      target,
      decisionStates: best.analysis.decisionStates,
    });
    console.log(report.at(-1));
  }
  writeFileSync(
    "content/candidates/amber/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 1200000);

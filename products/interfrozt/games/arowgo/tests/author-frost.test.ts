import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePuzzle, evaluateDifficulty } from "../src/domain/generator";
import { planDeadlines } from "../src/domain/planning";
import { solve, validateLevel, dependencies } from "../src/domain/rules";
it("authors Frostfall candidates with measured planning decisions", () => {
  if (process.env.AROWGO_FROST !== "1") return;
  mkdirSync("content/candidates/frost", { recursive: true });
  const report = [];
  for (let i = 0; i < 20; i++) {
    const n = 41 + i;
    let result;
    for (let retry = 0; retry < 30; retry++) {
      try {
        const base = generatePuzzle(
          261119 + i * 991 + retry * 137,
          16 + Math.floor(i / 7),
          120 + i,
          `frost-${n}`,
          { connectedPlacement: true, openingMoves: [2, 5], keyLockPairs: 1 },
        );
        const order = solve(base)!;
        const graph = dependencies(base);
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
        if (source) {
          const targets = order
            .slice(order.indexOf(source) + 1)
            .filter((t) => !occupied.has(t) && !graph.get(t)!.has(source))
            .slice(0, i < 5 ? 1 : 2);
          for (const id of targets)
            base.arrows.find((a) => a.id === id)!.anchorRequires = source;
        }
        const planned = planDeadlines(base, n);
        if (
          planned.analysis.randomLegalWinRate > 0.14 ||
          planned.analysis.randomLegalWinRate < 0.012
        )
          continue;
        planned.level.solution = solve(planned.level)!;
        validateLevel(planned.level);
        result = planned;
        break;
      } catch (e) {
        if (
          !(e instanceof Error) ||
          !/Generation budget|No meaningful/.test(e.message)
        )
          throw e;
      }
    }
    if (!result) throw Error(`No candidate ${n}`);
    const level = {
      ...result.level,
      contentVersion: 9,
      generation: {
        frostAuthorVersion: 1,
        planning: result.analysis,
        targetWinRate: result.targetWinRate,
        difficulty: evaluateDifficulty(result.level),
      },
    };
    validateLevel(level);
    expect(level.solution).toHaveLength(level.arrows.length);
    writeFileSync(
      `content/candidates/frost/level-${n}.json`,
      JSON.stringify(level, null, 2) + "\n",
    );
    report.push({ number: n, ...level.generation });
    console.log(n, result.analysis.randomLegalWinRate);
  }
  writeFileSync(
    "content/candidates/frost/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 600000);

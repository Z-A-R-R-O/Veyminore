import { it, expect } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import archived from "../content/levels/before-hardening.json";
import { evaluatePlanning } from "../src/domain/planning";
import { solve, validateLevel } from "../src/domain/rules";
it("authors harder candidates without adding arrows", () => {
  if (process.env.AROWGO_HARDEN !== "1") return;
  mkdirSync("content/candidates/harder", { recursive: true });
  const report = [];
  for (const [i, raw] of archived.entries()) {
    const old = validateLevel(raw),
      before = evaluatePlanning(old);
    const target = Math.min(
      before.randomLegalWinRate * 0.45,
      0.018 * Math.pow(0.0015 / 0.018, i / 20),
    );
    let best,
      cost = Infinity;
    const counters = old.arrows.filter((a) => a.deadline !== undefined);
    for (let variant = 0; variant < 64; variant++)
      for (let x = -2; x <= 6; x++)
        for (let y = -2; y <= 6; y++) {
          if (x + y + variant === 0) continue;
          const candidate = structuredClone(old);
          candidate.contentVersion = 11;
          for (const [j, a] of counters.entries())
            candidate.arrows.find((b) => b.id === a.id)!.deadline = Math.max(
              1,
              a.deadline! - (j === 0 ? x : y),
            );
          if (variant >= 24) {
            const gates = candidate.arrows.filter((a) => a.phase !== undefined);
            const sources = new Set(
              candidate.arrows.flatMap((a) => [a.requires, a.anchorRequires]),
            );
            for (const a of gates) delete a.phase;
            const pool = candidate.arrows.filter(
              (a) =>
                a.deadline === undefined &&
                a.thawAfter === undefined &&
                !a.requires &&
                !a.anchorRequires &&
                !sources.has(a.id),
            );
            for (let g = 0; g < gates.length; g++) {
              const a = pool[(variant + g * 3) % pool.length];
              if (a) a.phase = (old.solution.indexOf(a.id) % 2) as 0 | 1;
            }
          }
          if (variant >= 40 && i >= 6) {
            const pool = candidate.arrows.filter(
              (a) =>
                a.phase === undefined &&
                a.thawAfter === undefined &&
                a.deadline === undefined &&
                !a.requires &&
                !a.anchorRequires &&
                !candidate.arrows.some(
                  (b) => b.requires === a.id || b.anchorRequires === a.id,
                ),
            );
            const a = pool[variant % pool.length];
            if (a) a.phase = (old.solution.indexOf(a.id) % 2) as 0 | 1;
          }
          const frozen = candidate.arrows.filter(
            (a) => a.thawAfter !== undefined,
          );
          if (variant > 0)
            for (const [j, a] of frozen.entries())
              a.thawAfter = Math.min(
                candidate.arrows.length - 1,
                Math.max(1, a.thawAfter! + ((variant + j * 3) % 7) - 2),
              );
          if (variant >= 12 && variant < 24)
            for (const a of candidate.arrows.filter(
              (a) => a.phase !== undefined,
            ))
              a.phase = (1 - a.phase!) as 0 | 1;
          const solution = solve(candidate);
          if (!solution) continue;
          candidate.solution = solution;
          const analysis = evaluatePlanning(candidate);
          if (
            analysis.randomLegalWinRate >= before.randomLegalWinRate * 0.8 ||
            !analysis.blockedTargetDecisions
          )
            continue;
          const score = Math.abs(
            Math.log(analysis.randomLegalWinRate / target),
          );
          if (score < cost) {
            best = { level: candidate, analysis };
            cost = score;
          }
        }
    expect(best, `candidate ${i + 40}`).toBeTruthy();
    if (!best) throw Error("Missing candidate");
    validateLevel(best.level);
    const out = {
      ...best.level,
      generation: {
        hardeningVersion: 1,
        targetWinRate: target,
        planning: best.analysis,
      },
    };
    writeFileSync(
      `content/candidates/harder/level-${i + 40}.json`,
      JSON.stringify(out, null, 2) + "\n",
    );
    report.push({
      level: i + 40,
      before: before.randomLegalWinRate,
      after: best.analysis.randomLegalWinRate,
      target,
      decisions: best.analysis.decisionStates,
    });
    console.log(report.at(-1));
  }
  writeFileSync(
    "content/candidates/harder/report.json",
    JSON.stringify(report, null, 2) + "\n",
  );
}, 600000);

import { it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { generatePuzzle, evaluateDifficulty } from "../src/domain/generator";
import { levels } from "../src/domain/campaign";
it("authors five mild candidates without replacing campaign", () => {
  if (process.env.AROWGO_MILD !== "1") return;
  const baseline = evaluateDifficulty(levels[4]);
  mkdirSync("content/candidates/mild", { recursive: true });
  const report: (ReturnType<typeof evaluateDifficulty> & {
    proposedLevel: number;
    arrows: number;
    seed: number;
  })[] = [];
  let previous = Math.max(55, baseline.score);
  for (let i = 0; i < 5; i++) {
    const target = previous + 4;
    let selected;
    for (let retry = 0; retry < 25; retry++) {
      try {
        selected = generatePuzzle(
          81000 + i * 997 + retry * 97,
          14 + Math.floor(i / 2),
          target,
          `mild-${i + 6}`,
          {
            connectedPlacement: true,
            openingMoves: [2, 4],
            depthRange: [3, 8],
            scoreRange: [previous + 2, previous + 8],
          },
        );
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.startsWith("Generation budget exhausted")
        )
          throw error;
      }
    }
    if (!selected)
      throw new Error(`Candidate ${i + 6} budget exhausted after ${previous}`);
    previous = selected.generation.difficulty.score;
    writeFileSync(
      `content/candidates/mild/level-${i + 6}.json`,
      JSON.stringify(selected, null, 2) + "\n",
    );
    report.push({
      proposedLevel: i + 6,
      ...selected.generation.difficulty,
      arrows: selected.arrows.length,
      seed: selected.generation.seed,
    });
  }
  writeFileSync(
    "content/candidates/mild/report.json",
    JSON.stringify({ baselineLevel5: baseline, candidates: report }, null, 2) +
      "\n",
  );
}, 180000);

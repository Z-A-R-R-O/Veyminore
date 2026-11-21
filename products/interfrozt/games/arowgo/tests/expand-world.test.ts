import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { generatePuzzle } from "../src/domain/generator";
it("authors the second ten-level section only on explicit request", () => {
  if (process.env.AROWGO_EXPAND !== "1") return;
  const candidates: ReturnType<typeof generatePuzzle>[] = [];
  for (let i = 0; i < 50 && candidates.length < 10; i++) {
    try {
      const level = generatePuzzle(20001 + i * 193, 16 + (i % 5), 110 + i * 2);
      if (level.generation.difficulty.score >= 91) candidates.push(level);
    } catch {
      /* A bounded generation failure can be retried with the next seed. */
    }
  }
  expect(candidates).toHaveLength(10);
  candidates.sort(
    (a, b) => a.generation.difficulty.score - b.generation.difficulty.score,
  );
  candidates.forEach((level, i) => {
    const levelId = `bloom-${i + 11}`;
    writeFileSync(
      `content/levels/${levelId}.json`,
      JSON.stringify({ ...level, levelId }, null, 2) + "\n",
    );
  });
}, 120000);

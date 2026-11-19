import { it, expect } from "vitest";
import { writeFileSync } from "node:fs";
import { generatePuzzle } from "../src/domain/generator";
it("authors reproducible campaign candidates when explicitly requested", () => {
  if (process.env.AROWGO_GENERATE !== "1") return;
  const candidates = Array.from({ length: 5 }, (_, i) =>
    generatePuzzle(6106 + i * 137, 11 + i, 70 + i * 12),
  ).sort(
    (a, b) => a.generation.difficulty.score - b.generation.difficulty.score,
  );
  const scores = candidates.map((l) => l.generation.difficulty.score);
  expect(scores.every((s, i) => i === 0 || s > scores[i - 1])).toBe(true);
  for (let i = 0; i < 5; i++) {
    const id = `bloom-${String(i + 6).padStart(2, "0")}`;
    const level = { ...candidates[i], levelId: id };
    writeFileSync(
      `content/levels/${id}.json`,
      JSON.stringify(level, null, 2) + "\n",
    );
  }
  expect(scores).toEqual([...scores].sort((a, b) => a - b));
}, 60000);

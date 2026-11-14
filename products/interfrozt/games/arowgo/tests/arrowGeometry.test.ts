import { describe, it, expect } from "vitest";
import {
  snake,
  length,
  roundedPath,
  type Point,
} from "../src/game/arrowGeometry";
describe("snake presentation geometry", () => {
  const path: Point[] = [
    [0, 100],
    [0, 50],
    [50, 50],
    [50, 0],
  ];
  it("starts exactly on the authored path", () =>
    expect(snake(path, 0)).toEqual(path));
  it("advances the tail around bends and extends the head", () =>
    expect(snake(path, 75)).toEqual([
      [25, 50],
      [50, 50],
      [50, 0],
      [50, -75],
    ]));
  it("preserves body length throughout the exit", () => {
    for (let d = 0; d <= 900; d += 3)
      expect(length(snake(path, d))).toBeCloseTo(length(path), 8);
  });
  it("fully clears the board and never mutates authored points", () => {
    const copy = JSON.stringify(path);
    expect(snake(path, 400).every((p) => p[1] < 0)).toBe(true);
    expect(JSON.stringify(path)).toBe(copy);
  });
  it("rounds bends with quadratic curves, including tiny residual segments", () => {
    for (const d of [0, 49.99, 50, 99.99, 100, 150, 300]) {
      const result = roundedPath(snake(path, d));
      expect(result).not.toMatch(/NaN|Infinity/);
    }
    expect(roundedPath(path)).toContain(" Q ");
  });
});

import { describe, expect, it } from "vitest";
import data from "../content/levels/bloom-01.json";
import { validateLevel, legalArrows } from "../src/domain/rules";
import {
  newSession,
  resolve,
  parseSession,
  stars,
} from "../src/application/session";
const level = validateLevel(data);
describe("Analyze and confirmed Erase", () => {
  it("Analyze reveals every legal arrow without changing occupancy or spending hearts", () => {
    const start = newSession(level, "one");
    const result = resolve(level, start, {
      id: "analyze",
      attemptId: "one",
      type: "analyze",
    });
    expect(result.hints).toEqual(legalArrows(level, start.active));
    expect(result.hints).toHaveLength(4);
    expect(result.state.active).toEqual(start.active);
    expect(result.state.mistakes).toBe(0);
    expect(result.state.assisted).toBe(true);
  });
  it("Erase can remove a blocked arrow and persists a valid assisted state", () => {
    const start = newSession(level, "one"),
      command = {
        id: "erase",
        attemptId: "one",
        type: "erase" as const,
        arrowId: "B",
      };
    const result = resolve(level, start, command);
    expect(result.exit?.clear).toBe(false);
    expect(result.erased).toBe(true);
    expect(result.state.active).not.toContain("B");
    expect(result.state.mistakes).toBe(0);
    expect(result.state.erased).toEqual(["B"]);
    expect(result.state.assisted).toBe(true);
    expect(parseSession(JSON.stringify(result.state), level)).toEqual(
      result.state,
    );
    expect(resolve(level, result.state, command).state).toBe(result.state);
  });
  it("erasing the last arrow completes and rewards exactly once, with assisted stars", () => {
    let state = newSession(level, "one");
    for (const id of level.solution)
      state = resolve(level, state, {
        id: `erase-${id}`,
        attemptId: "one",
        type: "erase",
        arrowId: id,
      }).state;
    expect(state.status).toBe("complete");
    expect(stars(state)).toBe(1);
    expect(state.coins).toBe(25);
    expect(parseSession(JSON.stringify(state), level)).toEqual(state);
    expect(
      resolve(level, state, {
        id: "duplicate",
        attemptId: "one",
        type: "erase",
        arrowId: "J",
      }).state,
    ).toBe(state);
  });
  it("migrates original v1 snapshots without dropping their progress", () => {
    const old = resolve(level, newSession(level, "one"), {
      id: "a",
      attemptId: "one",
      type: "select",
      arrowId: "A",
    }).state;
    const { erased: _, ...legacy } = old;
    void _;
    const restored = parseSession(JSON.stringify(legacy), level);
    expect(restored.active).not.toContain("A");
    expect(restored.erased).toEqual([]);
  });
  it("rejects forged or inconsistent erased-arrow lists", () => {
    const start = newSession(level, "one");
    for (const invalid of [
      { ...start, erased: ["B"] },
      { ...start, erased: ["unknown"], assisted: true },
      { ...start, erased: null },
      {
        ...start,
        active: start.active.filter((id) => id !== "B"),
        erased: ["B", "B"],
        assisted: true,
      },
      {
        ...start,
        active: start.active.filter((id) => id !== "B"),
        erased: ["B"],
        assisted: false,
      },
    ])
      expect(() => parseSession(JSON.stringify(invalid), level)).toThrow();
  });
});

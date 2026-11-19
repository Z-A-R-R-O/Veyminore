import { it, expect } from "vitest";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
import { levels } from "../src/domain/campaign";
import { parseSession } from "../src/application/session";
it("saves feedback counts across reload, counts hints and resets replay", () => {
  const level = levels[0],
    data = new Map<string, string>();
  let id = 0;
  const store = new SaveStore(
    {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => {
        data.set(k, v);
      },
    },
    level,
    "counts",
  );
  let c = new Controller(level, store, () => String(++id));
  c.hint();
  expect(c.state.feedbackCounts?.book).toBe(1);
  c.select("E");
  expect(c.state.feedbackCounts?.mistake).toBe(1);
  c = new Controller(level, store, () => String(++id));
  expect(c.state.feedbackCounts).toMatchObject({ book: 1, mistake: 1 });
  c.select("E");
  c.select("E");
  expect(c.state.feedbackCounts).toMatchObject({ mistake: 2, blunder: 1 });
  expect(parseSession(JSON.stringify(c.state), level).feedbackCounts).toEqual(
    c.state.feedbackCounts,
  );
  c.restart();
  expect(c.state.feedbackCounts).toEqual({});
  for (const arrow of level.solution) c.select(arrow);
  expect(c.state.feedbackCounts?.perfect).toBe(1);
  expect(() =>
    parseSession(
      JSON.stringify({ ...c.state, feedbackCounts: { good: -1 } }),
      level,
    ),
  ).toThrow("Invalid feedback");
});

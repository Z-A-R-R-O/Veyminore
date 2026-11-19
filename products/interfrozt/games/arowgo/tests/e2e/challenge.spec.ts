import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
const old = JSON.parse(
  readFileSync("content/levels/archive-before-planning.json", "utf8"),
).map(validateLevel) as ReturnType<typeof validateLevel>[];
import { newSession, resolve } from "../../src/application/session";
test("planning boards migrate old progress and fit phones and desktop", async ({
  page,
}) => {
  test.setTimeout(120000);
  const saves = old.map((l, i) => {
    let s = newSession(l, "old");
    for (const id of l.solution)
      s = resolve(l, s, {
        id,
        attemptId: "old",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${l.levelId}.v1`,
      JSON.stringify(s),
    ];
  });
  await page.addInitScript((values) => {
    if (!localStorage.getItem("challenge-seed")) {
      for (const [k, v] of values) localStorage.setItem(k, v);
      for (const k of [
        "arowgo.tutorial.snake.v2",
        "arowgo.tutorial.keys.v1",
        "arowgo.lesson.anchors",
        "arowgo.lesson.kegs",
      ])
        localStorage.setItem(k, "seen");
      localStorage.setItem("challenge-seed", "1");
    }
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    for (const n of [10, 15, 25, 35, 40]) {
      await page.goto("/#play/" + n);
      await expect(
        page.getByRole("heading", {
          name: "Level " + String(n).padStart(2, "0"),
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".vector-arrows")).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollHeight),
      ).toBeLessThanOrEqual(height);
      await expect
        .poll(
          async () =>
            (await page.getByTestId("board").boundingBox())?.width ?? 0,
        )
        .toBeGreaterThanOrEqual(240);
      const board = (await page.getByTestId("board").boundingBox())!;
      expect(board.width).toBeGreaterThanOrEqual(240);
      expect(board.x).toBeGreaterThanOrEqual(0);
      expect(board.x + board.width).toBeLessThanOrEqual(width);
      for (const counter of await page
        .locator('.cove-mechanic[data-kind="keg"] text')
        .all()) {
        expect((await counter.boundingBox())!.height).toBeGreaterThanOrEqual(
          11,
        );
      }
      await page.screenshot({
        path: `docs/verification/planning-${n}-${width}.png`,
        scale: "css",
      });
    }
  }
  await page.goto("/#profile");
  await expect(page.getByLabel("1000 total coins")).toBeVisible();
  expect(
    await page.evaluate(
      () => !!localStorage.getItem("arowgo.level.bloom-10.v1.content-8"),
    ),
  ).toBe(true);
});

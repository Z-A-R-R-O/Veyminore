import { guest } from "../../src/storage/profile";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const levels = Array.from({ length: 180 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/${i < 40 ? "cove" : i < 60 ? "frost" : i < 80 ? "amber" : i < 100 ? "sanctum" : i < 140 ? "clockwork" : "astral"}/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);
test("legacy saves unlock four Foundry pages without changing balances", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const saves = levels.map((level, i) => {
    let state = newSession(level, "legacy");
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: "legacy",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  const profile = JSON.stringify({ ...guest(), gems: 73 });
  await page.addInitScript(
    ({ values, profile }) => {
      localStorage.setItem("arowgo.profile.v1", profile);
      for (const [k, v] of values) localStorage.setItem(k, v);
      localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
    },
    { values: saves, profile },
  );
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/#worlds");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Eclipse Foundry", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole("button", { name: "Previous levels", exact: true }),
    ).toBeDisabled();
    for (
      let section = 0;
      section < (process.env.FOUNDRY_SMOKE ? 2 : 4);
      section++
    ) {
      await expect(page.locator(".map-pager")).toContainText(
        `Levels ${181 + 10 * section}–${190 + 10 * section}`,
      );
      await expect(page.locator(".valley-stop")).toHaveCount(10);
      const boxes = await page.locator(".valley-stop").evaluateAll((nodes) =>
        nodes.map((n) => {
          const r = n.getBoundingClientRect();
          return { x: r.x, y: r.y, w: r.width, h: r.height };
        }),
      );
      for (const [i, a] of boxes.entries()) {
        expect(a.x).toBeGreaterThanOrEqual(0);
        expect(a.y).toBeGreaterThanOrEqual(0);
        expect(a.x + a.w).toBeLessThanOrEqual(size.width + 1);
        expect(a.y + a.h).toBeLessThanOrEqual(size.height + 1);
        for (const b of boxes.slice(i + 1))
          expect(
            a.x + a.w <= b.x ||
              b.x + b.w <= a.x ||
              a.y + a.h <= b.y ||
              b.y + b.h <= a.y,
          ).toBe(true);
      }

      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (section < (process.env.FOUNDRY_SMOKE ? 1 : 3))
        await page
          .getByRole("button", { name: "Next levels", exact: true })
          .click();
    }
    if (!process.env.FOUNDRY_SMOKE)
      await expect(
        page.getByRole("button", { name: "Next levels", exact: true }),
      ).toBeDisabled();
    await page.screenshot({ path: `tmp/foundry-world-${size.width}.png` });
    await expect(page.locator(".hub-coins")).toContainText("4500");
    await expect(page.locator(".hub-gems")).toContainText("73");
    for (const [k, v] of saves)
      expect(await page.evaluate((key) => localStorage.getItem(key), k)).toBe(
        v,
      );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#home");
  await expect(page.locator(".bloom-home-island")).toHaveAttribute(
    "src",
    "/assets/eclipse-foundry-home-v1.png",
  );
  await expect
    .poll(() =>
      page
        .locator(".bloom-home-island")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.screenshot({ path: "tmp/foundry-home-phone.png" });
});

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const levels = Array.from({ length: 100 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/${i < 40 ? "cove" : i < 60 ? "frost" : i < 80 ? "amber" : "sanctum"}/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);
test("legacy saves unlock four Clockwork pages without changing balances", async ({
  page,
}) => {
  test.setTimeout(120000);
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
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
    localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
  }, saves);
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/#worlds");
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Clockwork Citadel", exact: true }),
    ).toBeVisible({ timeout: 60000 });
    await expect(
      page.getByRole("button", { name: "Previous levels", exact: true }),
    ).toBeDisabled();
    for (let section = 0; section < 4; section++) {
      await expect(page.locator(".map-pager")).toContainText(
        `Levels ${101 + 10 * section}–${110 + 10 * section}`,
      );
      await expect(page.locator(".valley-stop")).toHaveCount(10);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      if (section < 3)
        await page
          .getByRole("button", { name: "Next levels", exact: true })
          .click();
    }
    await expect(
      page.getByRole("button", { name: "Next levels", exact: true }),
    ).toBeDisabled();
    await page.screenshot({ path: `tmp/clockwork-world-${size.width}.png` });
    for (const [k, v] of saves)
      expect(await page.evaluate((key) => localStorage.getItem(key), k)).toBe(
        v,
      );
  }
});

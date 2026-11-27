import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Level } from "../../src/domain/rules";
const candidates: Level[] = Array.from({ length: 40 }, (_, i) =>
  JSON.parse(
    readFileSync(`content/levels/clockwork/level-${101 + i}.json`, "utf8"),
  ),
);
test("each Clockwork difficulty band plays and preserves storage in DEV", async ({
  page,
}, info) => {
  test.setTimeout(1200000);
  await page.addInitScript(() => {
    for (const key of [
      "arowgo.tutorial.snake.v2",
      "arowgo.tutorial.keys.v1",
      "arowgo.lesson.anchors",
      "arowgo.lesson.kegs",
      "arowgo.lesson.ice",
      "arowgo.lesson.aurora",
    ])
      localStorage.setItem(key, "seen");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#home");
  const dock = page.getByRole("button", {
    name: "Developer tools and bug report",
  });
  await expect(dock).toBeVisible({ timeout: 30000 });
  const snapshot = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([k]) => k.startsWith("arowgo.") && !k.startsWith("arowgo.dev."),
        ),
      ),
    );
  const original = await snapshot();
  for (const [i, level] of candidates.entries()) {
    if (![0, 9, 10, 19, 20, 29, 30, 39].includes(i)) continue;
    await dock.click();
    await page.getByLabel("Sandbox level").selectOption(String(101 + i));
    await expect(page.locator(".dev-difficulty summary")).toContainText(
      /Difficulty \d+/,
    );
    if (
      !(await page
        .locator(".dev-difficulty")
        .evaluate((e) => (e as HTMLDetailsElement).open))
    )
      await page.locator(".dev-difficulty summary").click();
    await expect(
      page.getByText("Failure horizon", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open sandbox", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `Level ${101 + i}`, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Start puzzle", exact: true })
      .click();
    await expect(
      page.locator('.timing-badge[data-kind="pulse"]'),
    ).not.toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow).toBe(false);
    if ([0, 10, 20, 39].includes(i))
      await page.screenshot({
        path: `tmp/clockwork-${101 + i}-${info.project.name}.png`,
      });
    await dock.focus();
    for (let n = 0; n < 40; n++) await page.keyboard.press("Shift+ArrowDown");
    for (const id of level.solution) {
      const arrow = page.getByRole("button", {
        name: `Slide arrow ${id}`,
        exact: true,
      });
      await expect(arrow).toBeEnabled();
      if (info.project.name === "phone") {
        const box = (await arrow.boundingBox())!;
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
      } else {
        await arrow.focus();
        await page.keyboard.press("Enter");
      }
      await expect(arrow).toHaveCount(0);
    }
    await expect(
      page.getByRole("dialog", { name: "Level result" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Main menu", exact: true }).click();
    expect(await snapshot()).toEqual(original);
  }
});

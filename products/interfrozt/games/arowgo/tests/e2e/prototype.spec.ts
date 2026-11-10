import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const levels = [1, 2, 3, 4, 5].map(
  (n) =>
    JSON.parse(readFileSync(`content/levels/bloom-0${n}.json`, "utf8")) as {
      solution: string[];
    },
);
test("v0.1 journey: pages, five levels, rewards and persistence", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Worlds", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play level 2:", exact: false }),
  ).toBeDisabled();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox").check();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await expect(
      page.getByRole("heading", { name: `Level 0${i + 1}`, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toHaveCount(0);
    for (const id of levels[i].solution) {
      const arrow = page.getByRole("button", {
        name: `Slide arrow ${id}`,
        exact: true,
      });
      await expect(arrow).toBeEnabled();
      await arrow.focus();
      await page.keyboard.press("Enter");
    }
    await expect(
      page.getByText("Beautifully cleared.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: i < 4 ? "Next level" : "Back to Worlds",
        exact: true,
      })
      .click();
  }
  await page.getByRole("link", { name: "Progress", exact: true }).click();
  await expect(page.getByLabel("125 total coins")).toBeVisible();
  await expect(page.getByText("15 / 15", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("125 total coins")).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/verification/v01-progress.png" });
});
test("all pages fit a small phone and the hint points at a safe arrow", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  for (const name of ["Home", "Worlds", "Modes", "Progress", "Settings"]) {
    await page.getByRole("link", { name, exact: true }).click();
    const box = await page
      .getByRole("navigation", { name: "Main navigation" })
      .boundingBox();
    expect(box!.y + box!.height).toBeLessThanOrEqual(568);
    if (name === "Modes") {
      for (const card of await page.locator(".mode-card").all()) {
        const bounds = await card.boundingBox();
        const button = await card.getByRole("button").boundingBox();
        expect(button!.y).toBeGreaterThanOrEqual(bounds!.y);
        expect(button!.y + button!.height).toBeLessThanOrEqual(
          bounds!.y + bounds!.height,
        );
      }
    }
    if (name !== "Settings") {
      const content = await page.locator(".hub-content").evaluate((el) => ({
        height: el.clientHeight,
        scroll: el.scrollHeight,
      }));
      expect(content.scroll).toBeLessThanOrEqual(content.height + 1);
    } else {
      await page
        .getByText("AROWGO v0.1", { exact: false })
        .scrollIntoViewIfNeeded();
      await expect(
        page.getByText("AROWGO v0.1", { exact: false }),
      ).toBeVisible();
      await page.locator(".hub-content").evaluate((el) => (el.scrollTop = 0));
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(568);
    await page.waitForTimeout(400);
    await page.screenshot({
      path: `docs/verification/v01-${name.toLowerCase()}-small.png`,
    });
  }
  await page.goto("/#play/1");
  await page.getByRole("button", { name: "A little hint" }).click();
  await expect(page.locator(".hint-beacon")).toHaveCount(1);
  await expect(page.locator('[data-arrow="A"] .hint-beacon')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: "docs/verification/v01-hint-small.png" });
  await context.close();
});
test("Practice never unlocks campaign and in-game preferences reach Settings", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Reduce motion" }).check();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leave puzzle" }).click();
  await page.getByRole("link", { name: "Modes", exact: true }).click();
  await page
    .getByRole("button", { name: "Play Practice", exact: true })
    .click();
  await expect(page.getByLabel("Unlimited mistakes")).toBeVisible();
  for (const id of levels[0].solution) {
    const arrow = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(arrow).toBeEnabled();
    await arrow.focus();
    await page.keyboard.press("Enter");
  }
  await expect(
    page.getByRole("button", { name: "Next level", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Play again", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play again", exact: true }).click();
  await page.getByRole("button", { name: "Leave puzzle" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
  await page.getByRole("link", { name: "Worlds", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play level 2:", exact: false }),
  ).toBeDisabled();
  await expect(page.getByLabel("0 total coins")).toBeVisible();
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Make it yours." }),
  ).toBeVisible();
});

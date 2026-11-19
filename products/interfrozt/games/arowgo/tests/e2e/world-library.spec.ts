import { test, expect } from "@playwright/test";
test("world name list locks future destinations and compact arrows page the map", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#worlds");
    await page.getByRole("button", { name: "Choose world" }).click();
    const dialog = page.getByRole("dialog", { name: "Choose a world" });
    await expect(dialog).toBeVisible();
    await dialog.evaluate(async e => {await Promise.all(e.getAnimations().map(a=>a.finished));});
    await expect(
      dialog.getByRole("button", {
        name: "Verdant Cove — complete Bloom Valley to unlock",
      }),
    ).toBeDisabled();
    await expect(dialog.locator(".world-name-row")).toHaveCount(4);
    await expect(dialog.getByRole("button",{name:"Frostfall Peaks — coming soon, locked"})).toBeDisabled();
    await expect(dialog.getByRole("button",{name:"Amber Dunes — coming soon, locked"})).toBeDisabled();
    await expect(dialog.locator("img")).toHaveCount(0);
    expect(
      await dialog.evaluate((e) => e.scrollHeight - e.clientHeight),
    ).toBeLessThanOrEqual(1);
    const box = (await dialog.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await page.screenshot({
      path: `docs/verification/world-library-${width}.png`,
      scale: "css",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Choose world" }),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Previous levels" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Next levels" }).click();
    await expect(page.locator(".map-pager")).toContainText("Levels 11–20");
    await expect(
      page.getByRole("button", { name: "Next levels" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Previous levels" }).click();
    await expect(page.locator(".map-pager")).toContainText("Levels 1–10");
    await page.screenshot({
      path: `docs/verification/world-clean-${width}.png`,
      scale: "css",
    });
  }
});

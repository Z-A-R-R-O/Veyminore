import { test, expect } from "@playwright/test";
for (const [width, height] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [412, 915],
  [844, 390],
]) {
  test(`game fits ${width}x${height}`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    await page.goto("/#play/1");
    await page.locator("canvas[data-ready=true]").waitFor();
    for (const selector of [
      ".board",
      ".tool-tray",
      ".card-footer",
      ".hud",
      ".settings-button",
      ".topbar",
    ]) {
      const box = await page.locator(selector).boundingBox();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    const board = await page.locator(".board").boundingBox();
    expect(Math.abs(board!.width - board!.height)).toBeLessThan(2);
    expect(board!.height).toBeGreaterThan(180);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Slide arrow B", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("2 hearts remaining")).toBeVisible();
    await page.screenshot({
      path: `docs/verification/mobile-fit-${width}x${height}.png`,
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await context.close();
  });
}

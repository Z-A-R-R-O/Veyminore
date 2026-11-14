import { test, expect } from "@playwright/test";

test("world map fits the viewport and starts the selected level", async ({
  page,
}) => {
  for (const size of [
    { width: 320, height: 568 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await page.goto("/#worlds");
    await expect(
      page.getByRole("heading", { name: "Bloom Valley", exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(450);
    const nav = await page.getByRole("navigation").boundingBox();
    const nodes = page.locator(".valley-stop");
    await expect(nodes).toHaveCount(5);
    for (const node of await nodes.all()) {
      const box = (await node.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(nav!.y);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width);
    }
    const play = page.getByRole("button", { name: "Play 1", exact: true });
    const box = (await play.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(nav!.y);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(size.height);
    expect(
      await page
        .locator(".page-worlds")
        .evaluate((e) => e.scrollHeight - e.clientHeight),
    ).toBeLessThanOrEqual(1);
    await expect(
      page.getByRole("button", { name: "Play level 2:", exact: false }),
    ).toBeDisabled();
    await page.screenshot({
      path: `docs/verification/worlds-${size.width}x${size.height}.png`,
    });
  }
  await page
    .getByRole("button", { name: "Play level 1:", exact: false })
    .click();
  await expect(
    page.getByRole("button", { name: "Play level 1:", exact: false }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Play 1", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Level 01", exact: true }),
  ).toBeVisible();
});

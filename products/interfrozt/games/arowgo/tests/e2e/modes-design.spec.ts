import { test, expect } from "@playwright/test";
test("mode accents and multiplayer placeholder fit small and wide screens", async ({
  page,
}) => {
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#modes");
    const card = page.getByRole("region", { name: "Multiplayer coming soon" });
    await expect(card).toContainText("Coming soon");
    await expect(card.getByRole("button")).toHaveCount(0);
    await expect
      .poll(() =>
        page
          .locator(".multiplayer-card img")
          .evaluate((im: HTMLImageElement) => im.naturalWidth),
      )
      .toBeGreaterThan(0);
    for (const sel of [".story-card", ".practice-card", ".multiplayer-card"]) {
      const b = await page.locator(sel).boundingBox();
      expect(b!.height).toBeGreaterThan(80);
      expect(b!.y + b!.height).toBeLessThan(height);
    }
    await page.screenshot({ path: `tmp/modes-${width}.png` });
  }
  await page.getByRole("button", { name: "Play Practice" }).click();
  await expect(page).toHaveURL(/#(play|learn\/snake)\//);
});

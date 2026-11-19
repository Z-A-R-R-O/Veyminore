import { test, expect } from "@playwright/test";

test("idle arrow nudges gently and stops on interaction", async ({ page }) => {
  await page.clock.install();
  await page.goto("/#play/1");
  await page.locator("canvas[data-ready=true]").waitFor();
  await expect(page.getByText("Tap an arrow to clear its path.")).toHaveCount(
    0,
  );
  await expect(page.locator(".feedback")).toBeHidden();

  await page.clock.fastForward(20050);
  const animations = () =>
    page
      .locator("[data-arrow]")
      .evaluateAll((nodes) =>
        nodes.reduce((n, node) => n + node.getAnimations().length, 0),
      );
  expect(await animations()).toBe(1);
  await page.keyboard.press("Shift");
  expect(await animations()).toBe(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.clock.fastForward(21000);
  expect(await animations()).toBe(0);
});

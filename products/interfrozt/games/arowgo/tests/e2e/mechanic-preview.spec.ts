import { test, expect } from "@playwright/test";
test("preview plays, pauses, replays and fits small phones", async ({
  page,
}) => {
  await page.goto("/#preview/keys");
  await expect(
    page.getByRole("heading", { name: "Keys & locks" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const step = await page.locator(".preview-stage").getAttribute("data-step");
  await page.waitForTimeout(2600);
  await expect(page.locator(".preview-stage")).toHaveAttribute(
    "data-step",
    step!,
  );
  for (const [width, height] of [
    [320, 568],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      page.getByRole("button", { name: "Try it yourself" }),
    ).toBeInViewport();
    await page.screenshot({
      path: `docs/verification/mechanic-preview-${width}.png`,
    });
  }
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(page.locator(".preview-stage")).toHaveAttribute(
    "data-step",
    "3",
    { timeout: 10000 },
  );
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.locator(".preview-stage")).toHaveAttribute(
    "data-step",
    "0",
  );
});

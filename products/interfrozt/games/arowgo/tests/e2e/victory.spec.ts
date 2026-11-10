import { test, expect } from "@playwright/test";
test("victory recognizes mastery, settles, and does not replay on reload", async ({
  page,
}, info) => {
  await page.goto("/");
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
    const button = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(button).toBeEnabled();
    await button.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.getByText("Perfect flow · No mistakes")).toBeVisible();
  await expect(page.locator(".coin-reveal strong")).toHaveText("+25");
  await expect(page.locator(".fresh-win")).toHaveCount(0);
  const panel = page.locator(".win-result");
  const bounds = await panel.boundingBox();
  const button = await page
    .getByRole("button", { name: "Play again" })
    .boundingBox();
  expect(button!.y + button!.height).toBeLessThanOrEqual(
    bounds!.y + bounds!.height,
  );
  await panel.screenshot({
    path: `docs/verification/victory-${info.project.name}.png`,
  });
  await page.reload();
  await expect(page.locator(".fresh-win")).toHaveCount(0);
  await expect(page.locator(".coin-reveal strong")).toHaveText("+25");
  await expect(page.getByLabel("25 earned coins")).toBeVisible();
});

import { test, expect } from "@playwright/test";
test("snake lesson shows a head obstacle and clears a bent arrow beside a blocker", async ({
  page,
}) => {
  await page.goto("/#learn/snake/1");
  await page.locator("canvas[data-ready=true]").waitFor();
  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  };
  await move("A");
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await move("A");
  await expect(page.locator(".blocked-path-guide")).toHaveCount(1);
  await expect(page.locator('.blocker-cue[data-blocker="B"]')).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(1);
  await move("B");
  await expect(page.locator(".blocker-cue")).toHaveCount(0);
  await move("A");
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(
    page.getByRole("button", { name: "Back to menu", exact: true }),
  ).toBeInViewport();
  expect(
    await page
      .locator(".snake-tutorial")
      .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
  ).toBe(true);
  await page.screenshot({ path: "docs/verification/snake-lesson-bend.png" });
  await move("A");
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Slide arrow B", exact: true }),
  ).toHaveCount(1);
  await move("B");
  await page
    .getByRole("button", { name: "Start playing", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Level 01", exact: true }),
  ).toBeVisible();
});

test("reduced motion retains a static blocker explanation and expires it", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#learn/snake/1");
  await page.locator("canvas[data-ready=true]").waitFor();
  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  };
  await move("A");
  await page.getByRole("button", { name: "Next lesson", exact: true }).click();
  await move("A");
  const cue = page.locator('.blocker-cue[data-blocker="B"]');
  await expect(cue).toHaveCount(1);
  expect(await cue.evaluate((el) => el.getAnimations().length)).toBe(0);
  await page.screenshot({ path: "docs/verification/blocker-highlight.png" });
  await expect(cue).toHaveCount(0, { timeout: 3000 });
  await move("B");
  await move("A");
  await expect(
    page.getByRole("button", { name: "Next lesson", exact: true }),
  ).toBeEnabled();
});

import { test, expect } from "@playwright/test";

test("result artwork and actions fit phone, desktop and landscape", async ({
  page,
}) => {
  await page.goto("/#settings");
  await page.getByRole("checkbox", { name: /Reduce motion/ }).check();
  await page.goto("/#play/1");
  for (const id of "ABCDEFGHIJ") {
    const arrow = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(arrow).toBeEnabled();
    await arrow.focus();
    await page.keyboard.press("Enter");
  }
  const dialog = page.getByRole("dialog", { name: "Level result" });
  await expect(dialog).toBeVisible();
  for (const [width, height] of [
    [390, 844],
    [320, 568],
    [1280, 800],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(dialog.locator(".result-title-art")).toHaveJSProperty(
      "naturalWidth",
      2172,
    );
    const box = await dialog
      .locator(".result-overlay")
      .evaluate((el) => ({ scroll: el.scrollHeight, height: el.clientHeight }));
    expect(box.scroll).toBeLessThanOrEqual(box.height + 1);
    await expect(
      dialog.getByRole("button", { name: "Next level" }),
    ).toBeInViewport();
    await page.screenshot({
      path: `docs/verification/result-win-${width}.png`,
    });
  }
  await dialog.getByRole("button", { name: "Play again", exact: true }).click();
  for (let i = 0; i < 3; i++) {
    const arrow = page.getByRole("button", {
      name: "Slide arrow E",
      exact: true,
    });
    await expect(arrow).toBeEnabled();
    await arrow.focus();
    await page.keyboard.press("Enter");
  }
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".result-title-art")).toHaveAttribute(
    "src",
    /try-again/,
  );
  for (const [width, height] of [
    [320, 568],
    [844, 390],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(
      dialog.getByRole("button", { name: "Try again", exact: false }),
    ).toBeInViewport();
    await page.screenshot({
      path: `docs/verification/result-defeat-${width}.png`,
    });
  }
});

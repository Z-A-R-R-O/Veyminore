import { test, expect } from "@playwright/test";
test("learn keys, unlock, reload and finish without campaign rewards", async ({
  page,
}) => {
  await page.goto("/#settings");
  await page.getByRole("checkbox", { name: /Reduce motion/ }).check();
  await page.goto("/#modes");
  await page.getByRole("button", { name: "Learn keys & locks" }).click();
  await expect(page.getByRole("button", { name: "Next step" })).toBeVisible();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(
    page.getByText("Now clear the gold key arrow.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try it yourself" }).click();
  await expect(
    page.getByRole("heading", { name: "Keys & locks", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-kind="lock"]')).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Switch to Story" }),
  ).toBeHidden();
  await page.screenshot({ path: "docs/verification/keys-introduction.png" });
  await page
    .getByRole("button", { name: "Slide arrow G", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Clear the gold key arrow to open this lock.", {
      exact: false,
    }),
  ).toBeVisible();
  for (const id of ["B", "K"]) {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  }
  await expect(page.locator('[data-kind="lock"]')).toHaveCount(0);
  await expect(page.locator(".unlock-bubble")).toHaveCount(1);
  await expect(page.locator(".unlock-bubble")).toHaveCount(0);
  await page.reload();
  await expect(page.locator('[data-kind="lock"]')).toHaveCount(0);
  await page.screenshot({ path: "docs/verification/keys-unlocked.png" });
  for (const id of ["L", "G"]) {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("button", { name: "Back to Modes" }).click();
  await expect(page.getByLabel("0 total coins")).toBeVisible();
});

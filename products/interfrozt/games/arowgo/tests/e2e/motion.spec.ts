import { test, expect, type Page } from "@playwright/test";
async function select(page: Page, id: string) {
  const button = page.getByRole("button", {
    name: `Slide arrow ${id}`,
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}

test("tools are functional, Erase is cancellable, and reduced motion survives reload", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("canvas[data-ready=true]")).toBeVisible();
  await page.getByRole("button", { name: "Analyze", exact: true }).click();
  await expect(
    page.getByText("4 arrows can leave right now.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  await select(page, "B");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep the arrow" }).click();
  await expect(
    page.getByRole("button", { name: "Slide arrow B", exact: true }),
  ).toHaveCount(1);
  await select(page, "B");
  await page
    .getByRole("button", { name: "Erase arrow B", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Slide arrow B", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("3 hearts remaining")).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Slide arrow B", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Visual effects" })
    .selectOption("subtle");
  await page.getByRole("checkbox", { name: "Reduce motion" }).check();
  await page.keyboard.press("Escape");
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await expect(page.locator(".petals")).toBeHidden();
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-effects",
    "subtle",
  );
  expect(
    await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    ),
  ).toBe(0);
  await select(page, "A");
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("system reduced motion disables ambient animation and touch layout stays within viewport", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator(".app-shell")).toHaveAttribute(
    "data-motion",
    "reduced",
  );
  await expect(page.locator(".petals")).toBeHidden();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Reduce motion" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Reduce motion" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

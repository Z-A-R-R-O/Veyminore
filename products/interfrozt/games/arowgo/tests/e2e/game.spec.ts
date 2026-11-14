import { test, expect, type Page } from "@playwright/test";
async function arrow(page: Page, id: string) {
  const button = page.getByRole("button", {
    name: `Slide arrow ${id}`,
    exact: true,
  });
  await expect(button).toBeEnabled();
  await button.focus();
  await page.keyboard.press("Enter");
}
test("blocked feedback, saved progress, full clear and no duplicate replay reward", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/#play/1");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  await arrow(page, "B");
  await expect(
    page.getByText("A little blocked. Try another path.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("2 hearts remaining")).toBeVisible();
  await arrow(page, "A");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(0);
  for (const id of ["B", "C", "D", "E", "F", "G", "H", "I", "J"])
    await arrow(page, id);
  await expect(page.getByText("Beautifully cleared.")).toBeVisible();
  await expect(page.getByLabel("25 earned coins")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Beautifully cleared.")).toBeVisible();
  await page.getByRole("button", { name: "Play again" }).click();
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"])
    await arrow(page, id);
  await expect(
    page.getByText("First-clear reward already collected"),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("real pointer input, restart cancellation, practice and rule lab isolation", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  const box = (await page.getByTestId("board").boundingBox())!;
  // Midpoint on A between logical cells: (150,120) in the 600 px scene.
  // This checks continuous body hit testing, not a keyboard overlay or a grid-cell center.
  const x = box.x + box.width * 0.25,
    y = box.y + box.height * 0.2;
  if (test.info().project.name === "phone") await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Restart", exact: true }).click();
  await page.getByRole("button", { name: "Keep playing" }).click();
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Switch to Practice" }).click();
  await page.getByRole("button", { name: "Start fresh" }).click();
  await expect(page.getByLabel("Unlimited mistakes")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Rule lab" }).click();
  await arrow(page, "A");
  await expect(
    page.getByText("A: blocked by B at (3, 1), step 3."),
  ).toBeVisible();
  await arrow(page, "B");
  await arrow(page, "A");
  await expect(page.getByText("A: clear.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Play", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("rapid taps cost one heart, failure can resume, and dialogs support keyboard dismissal", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await expect(page.locator('canvas[data-ready="true"]')).toBeVisible();
  const box = (await page.getByTestId("board").boundingBox())!;
  await page.mouse.dblclick(
    box.x + box.width * 0.4,
    box.y + box.height * 0.25,
    { delay: 20 },
  );
  await expect(page.getByLabel("2 hearts remaining")).toBeVisible();
  await arrow(page, "B");
  await arrow(page, "B");
  await expect(page.getByText("Take a fresh look.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Take a fresh look.")).toBeVisible();
  await page.getByRole("button", { name: /^Try again/ }).click();
  await expect(page.getByLabel("3 hearts remaining")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("checkbox", { name: "Reduce motion" }).check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.context().setOffline(true);
  await arrow(page, "A");
  await expect(
    page.getByRole("button", { name: "Slide arrow A", exact: true }),
  ).toHaveCount(0);
});

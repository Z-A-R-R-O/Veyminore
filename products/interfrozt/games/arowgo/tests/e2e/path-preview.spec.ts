import { test, expect } from "@playwright/test";
test("holding previews without moving or saving; tapping still moves", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await page.locator("canvas[data-ready=true]").waitFor();
  const board = page.getByTestId("board");
  const box = (await board.boundingBox())!;
  // Level 1 A head: (1,0), in the same 600px viewBox as the board.
  const a = page.getByRole("button", { name: "Slide arrow A", exact: true });
  const pos = (await a.boundingBox())!;
  const x = pos.x + pos.width / 2,
    y = pos.y + pos.height / 2;
  const saved = await page.evaluate(() =>
    localStorage.getItem("arowgo.slice.v1"),
  );
  await page.mouse.move(x, y);
  await page.mouse.down();
  await expect(page.locator(".path-preview")).toBeVisible();
  await page.screenshot({ path: "tmp/hold-preview.png" });
  await page.mouse.up();
  await expect(page.locator(".path-preview")).toHaveCount(0);
  await expect(a).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("arowgo.slice.v1")),
  ).toBe(saved);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(box.x + 4, box.y + 4);
  await page.mouse.up();
  await expect(a).toHaveCount(1);
  await a.focus();
  await page.keyboard.down("p");
  await expect(page.locator(".path-preview")).toBeVisible();
  await page.keyboard.up("p");
  await expect(page.locator(".path-preview")).toHaveCount(0);
  await page.mouse.click(x, y);
  await expect(a).toHaveCount(0);
});
test("blocked preview names obstacle without costing a heart", async ({
  page,
}) => {
  await page.goto("/#play/1");
  await page.locator("canvas[data-ready=true]").waitFor();
  const e = page.getByRole("button", { name: "Slide arrow E", exact: true });
  await e.focus();
  await page.keyboard.down("p");
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Path blocked · obstacle highlighted" }),
  ).toBeVisible();
  await page.keyboard.up("p");
  await expect(e).toHaveCount(1);
  expect(
    await page.evaluate(() => localStorage.getItem("arowgo.slice.v1")),
  ).toBeNull();
});
test("touch hold previews a required key and release does not move", async ({
  page,
  context,
}) => {
  await page.goto("/#learn/keys");
  await page.locator("canvas[data-ready=true]").waitFor();
  const control = page.getByRole("button", {
    name: "Slide arrow G",
    exact: true,
  });
  const box = (await control.boundingBox())!;
  const client = await context.newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
  });
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Locked · matching key highlighted" }),
  ).toBeVisible();
  await client.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect(page.locator(".path-preview")).toHaveCount(0);
  await expect(control).toHaveCount(1);
});

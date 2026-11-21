import { test, expect } from "@playwright/test";
test("movable developer dock persists, exports safe reports and isolates sandbox saves", async ({
  page,
}) => {
  await page.goto("/#home");
  const dock = page.getByRole("button", {
    name: "Developer tools and bug report",
  });
  await expect(dock).toBeVisible();
  const initial = (await dock.boundingBox())!;
  await dock.focus();
  await page.keyboard.press("ArrowLeft");
  const moved = (await dock.boundingBox())!;
  expect(moved.x).toBeLessThan(initial.x);
  await page.reload();
  await expect(dock).toBeVisible();
  expect((await dock.boundingBox())!.x).toBe(moved.x);
  // Pointer drag must move without opening the panel.
  const box = (await dock.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(100, 130, { steps: 8 });
  await page.mouse.up();
  const panel = page.getByRole("dialog", { name: "Developer tools" });
  await expect(panel).not.toBeVisible();
  await dock.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Bug report", exact: true }).click();
  await panel.getByLabel("Summary", { exact: true }).fill("Arrow did not move");
  await panel
    .getByLabel("Steps and expected behavior")
    .fill("Open Level 1 and tap an arrow.");
  const downloaded = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download report" }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  let raw = "";
  for await (const chunk of stream!) raw += chunk.toString();
  const report = JSON.parse(raw);
  expect(report.summary).toBe("Arrow did not move");
  expect(report.context.route).toBe("home");
  expect(raw).not.toContain("accountId");
  await panel.getByLabel("Add screenshot", { exact: false }).setInputFiles({
    name: "screen.png", mimeType: "image/png",
    buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9u0AAAAASUVORK5CYII=", "base64"),
  });
  await expect(panel.getByAltText("Bug report screenshot preview")).toBeVisible();
  const emailDownload = page.waitForEvent("download");
  await panel.getByRole("button", { name: "Download email with attachments" }).click();
  const email = await emailDownload;
  expect(email.suggestedFilename()).toBe("arowgo-bug-report.eml");
  let mime = "";
  for await (const chunk of (await email.createReadStream())!) mime += chunk.toString();
  expect(mime).toContain("To: interfrozt.vym@gmail.com");
  expect(mime).toContain('filename="screenshot.png"');
  await panel.getByRole("button", { name: "Remove screenshot" }).click();
  await expect(panel.getByAltText("Bug report screenshot preview")).toHaveCount(0);
  await panel.getByRole("button", { name: "Tools", exact: true }).click();
  const before = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage).filter(
        ([k]) => !k.startsWith("arowgo.dev."),
      ),
    ),
  );
  await panel.getByLabel("Sandbox level").selectOption("60");
  await panel
    .getByRole("button", { name: "Open sandbox", exact: true })
    .click();
  const guide = page.getByRole("dialog", { name: "Follow the aurora" });
  await expect(guide).toBeVisible();
  await guide.getByRole("button", { name: "Start puzzle" }).click();
  await expect(
    page.getByRole("heading", { name: "Level 60", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "SANDBOX · No rewards or saves · Exit" }),
  ).toBeVisible();
  await dock.click();
  await panel.getByRole("button", { name: "Show safe moves" }).click();
  await page
    .getByRole("button", { name: "SANDBOX · No rewards or saves · Exit" })
    .click();
  const after = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage).filter(
        ([k]) => !k.startsWith("arowgo.dev."),
      ),
    ),
  );
  expect(after).toEqual(before);
  await page.setViewportSize({ width: 320, height: 568 });
  const fitted = (await dock.boundingBox())!;
  expect(fitted.x + fitted.width).toBeLessThanOrEqual(320);
  expect(fitted.y + fitted.height).toBeLessThanOrEqual(568);
  await dock.click();
  await expect(panel).toBeVisible();
  await page.screenshot({ path: "tmp/dev-tools-320.png", scale: "css" });
  await panel.getByLabel("Development mode").uncheck();
  await expect(
    panel.getByRole("button", { name: "Open sandbox" }),
  ).toBeDisabled();
});

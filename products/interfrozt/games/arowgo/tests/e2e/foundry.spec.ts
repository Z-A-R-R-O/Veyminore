import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Level } from "../../src/domain/rules";
const candidates: Level[] = Array.from(
  { length: process.env.FOUNDRY_SMOKE ? 20 : 40 },
  (_, i) =>
    JSON.parse(
      readFileSync(`content/levels/foundry/level-${181 + i}.json`, "utf8"),
    ),
);
test("each Foundry difficulty band plays and preserves storage in DEV", async ({
  page,
  context,
}, info) => {
  test.setTimeout(1200000);
  await page.addInitScript(() => {
    for (const key of [
      "arowgo.tutorial.snake.v2",
      "arowgo.tutorial.keys.v1",
      "arowgo.lesson.anchors",
      "arowgo.lesson.kegs",
      "arowgo.lesson.ice",
      "arowgo.lesson.aurora",
    ])
      localStorage.setItem(key, "seen");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#home");
  const dock = page.getByRole("button", {
    name: "Developer tools and bug report",
  });
  await expect(dock).toBeVisible({ timeout: 30000 });
  const snapshot = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(
          ([k]) => k.startsWith("arowgo.") && !k.startsWith("arowgo.dev."),
        ),
      ),
    );
  const original = await snapshot();
  for (const [i, level] of candidates.entries()) {
    if (
      !(
        process.env.FOUNDRY_SMOKE
          ? [0, 1, 2, 3, 4]
          : [0, 9, 10, 19, 20, 29, 30, 39]
      ).includes(i)
    )
      continue;
    await dock.click();
    await page.getByLabel("Sandbox level").selectOption(String(181 + i));
    await expect(page.locator(".dev-difficulty summary")).toContainText(
      /Difficulty \d+/,
    );
    if (
      !(await page
        .locator(".dev-difficulty")
        .evaluate((e) => (e as HTMLDetailsElement).open))
    )
      await page.locator(".dev-difficulty summary").click();
    await expect(
      page.getByText("Failure horizon", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open sandbox", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: `Level ${181 + i}`, exact: true }),
    ).toBeVisible();
    const demo = page.locator(".switch-demo");
    await expect(demo).toHaveAttribute("data-open", "false");
    await page
      .getByRole("button", { name: "Remove an ordinary arrow", exact: true })
      .click();
    await expect(demo).toHaveAttribute("data-open", "false");
    await page
      .getByRole("button", { name: "◇ Remove first switch 1", exact: true })
      .click();
    await expect(demo).toHaveAttribute("data-open", "true");
    await page
      .getByRole("button", { name: "◇ Remove second switch 1", exact: true })
      .click();
    await expect(demo).toHaveAttribute("data-open", "false");
    await page
      .getByRole("button", { name: "Reset demonstration", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Start puzzle", exact: true })
      .click();
    await expect(
      page.locator('.switch-badge[data-kind="switch"]'),
    ).not.toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    );
    expect(overflow).toBe(false);
    if ([0, 10, 20, 39].includes(i))
      await page.screenshot({
        path: `tmp/foundry-${181 + i}-${info.project.name}.png`,
      });
    await dock.focus();
    for (let n = 0; n < 40; n++) await page.keyboard.press("Shift+ArrowDown");
    let held = false;
    for (const id of level.solution) {
      const arrow = page.getByRole("button", {
        name: `Slide arrow ${id}`,
        exact: true,
      });
      await expect(arrow).toBeEnabled();
      const source = level.arrows.find((a) => a.id === id)!;
      const gates = await page
        .locator('.switch-badge[data-kind="gate"]')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            id: n.parentElement!.getAttribute("data-arrow")!,
            group: n.getAttribute("data-group"),
            open: n.getAttribute("data-open"),
          })),
        );
      if (source.switchGroup && !held) {
        held = true;
        const box = (await arrow.boundingBox())!;
        if (info.project.name === "phone") {
          const c = await context.newCDPSession(page);
          await c.send("Input.dispatchTouchEvent", {
            type: "touchStart",
            touchPoints: [
              { x: box.x + box.width / 2, y: box.y + box.height / 2 },
            ],
          });
          await expect(page.locator(".hold-preview")).toBeVisible();
          await c.send("Input.dispatchTouchEvent", {
            type: "touchEnd",
            touchPoints: [],
          });
          await c.detach();
        } else {
          await arrow.focus();
          await page.keyboard.down("p");
          await expect(page.locator(".hold-preview")).toBeVisible();
          await page.keyboard.up("p");
        }
        await expect(arrow).toHaveCount(1);
        await expect(page.locator(".hold-preview")).toHaveCount(0);
      }
      if (info.project.name === "phone") {
        const box = (await arrow.boundingBox())!;
        await page.touchscreen.tap(
          box.x + box.width / 2,
          box.y + box.height / 2,
        );
      } else {
        await arrow.focus();
        await page.keyboard.press("Enter");
      }
      await expect(arrow).toHaveCount(0);
      for (const g of gates) {
        if (g.id === id) continue;
        const badge = page.locator(`[data-arrow="${g.id}"] .switch-badge`);
        const toggled = String(source.switchGroup) === g.group;
        await expect(badge).toHaveAttribute(
          "data-open",
          toggled ? String(g.open !== "true") : g.open!,
        );
      }
    }
    await expect(
      page.getByRole("dialog", { name: "Level result" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Main menu", exact: true }).click();
    expect(await snapshot()).toEqual(original);
  }
});

test("switch lesson fits a short phone and honours reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/#home");
  await page
    .getByRole("button", { name: "Developer tools and bug report" })
    .click();
  await page.getByLabel("Sandbox level").selectOption("181");
  await page.getByRole("button", { name: "Open sandbox", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose when to switch" });
  await expect(dialog).toBeVisible();
  const r = (await dialog.boundingBox())!;
  expect(r.x).toBeGreaterThanOrEqual(0);
  expect(r.width).toBeLessThanOrEqual(320);
  expect(r.height).toBeLessThanOrEqual(544);
  await page
    .getByRole("button", { name: "◇ Remove first switch 1", exact: true })
    .click();
  await expect(page.locator(".switch-demo")).toHaveAttribute(
    "data-open",
    "true",
  );
  expect(
    await page
      .locator(".switch-demo-door i")
      .first()
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0.55s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".switch-demo-door i")
      .first()
      .evaluate((e) => getComputedStyle(e).transitionDuration),
  ).toBe("0s");
  await page.getByRole("button", { name: "Start puzzle", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Switch rules", exact: true }).click();
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: "tmp/foundry-lesson-320.png" });
});

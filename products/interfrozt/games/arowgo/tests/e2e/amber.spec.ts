import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const levels = Array.from({ length: 80 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/${i < 40 ? "cove" : i < 60 ? "frost" : "amber"}/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);
const bloom = levels.slice(0, 60);
const cove = levels.slice(60);

test("existing 60 saves unlock Amber Dunes; all 20 levels complete and reload safely", async ({
  page,
}) => {
  test.setTimeout(300000);
  const saves = bloom.map((level, i) => {
    let state = newSession(level, "seed");
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: "seed",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  await page.addInitScript((values) => {
    if (!localStorage.getItem("amber-test-init")) {
      for (const [k, v] of values) localStorage.setItem(k, v);
      localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
      localStorage.setItem("arowgo.tutorial.keys.v1", "seen");
      localStorage.setItem("arowgo.lesson.anchors", "seen");
      localStorage.setItem("arowgo.lesson.kegs", "seen");
      localStorage.setItem("arowgo.lesson.ice", "seen");
      localStorage.setItem("arowgo.lesson.aurora", "seen");
      localStorage.setItem("amber-test-init", "1");
    }
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#worlds");
  await expect(
    page.getByRole("heading", { name: "Amber Dunes", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play 61", exact: true }).click();
  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  };
  for (let i = 0; i < 20; i++) {
    await expect(
      page.getByRole("heading", { name: `Level ${i + 61}`, exact: true }),
    ).toBeVisible();
    if ([0, 3, 10, 19].includes(i))
      await page.screenshot({
        path: `tmp/amber-level-${i + 61}.png`,
      });
    for (const id of cove[i].solution) await move(id);
    await expect(
      page.getByRole("dialog", { name: "Level result" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Next level",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Level 81", exact: true }),
  ).toBeVisible();
  await page.goto("/#home");
  await page.reload();
  await expect(page.getByLabel("2000 total coins")).toBeVisible();
  await expect(page.locator(".bloom-next")).toContainText("LEVEL 81");
});
test("Amber Dunes map fits small phones and wide screens without hiding level controls", async ({
  page,
}) => {
  const saves = bloom.map((level, i) => {
    let state = newSession(level, "seed");
    for (const id of level.solution)
      state = resolve(level, state, {
        id,
        attemptId: "seed",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${level.levelId}.v1`,
      JSON.stringify(state),
    ];
  });
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
  }, saves);
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    await page.goto("/#worlds");
    await page.getByRole("button", { name: "Choose world" }).click();
    await page.getByRole("button", { name: "Explore Amber Dunes" }).click();
    await expect(
      page.getByRole("heading", { name: "Amber Dunes", exact: true }),
    ).toBeVisible();
    // Developer overlay is movable and can otherwise cover a map marker after resizing.
    const dock = page.getByRole("button", {
      name: "Developer tools and bug report",
    });
    await dock.focus();
    for (let step = 0; step < 30; step++)
      await page.keyboard.press("Shift+ArrowDown");
    const nodes = page.locator(".valley-stop");
    await expect(nodes).toHaveCount(10);
    for (const node of await nodes.all()) {
      const b = (await node.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(width);
      expect(b.y + b.height).toBeLessThanOrEqual(height);
      expect(
        await node.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return e.contains(
            document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
          );
        }),
        `Visible marker ${await node.getAttribute("aria-label")} at ${width}x${height}`,
      ).toBe(true);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight),
    ).toBeLessThanOrEqual(height);
    await page.screenshot({
      path: "tmp/amber-world-" + width + ".png",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#home");
  const island = page.locator(".bloom-home-island");
  await expect(island).toHaveAttribute(
    "src",
    "/assets/generated/amber-home.webp",
  );
  await expect
    .poll(() => island.evaluate((e) => (e as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);
  await page.screenshot({ path: "tmp/amber-home.png", scale: "css" });
});

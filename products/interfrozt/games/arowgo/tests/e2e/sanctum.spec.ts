import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel } from "../../src/domain/rules";
import { newSession, resolve } from "../../src/application/session";
const levels = Array.from({ length: 100 }, (_, i) =>
  validateLevel(
    JSON.parse(
      readFileSync(
        i < 20
          ? `content/levels/bloom-${String(i + 1).padStart(2, "0")}.json`
          : `content/levels/${i < 40 ? "cove" : i < 60 ? "frost" : i < 80 ? "amber" : "sanctum"}/level-${i + 1}.json`,
        "utf8",
      ),
    ),
  ),
);
const bloom = levels.slice(0, 80);
const cove = levels.slice(80);

test("existing 80 saves unlock Amber Sanctum; all 20 levels complete and reload safely", async ({
  page,
}, info) => {
  test.setTimeout(480000);
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
    if (!localStorage.getItem("sanctum-test-init")) {
      for (const [k, v] of values) localStorage.setItem(k, v);
      localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
      localStorage.setItem("arowgo.tutorial.keys.v1", "seen");
      localStorage.setItem("arowgo.lesson.anchors", "seen");
      localStorage.setItem("arowgo.lesson.kegs", "seen");
      localStorage.setItem("arowgo.lesson.ice", "seen");
      localStorage.setItem("arowgo.lesson.aurora", "seen");
      localStorage.setItem("sanctum-test-init", "1");
    }
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#worlds");
  await expect(
    page.getByRole("heading", { name: "Amber Sanctum", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Play 81", exact: true }).click();
  const dock = page.getByRole("button", {
    name: "Developer tools and bug report",
  });
  await dock.focus();
  for (let step = 0; step < 40; step++)
    await page.keyboard.press("Shift+ArrowDown");
  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: `Slide arrow ${id}`,
      exact: true,
    });
    await expect(a).toBeEnabled();
    if (info.project.name === "phone") {
      const b = (await a.boundingBox())!;
      await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    } else {
      await a.focus();
      await page.keyboard.press("Enter");
    }
    await expect(a).toHaveCount(0);
  };
  for (let i = 0; i < 20; i++) {
    await expect(
      page.getByRole("heading", { name: `Level ${i + 81}`, exact: true }),
    ).toBeVisible();
    if ([0, 3, 10, 19].includes(i))
      await page.screenshot({
        path: `tmp/sanctum-level-${i + 81}.png`,
      });
    for (const id of cove[i].solution) await move(id);
    await expect(
      page.getByRole("dialog", { name: "Level result" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: i === 19 ? "Adventure complete" : "Next level",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByRole("heading", { name: "Amber Sanctum cleared!" }),
  ).toBeVisible();
  for (const [key, raw] of saves)
    expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe(raw);
  await page.reload();
  await expect(page.getByLabel("2500 total coins")).toBeVisible();
  await expect(page.getByLabel("300 of 300 stars")).toBeVisible();
});
test("Amber Sanctum map fits small phones and wide screens without hiding level controls", async ({
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
    await page.getByRole("button", { name: "Explore Amber Sanctum" }).click();
    await expect(
      page.getByRole("heading", { name: "Amber Sanctum", exact: true }),
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
      path: "tmp/sanctum-world-" + width + ".png",
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
  await page.screenshot({ path: "tmp/sanctum-home.png", scale: "css" });
});

test("Level 80 hands off to 81 instead of the old finale", async ({ page }) => {
  const saves = bloom.map((level, i) => {
    let state = newSession(level, "handoff");
    for (const id of level.solution.slice(0, i === 79 ? -1 : undefined))
      state = resolve(level, state, {
        id,
        attemptId: state.attemptId,
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
    for (const k of [
      "arowgo.tutorial.snake.v2",
      "arowgo.tutorial.keys.v1",
      "arowgo.lesson.anchors",
      "arowgo.lesson.kegs",
      "arowgo.lesson.ice",
      "arowgo.lesson.aurora",
    ])
      localStorage.setItem(k, "seen");
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#play/80");
  const last = page.getByRole("button", {
    name: `Slide arrow ${levels[79].solution.at(-1)}`,
    exact: true,
  });
  await expect(last).toBeEnabled();
  await last.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Next level", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Level 81", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".world-label")).toContainText(
    "World 5 · Amber Sanctum",
  );
});

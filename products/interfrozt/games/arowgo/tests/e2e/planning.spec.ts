import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { validateLevel, safeArrows } from "../../src/domain/rules";
import { evaluatePlanning } from "../../src/domain/planning";
import { newSession, resolve } from "../../src/application/session";
const archive = JSON.parse(
  readFileSync("content/levels/archive-before-planning.json", "utf8"),
).map(validateLevel) as ReturnType<typeof validateLevel>[];
const level = validateLevel(
  JSON.parse(readFileSync("content/levels/bloom-10.json", "utf8")),
);
test("Level 10 teaches prerequisite planning, handles a wrong order, and allows a safe retry", async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.setViewportSize({width:320,height:568});
  const saves = archive.slice(0, 9).map((l, i) => {
    let s = newSession(l, "seed");
    for (const id of l.solution)
      s = resolve(l, s, {
        id,
        attemptId: "seed",
        type: "select",
        arrowId: id,
      }).state;
    return [
      i === 0 ? "arowgo.slice.v1" : `arowgo.level.${l.levelId}.v1`,
      JSON.stringify(s),
    ];
  });
  await page.addInitScript((values) => {
    for (const [k, v] of values) localStorage.setItem(k, v);
    localStorage.setItem("arowgo.tutorial.snake.v2", "seen");
  }, saves);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#play/10");
  const move = async (id: string) => {
    const a = page.getByRole("button", {
      name: "Slide arrow " + id,
      exact: true,
    });
    await expect(a).toBeEnabled();
    await a.focus();
    await page.keyboard.press("Enter");
  };
  await expect(
    page.getByRole("heading", { name: "Mind the powder" }),
  ).toBeVisible();
  await page.screenshot({path:'docs/verification/planning-lesson-320.png',scale:'css'});
  expect(await page.locator('.snake-tutorial').evaluate(e=>e.scrollHeight-e.clientHeight)).toBeLessThanOrEqual(1);
  await move("C");
  await expect(
    page.getByRole("button", { name: "Try lesson again" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try lesson again" }).click();
  for (const id of ["B", "A", "C"]) await move(id);
  await page.getByRole("button", { name: "Continue to level" }).click();
  await expect(
    page.getByRole("heading", { name: "Level 10", exact: true }),
  ).toBeVisible();
  const witness = evaluatePlanning(level).exampleDecision!;
  let active = level.arrows.map((a) => a.id);
  while (active.length > witness.active.length) {
    const id = safeArrows(level, active).find(
      (id) => !witness.active.includes(id),
    )!;
    expect(id).toBeTruthy();
    await move(id);
    active = active.filter((a) => a !== id);
  }
  await move(witness.unsafeMove);
  await expect(
    page.getByRole("dialog", { name: "Level result" }),
  ).toBeVisible();
  await expect(
    page.getByText(/No route can clear|A powder keg ran out/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  for (const id of level.solution) await move(id);
  await expect(
    page.getByText("Beautifully cleared.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next level", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play Level 11", exact: true }),
  ).toBeVisible();
});

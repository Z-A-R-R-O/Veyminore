import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
for (let n = 6; n <= 10; n++)
  test(`staged puzzle ${n} fits and clears`, async ({ page }) => {
    const level = JSON.parse(
      readFileSync(`content/candidates/mild/level-${n}.json`, "utf8"),
    );
    await page.goto("/");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(
      async ({ level, n }) => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const [
          { default: React },
          { default: ReactDOM },
          { App },
          { Controller },
          { SaveStore },
        ] = await Promise.all([
          load("/node_modules/.vite/deps/react.js"),
          load("/node_modules/.vite/deps/react-dom_client.js"),
          load("/src/ui/App.tsx"),
          load("/src/application/controller.ts"),
          load("/src/storage/save.ts"),
        ]);
        const data = new Map<string, string>();
        const controller = new Controller(
          level,
          new SaveStore(
            {
              getItem: (k: string) => data.get(k) ?? null,
              setItem: (k: string, v: string) => data.set(k, v),
            },
            level,
            "candidate",
          ),
        );
        const target = document.createElement("div");
        document.body.replaceChildren(target);
        ReactDOM.createRoot(target).render(
          React.createElement(App, { controller, levelNumber: n }),
        );
      },
      { level, n },
    );
    await expect(
      page.getByRole("heading", {
        name: `Level ${String(n).padStart(2, "0")}`,
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollHeight <= innerHeight + 1 &&
          document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/verification/mild-level-${n}-${test.info().project.name}.png`,
    });
    for (const id of level.solution) {
      const button = page.getByRole("button", {
        name: `Slide arrow ${id}`,
        exact: true,
      });
      await expect(button).toBeEnabled();
      await button.focus();
      await page.keyboard.press("Enter");
    }
    await expect(
      page.getByText("Beautifully cleared.", { exact: true }),
    ).toBeVisible();
  });

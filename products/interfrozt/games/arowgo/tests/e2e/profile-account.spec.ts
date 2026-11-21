import { test, expect } from "@playwright/test";
const origin = "http://localhost:4173";
const anonymous = {
  schemaVersion: 1,
  account: null,
  csrfToken: "a".repeat(32),
  expiresAt: null,
};
const connected = {
  ...anonymous,
  account: { id: "ABC123", kind: "linked", providers: ["google"], revision: 0 },
  expiresAt: "2030-01-01T00:00:00.000Z",
};
test("profile login and logout preserve every local save", async ({ page }) => {
  let signedIn = false;
  await page.route("**/api/arowgo/v1/account/**", async (route) => {
    const url = route.request().url();
    if (url.endsWith("/sign-in")) signedIn = true;
    if (url.endsWith("/logout")) signedIn = false;
    await route.fulfill({
      json: url.endsWith("/flow")
        ? { flowId: "b".repeat(32) }
        : signedIn
          ? connected
          : anonymous,
    });
  });
  await page.route("https://accounts.google.com/gsi/client", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: `window.google={accounts:{id:{initialize(o){this.options=o},renderButton(el){const b=document.createElement('button');b.textContent='Test Google';b.onclick=()=>this.options.callback({credential:'synthetic'});el.append(b)},disableAutoSelect(){}}}}`,
    }),
  );
  await page.goto(origin + "/#profile");
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByRole("textbox", { name: "Display name" }).fill("Save Keeper");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Profile saved.", { exact: true })).toBeVisible();
  const before = await page.evaluate(() =>
    JSON.stringify(Object.entries(localStorage).sort()),
  );
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("link", { name: "Sign in with Google", exact: true })
    .click();
  await page.getByRole("button", { name: "Test Google" }).click();
  await expect(
    page.getByRole("heading", { name: "You’re connected" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Return to game" }).click();
  await expect(
    page.getByRole("heading", { name: "Google connected" }),
  ).toBeVisible();
  await expect(page.locator(".player-name h1")).toHaveText("Save Keeper");
  expect(
    await page.evaluate(() =>
      JSON.stringify(Object.entries(localStorage).sort()),
    ),
  ).toBe(before);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Sign in with Google", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify(Object.entries(localStorage).sort()),
    ),
  ).toBe(before);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Sign in with Google", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify(Object.entries(localStorage).sort()),
    ),
  ).toBe(before);
});
test("profile recovers from unavailable service and fits compact layouts", async ({
  page,
}) => {
  let failed = true;
  await page.route("**/api/arowgo/v1/account/**", (route) =>
    route.fulfill({
      status: failed ? 503 : 200,
      json: failed ? { error: "unavailable" } : connected,
    }),
  );
  await page.goto(origin + "/?account=1#profile");
  await expect(
    page.getByRole("button", { name: "Retry account connection" }),
  ).toBeVisible();
  const before = await page.evaluate(() =>
    JSON.stringify(Object.entries(localStorage).sort()),
  );
  failed = false;
  await page.getByRole("button", { name: "Retry account connection" }).click();
  await expect(
    page.getByRole("heading", { name: "Google connected" }),
  ).toBeVisible();
  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [844, 390],
    [1280, 800],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toBeVisible();
  }
  expect(
    await page.evaluate(() =>
      JSON.stringify(Object.entries(localStorage).sort()),
    ),
  ).toBe(before);
});

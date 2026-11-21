import { expect, test } from "@playwright/test";
import { warmUp } from "./warm-up";

/**
 * Design review captures (not pixel assertions): home, search open, event story and /design,
 * light and dark, per project (desktop + phone). Written to tests/e2e/screenshots/.
 */
test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  await warmUp(browser, baseURL);
});

for (const scheme of ["dark", "light"] as const) {
  test(`capture pages (${scheme})`, async ({ page }, info) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const prefix = `tests/e2e/screenshots/${info.project.name}-${scheme}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${prefix}-home.png`, fullPage: true });

    await page.getByRole("combobox").fill("lol");
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.screenshot({ path: `${prefix}-search.png` });
    await page.keyboard.press("Enter");

    // Opening the event may compile the route on the dev server.
    await expect(page.locator("[data-tier]").first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: `${prefix}-event.png`, fullPage: true });

    await page.goto("/design");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.screenshot({ path: `${prefix}-design.png`, fullPage: true });
  });
}

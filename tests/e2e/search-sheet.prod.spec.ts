import { devices, expect, test, type Page } from "@playwright/test";

/**
 * Mobile P0 (D-088): tapping the home search opens a full-screen sheet. Checked against a
 * PRODUCTION build at phone sizes:
 *   SHEET_BASE_URL=http://127.0.0.1:3300 npx playwright test search-sheet.prod --project=desktop
 * (the phone viewports are set here, so run it under one project).
 */
const BASE = process.env.SHEET_BASE_URL;
/** Viewport, touch and UA only: the browser stays the project's Chromium. */
const phone = ({ defaultBrowserType: _browser, ...d }: (typeof devices)[string]) => d;
const PHONES = { "iPhone 13": phone(devices["iPhone 13"]!), "Pixel 7": phone(devices["Pixel 7"]!) };

const sheet = (page: Page) => page.getByRole("dialog", { name: "Search" });
const field = (page: Page) =>
  page.getByRole("combobox", { name: /search concerts, festivals, artists or cities/i });

for (const [name, device] of Object.entries(PHONES)) {
  test.describe(`search sheet on ${name}`, () => {
    test.skip(!BASE, "set SHEET_BASE_URL to a production server (next build && next start)");
    test.use({ ...device });

    test.beforeEach(async ({ page }) => {
      await page.goto(BASE!);
      await field(page).tap();
      await expect(sheet(page)).toBeVisible();
    });

    test("opens full screen with the field on top and every chip visible", async ({ page }) => {
      const box = (await sheet(page).boundingBox())!;
      const vp = page.viewportSize()!;
      expect(box.y).toBeLessThanOrEqual(1);
      expect(box.height).toBeGreaterThanOrEqual(vp.height - 1);
      // The field sits in the top row, next to Cancel.
      const input = (await field(page).boundingBox())!;
      expect(input.y).toBeLessThan(80);
      await expect(sheet(page).getByRole("button", { name: "Cancel" })).toBeInViewport();
      await expect(field(page)).toBeFocused();
      for (const chip of ["Tonight", "This weekend", "This month"]) {
        await expect(sheet(page).getByRole("button", { name: chip })).toBeInViewport({ ratio: 1 });
      }
      // The sticky bottom bar gets out of the way.
      await expect(page.locator("body")).toHaveAttribute("data-search-open", "");
    });

    test("typing shows the results inside the sheet", async ({ page }) => {
      await field(page).fill("charlie");
      const rows = sheet(page).getByRole("option");
      await expect(rows.first()).toBeInViewport({ timeout: 10_000 });
      const n = await rows.count();
      const visible = (
        await Promise.all(
          Array.from({ length: Math.min(n, 3) }, (_, i) =>
            rows.nth(i).evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= window.innerHeight;
            }),
          ),
        )
      ).filter(Boolean).length;
      expect(visible).toBe(Math.min(n, 3));
    });

    test("Cancel restores the page", async ({ page }) => {
      await sheet(page).getByRole("button", { name: "Cancel" }).tap();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.locator("body")).not.toHaveAttribute("data-search-open", "");
      expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
      await expect(page).toHaveURL(BASE! + "/");
    });

    test("Back closes the sheet and stays on the page", async ({ page }) => {
      await page.goBack();
      await expect(sheet(page)).toHaveCount(0);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    });
  });
}

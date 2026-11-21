import { expect, test } from "@playwright/test";

/**
 * D-057 speed budgets, checked against a PRODUCTION build (dev mode compiles routes on demand,
 * so its timings mean nothing). Run with a `next build && next start` server on the E2E DB:
 *   PERF_BASE_URL=http://127.0.0.1:3200 npx playwright test perf.prod
 */
const BASE = process.env.PERF_BASE_URL;

test.describe("search speed (production build)", () => {
  test.skip(!BASE, "set PERF_BASE_URL to a production server (next build && next start)");

  test("keystroke → first visible suggestion in under 150ms", async ({ page }) => {
    await page.goto(BASE!);
    const box = page.getByRole("combobox", { name: /search concerts/i });
    await box.focus();
    // Time inside the page: from the keydown to the first option in the DOM.
    await page.evaluate(() => {
      const w = window as unknown as { __perf: { start?: number; first?: number } };
      w.__perf = {};
      // The clock restarts on every keystroke until a suggestion shows: we time the keystroke
      // that produced it (suggestions start at two characters).
      document.addEventListener(
        "keydown",
        () => {
          if (w.__perf.first === undefined) w.__perf.start = performance.now();
        },
        { capture: true },
      );
      new MutationObserver(() => {
        if (
          w.__perf.start !== undefined &&
          w.__perf.first === undefined &&
          document.querySelector("[role=option]")
        ) {
          w.__perf.first = performance.now();
        }
      }).observe(document.body, { subtree: true, childList: true });
    });
    await box.pressSequentially("lol");
    await expect(page.getByRole("option").first()).toBeVisible();
    const ms = await page.evaluate(() => {
      const p = (window as unknown as { __perf: { start: number; first: number } }).__perf;
      return p.first - p.start;
    });
    test
      .info()
      .annotations.push({ type: "keystroke-to-suggestion-ms", description: ms.toFixed(1) });
    expect(ms).toBeLessThan(150);
  });

  test("/search page loads in under 1s", async ({ page }) => {
    await page.goto(`${BASE}/search?q=lolla`); // warm
    const started = Date.now();
    await page.goto(`${BASE}/search?q=lolla`, { waitUntil: "domcontentloaded" });
    const ms = Date.now() - started;
    test.info().annotations.push({ type: "search-page-ms", description: String(ms) });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(ms).toBeLessThan(1000);
  });
});

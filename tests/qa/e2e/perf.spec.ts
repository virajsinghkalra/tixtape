import { expect, test } from "@playwright/test";

test("home: DOMContentLoaded and LCP are quick (warm dev server)", async ({ page }) => {
  await page.goto("/"); // warm compile
  await page.goto("/", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(async () => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const lcp = await new Promise<number>((res) => {
      new PerformanceObserver((l) => {
        const e = l.getEntries();
        res(e[e.length - 1]?.startTime ?? 0);
      }).observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => res(-1), 2000);
    });
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? -1;
    return {
      dcl: Math.round(nav.domContentLoadedEventEnd),
      fcp: Math.round(fcp),
      lcp: Math.round(lcp),
    };
  });
  console.log("perf", JSON.stringify(m));
  test.info().annotations.push({ type: "perf", description: JSON.stringify(m) });
  expect(m.dcl).toBeLessThan(3000);
  expect(m.lcp).toBeGreaterThan(0);
  expect(m.lcp).toBeLessThan(4000);
});

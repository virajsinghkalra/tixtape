import type { Browser } from "@playwright/test";

const WARM_UP_TIMEOUT = 180_000;

/**
 * The dev server compiles pages and their client bundles on the first browser request, which can
 * outlast a test's timeout when several workers start at once. Load home and an event page in a
 * real browser (so client chunks compile too) before the tests run.
 */
export async function warmUp(browser: Browser, baseURL: string | undefined): Promise<void> {
  const page = await browser.newPage({ baseURL });
  try {
    await page.goto("/", { timeout: WARM_UP_TIMEOUT });
    const res = await page.request.get("/api/events?pageSize=1", { timeout: WARM_UP_TIMEOUT });
    // Warm-up only: a failed list call is left for the tests themselves to report.
    const body = res.ok() ? ((await res.json()) as { events?: { id: string }[] }) : {};
    const id = body.events?.[0]?.id;
    if (id) await page.goto(`/events/${id}`, { timeout: WARM_UP_TIMEOUT });
  } finally {
    await page.close();
  }
}

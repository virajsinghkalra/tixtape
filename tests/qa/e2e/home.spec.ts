import { expect, gotoHome, shot, test, watch } from "./helpers";

test.describe("P3.8 home feed", () => {
  test("sections render and every event card links to a real event", async ({ page }) => {
    const w = watch(page);
    await gotoHome(page);
    await expect(page.getByRole("heading", { level: 2, name: /upcoming/i })).toBeVisible();
    // D-036: "Concerts for you" is a logged-in extra; a logged-out visitor never sees it.
    await expect(page.getByRole("heading", { name: /concerts for you/i })).toHaveCount(0);
    const hrefs = [
      ...new Set(
        await page
          .locator('a[href^="/events/"]')
          .evaluateAll((as) => as.map((a) => a.getAttribute("href")!)),
      ),
    ];
    expect(hrefs.length).toBeGreaterThanOrEqual(3);
    for (const h of hrefs) {
      const r = await page.request.get(h);
      expect(r.status(), h).toBe(200);
    }
    const api = await (await page.request.get("/api/events")).json();
    for (const e of api.events) expect(hrefs).toContain(`/events/${e.id}`);
    w.assertClean();
  });

  test("Upcoming is sorted soonest first", async ({ page }) => {
    await gotoHome(page);
    const titles = await page
      .locator("section", { has: page.getByRole("heading", { name: /upcoming/i }) })
      .locator("h3")
      .allInnerTexts();
    const api = await (await page.request.get("/api/events")).json();
    const sorted = [...api.events]
      .sort((a: any, b: any) => a.startsAt.localeCompare(b.startsAt))
      .map((e: any) => e.title.toUpperCase());
    expect(titles.map((t) => t.toUpperCase())).toEqual(sorted);
  });

  test("no duplicate-key or hydration warnings on load", async ({ page }) => {
    const msgs: string[] = [];
    page.on("console", (m) => {
      if (/key|hydrat|did not match/i.test(m.text()) && m.type() !== "log")
        msgs.push(m.text().slice(0, 200));
    });
    await gotoHome(page);
    await page.waitForTimeout(1000);
    expect(msgs).toEqual([]);
  });

  test("P3.1 header: a quiet 'Sign in', no 'Connect Spotify' call to action", async ({ page }) => {
    await gotoHome(page);
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: /^sign in$/i })).toBeVisible();
    await expect(page.getByText(/connect spotify/i)).toHaveCount(0);
    // quiet: it isn't styled as the page's primary button
    const signIn = banner.getByRole("link", { name: /^sign in$/i });
    const fontSize = await signIn.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
    expect(fontSize).toBeLessThanOrEqual(16);
  });

  // was QA-UI-6: Connect Spotify (keys not configured) showed raw JSON to the user
  test("Sign in never shows raw JSON", async ({ page }, info) => {
    await gotoHome(page);
    await page
      .getByRole("banner")
      .getByRole("link", { name: /sign in/i })
      .click();
    await page.waitForLoadState("load");
    await page.waitForTimeout(1000);
    await shot(page, info, "sign-in", true);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/^\s*\{/);
    expect(text).not.toMatch(/"error"\s*:/);
  });

  // was QA-UI-5: footer copy contradicted D-036
  test("footer copy matches D-036 (shared playlist, no login)", async ({ page }) => {
    await gotoHome(page);
    await expect(page.locator("footer")).not.toContainText(/in your own Spotify account/i);
    await expect(page.locator("footer")).toContainText(/no login/i);
  });
});

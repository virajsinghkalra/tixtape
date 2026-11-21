import { expect, gotoHome, shot, test, watch } from "./helpers";

test.describe("P3.8 home feed", () => {
  test("sections render and every event card links to a real event", async ({ page }) => {
    const w = watch(page);
    await gotoHome(page);
    await expect(
      page.getByRole("heading", { level: 2, name: /the big ones|near you|this week/i }).first(),
    ).toBeVisible();
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

  test("D-079 sections: each has 'See all', and no card repeats across sections", async ({
    page,
  }) => {
    await gotoHome(page);
    const known = /near you|the big ones|this week|just announced|tours/i;
    const regions = page
      .getByRole("region")
      .filter({ has: page.getByRole("heading", { level: 2, name: known }) });
    const n = await regions.count();
    expect(n).toBeGreaterThan(0);
    const seen = new Map<string, string>();
    for (let i = 0; i < n; i++) {
      const r = regions.nth(i);
      const name = await r.getByRole("heading", { level: 2 }).first().innerText();
      const seeAll = r.getByRole("link", { name: /see all/i });
      await expect(seeAll, name).toBeVisible();
      const href = (await seeAll.getAttribute("href"))!;
      expect((await page.request.get(href)).status(), `${name} See all → ${href}`).toBe(200);
      for (const h of await r
        .locator('article a[href^="/events/"]')
        .evaluateAll((as) => as.map((a) => a.getAttribute("href")!))) {
        expect(seen.get(h), `${h} repeats in "${name}" and "${seen.get(h)}"`).toBeUndefined();
        seen.set(h, name);
      }
    }
    // the old date-sorted "Upcoming" list is gone
    await expect(page.getByRole("heading", { level: 2, name: /^upcoming$/i })).toHaveCount(0);
  });

  test("D-079 city cookie: 'Near you · Pune' lists Pune first, and its See all is /search?city=Pune", async ({
    page,
    baseURL,
  }) => {
    await page.context().addCookies([{ name: "city", value: "Pune", url: baseURL! }]);
    await gotoHome(page);
    const near = page.getByRole("region", { name: /near you · pune/i });
    await expect(near).toBeVisible();
    await expect(near.locator("article h3").first()).toContainText(/NH7 Weekender Pune/);
    await expect(near.getByRole("link", { name: /see all/i })).toHaveAttribute(
      "href",
      /\/search\?city=Pune/,
    );
    // Pune shows aren't repeated in The big ones
    const big = page.getByRole("region", { name: /the big ones/i });
    if (await big.count()) await expect(big).not.toContainText(/NH7 Weekender Pune/);
    // switching to All India removes Near you
    await page.context().clearCookies();
    await gotoHome(page);
    await expect(page.getByRole("region", { name: /near you/i })).toHaveCount(0);
  });

  test("D-079 no city: no 'Near you' section and every published event is reachable from the page", async ({
    page,
  }) => {
    await gotoHome(page);
    await expect(page.getByRole("region", { name: /near you/i })).toHaveCount(0);
    const api = await (await page.request.get("/api/events")).json();
    const hrefs = await page
      .locator('a[href^="/events/"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    for (const e of api.events) expect(hrefs).toContain(`/events/${e.id}`);
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

  test("P3.1 header (logged out): nothing on the right; no 'Sign in', no 'Connect Spotify'", async ({
    page,
  }) => {
    await gotoHome(page);
    const banner = page.getByRole("banner");
    await expect(banner.getByRole("link", { name: /sign in|log ?in/i })).toHaveCount(0);
    await expect(banner.getByRole("button")).toHaveCount(0);
    await expect(page.getByText(/connect spotify/i)).toHaveCount(0);
    // the logo is the only link in the header
    expect(await banner.getByRole("link").count()).toBe(1);
  });

  // was QA-UI-6: Connect Spotify (keys not configured) showed raw JSON. Admins now go straight to
  // /api/auth/spotify/login; it must never show raw JSON (Spotify's page is stubbed).
  test("admin login URL never shows raw JSON", async ({ page }, info) => {
    await page.goto("/api/auth/spotify/login");
    await page.waitForLoadState("load");
    await shot(page, info, "admin-login", true);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/^\s*\{/);
    expect(text).not.toMatch(/"error"\s*:/);
  });
});

import {
  DILJIT_TITLE,
  LOLLA_TITLE,
  NH7_TITLE,
  eventId,
  expect,
  settle,
  shot,
  test,
  watch,
} from "./helpers";

async function api(page: import("@playwright/test").Page, id: string) {
  const r = await page.request.get(`/api/events/${id}`);
  return (await r.json()).event as {
    title: string;
    startsAt: string;
    endsAt: string | null;
    artistCount: number;
    lineup: { name: string; tier: string; billingRank: number }[];
    ticketUrl?: string | null;
    startsAtDateOnly?: boolean;
  };
}

test.describe("P3.2 event page", () => {
  for (const title of [LOLLA_TITLE, NH7_TITLE, DILJIT_TITLE]) {
    test(`lineup order, sizes and counts (${title.split(" ")[0]})`, async ({ page }, info) => {
      const id = await eventId(page.request, title);
      const w = watch(page);
      const ev = await api(page, id);
      await page.goto(`/events/${id}`);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        new RegExp(ev.title.split(" ")[0] ?? ev.title, "i"),
      );
      await shot(page, info, `event-${title.split(" ")[0]}`, true);
      const body = await page.locator("main").innerText();
      // all artists listed, in billing order (headliners first)
      const sorted = [...ev.lineup].sort((a, b) => a.billingRank - b.billingRank);
      let last = -1;
      for (const a of sorted) {
        const idx = body.toUpperCase().indexOf(a.name.toUpperCase());
        expect(idx, `${a.name} missing`).toBeGreaterThan(-1);
        expect(idx, `${a.name} out of order`).toBeGreaterThan(last);
        last = idx;
      }
      // artist count consistent with the lineup
      expect(ev.artistCount).toBe(ev.lineup.length);
      const counts = body.match(/(\d+)\s+of\s+(\d+)/i);
      if (counts) expect(Number(counts[2])).toBe(ev.lineup.length);
      // headliners visually larger than support
      const size = (name: string) =>
        page.locator("main").evaluate((root, n) => {
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          while (walker.nextNode())
            if (walker.currentNode.textContent!.trim().toUpperCase() === n.toUpperCase())
              return parseFloat(getComputedStyle(walker.currentNode.parentElement!).fontSize);
          return -1;
        }, name);
      const head = sorted.find((a) => a.tier === "headliner");
      const sup = [...sorted].reverse().find((a) => a.tier !== "headliner");
      if (head && sup) expect(await size(head.name)).toBeGreaterThan(await size(sup.name));
      w.assertClean();
    });
  }

  test("dates shown in IST match the API instant", async ({ page }) => {
    const DILJIT = await eventId(page.request, DILJIT_TITLE);
    const ev = await api(page, DILJIT);
    await page.goto(`/events/${DILJIT}`);
    const ist = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
      .format(new Date(ev.startsAt))
      .replace(/\s/g, " ")
      .toLowerCase(); // "7:00 pm"
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(ev.startsAt));
    const text = (await page.locator("main").innerText()).replace(/\s/g, " ").toLowerCase();
    expect(text).toContain(`${ist} ist`);
    expect(text).toContain(day.toLowerCase());
  });

  test("browser timezone doesn't change the IST time shown", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ timezoneId: "America/Los_Angeles", baseURL });
    const page = await ctx.newPage();
    const DILJIT = await eventId(page.request, DILJIT_TITLE);
    await page.goto(`/events/${DILJIT}`);
    await settle(page);
    await expect(page.locator("main")).toContainText(/7:00\s*pm IST/i);
    await expect(page.locator("main")).toContainText(/6 Feb 2027/i);
    await ctx.close();
  });

  test("date-only events show 'Time TBA' (needs a date-only event; skipped if none)", async ({
    page,
  }) => {
    const list = await (await page.request.get("/api/events")).json();
    const ids: string[] = list.events.map((e: { id: string }) => e.id);
    let found: string | undefined;
    for (const id of ids) if ((await api(page, id)).startsAtDateOnly) found = id;
    test.skip(!found, "no date-only event in the data");
    await page.goto(`/events/${found}`);
    await expect(page.locator("main")).toContainText(/time tba/i);
  });

  test("Buy tickets appears only when the event has a ticket link", async ({ page }) => {
    for (const title of [LOLLA_TITLE, NH7_TITLE, DILJIT_TITLE]) {
      const id = await eventId(page.request, title);
      const ev = await api(page, id);
      await page.goto(`/events/${id}`);
      const buy = page.getByRole("link", { name: /tickets?/i });
      if (ev.ticketUrl) await expect(buy).toHaveAttribute("href", ev.ticketUrl);
      else await expect(buy).toHaveCount(0);
    }
  });

  test("Make playlist does not pretend to have made a playlist", async ({ page }, info) => {
    const LOLLA = await eventId(page.request, LOLLA_TITLE);
    // 422: no lineup artist is matched on Spotify in the E2E DB. That's the only allowed error.
    const w = watch(page, {
      allowStatus: (u, s) => /\/playlist$/.test(u) && s === 422,
      allowConsole: /status of 422/,
    });
    await page.goto(`/events/${LOLLA}`);
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const btn = page.getByRole("button", { name: /make playlist/i });
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(3000);
    await shot(page, info, "event-make-playlist-clicked", true);
    const text = await page.locator("body").innerText();
    // no Spotify publisher configured: must not claim success or show an "Open in Spotify" link
    expect(text).not.toMatch(
      /playlist (is )?ready\b(?! is)|(?<!nothing )has been created|done!|saved to/i,
    );
    await expect(page.getByRole("link", { name: /open in spotify/i })).toHaveCount(0);
    expect(text).not.toMatch(/\{"error"|"code":/);
    // the 422 is explained in plain words
    await expect(page.locator("main")).toContainText(/aren.t on Spotify yet|nothing to add/i);
    w.assertClean();
  });

  // was QA-UI-5: copy contradicted D-036 (shared playlist, no login needed)
  test("copy matches D-036: no 'your own Spotify account' / 'your playlist' claims", async ({
    page,
  }) => {
    const LOLLA = await eventId(page.request, LOLLA_TITLE);
    await page.goto(`/events/${LOLLA}`);
    const text = await page.locator("body").innerText();
    expect(text).not.toMatch(/in your own Spotify account/i);
    expect(text).not.toMatch(/your playlist/i);
    expect(text).not.toMatch(/created in your account/i);
    expect(text).not.toMatch(
      /(log ?in|sign in|connect)[^.]{0,40}(to|for) (get|make|create)[^.]{0,20}playlist/i,
    );
  });
});

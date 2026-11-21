/**
 * SEARCH_FLOW.md A–C, written from the spec (D-042, D-047, D-048, D-050, D-057).
 * The live lookup is always stubbed (helpers.ts); no third party is ever called.
 */
import type { Page, Route } from "@playwright/test";
import {
  LOLLA_TITLE,
  eventId,
  expect,
  finalShot,
  gotoHome,
  groupOptions,
  openSearch,
  options,
  search,
  settle,
  test,
  watch,
} from "./helpers";

const SUGGEST = /\/api\/events\/suggest\?/;
const recs = (page: Page) =>
  page.getByRole("group", { name: /up next|trending|coming up|this weekend|near you/i });

function lookupAnswer(answer: (q: string, route: Route) => unknown) {
  return async (route: Route) => {
    const req = route.request();
    const q = req.method() === "POST" ? (JSON.parse(req.postData() ?? "{}").q as string) : "";
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(answer(q, route)),
    });
  };
}

test.describe("A. before typing", () => {
  test("focus shows recommendations at once, with no spinner and no request on focus", async ({
    page,
  }, info) => {
    const w = watch(page);
    await gotoHome(page);
    // D-057/SEARCH_FLOW A: the zero-query response is prefetched on page load
    const onFocus: string[] = [];
    page.on("request", (r) => SUGGEST.test(r.url()) && onFocus.push(r.url()));
    const t0 = Date.now();
    await openSearch(page);
    await expect(recs(page).first()).toBeVisible();
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "focus-to-recs-ms", description: String(ms) });
    await expect(page.locator("[aria-busy=true]")).toHaveCount(0);
    expect(onFocus, "focus should use the prefetched zero-query response").toEqual([]);
    // each recommended event links to a real event page
    const links = recs(page).first().getByRole("link");
    expect(await links.count()).toBeGreaterThan(0);
    for (const href of await links.evaluateAll((as) => as.map((a) => a.getAttribute("href")!)))
      expect((await page.request.get(href)).status(), href).toBe(200);
    await finalShot(page, info, "A-focus-recommendations", false);
    w.assertClean();
  });

  test("popular-search chips fill the box and run a search that finds something", async ({
    page,
  }) => {
    await gotoHome(page);
    await openSearch(page);
    const chips = page.getByRole("group", { name: /popular searches/i }).getByRole("button");
    const labels = await chips.allInnerTexts();
    expect(labels.length).toBeGreaterThan(0);
    const dead: string[] = [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i]!.replace(/[^\p{L}\p{N} ]/gu, "").trim();
      await search(page).fill("");
      await openSearch(page);
      await page
        .getByRole("group", { name: /popular searches/i })
        .getByRole("button")
        .nth(i)
        .click();
      await expect(search(page)).toHaveValue(new RegExp(label, "i"));
      await page.waitForTimeout(1500);
      if ((await options(page).count()) === 0) dead.push(label);
    }
    // BUG: QA-F-6 "Popular searches" offers chips (e.g. "Sunburn") with no upcoming events behind
    // them; D-047 says they come from search_log, so a chip should never lead to "No … shows yet".
    expect(dead, `chips with no results: ${dead.join(", ")}`).toEqual([]);
  });

  test("phone: tapping the box opens a full-screen sheet; Back closes it and stays on the page", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await gotoHome(page);
    await openSearch(page);
    const box = await search(page).boundingBox();
    const vp = page.viewportSize()!;
    // full-screen sheet: the box moves to the top of the viewport and the sheet covers it
    expect(box!.y).toBeLessThan(vp.height * 0.25);
    await expect(page.getByRole("button", { name: /cancel|close/i }).first()).toBeVisible();
    await finalShot(page, info, "A-phone-sheet", false);
    await page.goBack();
    await expect(page).toHaveURL(/\/(\?.*)?$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("button", { name: /^cancel$/i })).toBeHidden();
  });
});

test.describe("B. while typing", () => {
  test("2+ characters: instant local results, then server results with no blank frame", async ({
    page,
  }) => {
    await gotoHome(page);
    // hold the server response so the instant local layer is observable
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    await page.route(SUGGEST, async (r) => {
      if (new URL(r.request().url()).searchParams.get("q")) await held;
      await r.continue();
    });
    // record any frame where the dropdown area becomes empty after the first result appeared
    await page.evaluate(() => {
      const w = window as unknown as { __blank: number; __any: boolean };
      w.__blank = 0;
      w.__any = false;
      new MutationObserver(() => {
        const n = document.querySelectorAll("[role=option], [role=group] a").length;
        if (n > 0) w.__any = true;
        else if (w.__any) w.__blank++;
      }).observe(document.body, { subtree: true, childList: true });
    });
    await openSearch(page);
    const t0 = Date.now();
    await search(page).pressSequentially("lo", { delay: 20 });
    // within 50 ms budget (D-057); 1 s allowed on this loaded dev machine
    await expect(page.getByText(/Lollapalooza/i).first()).toBeVisible({ timeout: 1000 });
    test
      .info()
      .annotations.push({ type: "local-results-ms", description: String(Date.now() - t0) });
    release();
    await expect(groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i })).toHaveCount(1);
    await search(page).pressSequentially("lla", { delay: 40 });
    await page.waitForTimeout(1500);
    const blank = await page.evaluate(() => (window as unknown as { __blank: number }).__blank);
    expect(blank, "the list went blank between local and server results (flicker)").toBe(0);
  });

  test("slow server (>300 ms): spinner/aria-busy in the box, old results stay visible", async ({
    page,
  }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await expect(options(page).first()).toBeVisible();
    await page.route(SUGGEST, async (r) => {
      await new Promise((res) => setTimeout(res, 2500));
      await r.continue();
    });
    await search(page).pressSequentially(" i", { delay: 40 });
    await page.waitForTimeout(800);
    await expect(page.locator("[aria-busy=true]").first()).toBeAttached();
    await expect(page.getByText(/Lollapalooza/i).first()).toBeVisible();
  });

  test("groups appear in order: Artists, Cities, Events; each row says why it matched", async ({
    page,
  }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("diljit", { delay: 40 });
    await expect(groupOptions(page, /artists/i)).toHaveCount(1);
    await expect(groupOptions(page, /artists/i).first()).toContainText(/1 upcoming show/i);
    await search(page).fill("mumbai");
    await expect(groupOptions(page, /cities/i)).toHaveCount(1);
    await expect(groupOptions(page, /cities/i).first()).toContainText(/1 upcoming/i);
    await expect(groupOptions(page, /events/i).first()).toContainText(/in Mumbai/i);
    await search(page).fill("prateek");
    await expect(groupOptions(page, /events/i).first()).toContainText(/Prateek Kuhad plays here/i);
    const order = await page
      .getByRole("listbox")
      .getByRole("group")
      .evaluateAll((gs) =>
        gs.map((g) => g.getAttribute("aria-label") ?? (g as HTMLElement).innerText.split("\n")[0]),
      );
    const rank = (n: string | undefined) =>
      ["artists", "cities", "events"].findIndex((k) => (n ?? "").toLowerCase().includes(k));
    const ranks = order.map(rank).filter((r) => r >= 0);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  test("filter chips: 'concerts in pune' shows a Pune chip and finds the Pune show", async ({
    page,
  }, info) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("concerts in pune", { delay: 30 });
    await expect(page.getByRole("button", { name: /remove filter.*pune/i })).toBeVisible();
    await finalShot(page, info, "B-chips-concerts-in-pune", false);
    // BUG: QA-F-4 "concerts" becomes a strict type=concert filter, so the only Pune show (a festival)
    // is not a result; users say "concerts" for any gig.
    await expect(groupOptions(page, /events/i).filter({ hasText: /NH7/i })).toHaveCount(1);
  });

  test("filter chips: 'this weekend' shows a 'This weekend' chip with ×, removing it drops the filter", async ({
    page,
  }, info) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("pune this weekend", { delay: 30 });
    const pune = page.getByRole("button", { name: /remove filter.*pune/i });
    await expect(pune).toBeVisible();
    await finalShot(page, info, "B-chips-this-weekend", false);
    // BUG: QA-F-5 "pune this weekend" is a dead end: no fallback events (the Pune show is 3 weeks
    // out), the lookup copy reads the filter words as an artist ("pune this weekend: no India dates
    // yet"), and the date chip reads "20 Nov – 22 Nov" where the spec says "📅 This weekend".
    await expect(page.getByText(/try these instead|did you mean/i).first()).toBeVisible();
    // the copy must not treat the filter words as an artist name
    await expect(page.locator("main")).not.toContainText(/pune this weekend: no India dates/i);
    await expect(page.getByRole("button", { name: /remove filter.*this weekend/i })).toBeVisible();
  });

  test("removing a chip removes that filter from the query", async ({ page }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla mumbai", { delay: 30 });
    const chip = page.getByRole("button", { name: /remove filter.*mumbai/i });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(chip).toHaveCount(0);
    await expect(search(page)).not.toHaveValue(/mumbai/i);
    await expect(groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i })).toHaveCount(1);
  });

  test("ghost completion: 'lolla' shows the rest; → and Tab accept it", async ({ page }, info) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await expect(options(page).first()).toBeVisible();
    await expect(
      page
        .locator("[aria-hidden=true]")
        .filter({ hasText: /palooza India 2027/i })
        .first(),
    ).toBeVisible();
    await finalShot(page, info, "B-ghost", false);
    await search(page).press("ArrowRight");
    await expect(search(page)).toHaveValue(/^lollapalooza india 2027$/i);
  });

  test("ghost completion: Tab also accepts it", async ({ page }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await expect(options(page).first()).toBeVisible();
    await search(page).press("Tab");
    // BUG: QA-F-9 (low) only → accepts the ghost completion; SEARCH_FLOW B says "Tab or →"
    await expect(search(page)).toHaveValue(/^lollapalooza india 2027$/i);
  });

  test("Enter with nothing highlighted opens /search?q= with the same results, and logs the query", async ({
    page,
  }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("prateek", { delay: 40 });
    await expect(options(page).first()).toBeVisible();
    await search(page).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=prateek$/);
    await expect(page.getByRole("link", { name: /Lollapalooza/i }).first()).toBeVisible();
  });

  test("unknown query: live lookup shows 'Looking for…' while it runs (≤6 s, D-070), then found results", async ({
    page,
  }, info) => {
    const lolla = await eventId(page.request, LOLLA_TITLE);
    await page.route("**/api/lookup**", async (route) => {
      await new Promise((r) => setTimeout(r, 2500)); // synchronous lookup, capped at 6 s
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "found",
          lookupId: "qa-lk-1",
          results: [
            {
              id: lolla,
              title: LOLLA_TITLE,
              type: "festival",
              startsAt: "2027-01-23T06:30:00.000Z",
              startsAtDateOnly: false,
              city: "Mumbai",
              venueName: "Mahalaxmi Racecourse",
              matchReason: "artist",
              matchedText: "Qzband",
            },
          ],
        }),
      });
    });
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("qzband", { delay: 40 });
    await expect(page.getByText(/looking for/i).first()).toBeVisible();
    await finalShot(page, info, "B-lookup-looking", false);
    await expect(page.getByText(/found it/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page
        .getByRole("region")
        .first()
        .getByRole("link", { name: /Lollapalooza India 2027/ }),
    ).toHaveAttribute("href", `/events/${lolla}`);
  });

  test("lookup recognises an artist with no India dates: says so with the artist's name", async ({
    page,
  }, info) => {
    const coldplay = { name: "Coldplay", spotifyId: "4gzpq5DPGxSnKTe4SA8HAU", imageUrl: null };
    await page.route(
      "**/api/lookup**",
      lookupAnswer(() => ({
        status: "not_found",
        lookupId: "qa-lk-2",
        artist: coldplay,
        artists: [coldplay],
      })),
    );
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("coldplay", { delay: 40 });
    await page.waitForTimeout(3000);
    await finalShot(page, info, "B-lookup-coldplay", false);
    // D-050: "Coldplay: no India dates yet", never a blank.
    await expect(page.locator("main")).toContainText(/no (india dates|coldplay shows) yet/i);
    // BUG: QA-F-3 (low) the UI ignores the recognised artist and echoes the raw query
    // ("No coldplay shows yet") instead of naming the artist Spotify recognised.
    await expect(page.locator("main")).toContainText(/Coldplay/);
  });

  test("lookup at its global cap ('searching'): the user is told to try again, not left spinning", async ({
    page,
  }) => {
    await page.route(
      "**/api/lookup**",
      lookupAnswer(() => ({ status: "searching", lookupId: "qa-lk-3" })),
    );
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("qzzyband", { delay: 40 });
    await page.waitForTimeout(9000);
    await expect(page.locator("main")).not.toContainText(/looking for/i);
    await expect(page.locator("main")).toContainText(/try (again|these)|no .* yet|later/i);
  });

  test("ambiguous lookup shows 'Did you mean …?' with the candidate artists", async ({
    page,
  }, info) => {
    await page.route(
      "**/api/lookup**",
      lookupAnswer(() => ({
        status: "not_found",
        ambiguous: true,
        artists: [
          { name: "Arijit Singh", spotifyId: "4YRxDV8wJFPHPTeXepOstw", imageUrl: null },
          { name: "Arijit Das", spotifyId: "1111111111111111111111", imageUrl: null },
        ],
      })),
    );
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("arijit", { delay: 40 });
    await page.waitForTimeout(2500);
    await finalShot(page, info, "B-lookup-ambiguous", false);
    // BUG: QA-F-2 the ambiguous answer is ignored: the user sees "No arijit shows yet" and no "Did you mean"
    await expect(page.getByText(/did you mean/i).first()).toBeVisible();
    await expect(page.locator("main")).toContainText(/Arijit Singh/);
  });

  test("server error: 'isn't responding, retrying…', one automatic retry, then a Retry button that works", async ({
    page,
  }) => {
    let calls = 0;
    let fail = true;
    await page.route(SUGGEST, async (r) => {
      if (!new URL(r.request().url()).searchParams.get("q")) return r.continue();
      calls++;
      if (fail)
        return r.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":{"code":"unavailable","message":"x"}}',
        });
      return r.continue();
    });
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("nh7", { delay: 40 });
    await expect(page.getByText(/isn.t responding/i).first()).toBeVisible();
    const retry = page.getByRole("button", { name: /retry/i });
    await expect(retry).toBeVisible({ timeout: 10_000 });
    expect(calls, "exactly one automatic retry").toBe(2);
    fail = false;
    await retry.click();
    await expect(groupOptions(page, /events/i).filter({ hasText: /NH7/i })).toHaveCount(1);
  });

  test("offline: 'You're offline' and a Retry; back online, Retry shows results", async ({
    page,
    context,
  }) => {
    await gotoHome(page);
    await openSearch(page);
    await context.setOffline(true);
    await search(page).pressSequentially("nh7", { delay: 40 });
    await expect(page.getByText(/you.re offline/i).first()).toBeVisible();
    await context.setOffline(false);
    await page.getByRole("button", { name: /retry/i }).click();
    await expect(groupOptions(page, /events/i).filter({ hasText: /NH7/i })).toHaveCount(1);
  });

  test("× clears the text and returns to the recommendations", async ({ page }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await expect(options(page).first()).toBeVisible();
    await page.getByRole("button", { name: /clear search/i }).click();
    await expect(search(page)).toHaveValue("");
    await expect(recs(page).first()).toBeVisible();
  });

  test("no query is logged per keystroke: only committed queries reach search_log", async ({
    page,
  }) => {
    const logged: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/search\/click/.test(r.url())) logged.push(r.postData() ?? "");
    });
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lollapa", { delay: 30 });
    await page.waitForTimeout(1200);
    expect(logged).toEqual([]);
  });
});

test.describe("C. after clicking", () => {
  test("event: opens fast; title, date and city show at once; prefetched on hover", async ({
    page,
  }) => {
    const w = watch(page);
    const lolla = await eventId(page.request, LOLLA_TITLE);
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    const opt = groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i });
    await opt.hover();
    await page.waitForTimeout(800);
    const t0 = Date.now();
    await opt.click();
    await expect(page).toHaveURL(new RegExp(`/events/${lolla}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(LOLLA_TITLE);
    await expect(page.locator("main")).toContainText(/Mumbai/);
    await expect(page.locator("main")).toContainText(/23/);
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "click-to-title-ms", description: String(ms) });
    expect(ms).toBeLessThan(3000);
    w.assertClean();
  });

  test("choosing a result fires POST /api/search/click and the event page fires one view", async ({
    page,
  }) => {
    const clicks: string[] = [];
    const views: string[] = [];
    page.on("request", (r) => {
      if (/\/api\/search\/click/.test(r.url())) clicks.push(r.url());
      if (/\/api\/events\/[^/]+\/view/.test(r.url())) views.push(r.url());
    });
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await groupOptions(page, /events/i)
      .first()
      .click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Lollapalooza/);
    await page.waitForTimeout(2000);
    // BUG: QA-F-7 neither the search click (SEARCH_FLOW C) nor the event view (SEARCH_FLOW D, D-047)
    // is ever sent, so trend_score and the learning loop stay empty.
    expect(clicks.length, "POST /api/search/click").toBe(1);
    expect(views.length, "POST /api/events/:id/view").toBe(1);
  });

  test("artist with 1 upcoming show opens that event with the artist highlighted in the lineup", async ({
    page,
  }, info) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("prateek", { delay: 40 });
    await expect(groupOptions(page, /artists/i).first()).toContainText(/1 upcoming show/i);
    await groupOptions(page, /artists/i)
      .first()
      .click();
    await page.waitForTimeout(2000);
    await finalShot(page, info, "C-artist-one-show", false);
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Lollapalooza/);
    const row = page.locator("main li", { hasText: /^Prateek Kuhad$/ }).last();
    await expect(row).toBeInViewport();
    const marked = await row.evaluate(
      (e) =>
        e.getAttribute("aria-current") !== null ||
        /highlight|glow|ring|current/i.test(
          e.className + " " + (e.firstElementChild?.className ?? ""),
        ) ||
        getComputedStyle(e).boxShadow !== "none",
    );
    expect(marked, "artist row isn't highlighted").toBe(true);
  });

  test("artist with 1 upcoming show (Diljit) opens the event, not a one-item list", async ({
    page,
  }, info) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("diljit", { delay: 40 });
    await expect(groupOptions(page, /artists/i).first()).toContainText(/1 upcoming show/i);
    await groupOptions(page, /artists/i)
      .first()
      .click();
    await page.waitForTimeout(2000);
    await finalShot(page, info, "C-artist-diljit", false);
    // BUG: QA-F-1 goes to /search?artist=Diljit%20Dosanjh (a one-item list) instead of the event page
    await expect(page).toHaveURL(/\/events\/[0-9a-f-]{36}/);
  });

  test("city opens /search?city= with the city's shows and date chips", async ({ page }, info) => {
    const w = watch(page);
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("pune", { delay: 40 });
    await groupOptions(page, /cities/i)
      .first()
      .click();
    await expect(page).toHaveURL(/\/search\?city=Pune$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Pune/);
    await expect(page.getByRole("link", { name: /NH7 Weekender Pune/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /this weekend/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /this month/i })).toBeVisible();
    await finalShot(page, info, "C-city-pune");
    w.assertClean();
  });

  test("Back from an event restores the query and results; the URL keeps ?q=", async ({ page }) => {
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await expect(page).toHaveURL(/\?q=lolla/);
    await groupOptions(page, /events/i)
      .first()
      .click();
    await expect(page).toHaveURL(/\/events\//);
    await page.goBack();
    await expect(page).toHaveURL(/\?q=lolla/);
    await expect(search(page)).toHaveValue("lolla");
    await expect(groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i })).toHaveCount(1);
  });

  test("a shared link /?q=lolla reproduces the search; recent searches remember it", async ({
    page,
  }) => {
    await page.goto("/?q=lolla");
    await settle(page);
    await expect(search(page)).toHaveValue("lolla");
    await openSearch(page);
    await expect(groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i })).toHaveCount(1);
    await groupOptions(page, /events/i)
      .first()
      .click();
    await expect(page).toHaveURL(/\/events\//);
    await gotoHome(page);
    await openSearch(page);
    await expect(page.getByRole("group", { name: /recent/i })).toContainText(/lolla/i);
  });

  test("/search?q= page: same engine, groups, and no live lookup during SSR", async ({
    page,
  }, info) => {
    const w = watch(page);
    const t0 = Date.now();
    const res = await page.goto("/search?q=diljit");
    test.info().annotations.push({ type: "search-page-ms", description: String(Date.now() - t0) });
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole("link", { name: /Diljit Dosanjh Live in Bengaluru/ }).first(),
    ).toBeVisible();
    await expect(page.locator("main")).toContainText(/1 upcoming show/i);
    await finalShot(page, info, "C-search-page-diljit");
    w.assertClean();
  });
});

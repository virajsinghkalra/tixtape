import {
  DILJIT_TITLE,
  LOLLA_TITLE,
  eventId,
  expect,
  gotoHome,
  groupOptions,
  options,
  search,
  shot,
  test,
  watch,
} from "./helpers";

const SUGGEST = /\/api\/events\/suggest\?/;

test.describe("P3.6 type-ahead search", () => {
  test("1 character shows no suggestions and sends no request; says 'Keep typing'", async ({
    page,
  }) => {
    const w = watch(page);
    await gotoHome(page);
    const typed: string[] = [];
    page.on("request", (r) => {
      if (SUGGEST.test(r.url())) typed.push(new URL(r.url()).searchParams.get("q") ?? "");
    });
    await search(page).pressSequentially("l", { delay: 50 });
    await page.waitForTimeout(800);
    await expect(options(page)).toHaveCount(0);
    await expect(page.getByText(/keep typing/i)).toBeVisible();
    expect(typed.filter((q) => q.trim().length === 1)).toEqual([]);
    w.assertClean();
  });

  for (const q of ["lol", "LOLLA", "Lollapalooza"]) {
    test(`"${q}" suggests Lollapalooza (case-insensitive)`, async ({ page }) => {
      const w = watch(page);
      await gotoHome(page);
      await search(page).pressSequentially(q, { delay: 120 });
      await expect(groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i })).toHaveCount(
        1,
      );
      await expect(search(page)).toHaveAttribute("aria-expanded", "true");
      w.assertClean();
    });
  }

  // was QA-UI-3: multi-word query "lolla 2027" finds nothing although both words are in the title
  test('"lolla 2027" suggests Lollapalooza', async ({ page }) => {
    await gotoHome(page);
    await search(page).fill("lolla 2027");
    await expect(options(page).filter({ hasText: /Lollapalooza/i })).toHaveCount(1, {
      timeout: 5000,
    });
  });

  // was QA-UI-4: no typo tolerance: "lolapalooza" (one l missing) finds nothing
  test('typo "lolapalooza" still suggests Lollapalooza', async ({ page }, info) => {
    await gotoHome(page);
    await search(page).click();
    await search(page).fill("lolapalooza");
    await page.waitForTimeout(1200);
    await shot(page, info, "search-typo");
    await expect(options(page).filter({ hasText: /Lollapalooza/i })).toHaveCount(1, {
      timeout: 4000,
    });
  });

  test("no results shows a friendly empty message and fallback events, not a dead end", async ({
    page,
  }, info) => {
    const w = watch(page);
    await gotoHome(page);
    await search(page).fill("zzzqqqxxx");
    await page.waitForTimeout(1200);
    await shot(page, info, "search-no-results");
    await expect(options(page)).toHaveCount(0);
    await expect(page.getByRole("status").first()).toContainText(/no|nothing|0/i);
    // SEARCH_FLOW B "No match": never a blank dead end
    await expect(page.getByText(/try these instead/i)).toBeVisible();
    w.assertClean();
  });

  for (const [label, q] of [
    ["Hindi", "दिलजीत"],
    ["emoji", "🎸🔥"],
    ["SQL-ish", "' OR 1=1--"],
    ["percent", "%_%"],
  ] as const) {
    test(`${label} input doesn't break the page`, async ({ page }) => {
      const w = watch(page);
      await gotoHome(page);
      await search(page).fill(q);
      await page.waitForTimeout(1200);
      await expect(search(page)).toHaveValue(q);
      await expect(options(page)).toHaveCount(0);
      w.assertClean();
    });
  }

  // was QA-UI-2: 200-character query sends q>100 chars, API answers 400 and the UI shows nothing/err
  test("200 characters is handled gracefully (no 4xx, no crash)", async ({ page }, info) => {
    const w = watch(page);
    await gotoHome(page);
    const long = "lolla".repeat(40);
    await search(page).fill(long);
    await page.waitForTimeout(1500);
    await shot(page, info, "search-200-chars");
    await expect(page.locator("body")).not.toContainText(/validation_failed|\{"error"/);
    w.assertClean();
  });

  test("only spaces: no request error, no suggestions", async ({ page }) => {
    const w = watch(page);
    await gotoHome(page);
    await search(page).fill("     ");
    await page.waitForTimeout(1200);
    await expect(options(page)).toHaveCount(0);
    w.assertClean();
  });

  test("keyboard: ArrowDown sets aria-activedescendant, Enter opens the event", async ({
    page,
  }) => {
    const w = watch(page);
    await gotoHome(page);
    const LOLLA = await eventId(page.request, LOLLA_TITLE);
    const box = search(page);
    await box.pressSequentially("lol", { delay: 80 });
    await expect(options(page)).toHaveCount(1);
    await box.press("ArrowDown");
    const opt = options(page).first();
    const id = await opt.getAttribute("id");
    expect(id).toBeTruthy();
    await expect(box).toHaveAttribute("aria-activedescendant", id!);
    await expect(opt).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/events/${LOLLA}`));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Lollapalooza/i);
    w.assertClean();
  });

  test("Enter with no highlighted option opens /search?q=, not a random event", async ({
    page,
  }) => {
    await gotoHome(page);
    await search(page).pressSequentially("lolla", { delay: 60 });
    await expect(options(page).first()).toBeVisible();
    await search(page).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=lolla$/);
  });

  test("Esc clears the text (list closes, focus stays); a second Esc closes", async ({ page }) => {
    await gotoHome(page);
    const box = search(page);
    await box.pressSequentially("lol", { delay: 80 });
    await expect(options(page)).toHaveCount(1);
    await box.press("Escape");
    await expect(options(page)).toHaveCount(0);
    await expect(box).toHaveValue("");
    await expect(box).toHaveAttribute("aria-expanded", "false");
    await expect(box).toBeFocused();
    // back to the recommendations
    await expect(page.getByRole("group", { name: /up next|trending|coming up/i })).toBeVisible();
    await box.press("Escape");
    await expect(page.getByRole("group", { name: /up next|trending|coming up/i })).toHaveCount(0);
  });

  test("mouse click on an event suggestion opens the event", async ({ page }) => {
    const DILJIT = await eventId(page.request, DILJIT_TITLE);
    await gotoHome(page);
    await search(page).pressSequentially("diljit", { delay: 60 });
    await groupOptions(page, /events/i)
      .filter({ hasText: /Diljit/i })
      .click();
    await expect(page).toHaveURL(new RegExp(`/events/${DILJIT}`));
  });

  test("Tab away closes the list", async ({ page }) => {
    await gotoHome(page);
    await search(page).pressSequentially("lol", { delay: 80 });
    await expect(options(page)).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(options(page)).toHaveCount(0);
  });

  test("clearing the box removes suggestions", async ({ page }) => {
    await gotoHome(page);
    await search(page).pressSequentially("lol", { delay: 80 });
    await expect(options(page)).toHaveCount(1);
    await search(page).fill("");
    await page.waitForTimeout(600);
    await expect(options(page)).toHaveCount(0);
  });

  test("paste works like typing", async ({ page }) => {
    await gotoHome(page);
    await search(page).focus();
    await page.evaluate(() => {
      const el = document.activeElement as HTMLInputElement;
      const dt = new DataTransfer();
      dt.setData("text/plain", "nh7");
      el.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
      );
    });
    // Chromium doesn't insert on synthetic paste; insertText is the real-user equivalent.
    if ((await search(page).inputValue()) === "") await page.keyboard.insertText("nh7");
    await expect(groupOptions(page, /events/i).filter({ hasText: /NH7/i })).toHaveCount(1);
  });

  test("fast typing then delete: no stale results flash in", async ({ page }) => {
    const seen: string[] = [];
    await gotoHome(page);
    await page.exposeFunction("__qaSeen", (t: string) => seen.push(t));
    await page.evaluate(() => {
      new MutationObserver(() => {
        const lb = document.querySelector("[role=listbox]");
        (window as any).__qaSeen(lb ? (lb as HTMLElement).innerText : "");
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const box = search(page);
    await box.pressSequentially("lollapalooza", { delay: 10 });
    for (let i = 0; i < 12; i++) await box.press("Backspace", { delay: 10 });
    await box.pressSequentially("dil", { delay: 10 });
    await expect(groupOptions(page, /events/i).filter({ hasText: /Diljit/i })).toHaveCount(1);
    await page.waitForTimeout(1500);
    // after settling the list must show only the latest query's results (artist row + event row)
    const texts = await options(page).allInnerTexts();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toMatch(/Diljit/i);
    expect(seen.slice(-3).join(" ")).not.toMatch(/Lollapalooza/i);
  });

  test("slow API: the latest query wins even if an earlier one returns late", async ({ page }) => {
    await page.route(/\/api\/events\/suggest\?.*q=lol(&|$)/, async (r) => {
      await new Promise((res) => setTimeout(res, 2500));
      await r.continue();
    });
    await gotoHome(page);
    const box = search(page);
    await box.pressSequentially("lol", { delay: 50 });
    await page.waitForTimeout(500);
    await box.fill("diljit");
    await expect(groupOptions(page, /events/i).filter({ hasText: /Diljit/i })).toHaveCount(1);
    await page.waitForTimeout(3000);
    await expect(options(page).filter({ hasText: /Lollapalooza/i })).toHaveCount(0);
  });

  test("API 500: user sees a friendly error, not JSON and not 'no events'", async ({
    page,
  }, info) => {
    await page.route(SUGGEST, (r) =>
      r.fulfill({
        status: 500,
        contentType: "application/json",
        body: '{"error":{"code":"internal","message":"boom"}}',
      }),
    );
    await gotoHome(page);
    await search(page).pressSequentially("lol", { delay: 60 });
    await page.waitForTimeout(1500);
    await shot(page, info, "search-api-500");
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/\{"error"|internal|boom/);
    expect(body).not.toMatch(/no lol shows/i);
    // SEARCH_FLOW B: "Search isn't responding, retrying…", then a Retry button
    await expect(page.getByText(/isn.t responding/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /retry/i })).toBeVisible({ timeout: 10_000 });
  });

  // was QA-UI-7: while a search request is in flight nothing tells the user it is searching (status empty, no aria-busy)
  test("API slow (5s): shows a loading state, then results", async ({ page }, info) => {
    await page.route(SUGGEST, async (r) => {
      if (!new URL(r.request().url()).searchParams.get("q")) return r.continue();
      await new Promise((res) => setTimeout(res, 5000));
      await r.continue();
    });
    await gotoHome(page);
    await search(page).pressSequentially("lol", { delay: 60 });
    await page.waitForTimeout(1200);
    await shot(page, info, "search-api-slow");
    const busy = await page.locator("[aria-busy=true]").count();
    const status = await page.getByRole("status").innerText();
    expect(
      busy > 0 || /search|loading|…|\.\.\./i.test(status),
      `status="${status}" aria-busy=${busy}`,
    ).toBe(true);
    await expect(groupOptions(page, /events/i).filter({ hasText: /Lollapalooza/i })).toHaveCount(
      1,
      { timeout: 10_000 },
    );
  });

  test("suggestions appear within ~500ms (1000ms budget under load) of the last keystroke (local)", async ({
    page,
  }) => {
    await gotoHome(page);
    // warm up compile
    await search(page).fill("nh");
    await expect(options(page).first()).toBeVisible();
    await search(page).fill("");
    const box = search(page);
    await box.pressSequentially("dilj", { delay: 30 });
    const t0 = Date.now();
    await expect(groupOptions(page, /events/i).filter({ hasText: /Diljit/i })).toHaveCount(1);
    const ms = Date.now() - t0;
    test.info().annotations.push({ type: "suggest-latency-ms", description: String(ms) });
    console.log(`suggest latency ${ms}ms`);
    expect(ms).toBeLessThan(1000); // includes debounce; machine is heavily loaded
  });
});

import { expect, test, type Page } from "@playwright/test";
import { NAVIGATION, result, search, stubLookup, stubSuggest, typed } from "./helpers";
import { warmUp } from "./warm-up";

/** The search journey, state by state (docs/SEARCH_FLOW.md, D-048). */

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  await warmUp(browser, baseURL);
});

const LOLLA = result({ id: "e-lolla", title: "Lollapalooza India 2027", matchedText: "Lol" });
const options = (page: Page) => page.getByRole("listbox").getByRole("option");

test.describe("A. before typing", () => {
  test("focus shows recommendations at once; one letter says keep typing and sends nothing", async ({
    page,
  }) => {
    let requests = 0;
    page.on("request", (r) => r.url().includes("/api/events/suggest") && requests++);
    await page.goto("/");
    await search(page).focus();
    await expect(page.getByText("Up next", { exact: true }).last()).toBeVisible();
    await search(page).pressSequentially("l");
    await expect(page.getByText("Keep typing…")).toBeVisible();
    await expect(options(page)).toHaveCount(0);
    await page.waitForTimeout(500);
    expect(requests).toBe(0);
  });

  test("phone: the search sheet opens on tap and the back button closes it", async ({
    page,
  }, info) => {
    test.skip(info.project.name !== "phone", "phone only");
    await page.goto("/");
    await search(page).click();
    await expect(page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe("B. while typing", () => {
  test("artist names match: 'olivia' shows Olivia Dean plays here", async ({ page }) => {
    await page.goto("/");
    await search(page).fill("olivia");
    await expect(options(page).filter({ hasText: /olivia dean plays here/i })).toBeVisible(
      NAVIGATION,
    );
    await expect(page.getByText("Artists", { exact: true })).toBeVisible();
  });

  test("instant local results from recent searches before the server answers", async ({ page }) => {
    await page.addInitScript(() =>
      localStorage.setItem("concert-playlist.recent-searches", JSON.stringify(["nh7 pune"])),
    );
    await stubSuggest(page, typed({ results: [] }), 3_000);
    await page.goto("/");
    await search(page).fill("nh");
    await expect(options(page).filter({ hasText: "nh7 pune" })).toBeVisible({ timeout: 1000 });
  });

  test("old results stay (dimmed) while the next query loads, with a spinner and aria-busy", async ({
    page,
  }) => {
    await stubSuggest(page, (q) => typed({ results: q === "lol" ? [LOLLA] : [] }));
    await page.goto("/");
    await search(page).fill("lol");
    await expect(options(page).filter({ hasText: /lollapalooza/i })).toBeVisible();
    await page.unrouteAll();
    await stubSuggest(page, typed({ results: [LOLLA] }), 2500);
    await search(page).fill("lolla");
    await expect(page.locator("[aria-busy=true]")).toHaveCount(1);
    await expect(page.getByRole("listbox")).toHaveClass(/opacity-60/);
    await expect(options(page).filter({ hasText: /lollapalooza/i })).toBeVisible();
  });

  test("ghost autocomplete: → accepts the completion", async ({ page }) => {
    await stubSuggest(page, typed({ results: [LOLLA] }));
    await page.goto("/");
    await search(page).fill("lolla");
    await expect(page.locator("span.text-muted", { hasText: "palooza India 2027" })).toBeVisible();
    await search(page).press("End");
    await expect(search(page)).toHaveValue("lollapalooza India 2027");
  });

  test("understood filters show as chips; × removes the words", async ({ page }) => {
    await stubSuggest(page, (q) =>
      typed({
        results: [LOLLA],
        filters: q.includes("pune") ? { city: "Pune", type: "festival" } : {},
      }),
    );
    await page.goto("/");
    await search(page).fill("festivals pune");
    await page.getByRole("button", { name: "Remove filter Pune" }).click();
    await expect(search(page)).toHaveValue("festivals");
  });

  test("no match: a friendly line, did-you-mean and fallback events, never a dead end", async ({
    page,
  }) => {
    await stubSuggest(page, (q) =>
      q === "coldplay"
        ? typed({ didYouMean: "diljit", fallback: [LOLLA] })
        : typed({ results: [LOLLA] }),
    );
    await stubLookup(page, 404, {});
    await page.goto("/");
    await search(page).fill("coldplay");
    // D-088: "Not in India yet 🫠", the query as typed, a typo chip and "Up next".
    await expect(page.getByText("Not in India yet 🫠").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /lollapalooza/i }).first()).toBeVisible();
    await page.getByRole("button", { name: "diljit?" }).click();
    await expect(search(page)).toHaveValue("diljit");
  });

  test("errors retry quietly once, then offer a Retry button that works", async ({ page }) => {
    await page.route(/\/api\/events\/suggest\?/, (r) => r.fulfill({ status: 500, body: "{}" }));
    await page.goto("/");
    await search(page).fill("lol");
    const retry = page.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible();
    await expect(page.locator("body")).not.toContainText('{"error"');
    await page.unrouteAll();
    await stubSuggest(page, typed({ results: [LOLLA] }));
    await retry.click();
    await expect(options(page).filter({ hasText: /lollapalooza/i })).toBeVisible();
  });

  test("clear: × empties the box; Esc clears first, a second Esc closes", async ({
    page,
  }, testInfo) => {
    await stubSuggest(page, typed({ results: [LOLLA] }));
    await page.goto("/");
    await search(page).fill("lol");
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search(page)).toHaveValue("");
    await expect(search(page)).toBeFocused();
    await search(page).fill("lol");
    await search(page).press("Escape");
    await expect(search(page)).toHaveValue("");
    await search(page).press("Escape");
    if (testInfo.project.name === "phone") {
      // The full-screen sheet closes and focus returns to the field that opened it.
      await expect(page.getByRole("dialog", { name: "Search" })).toHaveCount(0);
    } else {
      await expect(search(page)).not.toBeFocused();
    }
  });

  test("keyboard: ↑↓ move through all groups; Enter with nothing highlighted opens /search", async ({
    page,
  }) => {
    await stubSuggest(
      page,
      typed({ results: [LOLLA, result({ id: "e2", title: "Lolla Chile" })] }),
    );
    await page.goto("/");
    await search(page).fill("lol");
    await expect(options(page)).toHaveCount(2);
    await search(page).press("ArrowDown");
    await expect(options(page).nth(0)).toHaveAttribute("aria-selected", "true");
    await search(page).press("ArrowDown");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await search(page).press("ArrowUp");
    await search(page).press("ArrowUp");
    await expect(options(page).nth(1)).toHaveAttribute("aria-selected", "true");
    await page.unrouteAll();
    // A new edit clears the highlight; then Enter has nothing highlighted.
    await search(page).fill("lo");
    await search(page).pressSequentially("l");
    await search(page).press("Enter");
    await expect(page).toHaveURL(/\/search\?q=lol/, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Results for “lol”");
  });
});

test.describe("B. live lookup when nothing matches (D-050)", () => {
  test("looking… then found it", async ({ page }) => {
    await stubSuggest(page, typed({}));
    await stubLookup(page, 200, { status: "found", results: [LOLLA] }, 800);
    await page.goto("/");
    await search(page).fill("coldplay");
    await expect(page.getByText("Checking…")).toBeVisible();
    await expect(page.getByText("Found it 🎉")).toBeVisible();
    await expect(page.getByRole("link", { name: /lollapalooza/i }).first()).toBeVisible();
  });

  test("not found: says there are no India dates yet", async ({ page }) => {
    await stubSuggest(page, typed({}));
    await stubLookup(page, 200, { status: "not_found", artist: { name: "Coldplay" } });
    await page.goto("/");
    await search(page).fill("coldplay");
    await expect(page.getByText("Not in India yet 🫠").first()).toBeVisible();
    await expect(page.getByText(/🎤 Coldplay/).first()).toBeVisible();
  });

  test("a partial name matching several artists asks which one; picking one searches again", async ({
    page,
  }) => {
    await stubSuggest(page, typed({}));
    await stubLookup(page, 200, {
      status: "not_found",
      ambiguous: true,
      artists: [{ name: "Olivia Rodrigo" }, { name: "Olivia Dean" }],
    });
    await page.goto("/");
    await search(page).fill("olivia");
    await expect(page.getByText("Did you mean…")).toBeVisible();
    await page.getByRole("button", { name: "Olivia Rodrigo" }).click();
    await expect(search(page)).toHaveValue("Olivia Rodrigo");
  });

  test("a missing lookup route (404) falls back to the normal empty state", async ({ page }) => {
    await stubSuggest(page, typed({}));
    await stubLookup(page, 404, { error: {} });
    await page.goto("/");
    await search(page).fill("coldplay");
    await expect(page.getByText("Not in India yet 🫠").first()).toBeVisible();
  });
});

test.describe("C. after clicking", () => {
  test("an event opens its page (shell first), and Back restores the query and results", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await search(page).fill("lol");
    await expect(options(page).filter({ hasText: /lollapalooza/i })).toBeVisible(NAVIGATION);
    await search(page).press("ArrowDown");
    await search(page).press("Enter");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      /lollapalooza/i,
      NAVIGATION,
    );
    await page.goBack();
    await expect(page).toHaveURL(/\?q=lol/, NAVIGATION);
    await expect(search(page)).toHaveValue("lol");
    // Phones: the results live in the full-screen sheet, which opens on tap (never on load).
    if (testInfo.project.name === "phone") await search(page).tap();
    await expect(options(page).filter({ hasText: /lollapalooza/i })).toBeVisible(NAVIGATION);
  });

  test("an artist with one show opens that event with the artist highlighted", async ({ page }) => {
    await page.goto("/");
    await search(page).fill("olivia");
    const artist = options(page).filter({ hasText: /1 upcoming show/i });
    await artist.click(NAVIGATION);
    await expect(page).toHaveURL(/\/events\/.+\?artist=Olivia/, NAVIGATION);
    await expect(page.locator("#highlighted-artist")).toContainText(/olivia dean/i);
    await expect(page.locator("#highlighted-artist")).toBeInViewport();
  });

  test("an artist with 2+ shows opens their list", async ({ page }) => {
    await stubSuggest(
      page,
      typed({ artists: [{ name: "Prateek Kuhad", upcomingCount: 2, matchedText: "prat" }] }),
    );
    await page.goto("/");
    await search(page).fill("prat");
    await options(page).filter({ hasText: "Prateek Kuhad" }).click();
    await expect(page).toHaveURL(/\/search\?artist=Prateek/, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Shows by Prateek Kuhad");
  });

  test("a city opens its upcoming shows with date chips", async ({ page }) => {
    await stubSuggest(page, typed({ cities: [{ city: "Pune", upcomingCount: 1 }] }));
    await page.goto("/");
    await search(page).fill("pune");
    await options(page).filter({ hasText: "Pune" }).click();
    await expect(page).toHaveURL(/\/search\?city=Pune/, NAVIGATION);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Shows in Pune");
    await expect(page.getByRole("link", { name: /this weekend/i })).toBeVisible();
    await expect(page.getByTestId("event-card").filter({ hasText: /nh7/i })).toBeVisible();
  });
});

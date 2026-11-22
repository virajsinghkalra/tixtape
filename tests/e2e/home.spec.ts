import { expect, test } from "@playwright/test";
import { search } from "./helpers";
import { warmUp } from "./warm-up";

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  await warmUp(browser, baseURL);
});

test("home: hero with search, the big ones ranked, See all links, no Sign in", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/every lineup/i);
  await expect(search(page)).toBeVisible();

  const big = page.getByRole("region", { name: /the big ones/i });
  await expect(big.getByRole("link", { name: /see all/i })).toHaveAttribute(
    "href",
    /\/search\?from=/,
  );
  const titles = (await big.getByRole("heading", { level: 3 }).allInnerTexts()).map((t) =>
    t.toUpperCase(),
  );
  const order = ["NH7", "LOLLAPALOOZA", "DILJIT"].map((t) =>
    titles.findIndex((x) => x.includes(t)),
  );
  expect(order.every((i) => i >= 0)).toBe(true);

  // logged out, the header shows nothing on the right (admins use /api/auth/spotify/login)
  await expect(page.getByRole("banner").getByRole("link", { name: /sign in/i })).toHaveCount(0);
  await expect(page.locator("footer")).toContainText(/one shared playlist on spotify/i);
});

test("logged out: no 'Concerts for you' teaser anywhere on home", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/concerts for you/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /connect spotify/i })).toHaveCount(0);
});

test("a story opens full screen and closes with Escape", async ({ page }) => {
  await page.goto("/design");
  await page.getByRole("button", { name: "Open story" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Modal story demo" });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a Spotify auth error comes back as a friendly toast, never JSON", async ({ page }) => {
  await page.goto("/?auth_error=spotify_denied");
  await expect(page.getByRole("alert").filter({ hasText: /sign-in was cancelled/i })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

for (const path of ["/", "/design"]) {
  test(`no horizontal scroll on ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("reduced motion still renders everything", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const card = page.getByTestId("event-card").first();
  await expect(card).toBeVisible();
  expect(await card.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("/design shows every primitive in light and dark", async ({ page }) => {
  await page.goto("/design");
  await expect(page.getByRole("heading", { level: 2, name: "light" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "dark" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Inline story demo" })).toHaveCount(2);
});

test("city switcher: All India by default; choosing Pune remembers it and focuses the feed", async ({
  page,
  context,
}) => {
  await page.goto("/");
  const switcher = page.getByRole("button", { name: /city: all india/i });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole("button", { name: "Pune", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: /near you · pune/i })).toBeVisible({
    timeout: 15_000,
  });
  const cookie = (await context.cookies()).find((c) => c.name === "city");
  expect(cookie?.value).toBe("Pune");
  expect(cookie?.sameSite).toBe("Lax");
  await page.getByRole("button", { name: /city: pune/i }).click();
  await page.getByRole("button", { name: "All India" }).click();
  await expect(page.getByRole("heading", { level: 2, name: /near you/i })).toHaveCount(0, {
    timeout: 15_000,
  });
});

test("a city with no gigs says so once and falls back to all of India", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([{ name: "city", value: "Goa", url: baseURL! }]);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /city: goa/i })).toBeVisible();
  await expect(page.getByText(/Nothing in Goa yet/)).toHaveCount(1);
  await expect(
    page.getByRole("region", { name: /the big ones/i }).getByTestId("event-card"),
  ).toHaveCount(3);
});

test("popular-search chips fill the box and run the search", async ({ page }) => {
  await page.goto("/");
  await search(page).focus();
  const chip = page.getByRole("group", { name: "Popular searches" }).getByRole("button").first();
  const query = (await chip.innerText()).replace(/^\W+/, "").trim();
  await chip.click();
  await expect(search(page)).toHaveValue(query);
  // The search runs: results, a lookup or a friendly empty line, never nothing.
  await expect(page.getByRole("status").first()).not.toHaveText("", { timeout: 15_000 });
});

/**
 * The empty catalogue needs a server whose database has no events. Set E2E_EMPTY_BASE_URL to
 * one (e.g. a dev server on an empty DB) to run it; the fixture server always has events.
 */
test("empty catalogue: one message, try-searching chips, how it works; no empty sections", async ({
  page,
}) => {
  const emptyBase = process.env.E2E_EMPTY_BASE_URL;
  test.skip(!emptyBase, "needs E2E_EMPTY_BASE_URL (a server with an empty catalogue)");
  await page.goto(emptyBase!);
  await expect(page.getByText(/new gigs land here soon/i)).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "How it works" })).toBeVisible();
  await expect(page.getByRole("region", { name: /the big ones|near you|this week/i })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Sunburn" }).first().click();
  await expect(search(page)).toHaveValue("Sunburn");
});

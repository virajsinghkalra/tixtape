/** /search?q= is the full results page (SEARCH_FLOW C "Enter with no selection"); it must be readable on arrival. */
import { expect, finalShot, gotoHome, openSearch, search, settle, test } from "./helpers";

async function resultsReadable(page: import("@playwright/test").Page) {
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toBeVisible();
  // nothing covers or blurs the results: the heading's own pixels are on top and unfiltered
  const state = await heading.evaluate((h) => {
    let blurred = false;
    for (let e: Element | null = h; e; e = e.parentElement)
      if (/blur/.test(getComputedStyle(e).filter)) blurred = true;
    const r = h.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + 10, r.top + r.height / 2);
    return { blurred, covered: !!top && !h.contains(top) };
  });
  expect(state, "results heading is blurred or covered by the suggestion panel").toEqual({
    blurred: false,
    covered: false,
  });
}

test("landing on /search?q= (shared link) shows readable results, not an open suggestion panel", async ({
  page,
}, info) => {
  await page.goto("/search?q=diljit");
  await settle(page);
  await page.waitForTimeout(800);
  await finalShot(page, info, "search-page-landing", false);
  // BUG: QA-F-10 the suggestion panel opens by itself on arrival and blurs/covers the results
  await resultsReadable(page);
});

test("Enter on home → /search?q=: the results page is readable without dismissing anything", async ({
  page,
}) => {
  await gotoHome(page);
  await openSearch(page);
  await search(page).pressSequentially("lolla", { delay: 40 });
  await search(page).press("Enter");
  await expect(page).toHaveURL(/\/search\?q=lolla/);
  await settle(page);
  await page.waitForTimeout(800);
  // BUG: QA-F-10
  await resultsReadable(page);
});

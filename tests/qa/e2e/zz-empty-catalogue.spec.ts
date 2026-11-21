/**
 * Empty catalogue. Runs last, and only in the phone project: the home feed is cached for 5 min
 * per server (D-079), so emptying the catalogue would leak into every later home test.
 */
import {
  e2eDb,
  expect,
  finalShot,
  gotoHome,
  openSearch,
  search,
  settle,
  test,
  watch,
} from "./helpers";

test.beforeEach(({}, info) =>
  test.skip(info.project.name !== "phone", "phone project only (runs last)"),
);

test("empty catalogue: home, search and /search show a friendly empty state, not errors", async ({
  page,
}, info) => {
  const sql = e2eDb();
  const ids = (
    await sql<
      { id: string }[]
    >`update events set visibility = 'held' where visibility = 'published' returning id`
  ).map((r) => r.id);
  try {
    const w = watch(page);
    // the event pages and search react at once
    for (const id of ids) expect((await page.request.get(`/events/${id}`)).status()).toBe(404);
    await gotoHome(page);
    await finalShot(page, info, "empty-catalogue-home");
    // BUG: QA-F-15 (low) the home feed is cached 5 min (D-079), so just-hidden events stay on home
    // as cards that 404 (D-058 "hidden events leave no trace").
    const links = await page
      .locator('main a[href^="/events/"]')
      .evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    expect(links, "home still links to hidden events").toEqual([]);
    const main = page.locator("main");
    await expect(main).not.toContainText(/undefined|NaN|\{"error"/);
    await expect(main).toContainText(
      /no (gigs|shows|events|concerts)|nothing (here|yet)|coming soon|check back/i,
    );
    await expect(main).not.toContainText(/\b3 gigs\b/);
    await openSearch(page);
    await search(page).pressSequentially("lolla", { delay: 40 });
    await page.waitForTimeout(1500);
    await expect(page.getByRole("option")).toHaveCount(0);
    await expect(main).toContainText(/no .*yet|nothing|we.ll keep checking/i);
    await page.goto("/search?q=lolla");
    await settle(page);
    await expect(page.locator("main")).toContainText(/no .*(yet|results|shows)|nothing/i);
    await finalShot(page, info, "empty-catalogue-search");
    w.assertClean();
  } finally {
    await sql`update events set visibility = 'published' where id in ${sql(ids)}`;
    await sql.end();
  }
});

/** Empty catalogue and a city with no events (D-050 location, RESUME "empty-catalogue home state"). */
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

test.describe.configure({ mode: "serial" });

test("city switcher: a city with no events says so and offers a way out, nothing pretends to be local", async ({
  page,
  context,
}, info) => {
  const w = watch(page);
  await gotoHome(page);
  await page.getByRole("button", { name: /change city/i }).click();
  await page
    .getByRole("list", { name: /choose your city/i })
    .getByRole("button", { name: "Chennai" })
    .click();
  await settle(page);
  // the choice is remembered in a cookie (D-050) and survives a reload
  const cookies = await context.cookies();
  expect(
    cookies.some((c) => /chennai/i.test(decodeURIComponent(c.value))),
    JSON.stringify(cookies),
  ).toBe(true);
  await page.reload();
  await settle(page);
  await expect(page.getByRole("button", { name: /city: chennai/i })).toBeVisible();
  const main = page.locator("main");
  await expect(main).toContainText(/chennai/i);
  await expect(main).toContainText(/no (gigs|shows|events|concerts)[^.]*(chennai|yet|here)/i);
  await finalShot(page, info, "city-chennai-empty");
  // no out-of-town show is presented as being in Chennai
  for (const card of await page.locator("main article").allInnerTexts())
    expect(card).not.toMatch(/chennai/i);
  // the copy says the rest is from elsewhere, and the switcher is the way back to All India
  await expect(main).toContainText(/across India|all India|elsewhere/i);
  await page.getByRole("button", { name: /change city/i }).click();
  await expect(page.getByRole("button", { name: "All India" })).toBeVisible();
  w.assertClean();
});

test("city switcher: choosing Pune puts Pune shows first / only", async ({ page }, info) => {
  await gotoHome(page);
  await page.getByRole("button", { name: /change city/i }).click();
  await page
    .getByRole("list", { name: /choose your city/i })
    .getByRole("button", { name: "Pune" })
    .click();
  await settle(page);
  await expect(page.getByRole("button", { name: /city: pune/i })).toBeVisible();
  const first = page.locator("main article h3").first();
  await expect(first).toContainText(/NH7 Weekender Pune/);
  await finalShot(page, info, "city-pune");
});

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
    await gotoHome(page);
    await finalShot(page, info, "empty-catalogue-home");
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
    await sql`update events set visibility = 'published' where id = any(${sql.array(ids)}::uuid[])`;
    await sql.end();
  }
});

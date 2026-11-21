/** Exploratory walk of a first-time visitor. Screenshots go to screenshots/final/ for review. */
import {
  DILJIT_TITLE,
  LOLLA_TITLE,
  NH7_TITLE,
  eventId,
  finalShot,
  gotoHome,
  openSearch,
  search,
  settle,
  test,
} from "./helpers";

test("first-time visitor walk", async ({ page }, info) => {
  const timings: Record<string, number> = {};
  const time = async (k: string, f: () => Promise<unknown>) => {
    const t = Date.now();
    await f();
    timings[k] = Date.now() - t;
  };
  await time("home", () => gotoHome(page));
  await finalShot(page, info, "x-home-full");
  await finalShot(page, info, "x-home-fold", false);
  await page.getByRole("button", { name: /change city/i }).click();
  await finalShot(page, info, "x-city-switcher", false);
  await page.keyboard.press("Escape");
  await openSearch(page);
  await search(page).pressSequentially("d", { delay: 40 });
  await finalShot(page, info, "x-search-1char", false);
  await search(page).pressSequentially("iljeet", { delay: 40 });
  await page.waitForTimeout(1200);
  await finalShot(page, info, "x-search-diljeet-typo", false);
  await search(page).fill("fest");
  await page.waitForTimeout(1500);
  await finalShot(page, info, "x-search-fest", false);
  for (const t of [LOLLA_TITLE, NH7_TITLE, DILJIT_TITLE]) {
    const id = await eventId(page.request, t);
    await time(`event-${t.split(" ")[0]}`, async () => {
      await page.goto(`/events/${id}`);
      await settle(page);
    });
    await finalShot(page, info, `x-event-${t.split(" ")[0]}`);
  }
  await page.goto("/events/00000000-0000-4000-8000-000000000000");
  await finalShot(page, info, "x-event-404");
  await page.goto("/search?q=diljit");
  await settle(page);
  await finalShot(page, info, "x-search-page");
  test.info().annotations.push({ type: "timings-ms", description: JSON.stringify(timings) });
  console.log(info.project.name, "timings", JSON.stringify(timings));
});

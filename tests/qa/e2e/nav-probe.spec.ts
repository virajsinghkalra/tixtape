import { LOLLA_TITLE, eventId, expect, test } from "./helpers";
// was QA-UI-0: on the event page, links (All events, logo) didn't navigate: the router kept re-fetching the event RSC payload.
// Probe: does client-side navigation via links work? Logs RSC request count and final URL.
test("probe client nav", async ({ page }) => {
  const lolla = await eventId(page.request, LOLLA_TITLE);
  let rsc = 0;
  page.on("request", (r) => {
    if (r.url().includes("_rsc=")) rsc++;
  });
  page.on("response", (r) => r.status() >= 400 && console.log("BAD", r.status(), r.url()));
  page.on("console", (m) => m.type() === "error" && console.log("CONERR", m.text().slice(0, 200)));
  await page.goto(`/events/${lolla}`);
  await page.waitForTimeout(3000);
  rsc = 0;
  await page.getByRole("link", { name: /all events/i }).click();
  await page.waitForTimeout(10000);
  console.log("after All events:", page.url(), "rsc requests", rsc);
  expect(new URL(page.url()).pathname).toBe("/");
});

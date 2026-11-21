import { LOLLA_TITLE, eventId, expect, gotoHome, test, watch } from "./helpers";

test.describe("P3.2 navigation", () => {
  test("home -> event -> back -> forward -> reload", async ({ page }) => {
    const LOLLA = await eventId(page.request, LOLLA_TITLE);
    const w = watch(page);
    await gotoHome(page);
    await page.locator(`a[href="/events/${LOLLA}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(LOLLA));
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Lollapalooza/i);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Lollapalooza/i);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Lollapalooza/i);
    w.assertClean();
  });

  test("'All events' link returns home", async ({ page }) => {
    const LOLLA = await eventId(page.request, LOLLA_TITLE);
    await page.goto(`/events/${LOLLA}`);
    await page.getByRole("link", { name: /all events/i }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  // was QA-UI-1: unknown event id rendered a not-found page but with HTTP 200 (soft 404)
  test("unknown event id: proper not-found page with HTTP 404", async ({ page }, info) => {
    const res = await page.goto("/events/00000000-0000-4000-8000-000000000000");
    await page.screenshot({
      path: `tests/qa/e2e/screenshots/${info.project.name}-event-unknown.png`,
      fullPage: true,
    });
    await expect(page.locator("body")).toContainText(
      /not found|couldn.t find|doesn.t exist|no such|isn.t on the bill|404/i,
    );
    await expect(page.getByRole("link", { name: /home|all events|back/i }).first()).toBeVisible();
    expect(res?.status()).toBe(404);
  });

  // was QA-UI-1: malformed id also answered HTTP 200
  test("malformed id /events/abc: not-found page with HTTP 404, no crash", async ({
    page,
  }, info) => {
    const errs: string[] = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const res = await page.goto("/events/abc");
    await page.screenshot({
      path: `tests/qa/e2e/screenshots/${info.project.name}-event-abc.png`,
      fullPage: true,
    });
    await expect(page.locator("body")).toContainText(
      /not found|couldn.t find|doesn.t exist|no such|isn.t on the bill|404/i,
    );
    await expect(page.locator("body")).not.toContainText(/\{"error"|stack|TypeError/);
    expect(errs).toEqual([]);
    expect(res?.status()).toBe(404);
  });
});

import { expect, test } from "@playwright/test";
import { eventId, NAVIGATION, openEvent } from "./helpers";
import { warmUp } from "./warm-up";

test.beforeAll(async ({ browser, baseURL }) => {
  test.setTimeout(400_000);
  await warmUp(browser, baseURL);
});

test("lineup poster: headliners first and biggest, support last, each with a Spotify state", async ({
  page,
  request,
}) => {
  await openEvent(page, await eventId(request, "lolla"), /lollapalooza/i);
  const tiers = await page
    .locator("[data-tier]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-tier")));
  expect(tiers).toEqual(["headliner", "sub", "mid", "support"]);
  const size = (tier: string) =>
    page
      .locator(`[data-tier="${tier}"] [data-testid="lineup-artist"]`)
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el.firstElementChild!).fontSize));
  expect(await size("headliner")).toBeGreaterThan(await size("support"));
  await expect(page.locator('[data-testid="lineup-artist"] [data-match]')).toHaveCount(8);
  await expect(page.getByText(/of\s+8\s+found on spotify/i)).toBeVisible();
});

test("event story: step through the slides with the arrow buttons", async ({ page, request }) => {
  await openEvent(page, await eventId(request, "lolla"), /lollapalooza/i);
  const story = page.getByRole("region", { name: /your lollapalooza in \d slides/i });
  await story.getByRole("button", { name: "Next slide" }).click();
  await expect(story.getByText(/slide 2\/\d: the headliners/i)).toBeAttached();
  await story.getByRole("button", { name: "Previous slide" }).click();
  await expect(story.getByText(/slide 1\/\d/i)).toBeAttached();
});

test("unknown and malformed ids return a real 404", async ({ page }) => {
  for (const path of ["/events/00000000-0000-4000-8000-000000000000", "/events/abc"]) {
    const res = await page.goto(path);
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /isn.t on the bill/i })).toBeVisible();
  }
});

test("no horizontal scroll on the event page", async ({ page, request }) => {
  await openEvent(page, await eventId(request, "lolla"), /lollapalooza/i);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("'All events' goes home", async ({ page, request }) => {
  await openEvent(page, await eventId(request, "lolla"), /lollapalooza/i);
  await page.getByRole("link", { name: /all events/i }).click();
  await expect(page).toHaveURL(/\/$/, NAVIGATION);
});

test("Spotify labels aren't repeated: one link name per matched artist and one summary line", async ({
  page,
  request,
}) => {
  await openEvent(page, await eventId(request, "lolla"), /lollapalooza/i);
  const poster = page.getByRole("region", { name: "The lineup" });
  const text = await poster.innerText();
  expect(text).not.toMatch(/\((on|finding on) spotify\)/i);
  expect(text.match(/found on spotify/gi)).toHaveLength(1);
  // Matched artists (when the data has any) are one link each, named "<artist> on Spotify".
  for (const link of await poster.getByRole("link", { name: /on spotify/i }).all()) {
    await expect(link).toHaveAttribute("aria-label", /^.+ on Spotify \(opens in new tab\)$/);
  }
});

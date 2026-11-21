import { expect, type APIRequestContext, type Page, type Route } from "@playwright/test";

/** Opening a page may compile the route on the dev server; allow for it. */
export const NAVIGATION = { timeout: 15_000 };

export const search = (page: Page) =>
  page.getByRole("combobox", { name: /search concerts, festivals, artists or cities/i });

/** A fixture event's id (tests/e2e/fixtures/seed.ts), looked up by title so ids aren't hard-coded. */
export async function eventId(request: APIRequestContext, q: string): Promise<string> {
  const res = await request.get(`/api/events?${new URLSearchParams({ q, pageSize: "1" })}`);
  const body = (await res.json()) as { events: { id: string }[] };
  const id = body.events[0]?.id;
  if (!id) throw new Error(`No fixture event matches "${q}"; the E2E global setup seeds them.`);
  return id;
}

export type StubEvent = {
  id: string;
  title: string;
  type?: string;
  city?: string;
  matchReason?: string;
  matchedText?: string;
  matchedArtist?: string;
};

export const result = (e: StubEvent) => ({
  type: "festival",
  startsAt: "2027-01-23T06:30:00.000Z",
  startsAtDateOnly: false,
  city: "Mumbai",
  venueName: "Mahalaxmi Racecourse",
  matchReason: "title",
  matchedText: "",
  ...e,
});

/** Answers `GET /api/events/suggest` with `body`, optionally after a delay. */
export async function stubSuggest(page: Page, body: object | ((q: string) => object), delayMs = 0) {
  await page.route(/\/api\/events\/suggest\?/, async (route: Route) => {
    const q = new URL(route.request().url()).searchParams.get("q") ?? "";
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(typeof body === "function" ? body(q) : body),
    });
  });
}

export const typed = (over: Record<string, unknown>) => ({
  results: [],
  artists: [],
  cities: [],
  filters: {},
  ...over,
});

export async function openEvent(page: Page, id: string, title: RegExp) {
  await page.goto(`/events/${id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(title, NAVIGATION);
}

/** Answers `POST /api/lookup` (D-050) with `body`, optionally after a delay. */
export async function stubLookup(page: Page, status: number, body: unknown, delayMs = 0) {
  await page.route("**/api/lookup", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
}

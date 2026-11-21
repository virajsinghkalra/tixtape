/**
 * D-056 / D-058 / D-060: held and archived events never appear on any public path.
 * Fixtures are inserted straight into concert_e2e and removed afterwards.
 */
import {
  e2eDb,
  expect,
  finalShot,
  gotoHome,
  openSearch,
  options,
  search,
  settle,
  test,
  watch,
} from "./helpers";

const HELD = { title: "Zorblax Arena Festival Goa 2027", artist: "Qwyndel Starhaze", city: "Goa" };
const ARCHIVED = {
  title: "Vexmoor Beats Shillong 2026",
  artist: "Plorvane Duskwell",
  city: "Shillong",
};
let heldId = "";
let archivedId = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const sql = e2eDb();
  const add = async (
    e: typeof HELD,
    visibility: "held" | "archived",
    startsAt: string,
  ): Promise<string> => {
    const [v] = await sql<{ id: string }[]>`
      insert into venues (name, normalized_name, city, country)
      values (${e.city + " QA Grounds"}, ${(e.city + " qa grounds").toLowerCase()}, ${e.city}, 'IN') returning id`;
    const [a] = await sql<{ id: string }[]>`
      insert into artists (name, normalized_name, match_status)
      values (${e.artist}, ${e.artist.toLowerCase()}, 'pending') returning id`;
    const [ev] = await sql<{ id: string }[]>`
      insert into events (title, type, venue_id, starts_at, dedupe_key, visibility, lineup_hash)
      values (${e.title}, 'festival', ${v!.id}, ${startsAt}, ${"qa-hidden-" + e.title}, ${visibility}, 'qa')
      returning id`;
    await sql`insert into event_artists (event_id, artist_id, billing_rank, tier)
              values (${ev!.id}, ${a!.id}, 1, 'headliner')`;
    return ev!.id;
  };
  heldId = await add(HELD, "held", "2027-03-12T18:00:00+05:30");
  archivedId = await add(ARCHIVED, "archived", "2026-10-10T18:00:00+05:30");
  await sql.end();
});

test.afterAll(async () => {
  const sql = e2eDb();
  await sql`delete from events where id in (${heldId}, ${archivedId})`;
  await sql`delete from artists where name in (${HELD.artist}, ${ARCHIVED.artist})`;
  await sql`delete from venues where name like '% QA Grounds'`;
  await sql.end();
});

// "Shillong" is a known city word, so the query parser may echo it as a filter; it must never
// show up as a city with upcoming shows (checked separately).
const hiddenWords = /zorblax|qwyndel|vexmoor|plorvane/i;

test("public APIs never return held or archived events (suggest, search, list, recommendations)", async ({
  request,
}) => {
  const bodies: string[] = [];
  for (const q of [
    "zorblax",
    "zorblx",
    "qwyndel",
    "qwyndl starhze",
    "vexmoor",
    "plorvane",
    "goa",
    "shillong",
  ]) {
    bodies.push(await (await request.get(`/api/events/suggest?q=${encodeURIComponent(q)}`)).text());
    bodies.push(await (await request.get(`/api/search?q=${encodeURIComponent(q)}`)).text());
    bodies.push(await (await request.get(`/api/events?q=${encodeURIComponent(q)}`)).text());
  }
  bodies.push(await (await request.get("/api/events/suggest?q=")).text());
  bodies.push(await (await request.get("/api/events")).text());
  bodies.push(await (await request.get("/api/search?city=Goa")).text());
  for (const q of ["shillong", "goa"]) {
    const body = await (await request.get(`/api/events/suggest?q=${q}`)).json();
    expect(body.cities ?? [], `${q} has no published shows`).toEqual([]);
    expect(body.results ?? []).toEqual([]);
  }
  for (const b of bodies) {
    expect(b).not.toMatch(hiddenWords);
    expect(b).not.toContain(heldId);
    expect(b).not.toContain(archivedId);
  }
});

test("held event: every public path answers the same 404 as a missing id", async ({ request }) => {
  const missing = "00000000-0000-4000-8000-000000000000";
  const pairs: [string, "GET" | "POST"][] = [
    ["/api/events/{id}", "GET"],
    ["/api/events/{id}/playlist", "GET"],
    ["/api/events/{id}/playlist", "POST"],
    ["/api/events/{id}/view", "POST"],
  ];
  for (const [path, method] of pairs) {
    const call = (id: string) =>
      method === "GET"
        ? request.get(path.replace("{id}", id))
        : request.post(path.replace("{id}", id), { data: {} });
    const [h, m] = [await call(heldId), await call(missing)];
    expect(h.status(), `${method} ${path} (held)`).toBe(404);
    expect(await h.text(), `${method} ${path}: held must look exactly like missing`).toBe(
      await m.text(),
    );
  }
  expect((await request.get(`/events/${heldId}`)).status()).toBe(404);
});

test("archived (past) event (D-070): reachable by link, labelled 'This happened on', no new build", async ({
  request,
  page,
}, info) => {
  const w = watch(page, { allowStatus: (u) => /\/playlist$/.test(u) });
  const res = await page.goto(`/events/${archivedId}`);
  // BUG: QA-F-12 an archived event's direct link answers 404 (D-070: reachable, "This happened on")
  expect(res?.status()).toBe(200);
  await settle(page);
  await finalShot(page, info, "archived-event");
  const main = page.locator("main");
  await expect(main).toContainText(/this happened on/i);
  await expect(main).toContainText(/10 Oct 2026|Oct 10, 2026|10 October 2026/i);
  await expect(main).not.toContainText(/days to go|in \d+ months?|announced/i);
  // it can't start a new playlist build
  await expect(page.getByRole("button", { name: /make playlist/i })).toHaveCount(0);
  const start = await request.post(`/api/events/${archivedId}/playlist`, { data: {} });
  expect(start.status(), await start.text()).toBeGreaterThanOrEqual(400);
  expect(start.status()).toBeLessThan(500);
  expect(start.status()).not.toBe(202);
  w.assertClean();
});

test("UI: typing hidden names shows no hidden event, no 'Did you mean' to it, nothing on home", async ({
  page,
}) => {
  await gotoHome(page);
  expect(await page.locator("body").innerText()).not.toMatch(hiddenWords);
  await openSearch(page);
  expect(await page.locator("body").innerText()).not.toMatch(hiddenWords);
  for (const q of ["zorblax", "zorblx arena", "qwyndel", "plorvane"]) {
    await search(page).fill(q);
    await page.waitForTimeout(1200);
    const listText = await page
      .getByRole("listbox")
      .innerText()
      .catch(() => "");
    expect(listText).not.toMatch(hiddenWords);
    expect(await options(page).filter({ hasText: hiddenWords }).count()).toBe(0);
    const main = await page.locator("main").innerText();
    // the typed text itself is echoed ("No zorblax shows yet"); no other hidden name may appear
    expect(main.replace(new RegExp(q, "ig"), "")).not.toMatch(
      /qwyndel|starhaze|vexmoor|plorvane|Zorblax Arena/i,
    );
  }
  await page.goto("/search?q=zorblax");
  await settle(page);
  expect((await page.locator("main").innerText()).replace(/zorblax/gi, "")).not.toMatch(
    hiddenWords,
  );
});

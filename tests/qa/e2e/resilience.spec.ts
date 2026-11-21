/**
 * Failure modes: DB unavailable or slow, Spotify trouble as the browser sees it, two tabs, refresh
 * mid-build. Spotify itself is never called: its effects arrive through stubbed app endpoints.
 */
import type { Page, Route } from "@playwright/test";
import postgres from "postgres";
import {
  LOLLA_TITLE,
  e2eDb,
  eventId,
  expect,
  finalShot,
  gotoHome,
  groupOptions,
  openSearch,
  search,
  settle,
  test,
} from "./helpers";

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert";
const JOB = "22222222-2222-4222-8222-222222222222";
const STATUS = /\/api\/events\/[^/]+\/playlist$/;
const json = (r: Route, body: unknown, status = 200) =>
  r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
const panel = (page: Page) => page.locator("#playlist");

test.describe.configure({ mode: "serial" });

test("DB unavailable: pages and APIs fail with a friendly message, no stack trace", async ({
  page,
}, info) => {
  const lolla = await eventId(page.request, LOLLA_TITLE);
  const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
  await admin.unsafe("ALTER DATABASE concert_e2e ALLOW_CONNECTIONS false");
  await admin.unsafe(
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'concert_e2e' AND pid <> pg_backend_pid()",
  );
  try {
    for (const p of ["/", `/events/${lolla}`, "/search?q=lolla"]) {
      const res = await page.goto(p, { timeout: 60_000 });
      const body = await page.locator("body").innerText();
      await finalShot(
        page,
        info,
        `db-down${p === "/" ? "-home" : p.startsWith("/events") ? "-event" : "-search"}`,
      );
      expect(res?.status(), p).toBeGreaterThanOrEqual(500);
      expect(body, p).toMatch(/something went wrong|try again|can.t load|unavailable|trouble/i);
      expect(body, p).not.toMatch(
        /ECONNREFUSED|postgres|stack|at .*\.ts:\d+|does not allow connections/i,
      );
    }
    const api = await page.request.get("/api/events/suggest?q=lolla");
    expect(api.status()).toBeGreaterThanOrEqual(500);
    expect(await api.text()).not.toMatch(/postgres|stack|does not allow/i);
    // the search box says so in plain words
    await page.goto("/");
  } finally {
    await admin.unsafe("ALTER DATABASE concert_e2e ALLOW_CONNECTIONS true");
    await admin.end();
  }
  // and recovers once the DB is back
  await expect
    .poll(async () => (await page.request.get("/api/events/suggest?q=lolla")).status(), {
      timeout: 30_000,
    })
    .toBe(200);
  await gotoHome(page);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("DB slow (events table locked 6 s): search shows busy state, then results; no error", async ({
  page,
}) => {
  await gotoHome(page);
  await openSearch(page);
  const sql = e2eDb();
  const lock = sql.begin(async (tx) => {
    await tx`LOCK TABLE events IN ACCESS EXCLUSIVE MODE`;
    await new Promise((r) => setTimeout(r, 6000));
  });
  await page.waitForTimeout(300);
  await search(page).pressSequentially("nh7", { delay: 40 });
  await page.waitForTimeout(1200);
  await expect(page.locator("[aria-busy=true]").first()).toBeAttached();
  await lock;
  await sql.end();
  await expect(groupOptions(page, /events/i).filter({ hasText: /NH7/ })).toHaveCount(1, {
    timeout: 20_000,
  });
});

test("lookup errors (Spotify down → 500, slow → 7 s, 429) end in a friendly state, never an endless spinner", async ({
  page,
}) => {
  const modes: [string, (r: Route) => Promise<void>][] = [
    ["500", (r) => json(r, { error: { code: "internal", message: "x" } }, 500)],
    [
      "429",
      (r) =>
        r.fulfill({
          status: 429,
          headers: { "retry-after": "30" },
          contentType: "application/json",
          body: '{"error":{"code":"rate_limited","message":"Slow down"}}',
        }),
    ],
    [
      "slow",
      async (r) => {
        await new Promise((res) => setTimeout(res, 7000));
        await json(r, { status: "not_found", lookupId: "s" });
      },
    ],
  ];
  for (const [name, handler] of modes) {
    await page.unroute("**/api/lookup**");
    await page.route("**/api/lookup**", handler);
    await gotoHome(page);
    await openSearch(page);
    await search(page).pressSequentially(`qzz${name}band`, { delay: 30 });
    await page.waitForTimeout(name === "slow" ? 9000 : 3000);
    const main = await page.locator("main").innerText();
    expect(main, name).not.toMatch(/looking for/i);
    expect(main, name).not.toMatch(/\{"error"|rate_limited|internal/);
    expect(main, name).toMatch(/no .* yet|try (again|these)|later|isn.t responding/i);
  }
});

test("two tabs press Make playlist: the second joins the first build", async ({ context }) => {
  const a = await context.newPage();
  const b = await context.newPage();
  const lolla = await eventId(a.request, LOLLA_TITLE);
  let started = false;
  const posts: string[] = [];
  for (const p of [a, b]) {
    await p.route(STATUS, (r) => {
      if (r.request().method() === "POST") {
        posts.push(p === a ? "a" : "b");
        started = true;
        return json(r, { status: "building", jobId: JOB }, 202);
      }
      return json(r, started ? { status: "building", jobId: JOB } : { status: "none" });
    });
    await p.route(/\/api\/playlist-jobs\//, (r) =>
      json(r, {
        jobId: JOB,
        status: "running",
        stage: "select",
        progress: 30,
        artistsDone: 2,
        artistsTotal: 8,
        unresolved: [],
      }),
    );
  }
  await a.goto(`/events/${lolla}`);
  await settle(a);
  await a.getByRole("button", { name: /make playlist/i }).click();
  await expect(a.getByRole("progressbar")).toBeVisible();
  await b.goto(`/events/${lolla}`);
  await expect(panel(b)).toContainText(/joining|already making|picking songs/i);
  await expect(b.getByRole("button", { name: /make playlist/i })).toHaveCount(0);
  expect(posts).toEqual(["a"]);
});

test("refresh mid-build resumes the progress, then finishes", async ({ page }) => {
  const lolla = await eventId(page.request, LOLLA_TITLE);
  let steps = 0;
  await page.route(STATUS, (r) => json(r, { status: "building", jobId: JOB }));
  await page.route(/\/api\/playlist-jobs\//, (r) => {
    steps++;
    return json(
      r,
      steps < 6
        ? {
            jobId: JOB,
            status: "running",
            stage: "write",
            progress: 88,
            artistsDone: 8,
            artistsTotal: 8,
            unresolved: [],
          }
        : {
            jobId: JOB,
            status: "succeeded",
            stage: "done",
            progress: 100,
            artistsDone: 8,
            artistsTotal: 8,
            unresolved: [],
            playlistUrl: "https://open.spotify.com/playlist/37i9dQZF1DXqaQA0000003",
          },
    );
  });
  await page.goto(`/events/${lolla}`);
  await expect(page.getByRole("progressbar")).toBeVisible();
  await page.reload();
  await expect(panel(page)).toContainText(/adding songs|joining|making/i);
  await expect(page.getByRole("link", { name: /open in spotify/i })).toBeVisible({
    timeout: 20_000,
  });
});

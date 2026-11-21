import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { eventId, openEvent } from "./helpers";
import { warmUp } from "./warm-up";

/**
 * The playlist button states (docs/SEARCH_FLOW.md §D). The Playlist Engine routes are stubbed
 * with page.route: E2E never talks to real Spotify.
 */

const URL_ = "https://open.spotify.com/playlist/test123";
let id = "";

test.beforeAll(async ({ browser, baseURL, request }) => {
  test.setTimeout(400_000);
  await warmUp(browser, baseURL);
  id = await eventId(request, "lolla");
});

type Stubs = {
  status: unknown;
  start?: { status: number; body: unknown; headers?: Record<string, string> };
  steps?: unknown[];
};

async function stubPlaylist(page: Page, s: Stubs) {
  await page.route(/\/api\/events\/[^/]+\/playlist$/, (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(s.status) });
    }
    const start = s.start ?? { status: 503, body: { error: { code: "playlist_unavailable" } } };
    return route.fulfill({
      status: start.status,
      contentType: "application/json",
      headers: start.headers,
      body: JSON.stringify(start.body),
    });
  });
  let n = 0;
  await page.route(/\/api\/playlist-jobs\/[^/]+\/step$/, (route) => {
    const steps = s.steps ?? [];
    const body = steps[Math.min(n++, steps.length - 1)];
    return route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
}

const step = (over: Record<string, unknown>) => ({
  jobId: "job-1",
  status: "running",
  stage: "select",
  progress: 30,
  artistsDone: 3,
  artistsTotal: 8,
  unresolved: [],
  ...over,
});

const panel = (page: Page) => page.locator("#playlist");

test("ready: Open in Spotify, Copy link and Share", async ({ page }) => {
  await stubPlaylist(page, {
    status: { status: "ready", url: URL_, builtAt: "2026-11-21T10:00:00Z", stale: false },
  });
  await openEvent(page, id, /lollapalooza/i);
  await expect(panel(page).getByRole("link", { name: /open in spotify/i })).toHaveAttribute(
    "href",
    URL_,
  );
  await expect(panel(page).getByRole("button", { name: "Copy link" })).toBeVisible();
  await expect(panel(page)).toContainText(/live on spotify/i);
});

test("none → Make playlist → named stages → confetti and Open in Spotify", async ({ page }) => {
  await stubPlaylist(page, {
    status: { status: "none" },
    start: { status: 202, body: { status: "building", jobId: "job-1" } },
    steps: [
      step({}),
      step({ stage: "create", progress: 82, artistsDone: 8 }),
      step({ stage: "write", progress: 92, artistsDone: 8 }),
      step({ status: "succeeded", stage: "done", progress: 100, playlistUrl: URL_ }),
    ],
  });
  await openEvent(page, id, /lollapalooza/i);
  await panel(page)
    .getByRole("button", { name: /make playlist/i })
    .click();
  await expect(panel(page)).toContainText("Picking songs…");
  await expect(panel(page)).toContainText("Creating…", { timeout: 6000 });
  await expect(panel(page).getByRole("link", { name: /open in spotify/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(panel(page)).toContainText(/live on spotify/i);
});

test("building (started by someone else): joins the same progress", async ({ page }) => {
  await stubPlaylist(page, {
    status: { status: "building", jobId: "job-1" },
    steps: [step({ progress: 50 })],
  });
  await openEvent(page, id, /lollapalooza/i);
  await expect(panel(page)).toContainText(/picking songs/i, { timeout: 6000 });
  await expect(panel(page).getByRole("progressbar")).toBeVisible();
});

test("ready + stale: stays open while it refreshes into the same playlist", async ({ page }) => {
  let started = 0;
  await stubPlaylist(page, {
    status: { status: "ready", url: URL_, stale: true },
    start: { status: 202, body: { status: "building", jobId: "job-1" } },
    steps: [step({ progress: 40 })],
  });
  page.on("request", (r) => r.method() === "POST" && /\/playlist$/.test(r.url()) && started++);
  await openEvent(page, id, /lollapalooza/i);
  await expect(panel(page).getByRole("link", { name: /open in spotify/i })).toBeVisible();
  await expect(panel(page)).toContainText(/refreshing…/i);
  await expect.poll(() => started).toBe(1);
});

test("partial: opens the playlist with no comment on skipped artists (D-082)", async ({ page }) => {
  await stubPlaylist(page, {
    status: { status: "none" },
    start: { status: 202, body: { status: "building", jobId: "job-1" } },
    steps: [
      step({
        status: "partial",
        stage: "done",
        progress: 100,
        playlistUrl: URL_,
        unresolved: ["Nucleya", "Ritviz"],
      }),
    ],
  });
  await openEvent(page, id, /lollapalooza/i);
  await panel(page)
    .getByRole("button", { name: /make playlist/i })
    .click();
  await expect(panel(page).getByRole("link", { name: /open in spotify/i })).toBeVisible({
    timeout: 6000,
  });
  await expect(panel(page)).not.toContainText(/skipped|Nucleya/);
});

test("paused: tells when it continues (IST) and keeps polling", async ({ page }) => {
  await stubPlaylist(page, {
    status: { status: "building", jobId: "job-1" },
    steps: [step({ status: "paused", resumeAfter: "2026-11-21T13:10:00Z" })],
  });
  await openEvent(page, id, /lollapalooza/i);
  await expect(panel(page)).toContainText(/paused · back at 6:40 pm/i, {
    timeout: 6000,
  });
});

test("unavailable: says so kindly and offers no button", async ({ page }) => {
  await stubPlaylist(page, { status: { status: "none" } });
  await openEvent(page, id, /lollapalooza/i);
  await panel(page)
    .getByRole("button", { name: /make playlist/i })
    .click();
  await expect(panel(page)).toContainText(/opening soon/i);
  await expect(panel(page).getByRole("button")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText('{"error"');
});

test("a build that makes no progress never spins forever", async ({ page }) => {
  test.setTimeout(60_000);
  await stubPlaylist(page, {
    status: { status: "building", jobId: "job-1" },
    steps: [step({ status: "queued", stage: null, progress: 0, artistsDone: 0 })],
  });
  await openEvent(page, id, /lollapalooza/i);
  await expect(panel(page)).toContainText(/still cooking/i, { timeout: 30_000 });
  await expect(panel(page).getByRole("progressbar")).toHaveCount(0);
});

/** The E2E database (D-049): these tests may add and remove their own rows there, nothing else. */
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert_e2e";

test.describe("first paint shows the real playlist state", () => {
  test("a ready playlist shows Open in Spotify in the first HTML, and never Make playlist", async ({
    page,
    request,
  }) => {
    const sql = postgres(E2E_DB, { max: 1, onnotice: () => {} });
    try {
      // Built against the current lineup, so it is "ready" and not stale.
      await sql`
        insert into shared_playlists (event_id, spotify_playlist_id, url, track_ids, lineup_hash_at_build)
        select id, 'e2e-ready-test', ${URL_}, ${["t1"]}, lineup_hash from events where id = ${id}
        on conflict (event_id) do nothing`;
      const html = await (await request.get(`/events/${id}`)).text();
      expect(html).toContain("Open in Spotify");
      expect(html).not.toContain("Make playlist");

      await page.addInitScript(() => {
        const w = window as unknown as { __sawMake?: boolean };
        new MutationObserver(() => {
          if (document.body?.innerText.includes("Make playlist")) w.__sawMake = true;
        }).observe(document, { subtree: true, childList: true, characterData: true });
      });
      await openEvent(page, id, /lollapalooza/i);
      await expect(panel(page).getByRole("link", { name: /open in spotify/i })).toBeVisible();
      await page.waitForTimeout(1500); // let the client status refresh run
      expect(
        await page.evaluate(
          () => (window as unknown as { __sawMake?: boolean }).__sawMake ?? false,
        ),
      ).toBe(false);
    } finally {
      await sql`delete from shared_playlists where spotify_playlist_id = 'e2e-ready-test'`;
      await sql.end();
    }
  });

  test("no playlist yet: Make playlist", async ({ page }) => {
    await openEvent(page, id, /lollapalooza/i);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toBeVisible();
  });

  test("if the status refresh fails, the user can still make one", async ({ page }) => {
    await page.route(/\/api\/events\/[^/]+\/playlist$/, (route) =>
      route.request().method() === "GET"
        ? route.fulfill({ status: 500, body: "{}" })
        : route.fulfill({
            status: 202,
            contentType: "application/json",
            body: JSON.stringify({ status: "building", jobId: "job-1" }),
          }),
    );
    await page.route(/\/api\/playlist-jobs\/[^/]+\/step$/, (route) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(step({})) }),
    );
    await openEvent(page, id, /lollapalooza/i);
    await panel(page)
      .getByRole("button", { name: /make playlist/i })
      .click();
    await expect(panel(page)).toContainText("Picking songs…");
  });
});

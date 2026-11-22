/**
 * SEARCH_FLOW D: the playlist button on the event page (D-036). States the browser drives are
 * stubbed with page.route; "ready in the first HTML" and "stale" need a real shared_playlists
 * row in concert_e2e, which each test removes again.
 */
import type { Page, Route } from "@playwright/test";
import {
  LOLLA_TITLE,
  NH7_TITLE,
  e2eDb,
  eventId,
  expect,
  finalShot,
  settle,
  test,
  watch,
} from "./helpers";

const JOB = "11111111-1111-4111-8111-111111111111";
const URL_OK = "https://open.spotify.com/playlist/37i9dQZF1DXqaQA0000001";
const STATUS = /\/api\/events\/[^/]+\/playlist$/;
const JOBS = /\/api\/playlist-jobs\//;

type Progress = {
  status: string;
  stage: string | null;
  progress: number;
  artistsDone: number;
  artistsTotal: number;
  unresolved?: string[];
  resumeAfter?: string;
  playlistUrl?: string;
  error?: string;
};
const prog = (p: Progress) => ({ jobId: JOB, unresolved: [], ...p });
const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function stubJob(page: Page, steps: Progress[]) {
  let i = 0;
  const calls: string[] = [];
  await page.route(JOBS, (r) => {
    calls.push(`${r.request().method()} ${r.request().url()}`);
    const p = steps[Math.min(i++, steps.length - 1)]!;
    return json(r, prog(p));
  });
  return calls;
}

const panel = (page: Page) => page.locator("#playlist");
const openInSpotify = (page: Page) => page.getByRole("link", { name: /open in spotify/i });

test.describe("D. playlist panel", () => {
  test("none → Make playlist → named progress stages → done: Open in Spotify (UX #5: no Copy link)", async ({
    page,
  }, info) => {
    const w = watch(page);
    const id = await eventId(page.request, LOLLA_TITLE);
    const posts: string[] = [];
    await page.route(STATUS, (r) => {
      if (r.request().method() === "POST") {
        posts.push(r.request().url());
        return json(r, { status: "building", jobId: JOB }, 202);
      }
      return json(r, { status: "none" });
    });
    await stubJob(page, [
      { status: "running", stage: "select", progress: 20, artistsDone: 2, artistsTotal: 8 },
      { status: "running", stage: "select", progress: 60, artistsDone: 6, artistsTotal: 8 },
      { status: "running", stage: "create", progress: 82, artistsDone: 8, artistsTotal: 8 },
      { status: "running", stage: "write", progress: 92, artistsDone: 8, artistsTotal: 8 },
      {
        status: "succeeded",
        stage: "done",
        progress: 100,
        artistsDone: 8,
        artistsTotal: 8,
        playlistUrl: URL_OK,
      },
    ]);
    await page.goto(`/events/${id}`);
    await settle(page);
    const seen = new Set<string>();
    page.on("console", () => {});
    await panel(page)
      .getByRole("button", { name: /make playlist/i })
      .click();
    const bar = page.getByRole("progressbar");
    await expect(bar).toBeVisible();
    for (let t = 0; t < 40 && (await openInSpotify(page).count()) === 0; t++) {
      seen.add((await panel(page).innerText()).replace(/\s+/g, " "));
      await page.waitForTimeout(250);
    }
    const all = [...seen].join(" | ");
    // D-082: stage in a few words, no counts ("Matching…", "Picking songs…", …)
    expect(all).toMatch(/picking songs|matching/i);
    expect(all).toMatch(/creating/i);
    expect(all).toMatch(/adding songs/i);
    expect(all).not.toMatch(/\d+\/\d+|\d+ songs/);
    await expect(openInSpotify(page)).toHaveAttribute("href", URL_OK);
    await expect(openInSpotify(page)).toHaveAttribute("target", "_blank");
    await expect(panel(page)).toContainText(/live on spotify/i);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    expect(posts).toHaveLength(1);
    await finalShot(page, info, "D-done");
    w.assertClean();
  });

  test("double-clicking Make playlist starts only one build", async ({ page }) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    const posts: string[] = [];
    await page.route(STATUS, (r) => {
      if (r.request().method() === "POST") {
        posts.push(r.request().url());
        return json(r, { status: "building", jobId: JOB }, 202);
      }
      return json(r, { status: "none" });
    });
    await stubJob(page, [
      { status: "running", stage: "select", progress: 10, artistsDone: 1, artistsTotal: 8 },
    ]);
    await page.goto(`/events/${id}`);
    await settle(page);
    await panel(page)
      .getByRole("button", { name: /make playlist/i })
      .dblclick();
    await page.waitForTimeout(1500);
    expect(posts).toHaveLength(1);
  });

  test("building (started by someone else): joins the same progress, no duplicate build", async ({
    page,
  }, info) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    const posts: string[] = [];
    await page.route(STATUS, (r) => {
      if (r.request().method() === "POST") posts.push(r.request().url());
      return json(r, { status: "building", jobId: JOB });
    });
    const calls = await stubJob(page, [
      { status: "running", stage: "select", progress: 40, artistsDone: 3, artistsTotal: 8 },
      { status: "running", stage: "write", progress: 90, artistsDone: 8, artistsTotal: 8 },
      {
        status: "succeeded",
        stage: "done",
        progress: 100,
        artistsDone: 8,
        artistsTotal: 8,
        playlistUrl: URL_OK,
      },
    ]);
    await page.goto(`/events/${id}`);
    // joins at once: the progress (or the finished playlist), never a Make playlist button
    await expect(panel(page)).toContainText(
      /joining|making|matching|picking|adding|live on spotify/i,
    );
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    await finalShot(page, info, "D-building-join");
    await expect(openInSpotify(page)).toBeVisible({ timeout: 20_000 });
    expect(posts, "joining must not start a second build").toEqual([]);
    expect(calls.every((c) => c.includes(JOB))).toBe(true);
  });

  test("partial: Open in Spotify; per D-082 no skipped-artist commentary", async ({
    page,
  }, info) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    await page.route(STATUS, (r) => json(r, { status: "building", jobId: JOB }));
    await stubJob(page, [
      {
        status: "partial",
        stage: "done",
        progress: 100,
        artistsDone: 8,
        artistsTotal: 8,
        unresolved: ["Nucleya", "Ritviz"],
        playlistUrl: URL_OK,
      },
    ]);
    await page.goto(`/events/${id}`);
    await expect(openInSpotify(page)).toBeVisible({ timeout: 20_000 });
    await expect(panel(page)).toContainText(/live on spotify/i);
    await expect(panel(page)).not.toContainText(/skipped|aren.t on Spotify/i);
    await finalShot(page, info, "D-partial");
  });

  test("paused: 'Paused · back at h:mm', and the page keeps polling", async ({ page }, info) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    await page.route(STATUS, (r) => json(r, { status: "building", jobId: JOB }));
    const resume = new Date(Date.now() + 4000).toISOString();
    const calls = await stubJob(page, [
      {
        status: "paused",
        stage: "select",
        progress: 30,
        artistsDone: 3,
        artistsTotal: 8,
        resumeAfter: resume,
      },
      {
        status: "paused",
        stage: "select",
        progress: 30,
        artistsDone: 3,
        artistsTotal: 8,
        resumeAfter: resume,
      },
      { status: "running", stage: "select", progress: 50, artistsDone: 5, artistsTotal: 8 },
    ]);
    await page.goto(`/events/${id}`);
    // BUG: QA-F-19 a paused step (Spotify 429) still reads "Picking songs…"; D-082 says
    // "Paused · back at 5:33 pm"
    await expect(panel(page)).toContainText(/paused · back at \d{1,2}:\d{2}\s*(am|pm)/i, {
      timeout: 15_000,
    });
    await expect(openInSpotify(page)).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    await finalShot(page, info, "D-paused");
    const before = calls.length;
    await page.waitForTimeout(9000);
    expect(calls.length, "the page stopped polling while paused").toBeGreaterThan(before);
  });

  test("unavailable (503): 'Opening soon 😴' (D-082), no Open in Spotify", async ({
    page,
  }, info) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    await page.route(STATUS, (r) =>
      r.request().method() === "POST"
        ? json(
            r,
            {
              error: { code: "unavailable", message: "Playlist making is temporarily unavailable" },
            },
            503,
          )
        : json(r, { status: "none" }),
    );
    await page.goto(`/events/${id}`);
    await settle(page);
    await panel(page)
      .getByRole("button", { name: /make playlist/i })
      .click();
    await expect(panel(page)).toContainText(/opening soon/i);
    await expect(openInSpotify(page)).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/\{"error"|"code"/);
    await finalShot(page, info, "D-unavailable");
  });

  test("no artist on Spotify yet: 'coming soon', no Make playlist; the API says 422 in plain words", async ({
    page,
  }, info) => {
    const id = await eventId(page.request, "Diljit Dosanjh Live in Bengaluru"); // unmatched
    await page.goto(`/events/${id}`);
    await settle(page);
    await expect(panel(page)).toContainText(/playlist soon/i);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    await expect(openInSpotify(page)).toHaveCount(0);
    const r = await page.request.post(`/api/events/${id}/playlist`, { data: {} });
    expect(r.status()).toBe(422);
    expect(await r.text()).toMatch(/on Spotify yet/i);
    await finalShot(page, info, "D-no-matched-artists");
  });

  test("leaving mid-build and coming back shows the current progress", async ({ page }) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    await page.route(STATUS, (r) => json(r, { status: "building", jobId: JOB }));
    await stubJob(page, [
      { status: "running", stage: "write", progress: 91, artistsDone: 8, artistsTotal: 8 },
    ]);
    await page.goto(`/events/${id}`);
    await expect(page.getByRole("progressbar")).toBeVisible();
    await page.goto("/");
    await page.goto(`/events/${id}`);
    await expect(panel(page)).toContainText(/adding songs/i);
  });
});

test.describe("D. DB-backed playlist states", () => {
  let nh7 = "";
  test.beforeEach(async ({ page }) => {
    nh7 = await eventId(page.request, NH7_TITLE);
  });
  test.afterEach(async () => {
    const sql = e2eDb();
    await sql`delete from shared_playlists where event_id = ${nh7}`;
    await sql.end();
  });

  async function insertShared(stale: boolean) {
    const sql = e2eDb();
    const [ev] = await sql<
      { lineup_hash: string }[]
    >`select lineup_hash from events where id = ${nh7}`;
    await sql`
      insert into shared_playlists (event_id, spotify_playlist_id, url, track_ids, lineup_hash_at_build, built_at, updated_at)
      values (${nh7}, '37i9dQZF1DXqaQA0000002', ${URL_OK}, ${["4uLU6hMCjMI75M1A2tKUQC", "7ouMYWpwJ422jRcDASZB7P"]},
              ${stale ? "stale-hash" : ev!.lineup_hash}, now(), now())
      on conflict (event_id) do update set lineup_hash_at_build = excluded.lineup_hash_at_build`;
    await sql.end();
  }

  test("ready: 'Open in Spotify' is in the first HTML and 'Make playlist' never flashes", async ({
    page,
  }, info) => {
    await insertShared(false);
    const html = await (await page.request.get(`/events/${nh7}`)).text();
    expect(html).toMatch(/Open in Spotify/i);
    expect(html).not.toMatch(/>\s*Make playlist\s*</i);
    // watch every DOM state from the first paint
    await page.addInitScript(() => {
      const w = window as unknown as { __flash: boolean };
      w.__flash = false;
      new MutationObserver(() => {
        for (const b of document.querySelectorAll("button"))
          if (/make playlist/i.test(b.textContent ?? "")) w.__flash = true;
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const w = watch(page);
    await page.goto(`/events/${nh7}`);
    await settle(page);
    await expect(openInSpotify(page)).toHaveAttribute("href", URL_OK);
    await expect(panel(page)).toContainText(/live on spotify/i);
    // BUG: QA-F-20 (low) a ready playlist on an event with unmatched artists also says
    // "Playlist soon ⏳" next to "Live on Spotify 🎉"
    await expect(panel(page)).not.toContainText(/playlist soon/i);
    expect(await page.evaluate(() => (window as unknown as { __flash: boolean }).__flash)).toBe(
      false,
    );
    await finalShot(page, info, "D-ready");
    w.assertClean();
  });

  test("ready + stale: Open in Spotify stays, 'Lineup updated, refreshing playlist…', rebuild starts by itself", async ({
    page,
  }, info) => {
    await insertShared(true);
    const posts: string[] = [];
    await page.route(STATUS, (r) => {
      if (r.request().method() === "POST") {
        posts.push(r.request().url());
        return json(r, { status: "building", jobId: JOB }, 202);
      }
      return r.continue();
    });
    await stubJob(page, [
      { status: "running", stage: "select", progress: 30, artistsDone: 1, artistsTotal: 3 },
    ]);
    await page.goto(`/events/${nh7}`);
    await expect(openInSpotify(page)).toHaveAttribute("href", URL_OK);
    await page.waitForTimeout(2000);
    expect(posts.length, "stale playlist should rebuild automatically").toBeGreaterThanOrEqual(1);
    await finalShot(page, info, "D-stale");
  });
});

test.describe("D. estimate, checking, share and copy", () => {
  test("estimate (D-065/D-082): Make playlist only when the estimate has songs; no counts shown", async ({
    page,
  }) => {
    for (const title of [LOLLA_TITLE, "Diljit Dosanjh Live in Bengaluru"]) {
      const id = await eventId(page.request, title);
      const est = (await (
        await page.request.get(`/api/events/${id}/playlist/estimate`)
      ).json()) as {
        songs: number;
        showMinutes: number;
      };
      if (title.startsWith("Diljit")) expect(est.showMinutes).toBe(150); // single-artist concert
      if (title === LOLLA_TITLE) expect(est.songs).toBeGreaterThan(0);
      await page.goto(`/events/${id}`);
      await settle(page);
      const text = (await panel(page).innerText()).replace(/\s+/g, " ");
      // D-082: no song or minute counts, no "matches the show"
      expect(text, title).not.toMatch(/\d+ songs|\d+ ?h\b|\d+ min|matches the show/i);
      const make = panel(page).getByRole("button", { name: /make playlist/i });
      if (est.songs === 0) {
        expect(text, title).toMatch(/playlist soon/i);
        await expect(make).toHaveCount(0);
      } else {
        await expect(make).toBeVisible();
      }
    }
  });

  test("checking: an event with a build already running never offers 'Make playlist' in the first HTML", async ({
    page,
  }) => {
    const id = await eventId(page.request, LOLLA_TITLE);
    const sql = e2eDb();
    await sql`insert into playlist_jobs (id, idempotency_key, event_id, options, status, stage, kind)
              values (${JOB}, 'qa-checking', ${id}, '{}'::jsonb, 'running', 'select', 'shared')`;
    try {
      await page.route(JOBS, (r) =>
        json(
          r,
          prog({
            status: "running",
            stage: "select",
            progress: 20,
            artistsDone: 1,
            artistsTotal: 8,
          }),
        ),
      );
      const html = await (await page.request.get(`/events/${id}`)).text();
      expect(html).not.toMatch(/>\s*Make playlist\s*</i);
      await page.goto(`/events/${id}`);
      await expect(panel(page)).toContainText(/joining|making|picking/i);
    } finally {
      await sql`delete from playlist_jobs where id = ${JOB}`;
      await sql.end();
    }
  });

  test("Share without native share copies the event link and says so", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== "chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await eventId(page.request, LOLLA_TITLE);
    await page.addInitScript(() => {
      (navigator as unknown as { share?: unknown }).share = undefined;
    });
    await page.goto(`/events/${id}`);
    await settle(page);
    await page
      .getByRole("button", { name: /^share /i })
      .first()
      .click();
    await expect(page.getByText(/copied/i).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/events/${id}`);
  });
});

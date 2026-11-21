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
  test("none → Make playlist → named progress stages → done: Open in Spotify, Copy link, Share", async ({
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
    expect(all).toMatch(/2\/8|6\/8/); // names the artist count
    expect(all).toMatch(/picking songs|matching artists/i);
    expect(all).toMatch(/creating (the )?playlist/i);
    expect(all).toMatch(/adding songs/i);
    await expect(openInSpotify(page)).toHaveAttribute("href", URL_OK);
    await expect(openInSpotify(page)).toHaveAttribute("target", "_blank");
    await expect(panel(page).getByRole("button", { name: /copy link/i })).toBeVisible();
    await expect(
      panel(page)
        .getByRole("button", { name: /share/i })
        .or(panel(page).getByRole("link", { name: /share/i }))
        .first(),
    ).toBeVisible();
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
    await expect(panel(page)).toContainText(/joining|already making/i);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    await finalShot(page, info, "D-building-join");
    await expect(openInSpotify(page)).toBeVisible({ timeout: 20_000 });
    expect(posts, "joining must not start a second build").toEqual([]);
    expect(calls.every((c) => c.includes(JOB))).toBe(true);
  });

  test("partial: Open in Spotify, plus which artists were skipped", async ({ page }, info) => {
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
    await expect(panel(page)).toContainText(/2 artists aren.t on Spotify, so they were skipped/i);
    await expect(panel(page)).toContainText(/Nucleya/);
    await expect(panel(page)).toContainText(/Ritviz/);
    await finalShot(page, info, "D-partial");
  });

  test("paused: 'Spotify asked us to slow down, continuing at …' and the page keeps polling", async ({
    page,
  }, info) => {
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
    await expect(panel(page)).toContainText(/slow down/i, { timeout: 15_000 });
    await expect(panel(page)).toContainText(/continuing at \d{1,2}:\d{2}\s*(am|pm)/i);
    await expect(openInSpotify(page)).toHaveCount(0);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    await finalShot(page, info, "D-paused");
    const before = calls.length;
    await page.waitForTimeout(9000);
    expect(calls.length, "the page stopped polling while paused").toBeGreaterThan(before);
  });

  test("unavailable (503): 'temporarily unavailable. Try again later.', no Open in Spotify", async ({
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
    // BUG: QA-F-8 (low) the 503 says "Playlist making opens soon. We're connecting our Spotify
    // account…" instead of SEARCH_FLOW D's "temporarily unavailable. Try again later."
    await expect(panel(page)).toContainText(/temporarily unavailable/i);
    await expect(panel(page)).toContainText(/try again later/i);
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
    await expect(panel(page)).toContainText(/coming soon|aren.t on Spotify yet/i);
    await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
    await expect(openInSpotify(page)).toHaveCount(0);
    const r = await page.request.post(`/api/events/${id}/playlist`, { data: {} });
    expect(r.status()).toBe(422);
    expect(await r.text()).toMatch(/aren.t on Spotify yet/i);
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
    await expect(panel(page)).toContainText(/by Tixtape/i);
    await expect(panel(page)).toContainText(/updated/i);
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
    await expect(panel(page)).toContainText(/lineup updated, refreshing playlist/i);
    await page.waitForTimeout(2000);
    expect(posts.length, "stale playlist should rebuild automatically").toBeGreaterThanOrEqual(1);
    await finalShot(page, info, "D-stale");
  });
});

test.describe("D. estimate, checking, share and copy", () => {
  test("estimate (D-065): panel matches GET /playlist/estimate; single-artist concert = 2 h 30 min", async ({
    page,
  }) => {
    for (const title of [LOLLA_TITLE, "Diljit Dosanjh Live in Bengaluru"]) {
      const id = await eventId(page.request, title);
      const est = (await (
        await page.request.get(`/api/events/${id}/playlist/estimate`)
      ).json()) as {
        songs: number;
        minutes: number;
        showMinutes: number;
        days: number;
        unmatched: number;
      };
      await page.goto(`/events/${id}`);
      await settle(page);
      const text = (await panel(page).innerText()).replace(/\s+/g, " ");
      if (title.startsWith("Diljit")) expect(est.showMinutes).toBe(150);
      // was QA-F-11: with no artist matched the preview read "0 songs · about 0 min" and still
      // offered Make playlist.
      if (est.songs === 0) {
        expect(text, title).not.toMatch(/\b0 songs\b|about 0 min/);
        expect(text, title).toMatch(/coming soon/i);
        await expect(panel(page).getByRole("button", { name: /make playlist/i })).toHaveCount(0);
        continue;
      }
      expect(text).toContain(`${est.songs} songs`);
      const fmt = (min: number) => {
        const h = Math.floor(min / 60);
        const m = min % 60;
        return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`;
      };
      const perDay = est.days > 1 ? `${est.days} days × ${fmt(est.showMinutes / est.days)}` : "";
      expect(
        text.includes(fmt(est.showMinutes)) || (perDay !== "" && text.includes(perDay)),
        `show length ${fmt(est.showMinutes)} / ${perDay} in: ${text.slice(0, 300)}`,
      ).toBe(true);
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

  test("Copy link copies the playlist URL and says so; Share works without native share", async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== "chromium");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const id = await eventId(page.request, LOLLA_TITLE);
    await page.route(STATUS, (r) => json(r, { status: "building", jobId: JOB }));
    await stubJob(page, [
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
    await expect(openInSpotify(page)).toBeVisible({ timeout: 20_000 });
    await panel(page)
      .getByRole("button", { name: /copy link/i })
      .click();
    await expect(page.getByText(/copied/i).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(URL_OK);
    // page Share (event link): native share if present, else copy with feedback
    await page.evaluate(() => {
      (navigator as unknown as { share?: unknown }).share = undefined;
    });
    await page
      .getByRole("button", { name: /^share /i })
      .first()
      .click();
    await expect(page.getByText(/copied/i).first()).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(`/events/${id}`);
  });
});

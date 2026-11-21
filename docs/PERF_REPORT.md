# Performance report (D-086)

Measured 2026-11-22 from India (Vercel edge `bom1`, functions `sin1`, Neon Postgres 18 in `ap-southeast-1`). Prod had 50 events, 59 artists, 98 lineup rows, 63 sources at the time.

## 1. Prod latency, before (TTFB via `curl -w %{time_starttransfer}`, 30 sequential GETs each)

Every request sent a cookie `city=Benchtown` (not a known city), so D-081 demand counters were not touched. Nothing POSTed; Spotify was never called.

| Endpoint                                | p50 ms | p95 ms | max ms | First request |
| --------------------------------------- | -----: | -----: | -----: | ------------: |
| `/` (home)                              |    216 |    323 |    615 |           615 |
| `/events/:id` (Lollapalooza India)      |    225 |    268 |    272 |           247 |
| `/search?q=lolla`                       |    199 |    241 |    264 |           220 |
| `/api/events/suggest?q=lo`              |    191 |    245 |    262 |           216 |
| `/api/events/suggest` (empty: sections) |    170 |    206 |    324 |           187 |
| `/api/search?q=arijit`                  |    178 |    215 |    397 |           193 |
| `/api/events/:id`                       |    175 |    234 |    235 |           176 |
| `GET /api/events/:id/playlist`          |    174 |    199 |    214 |           172 |
| `GET /api/events/:id/playlist/estimate` |    187 |    234 |    410 |           232 |
| `/api/health`                           |    404 |      — |      — |             — |

`/api/health` didn't exist in prod yet; D-084 adds it in this release.

**Cold start** (first request after ~30 min idle): `/api/events/suggest?q=ar` took **1,068 ms** TTFB. The pages and APIs right after it were already warm (~230–270 ms), because they share one function instance.

**Targets:** warm API p95 < 300 ms and page TTFB < 800 ms from India were **already met**. The only miss is the cold start, which is around 1 s.

### Where the time goes

| Probe                                                       | p50 ms |
| ----------------------------------------------------------- | -----: |
| TCP connect to the edge (`bom1`)                            |     10 |
| Static file served by the edge (CSS, `x-vercel-cache: HIT`) |     81 |
| A `sin1` function with **no DB** (404 `/_not-found`)        |    174 |
| `/api/events/:id` (3 DB round trips)                        |    175 |

So about **95 ms of every dynamic request is the `bom1 → sin1` hop plus function overhead**. DB and app time is only 0–15 ms. EXPLAIN on Neon agrees: every hot query runs in 0.05–8 ms (§3).

The levers, in order of measured impact:

1. **Serve from the edge.** A HIT costs ~80–100 ms instead of ~175 ms.
2. **Cold start** (~0.9 s extra on the first hit).
3. **Index for growth.** The DB is fast today, but two queries scale badly (§3).

## 2. Server-Timing (new, every API route)

`route()` (`src/server/http.ts`) now runs each handler inside `timed()` (`src/lib/server-timing.ts`). postgres.js 4 publishes every query and connection open on `node:diagnostics_channel`, and `src/db/client.ts` subscribes once. Each response then carries a header like:

```
Server-Timing: db;dur=3.5;desc="3x", db-connect;dur=31.7;desc="1x", total;dur=4.5
```

- `db` is wall time with at least one query in flight, so parallel queries aren't double counted.
- `desc` is the number of queries.
- `db-connect` appears when the request opened a pool connection, which is the cold-start signal.

Local prod build against the local DB, warm:

| Route                            | DB queries | db ms | total ms |
| -------------------------------- | ---------: | ----: | -------: |
| `/api/events/suggest?q=lo`       |          1 |  5–14 |     6–15 |
| `/api/events/suggest` (sections) |          1 |   5.6 |      8.2 |
| `/api/search?q=arijit`           |  2 (1 log) | 11–88 |    14–93 |
| `/api/events/:id`                |          3 |   3.5 |      4.5 |
| `GET …/playlist`                 |          5 |  13.9 |     21.0 |
| `GET …/playlist/estimate`        |          5 |   4.4 |      5.9 |

Local numbers were noisy because other teams were building and testing on the same machine. **After deploy, read the real Neon split from the `Server-Timing` header** in prod (DevTools → Network → Timing).

## 3. Database

### EXPLAIN (ANALYZE, BUFFERS), hot queries

Captured with real params from the actual code paths. ANALYZE ran on SELECTs only; nothing was written on Neon.

| Query                                     | Local exec |    Neon exec | Synthetic 30× (2,000 events, 16k lineup rows), before → after 0016 |
| ----------------------------------------- | ---------: | -----------: | -----------------------------------------------------------------: |
| Home feed (`event-feed.ts`, limit 200)    |     1.5 ms |       8.3 ms |                                          174–240 ms → **18–26 ms** |
| Suggest `q=lo` (pg_trgm CTE)              |     1.1 ms |       3.0 ms |                                       42 ms → 30–45 ms (CPU-bound) |
| Suggest `q=arijit`                        |     1.1 ms |       2.9 ms |                                121–137 ms → 107–119 ms (CPU-bound) |
| Suggest sections (empty `q`)              |     0.2 ms |       0.6 ms |                                                             4–7 ms |
| Event detail (3 queries)                  |    <0.1 ms | <0.2 ms each |                                    sources: 0.4–1.9 → 0.03–0.07 ms |
| Estimate: `artist_track_cache` by artists |    <0.1 ms |      0.05 ms |                                                            <0.1 ms |

### Findings

1. **Missing index `event_sources(event_id)`.** The only key is `(source, external_id)`. The home feed runs two correlated subplans per event (`source_count`, `ticket_url`), and each seq-scans `event_sources`. At 30× scale that's 142 of the 174 ms. **Fixed by 0016**; the home feed is ~8× faster at scale.
2. **Missing index `event_artists(artist_id)`.** The PK `(event_id, artist_id)` can't serve artist → events lookups. Those happen in the suggest semi-join, artist merges, the popularity `due()` join, D-081 metro artists, and the FK check when an artist row is deleted or merged. **Fixed by 0016.**
3. **Suggest is CPU-bound, not index-bound.** `word_similarity()` plus the nested `replace()` phonetic chain runs for every upcoming event (22 ms at scale) and every artist (91 ms at scale), before the "plays an upcoming event" filter. No index helps the current SQL. Plan:
   - Filter artists to those with upcoming events **before** scoring them (move the semi-join first).
   - Store a `phonetic_key` column (backfilled, with a trigram index) so `%>`/`<%` can use a GIN index.
   - Owner: Events. It's a ranking change and needs the search QA suite.
4. **No N+1 loops in application code.** The "N+1" is in SQL: correlated subqueries per feed row. With index 1 that's fine up to thousands of events. A lateral join that aggregates `event_sources` once would remove it entirely; `event-feed.ts` is being edited by the UI/Matching teams, so that's left to them.
5. **Repeated reads per page view (recommendations, owned elsewhere):**
   - The **event page** reads `getDetail` **three times**: once itself, again in `getSharedStatus`, again in `estimatePlaylist`. That's ~9 sequential DB stages.
   - **Estimate** reads `artist_track_cache` **twice**: in `estimatePlaylist` and again in `buildReadiness → cachedState`.
   - Fix (Engine): let `getSharedStatus`/`estimatePlaylist` take an already-loaded event, and pass the cache map into `buildReadiness`. Fix (UI): `Promise.all` the status and estimate in `src/app/events/[id]/page.tsx`.
   - Together that's −5 to −6 sequential round trips, ~10–20 ms per event page.
6. **`/search` page awaits sequentially:** `load` → `nearYou` → `detailsFor`. The last two can run in parallel when the first returns nothing (UI).
7. **`/api/search` awaits the `search_log` insert** before responding (1 extra round trip, ~2–5 ms on Neon). It could move to `after()` the way D-081 demand counting does (Events).
8. **Over-fetching:** `getDetail` selects every `events` column, including `verification jsonb`, which the public page never shows. It's small today; a column list is cheap later.
9. **Schema/deploy hazard:** the tree reads the 0014 columns (`events.poster_credit`, `artists.alt_image_url`, …). **Run 0014 (and 0015, 0016) before the deploy**, or event detail returns 500. Without 0014, my local capture failed with exactly that error.

### Connection behaviour on Vercel and Neon

- **Pooled URL in use:** confirmed. On Neon, the app's backends (`application_name = postgres.js`) connect from `127.0.0.1`/`::1`, which is PgBouncer on the compute; a direct connection would show an external IP. `max_connections` = 901.
- **`prepare: false`:** set in `src/db/client.ts`. Drizzle also passes `prepare: name !== undefined` per query, and the code uses no named `.prepare()`, so no server-side prepared statements reach PgBouncer. This is correct for transaction mode.
- **`DB_POOL_MAX`:** defaults to 2 on Vercel (D-070). Pages run at most 2 queries in parallel, so 2 is enough. Leave it unset.
- **Each new connection costs two round trips before the first query:** TLS plus `pg_type` (`fetch_types`), about 27–32 ms locally (`db-connect`). Don't turn `fetch_types` off: the feed's `text[]` columns need it.
- **`idle_timeout: 20`** means a gap of more than 20 s between requests on one instance reconnects. Raising it to 60 s is cheap on Neon's pooler; it's left for the Lead (D-070 owner).

## 4. Changes made (Phase 2)

1. **Edge cache for suggest** (`/api/events/suggest`): `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, through one shared constant `EDGE_CACHE_SHORT` in `src/server/http.ts`.
   - It's safe because suggest reads no cookies, is never logged (D-048), and is keyed by the full URL.
   - Suggest runs on every keystroke, so common prefixes become edge HITs. A prod edge HIT measured **80–100 ms** TTFB against ~190 ms today. Expect **p50 ≈ 90 ms on hits**; misses are unchanged.
   - Worst-case staleness is 60 s, plus one stale serve while it refreshes.
2. **Migration `0016_perf_indexes`** (pure add): `event_sources_event_idx`, `event_artists_artist_idx`.
3. **Server-Timing** on every API route (§2).

**Not changed, and why:**

- **`unstable_cache` for sections and event detail:** the DB part is 0.2–8 ms, so a data-cache lookup would save almost nothing. The edge is the lever.
- **`/api/events/:id`:** no client calls it, so edge caching it has no user impact.
- **`/api/search`:** it's logged and counted, and edge caching would undercount analytics.
- **Playlist status and estimate:** Engine set `no-store` deliberately (readiness changes during prewarm).

## 5. Cold start (plan; not changed in the freeze)

Local module load of a public route is ~100 ms of Next runtime plus ~140 ms of app code (Apple Silicon; Vercel is slower). Every route bundles ~770 KB of server chunks. Of that, **265 KB is ingestion sources, gig discovery, and the Spotify, Tavily and Last.fm adapters**, which `src/server/container.ts` imports statically, even for read-only routes.

Plan (Platform, shared file):

- Split the container so `events()` and `playlists()` read paths don't import ingestion, gigs or lookup.
- For example, move `buildLookup`, `artistGigs` and the gigs module behind a `src/server/lookup.ts` / `src/server/gigs.ts` helper with their own lazy container slice, and keep `container.ts` to db, logger, events and playlists.
- Expected: about −35% of the app chunk parsed on a cold start.

## 6. After the deploy, verify

1. Rerun the bench script: `scratchpad/bench/bench.sh after 30` (30 sequential GETs). Expect suggest to show `x-vercel-cache: HIT` and p50 ≈ 90 ms.
2. Check `Server-Timing` on a few API responses: `db` should be < 10 ms and `total` < 20 ms.

## 7. Bench side effects in prod (clean-up for the Lead)

`/search?q=lolla` and `/api/search?q=arijit` log page-1 queries to `search_log` (D-047). That added 30 `arijit` rows (2026-11-21 19:47:40–19:47:47 UTC) and about 30 `lolla` rows (19:43–19:56 UTC), which inflates "Popular searches". The Lead can remove them; I did not write to prod:

```sql
delete from search_log where query_normalized = 'arijit'
  and created_at between '2026-11-21 19:47:40+00' and '2026-11-21 19:47:47+00';
delete from search_log where query_normalized = 'lolla'
  and created_at between '2026-11-21 19:46:00+00' and '2026-11-21 19:47:40+00';
```

Check the `lolla` window with a `select` first: 3 of the 33 rows in that hour may be real.

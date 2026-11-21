# Concert → Spotify Playlist App: Low-Level Design

_Draft v1 · 2026-11-21 · merged from three research reports (architecture, event data sources, Spotify API). Facts about third-party APIs were checked against the providers' own pages on this date; items marked **[unverified]** still need a check._

---

## 0. Read this first: hard constraints

These four facts shape everything else.

1. **Spotify Development Mode caps the app at 5 allow-listed users**, and the app owner must have Premium. Extended Quota is only granted to registered businesses with at least 250k monthly active users ([quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes), [criteria](https://developer.spotify.com/blog/2025-04-15-updating-the-criteria-for-web-api-extended-access)).
   → **The MVP is a closed beta (≤5 users).** A public launch needs a separate product decision (§15).
2. **New Spotify apps have lost several endpoints and fields.**
   - Removed: `GET /artists/{id}/top-tracks`, the batch `GET /artists` and `GET /tracks`, and artist/track `popularity` and `followers`.
   - Search is capped at `limit=10`.
   - Create a playlist with `POST /me/playlists`; add tracks with `POST /playlists/{id}/items`.
   - Sources: [Feb 2026 changelog](https://developer.spotify.com/documentation/web-api/references/changes/february-2026), [migration guide](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
     → We have to build our own "top tracks" list (§7).
3. **No public API covers Indian concert lineups.**
   - BookMyShow and District have no public API, and their terms restrict scraping.
   - Instagram and Facebook automated collection breaches Meta Terms §3.2.3.
   - Ticketmaster doesn't operate in India.
     → **For India, admins enter events by hand, and users can submit lineups. Nothing is scraped.**
4. **Spotify sometimes returns very long `Retry-After` values (hours).** Calls made during a block reportedly extend it. Rate quota is pooled per developer account.
   → One shared throttle gate. Long blocks abort the job and resume it later. Never sleep through them (§8.2).

---

## 1. Scope

|                 | MVP (≈3–4 weeks)                                             | Phase 2                                                                                                                                | Phase 3                                               |
| --------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Events          | Admin manual entry (India) + Ticketmaster Discovery (global) | User-submitted lineups with poster OCR/LLM prefill + moderation; RSS/sitemap "new event" flags; JamBase if India coverage is confirmed | BookMyShow/District partner feeds (if a deal happens) |
| Artist matching | Auto-match + admin review queue                              | User confirms low-confidence matches in the generate flow                                                                              | MusicBrainz cross-check                               |
| Tracks          | "Hits" mode (search-based)                                   | "Likely setlist" mode (setlist.fm)                                                                                                     | Per-day/stage playlists                               |
| Playlists       | Create + update (idempotent)                                 | Re-sync when the lineup changes; cover image                                                                                           | Apple Music / YouTube export                          |
| Users           | ≤5 (Dev Mode)                                                | —                                                                                                                                      | Depends on §15 decision                               |

---

## 2. Architecture

```
                ┌────────────── Railway project (Singapore) ───────────────┐
 Browser ──────▶│  web  (Next.js 15, App Router, route handlers)           │
   ▲  poll      │    │ enqueue                                             │
   └────────────│    ▼                                                     │
                │  Redis ── BullMQ queues ── spotify:paused_until key      │
                │    │                       │                             │
                │    ▼                       ▼                             │
                │  worker-playlist        worker-ingest                    │
                │  (generate jobs)        (cron: Ticketmaster sync,        │
                │                          artist-resolve, revalidate)     │
                │    │      \             /        │                       │
                │    │       Postgres 16 (Drizzle)  │                      │
                └────┼──────────────────────────────┼──────────────────────┘
                     ▼                              ▼
              Spotify Web API                Ticketmaster / setlist.fm / MusicBrainz
          (via one SpotifyClient + gate)
```

- **Modular monolith:** one repo, one Docker image, three process types (`web`, `worker-playlist`, `worker-ingest`).
- **All Spotify traffic, from both workers, goes through a single `SpotifyClient`.** It shares one Redis-backed gate because quota is per developer account.
- **Artists are resolved at ingest time,** not when someone generates a playlist. A cached festival then costs about 80 track searches plus about 6 write calls, instead of about 180+.

---

## 3. Tech stack (decisions)

| Concern          | Choice                                                     | Rejected alternative & why                                                                                           |
| ---------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript everywhere                                      | TS + FastAPI: two runtimes and duplicated models; Python's scraping advantage doesn't matter because we don't scrape |
| Web              | Next.js 15 App Router + TanStack Query + Tailwind          | SPA + separate API: extra deployable                                                                                 |
| ORM / validation | Drizzle + Zod                                              | Prisma: heavier, less control over upserts                                                                           |
| DB               | Postgres 16 (`pg_trgm`, JSONB)                             | Mongo: needs joins and unique constraints                                                                            |
| Queue            | BullMQ on Redis                                            | pg-boss: rate-gate coordination would be clumsier                                                                    |
| OAuth            | `arctic`, Authorization Code + PKCE + `state`, server-side | Auth.js: stores tokens in plaintext, awkward refresh rotation                                                        |
| Hosting          | Railway (web + 2 workers + PG + Redis), ~$10–25/mo         | Vercel + Railway: two platforms for no gain                                                                          |
| Observability    | Sentry, pino logs, Bull Board at `/admin/queues`           | —                                                                                                                    |

---

## 4. Data model (Postgres)

```sql
venues(id, name, normalized_name, city, state, country, lat, lng,
       UNIQUE(normalized_name, city))
venue_aliases(venue_id, alias)                     -- "Mahalakshmi Race Course" = "Mahalaxmi Racecourse"

events(id, title, type ENUM(concert,festival), venue_id, starts_at, ends_at,
       status ENUM(announced,partial_lineup,full_lineup,cancelled),
       image_url, lineup_hash, dedupe_key UNIQUE, created_at, updated_at)
event_sources(event_id, source ENUM(admin,ticketmaster,jambase,user_submission),
              external_id, url, raw JSONB, last_seen_at,
              UNIQUE(source, external_id))

artists(id, name, normalized_name /*trgm idx*/, spotify_id UNIQUE NULL,
        match_score, match_status ENUM(auto,needs_review,manual,not_found),
        mbid, image_url, spotify_resolved_at)
artist_aliases(artist_id, alias_normalized UNIQUE)
event_artists(event_id, artist_id, billing_rank, tier ENUM(headliner,sub,mid,support),
              day, stage, PRIMARY KEY(event_id, artist_id))
artist_track_cache(artist_id, mode ENUM(hits,setlist), spotify_track_ids text[],
                   fetched_at)                       -- TTL 7d (Spotify Terms IV.3.1.1)

users(id, spotify_user_id UNIQUE, display_name, market DEFAULT 'IN', role, created_at)
spotify_tokens(user_id PK, access_token_enc, refresh_token_enc, key_version,
               scope, expires_at, needs_reauth bool)  -- AES-256-GCM
sessions(id_hash PK, user_id, expires_at)

playlists(id, user_id, event_id, options_hash, spotify_playlist_id, track_ids text[],
          snapshot_id, lineup_hash_at_build, UNIQUE(user_id, event_id, options_hash))
playlist_jobs(id, idempotency_key UNIQUE, user_id, event_id, options JSONB,
              status ENUM(queued,running,paused,succeeded,partial,failed),
              stage, progress, artists_done, artists_total, checkpoint JSONB,
              resume_after timestamptz, error, playlist_id, timestamps)

submissions(id, user_id, payload JSONB, poster_url, status ENUM(pending,approved,rejected))  -- phase 2
ingest_runs(id, source, started_at, finished_at, status, items_seen, items_new, error)
```

Notes:

- `/me` no longer returns `country` in Dev Mode, so `users.market` is set by the user (default `IN`).
- Spotify IDs are re-validated every 30 days via `spotify_resolved_at`. Spotify's Terms forbid storing content indefinitely.
- When a user disconnects, delete their tokens and personal rows within 5 days (Terms Appendix A §5(c)).

---

## 5. Event ingestion

### 5.1 Sources

| Source                                   | How                                                                                               | Cadence                                                                                            |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Admin console                            | Form: event, venue, dates, ordered lineup (paste names, one per line, with tier)                  | Manual; ~30–60 India events/yr                                                                     |
| Ticketmaster Discovery                   | `classificationName=music`, by country; performers from `_embedded.attractions` (order ≈ billing) | Daily for the next 12 months; every 6h for events in the next 30 days. Limit 5k calls/day, 5 req/s |
| User submission (P2)                     | Event + lineup + source link/poster; an LLM/OCR pass prefills; goes to a moderation queue         | On submit                                                                                          |
| RSS / District `sitemap-events.xml` (P2) | **Only flags** a possible new event for the admin. Never republishes content                      | Every 6–12h                                                                                        |

**Excluded:** scraping Instagram, Facebook, BookMyShow or District; Songkick (paid, partner-only); Bandsintown (keys go to artists only); X.

### 5.2 Adapter contract

```ts
interface SourceAdapter {
  source: SourceName;
  fetch(since?: Date): AsyncIterable<RawEvent>; // RawEvent validated with Zod
}
```

Pipeline: `fetch → normalize → dedupe/merge → upsert → enqueue artist-resolve for new artists`.

### 5.3 Dedupe

- **Blocking key:** `(country, city_norm, start_date ± 1 day)`.
- **Score:**
  - 0.4 × venue similarity (Jaro-Winkler, after resolving aliases)
  - 0.3 × event-name token overlap (year and edition stripped)
  - 0.3 × Jaccard similarity of resolved artist IDs
- **Decision:** ≥ 0.85 auto-merges; 0.6–0.85 goes to the admin queue.
- **Field precedence:** admin > JamBase > Ticketmaster > user submission.
- **Lineup changes:** recompute `lineup_hash`; a change flags existing playlists as stale.

---

## 6. Artist resolution (`artist-resolve` job)

Uses an **app token (client credentials)**. Calls go through the same gate (§8.2), at low priority.

1. **Normalize:**
   - NFKD, strip diacritics, casefold.
   - Map `&`/`and`/`+` to one token.
   - Strip a leading "the" or "DJ ", and suffixes like "(live)", "(DJ set)", "[hybrid]".
2. **Split** `b2b` / `vs` entries into separate artists. Split on `&` only if the full string fails to match.
3. **Check** `artist_aliases`. On a hit, done.
4. **Search** `type=artist&limit=10` twice: `q=artist:"<raw>"` and `q=<normalized>`.
5. **Score each candidate** (popularity is gone, so it can't be used):

   | Signal                                                                       | Points                          |
   | ---------------------------------------------------------------------------- | ------------------------------- |
   | Exact normalized match                                                       | +50                             |
   | Diacritic-only difference                                                    | +30                             |
   | Match after removing "DJ"                                                    | +25                             |
   | Search rank                                                                  | up to +15, as `15 − 1.5 × rank` |
   | Has images                                                                   | +10                             |
   | Genre overlaps the event's genre **[unverified that `genres` is populated]** | +10                             |
   | MusicBrainz → Spotify link agrees (P3)                                       | +20                             |

6. **Decide:**
   - Auto-accept if score ≥ 70 and it leads the runner-up by ≥ 15.
   - Otherwise set `needs_review`. Admins see the top 3 candidates with image and albums.
   - Always send for review: names of 3 characters or fewer, and common words (e.g. "Anirudh"-style collisions).

---

## 7. Playlist generation

### 7.1 Options

`{ tracksPerTier: {headliner:10, sub:5, mid:3, support:2}, artistFilter: 'all'|'headliners'|ids[], mode: 'hits'|'setlist', order: 'billing'|'shuffle', public: false }`

### 7.2 Track selection

- **Hits mode (MVP):**
  - Search `type=track&q=artist:"<exact name>"&limit=10&market=<user.market>`.
  - Keep only tracks whose `artists[]` contains the resolved ID.
  - If fewer than N, fall back to `GET /artists/{id}/albums?include_groups=album,single&limit=10` → first tracks of the newest releases.
  - **[unverified]** whether search order tracks popularity. Measure on day 1 against a few known artists.
- **Setlist mode (P2):**
  - Take setlist.fm's recent setlists and count how often each song appears.
  - Search `track:"<song>" artist:"<name>"&limit=5` and match on artist ID plus a normalized title.
  - Prefer studio versions over live or karaoke ones.
  - Requires a setlist.fm commercial agreement once monetized.
- **Dedupe** by track ID, then ISRC (`external_ids.isrc`, restored in March 2026), then normalized title + artist.
- **Cache** per artist in `artist_track_cache` (7-day TTL).

### 7.3 Job state machine

```
queued → running(stage: resolve → select → create → add → cover) → succeeded
                       │                                      ↘ partial (some artists unresolved)
                       └─ long 429 / QUOTA_EXCEEDED → paused(resume_after) → running
                       └─ invalid_grant → failed(needs_reauth)
```

- `checkpoint` stores `{selectedTrackIds, playlistId, chunksDone}`, so a resume never repeats work.
- `spotify_playlist_id` is saved **immediately** after `POST /me/playlists`, before any tracks are added.
- Adding tracks: chunks of 100 via `POST /playlists/{id}/items`, with `chunksDone` stored after each chunk. On "update existing", the first chunk uses `PUT` (replace) and the rest use `POST`.

### 7.4 Call budget (80-artist festival, ~305 tracks)

|                                | Cold cache | Warm cache |
| ------------------------------ | ---------- | ---------- |
| Artist search (done at ingest) | ~92        | 0          |
| Track search (hits)            | 80         | 0–80       |
| Create + 4 add chunks + cover  | 6          | 6          |
| **At generate time**           | **~86**    | **6–86**   |

Setlist mode adds about 300 track searches. That's another reason it's phase 2.

---

## 8. Spotify client layer (`src/lib/spotify/`)

### 8.1 Tokens (`tokens.ts`)

- `getUserToken(userId)` returns the stored token if it's valid for more than 60 seconds.
- Otherwise, take `pg_advisory_xact_lock(userId)`, then refresh via `POST accounts.spotify.com/api/token` (Basic auth). Store the rotated refresh token if one is returned.
- On `invalid_grant`, set `needs_reauth` and fail the job with a "reconnect Spotify" message.
- Access tokens last 1 hour. Refresh tokens expire 6 months after issue; refreshing does not extend them. Plan for the reconnect prompt.
- **Scopes:** `playlist-modify-private playlist-modify-public`, plus `ugc-image-upload` only when covers ship.

### 8.2 Rate gate (`limiter.ts`): the only path to Spotify

```ts
async function call(req, { priority }) {
  await waitUntil(await redis.get('spotify:paused_until'));   // shared by all processes
  await bucket.take();                // token bucket ~2–3 req/s, in-flight cap 3 (tunable; Spotify publishes no numbers)
  const r = await fetch(req);
  if (r.status === 429) {
    const body = await r.json().catch(() => ({}));
    const ra = parseRetryAfter(r.headers.get('Retry-After'));  // seconds or HTTP-date; NaN-safe
    if (body?.error?.reason === 'QUOTA_EXCEEDED' || (ra ?? 0) > 120)
      throw new SpotifyBlocked(ra);   // job → paused(resume_after), no retry
    await setMaxPausedUntil(now + (ra ?? fullJitter(attempt, 1, 60)) + rand(0, 0.5s));
    return retry();                   // ≤5 attempts
  }
  if (r.status >= 500) return retryWithFullJitter();
  return r;
}
```

- `setMaxPausedUntil` is an atomic Lua compare-and-set: keep whichever deadline is later.
- No call is made while a pause is in effect. Reports say calling during a block extends it.
- Queue priority: user-facing generate jobs come before ingest/resolve jobs.

### 8.3 Idempotency

- `POST /api/playlist-jobs` requires an `Idempotency-Key` header.
- The server derives `options_hash`. If a `playlists` row already exists for (user, event, hash), the UI offers "update existing" instead of creating a duplicate.

---

## 9. HTTP API (route handlers, Zod-validated)

| Method & path                                                                                                                   | Purpose                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/events?city=&from=&to=&q=&type=`                                                                                      | List / search events                                                                           |
| `GET /api/events/:id`                                                                                                           | Event + lineup with tier and match status                                                      |
| `GET /api/auth/spotify/login` · `/callback` · `POST /api/auth/logout` · `GET /api/me`                                           | Auth                                                                                           |
| `PATCH /api/me`                                                                                                                 | Set `market`                                                                                   |
| `POST /api/playlist-jobs`                                                                                                       | `{eventId, options}` → `202 {jobId}` (rate limit: 5/user/hour)                                 |
| `GET /api/playlist-jobs/:id`                                                                                                    | `{status, stage, progress, artistsDone, artistsTotal, unresolved[], resumeAfter, playlistUrl}` |
| `GET /api/playlists`                                                                                                            | The user's generated playlists, with a "stale" flag                                            |
| `DELETE /api/me`                                                                                                                | Disconnect + delete data                                                                       |
| Admin: `GET/PATCH /api/admin/artists?status=needs_review`, `POST/PATCH /api/admin/events`, `POST /api/admin/ingest/:source/run` | Curation                                                                                       |

**Progress:** the client polls every 1.5 seconds with TanStack Query and stops on a terminal status. SSE was rejected for now; it isn't worth the extra machinery at ≤5 users.

---

## 10. Frontend pages

- `/`: upcoming events, with a city filter.
- `/events/[id]`: lineup by tier, a "Generate playlist" panel (options), and live job progress.
- `/playlists`: past playlists, with a "re-sync" button when stale.
- `/admin/events`, `/admin/artists` (review queue), `/admin/queues` (Bull Board).
- Spotify attribution and links on every track or artist shown (Policy II.4). The app name must not start with "Spot".

---

## 11. Background schedules

| Job                   | Schedule                                                           |
| --------------------- | ------------------------------------------------------------------ |
| `ingest:ticketmaster` | Daily 03:10 IST; every 6h for events ≤30 days out                  |
| `artist-resolve`      | On new artist; low priority                                        |
| `artist-revalidate`   | Weekly; refresh IDs older than 30 days                             |
| `track-cache-expire`  | Daily; drop entries older than 7 days                              |
| `playlist-resume`     | Every 5 min; requeue `paused` jobs whose `resume_after` has passed |
| `stale-playlists`     | On `lineup_hash` change → mark playlists stale                     |

---

## 12. Security & compliance

- Tokens are encrypted with AES-256-GCM, with a `key_version` column so keys can rotate. They never reach the browser.
- Session cookie: httpOnly, Secure, SameSite=Lax, random ID stored hashed.
- `worker-ingest` gets its own env group with no user-token key, and uses a DB role restricted to event, venue and artist tables.
- Every external payload is Zod-validated. Raw HTML is never rendered.
- Spotify Policy: no single-artist app (II.1), attribution (II.4), no ML on Spotify content (III.13–14), easy disconnect (I.1.2).
- **[unverified]** whether Policy III.5 ("integrated with content from another service") applies to setlist.fm enrichment. Check before shipping setlist mode.
- Redirect URIs must be HTTPS. In dev use `http://127.0.0.1:3000/api/auth/spotify/callback`; `localhost` is rejected.

---

## 13. Repo layout

```
concert-playlist-app/
├─ src/
│  ├─ app/                         # Next.js routes + api/*/route.ts
│  ├─ components/
│  ├─ server/{events,artists,playlists,auth}/   # domain services, no framework imports
│  ├─ lib/spotify/{client,limiter,tokens,resolve,tracks}.ts
│  ├─ lib/{crypto,redis,queue,logger,env}.ts
│  ├─ db/{schema.ts,client.ts,migrations/}
│  ├─ ingest/{sources/{ticketmaster,admin,submission}.ts, normalize.ts, dedupe.ts, types.ts}
│  └─ workers/{playlist.worker.ts, ingest.worker.ts, index.ts}
├─ tests/{unit,integration}/
├─ docker-compose.yml   # postgres + redis for local dev
├─ Dockerfile  drizzle.config.ts  .env.example
```

---

## 14. Testing

- **Unit:**
  - Name normalization and B2B splitting.
  - Match scoring (table-driven, with Indian and DJ edge cases).
  - Dedupe scoring.
  - `parseRetryAfter` (seconds, HTTP-date, garbage, missing).
- **Limiter:** a fake Spotify server (msw) that returns a 429 with `Retry-After: 2`, `Retry-After: 5000`, and the `QUOTA_EXCEEDED` body. Assert: all workers pause together, there are no calls during a pause, and the job goes to `paused`.
- **Job resume:** kill the worker mid-chunk, then assert there's no duplicate playlist and no duplicate tracks.
- **Day-1 spike** against the real API: is search order popularity-like, and is `genres` populated in Dev Mode?

---

## 15. Risks & open decisions

| #   | Risk                                           | Mitigation / decision needed                                                                                                                                                                                                                                                                                         |
| --- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **5-user Dev Mode cap blocks a public launch** | Decide the product direction: (a) a personal/closed-beta tool; (b) bring-your-own-Client-ID **[ToS unverified]**; (c) a public "track list" page with deep links, where only allow-listed users get write-to-Spotify; (d) add Apple Music (MusicKit can create playlists) / YouTube. Worth a dedicated research pass |
| R2  | No Indian lineup API                           | Admin curation now; pursue BookMyShow/District affiliate or partner deals                                                                                                                                                                                                                                            |
| R3  | Search ≠ "top tracks"                          | Day-1 spike; setlist mode in P2                                                                                                                                                                                                                                                                                      |
| R4  | Hour-long Spotify blocks                       | Pause/resume design (§8.2); low call volume through ingest-time resolution                                                                                                                                                                                                                                           |
| R5  | Wrong-artist matches                           | Review queue; aliases; user confirmation in P2                                                                                                                                                                                                                                                                       |
| R6  | setlist.fm / JamBase commercial terms          | Non-commercial until agreements are signed                                                                                                                                                                                                                                                                           |

---

## 16. Milestones

1. **Week 1:**
   - Repo scaffold, DB schema and migrations, env validation.
   - Spotify OAuth + token store.
   - Limiter with tests.
   - Day-1 API spike (R3).
2. **Week 2:**
   - Admin event entry.
   - Ticketmaster adapter + dedupe.
   - Artist resolve + review queue.
3. **Week 3:**
   - Playlist job pipeline (hits mode), idempotency, resume.
   - Event and job-progress UI.
4. **Week 4:**
   - Railway deploy, Sentry, Bull Board.
   - Closed beta with 5 users.

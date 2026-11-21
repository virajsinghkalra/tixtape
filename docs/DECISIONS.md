# Decision log

The single place for every technical and product decision. **Every team reads this before starting a pointer and adds to it before writing code that depends on a new decision.**

Format: newest at the bottom. IDs never change. To reverse a decision, add a new one that supersedes it, and mark the old one `Superseded by D-xxx`.

| Field  | Meaning                                                                 |
| ------ | ----------------------------------------------------------------------- |
| Status | Accepted · Proposed · Superseded                                        |
| Owner  | The team that made it (Lead, Spotify, Events, Matching, Engine, UI, QA) |

---

### D-001 · MVP is a closed beta of up to 5 users

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** Spotify Development Mode allows 5 allow-listed users and requires the app owner to have Premium. Extended Quota requires a business with about 250k monthly users.
- **Decision:** Build for at most 5 users. The owner's existing Premium account is used.
- **Consequence:** No public sign-up flow in the MVP. Revisit before any public launch.

### D-002 · Hosting must cost $0

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** Vercel Hobby (web), Neon free Postgres (database), GitHub Actions (scheduled jobs). No Redis and no always-on workers.
- **Consequence:**
  - The app must stay non-commercial while on Vercel Hobby.
  - Long work runs in short steps (D-005).

### D-003 · TypeScript everywhere; Next.js 15 App Router

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** Next.js 15, React 19, TypeScript strict, Drizzle ORM, Zod, Vitest, pino. npm as the package manager. Node 24.

### D-004 · Clean architecture with enforced layers

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** The layers are domain → application (ports) → infrastructure, wired in `src/server/container.ts`. ESLint enforces the import rules. See `ENGINEERING.md` §2.
- **Consequence:** This supersedes the folder layout in LLD §13.

### D-005 · Playlist jobs run in short steps; Postgres is the queue

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - The browser calls `POST /api/playlist-jobs/:id/step` about every 1.5 seconds.
  - Each step does at most about 8 seconds of work under a 15-second lease (`locked_until`), then saves a checkpoint.
  - A GitHub Actions sweep every 30 minutes finishes jobs left behind when users close the tab.

### D-006 · Spotify rate gate lives in Postgres

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:**
  - Store the shared pause in a single-row `spotify_gate` table, updated with `GREATEST()`.
  - On a 429 whose `Retry-After` is above 120 seconds, or whose body reason is `QUOTA_EXCEEDED`, pause the job instead of waiting.
  - Make no calls while a pause is in effect.
  - Fallback backoff: full jitter, capped at 60 seconds, at most 5 attempts.

### D-007 · Spotify endpoints and fields for new apps

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:**
  - Use `POST /me/playlists`, `POST|PUT /playlists/{id}/items` and `GET /search` (limit ≤ 10).
  - Do not use the top-tracks endpoint, batch gets, `popularity` or `followers`; all are removed for new apps.
  - Pass `market` explicitly, because `/me` no longer returns `country`.

### D-008 · Event data: admin entry + Ticketmaster; no scraping

- **Status:** Accepted · **Owner:** Events · **Date:** 2026-11-21
- **Decision:**
  - The MVP gets events from admin entry and the Ticketmaster Discovery API only.
  - No scraping of Instagram, Facebook, BookMyShow or District.
  - Songkick, Bandsintown and JamBase are out of scope.

### D-009 · Artists are resolved at ingest, cached 30 days

- **Status:** Accepted · **Owner:** Matching · **Date:** 2026-11-21
- **Decision:**
  - Resolve each artist's Spotify ID when an event is saved, using an app (client-credentials) token.
  - Re-check IDs older than 30 days.
  - Auto-accept a match at score ≥ 70 with a lead of ≥ 15 over the runner-up; otherwise send it to the review queue.

### D-010 · Independent QA team signs off every pointer

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - Dev teams write dev tests.
  - A separate QA team, which never sees the implementation discussion, writes adversarial tests from the LLD and the module's public interface.
  - A pointer is ticked only after QA passes it.

### D-011 · `@types/node` pinned to 24

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** Match the Node 24 runtime. Vitest 5 requires `@types/node` 22 or newer.

### D-012 · One web boundary and shared auth guards

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - Every route handler is wrapped in `route()` from `src/server/http.ts` and validates input with `parseBody` / `parseWith`.
  - Routes get the user from `requireUser(req)` / `requireAdmin(req)` in `src/server/auth/guards.ts`. The Spotify team implements the bodies in P1.2, and the signatures don't change.

### D-013 · Artist name normalization is shared and owned by Artist Matching

- **Status:** Accepted · **Owner:** Matching · **Date:** 2026-11-21
- **Decision:** `src/domain/shared/normalize.ts` exports:
  - `normalizeArtistName(raw: string): string`
  - `splitArtistCredit(raw: string): string[]`, which splits on b2b, vs, "x" and feat. and returns raw display names.
    Artist Matching builds it first (part of P1.4). Events & Ingestion uses it for lineups, and keeps venue normalization in `src/domain/events/`.
- **Consequence:** P1.4 is split between two teams: artist names go to Matching, venues to Events.

### D-014 · Teams don't edit shared files directly

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - `package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint and TS config, and `docs/DECISIONS.md` are changed only by the Lead.
  - Teams export factory functions (e.g. `createSpotifyModule(deps)`), and the Lead wires them into the container.
  - Teams put proposed decisions and schema changes in their hand-back report.

### D-015 · Review-queue artists keep `spotify_id` empty; aliases only count for confirmed matches

- **Status:** Accepted · **Owner:** Matching · **Date:** 2026-11-21
- **Decision:**
  - An artist in `needs_review` is stored with `spotify_id = null`, because two artists awaiting review can share a top candidate and the column is unique.
  - An alias hit is used only when the artist it points to is `auto` or `manual` and has a Spotify ID.

### D-016 · Persist match candidates for the review queue

- **Status:** Proposed · **Owner:** Matching · **Date:** 2026-11-21
- **Decision:**
  - Add table `artist_match_candidates(artist_id PK, candidates jsonb, scored_at)`, backing `MatchCandidateStore`.
  - Until it exists, the review queue re-searches Spotify for artists missing a candidate (2 calls each).
- **Next step:** the Lead adds the table when wiring the container.

### D-017 · Concrete `SpotifyBlockedError` class

- **Status:** Proposed · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:** Spotify exports a concrete `SpotifyBlockedError` (AppError with `resumeAfter` and `reason`), so other teams can use `instanceof` instead of shape checks.

### D-018 · API request bodies reject unknown fields

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** QA found that PATCH bodies with extra keys are silently accepted.
- **Decision:** Every Zod schema for request input uses `z.strictObject(...)`. Unknown keys return 400 `validation_failed`. Silently dropping fields hides client bugs and mass-assignment attempts.

### D-019 · Spotify errors live in the ports file

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:** `SpotifyBlockedError` (code `spotify_blocked`, 503, reason `gate_paused | long_retry_after | quota_exceeded`, `resumeAfter`) and `ReauthRequiredError` (code `spotify_reauth_required`, 401) are exported from `src/application/ports/spotify.ts`, so application code can catch them with `instanceof`. Supersedes D-017.

### D-020 · Spotify retry details

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:**
  - `QUOTA_EXCEEDED` without `Retry-After` pauses for 1 hour.
  - After 5 attempts that all got 429, throw `gate_paused`.
  - A 401 triggers one token refresh for both app and user tokens.
  - Any active pause makes calls throw immediately. The job runner (Playlist Engine) treats a short pause as "try again next step", not a failure.
  - The Engine configures a backoff cap that fits the 8-second step budget.

### D-021 · Token ciphertext is bound to its row

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:** AES-256-GCM uses associated data `spotify_tokens:<userId>:<field>`, so a ciphertext copied to another user or another column fails to decrypt.

### D-022 · `market` applies to track calls only

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** This clarifies D-007. Pass `market` on track search, artist albums and album tracks. Artist search needs none.

### D-023 · Auth ports location

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:** Auth ports stay in `src/application/auth/ports.ts`, next to the auth service.

### D-024 · Event data collection must cost $0

- **Status:** Accepted · **Owner:** Lead (user decision) · **Date:** 2026-11-21
- **Decision:**
  - Events and lineups are collected automatically from a whitelist of trusted news outlets, official festival/organiser sites, Wikipedia and Ticketmaster.
  - Extraction uses free methods only: RSS, schema.org JSON-LD, per-site parsing rules, and validating candidate names against Spotify artist search. No paid AI models.
  - Auto-publish only when two trusted sources agree, or one trusted outlet and the official site agree.
  - Users never type artists. They search events (type-ahead) and pick one.
- **Consequence:**
  - Admin entry stays only as a correction tool.
  - The source whitelist comes from research in progress.

### D-025 · Merge duplicate artist rows

- **Status:** Proposed · **Owner:** Events (owns `ArtistRepository`) · **Date:** 2026-11-21
- **Decision:** Add `ArtistRepository.mergeInto(duplicateId, canonicalId)`, which moves `event_artists` to the canonical row and deletes the duplicate in one transaction, plus `findBySpotifyId`. Matching calls them instead of recording duplicates.
- **Why:** QA-M-2 is fixed for now by storing the duplicate with a null ID. A merge removes the special case for downstream code.

### D-026 · Admin decisions are never overwritten automatically

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** Automatic re-checks (the 30-day re-validation) must never change an artist whose `match_status` is `manual`, or an event field set by `admin`. They may only flag it for review.

### D-027 · Events team conventions

- **Status:** Accepted · **Owner:** Events · **Date:** 2026-11-21
- **Decision:**
  - Event-title similarity uses Sørensen–Dice token overlap.
  - `dedupeKey` is `title|YYYY-MM-DD (UTC)|city`.
  - **Ticketmaster tiers** (by attraction position):
    - The first act is the headliner.
    - With 3 or fewer acts, the others are support.
    - Otherwise, positions 2–3 are sub, 4–10 mid, and the rest support.
  - **Festival detection:** multi-day, a name containing "fest", or 6 or more acts.
  - Possible duplicates (score 0.6–0.85) are saved as separate events with a logged warning until D-028 lands.

### D-028 · Review table for possible duplicate events; richer ingest stats

- **Status:** Proposed · **Owner:** Events · **Date:** 2026-11-21
- **Decision:** Add the `event_merge_reviews(event_id, similar_to, score, created_at)` table, and add `items_merged` and `items_failed` to `ingest_runs`.

### D-029 · Zero-duplication data rules (ENGINEERING.md §10)

- **Status:** Accepted · **Owner:** Lead (user requirement) · **Date:** 2026-11-21
- **Decision:**
  - Every entity has a natural key enforced by a unique constraint, and every write that can repeat is an upsert.
  - Duplicates are merged into a canonical row, and uncertain cases go to review tables.
  - D-016, D-025 and D-028 move from Proposed to Accepted.
  - A new pointer, **P1.10 Data integrity hardening**, covers:
    - artist `mergeInto` + `findBySpotifyId`
    - a globally unique venue alias
    - `event_merge_reviews`
    - `artist_match_candidates`
    - ingest counts

### D-030 · "Concerts for you" from Spotify listening

- **Status:** Accepted · **Owner:** Lead (user decision) · **Date:** 2026-11-21
- **Decision:**
  - Add the login scopes `user-top-read` and `user-follow-read`.
  - Recommend upcoming events whose lineup contains the user's top artists (`GET /me/top/artists`, `short_term` and `medium_term`, limit 50) or followed artists (`GET /me/following?type=artist`).
  - Both endpoints are listed as "still available" in Spotify's Feb 2026 changelog. Whether new Development Mode apps can call them is not explicitly stated, so verify it in the real-API check (P4.4) before building the UI.
  - Store only the derived set of the user's artist IDs (refreshed at most daily), never raw listening history.

### D-031 · QA tests the real app in a real browser

- **Status:** Accepted · **Owner:** Lead (user requirement) · **Date:** 2026-11-21
- **Decision:**
  - Besides unit and integration tests, QA runs **end-to-end tests with Playwright**. A real Chromium browser, on desktop and phone sizes, uses the running local app the way a user does: typing in search, clicking events, reading the lineup, logging in, generating a playlist.
  - E2E tests live in `tests/e2e/` and run with `npm run test:e2e`.
  - QA also does an **exploratory pass**: it browses the app, takes screenshots, and reports anything confusing, broken or slow, not only failed assertions.
  - A user-facing pointer is ticked only after its E2E flow passes.
- **Consequence:** Spotify steps in E2E use a fake Spotify server locally (msw or a stub route), plus one manual check with the real Spotify account (P4.4).

### D-032 · Read the Spotify gate before every request

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** QA-S-1 showed that a 2-second positive cache lets one worker call Spotify while another has set a pause.
- **Decision:** `SpotifyHttp` reads `spotify_gate` before every request. It may remember a pause it has already seen, but it never caches "not paused".

### D-033 · Event sources: research findings (supersedes parts of D-024)

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Findings:**
  - Official festival and organiser sites publish lineups as **images**, with no performer JSON-LD. They confirm event, date and venue only.
  - Text lineups come mainly from news outlets: Rolling Stone India (RSS, crawl-delay 600s) and Pollstar (RSS) are the low-risk best sources.
  - Time Out, The Hindu and Hindustan Times have terms that ban automated collection, so they're excluded.
- **Decision:**
  - The starter whitelist is:
    - Rolling Stone India, Pollstar, Free Press Journal, Mid-day, Indian Express (RSS)
    - Hollywood Reporter India (news sitemap)
    - Live Nation newsroom (sitemap diff)
    - Sunburn (WP REST + image file names) and Team Innovation (static cards) for event facts
    - Wikipedia API (CC BY-SA, attribute)
    - Ticketmaster
  - Artist extraction at $0: keyword filter → split lineup sentences → keep only names confirmed by Spotify artist search or MusicBrainz.
  - Corroboration: the event, date and city must match across two sources, and the artist sets must overlap by at least 70%.
  - We store facts only, never article text, and always link to the source.

### D-034 · Event-data rules clarified by QA

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - **URLs:** every URL from outside (sources, admin input) must be `http:` or `https:`. One shared `httpUrl` validator is used everywhere.
  - **Lineup limit:** at most 300 artists, counted after credit splitting.
  - **Date-only events:** Ticketmaster events with only `localDate` start at 00:00 in the venue's timezone, and the UI shows "time TBA".
  - **Dedupe blocking:** compare calendar dates (UTC), so events up to about 48 hours apart can share a block. Accepted, because scoring decides.
  - **Overwrites:** once an admin has edited an event, lower-precedence sources may only fill empty fields (D-026).
  - **Non-music events:** Ticketmaster events outside the Music segment are skipped on our side.

### D-035 · Spotify ids are validated at the response boundary

- **Status:** Accepted · **Owner:** Spotify · **Date:** 2026-11-21
- **Decision:**
  - Every Spotify id in a response (artist, track, album, playlist, and artist ids on tracks) must match base62. One invalid id rejects the whole response with `UpstreamError` and a logged warning.
  - We chose fail-safe over partial results, because real Spotify ids are always base62 and a bad one signals a deeper problem.
  - `/me` profile ids aren't checked, because they never go into URL paths.

### D-036 · One shared, auto-updating playlist per concert (core product decision)

- **Status:** Accepted · **Owner:** Lead (user decision) · **Date:** 2026-11-21
- **Context:** Spotify Development Mode allows only 5 allow-listed users, and Premium doesn't change that. Rotating users through the allow-list isn't possible through the API and would breach Spotify's terms.
- **Decision:**
  - Every event has **one public playlist**, created and owned by the **app owner's Spotify account** (the admin who connected it; stored as the "publisher" account).
  - Anyone can open the event and tap **Open in Spotify** to follow or save it. **No login is needed.**
  - If no playlist exists yet, **Make playlist** builds it with the publisher account. Later visitors reuse it.
  - When the lineup changes (`lineup_hash`), the same playlist is updated in place (replace items), so followers see the new songs.
  - Spotify login becomes **optional**: personal extras (Concerts for you, custom personal playlists) for up to 5 allow-listed people.
- **Consequences:**
  - Playlist jobs are keyed per **event**, not per user, so there's at most one active build per event.
  - Abuse protection is a per-IP rate limit plus one build per event at a time.
  - The publisher's token must be healthy. If it's missing or needs reauth, Make playlist shows "temporarily unavailable" and the admin is alerted.
  - Schema: `shared_playlists(event_id unique, spotify_playlist_id unique, url, track_ids, lineup_hash_at_build, options_version, snapshot_id, built_at)`. The existing `playlists` table stays for personal playlists.
  - Supersedes the per-user parts of LLD §7 and D-005, which now apply to event jobs.

### D-037 · Schema update for shared playlists and data integrity (migration 0001)

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **New tables:**
  - `shared_playlists` (one per event; unique Spotify id)
  - `spotify_publisher` (single row)
  - `artist_match_candidates` (D-016)
  - `event_merge_reviews` (D-028)
- **Changed columns:**
  - `events.starts_at_date_only`
  - `ingest_runs.items_merged` and `items_failed`
  - `playlist_jobs.kind` (`shared` | `personal`), with `user_id` nullable for shared jobs
  - The idempotency key is globally unique.
- **Constraints:**
  - A partial unique index allows one active shared job per event.
  - `venue_aliases.alias_normalized` is globally unique.
- All 120 integration tests pass on the new schema.

### D-038 · How songs are picked for each artist ($0 sources)

- **Status:** Accepted · **Owner:** Lead (user requirement: every artist, mixing most-listened, trending and newest) · **Date:** 2026-11-21
- **Sources:**
  - **Most listened:** Last.fm `artist.getTopTracks` (free key; non-commercial; credit and link to Last.fm; cache per HTTP headers, under 100 MB).
  - **Trending:** Apple Music RSS "most played" chart for India (`rss.marketingtools.apple.com/api/v2/in/music/most-played/100/songs.json`), fetched once a day for all artists. Plus Spotify search order as a per-artist proxy.
  - **Newest release:** Spotify `GET /artists/{id}/albums` (album, single), newest first. Fallback: iTunes lookup `sort=recent&country=in`.
  - **Mapping to Spotify:** track search `track:"X" artist:"Y"`. Keep a result only if it contains the resolved artist id, after title normalisation (strip "(From …)", feat., remaster tags).
- **Excluded:**
  - Deezer: lists are empty from Indian IPs, and its terms forbid local copies and association with third-party trademarks.
  - YouTube: quota too small.
  - ListenBrainz: needs a token, is rate-limited, and covers Indian artists poorly. It may come back later.
- **Per-artist mix:**
  - Headliner 10 = 5 most-listened + 3 trending + 2 newest.
  - Sub 5 = 3 + 1 + 1.
  - Mid 3 = 2 + 0–1 trending + 1 newest.
  - Support 2 = 1 most-listened + 1 trending-or-newest.
  - Unfilled slots roll over to the next-best signal. Every lineup artist is included.
- **Filters:** skip live, remix, karaoke, sped-up/slowed, instrumental and acoustic versions when the original exists. Dedupe by Spotify id, ISRC, then normalised title + artist.
- **Caching:** cached by artist for 24 hours (Last.fm, Apple) and 7 days (Spotify ids).

### D-039 · Real-Spotify finding: duplicate artist profiles without images

- **Status:** Accepted · **Owner:** Matching · **Date:** 2026-11-21
- **Context:** In the first real run (P4.4), 7 of 13 sample artists went to review for "small lead", even though the right artist was ranked first. Example: Prateek Kuhad scored 75 (rank 0, has image) against 63.5 for a same-name profile at rank 1 with **no image**. Spotify has many such stub or duplicate profiles.
- **Decision:**
  - Raise the image signal from +10 to **+20**. A real artist with photos now clearly beats an imageless duplicate (85 vs 63.5).
  - Two same-name candidates that both have images still go to review.
  - LLD §6 and the QA expectations are updated to match.
- **Also verified on real Spotify:** login with Authorization Code + PKCE works; tokens are stored encrypted; artist search works for a new app; search rank 0 was the correct artist for 13/13 names.

### D-040 · Playlist order and naming (default)

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Order:** headliners first, then sub, mid and support, which matches the UI copy "headliners first, openers last". Within a tier, artists are **interleaved round-robin**, so you never hear one artist's songs back to back. The order can be changed later per event.
- **Name:** `{Event title} · Lineup Mix` (max 100 chars).
- **Description** (max 300 chars): "Songs from the {title} lineup. Updated {d MMM}. Popularity data: Last.fm. Made with Lineup Mixes."
- **Publisher:** the shared playlist is public and owned by the publisher account (D-036).

### D-041 · "Owns the songs" signal for duplicate artist profiles

- **Status:** Accepted · **Owner:** Matching · **Date:** 2026-11-21
- **Context:** After D-039, 6 of 7 review cases (KATSEYE, Ritviz, Diljit Dosanjh, Seedhe Maut, Nucleya, The Local Train) still had **same-name duplicates with images**, scoring 85 vs 83.5. Spotify gives new apps no popularity or followers to separate them. The real artist was rank 0 every time.
- **Decision:**
  - When the top two candidates are within the lead margin, run **one** extra Spotify track search: `artist:"<name>"`, limit 10, market IN.
  - The candidate credited on the most of those tracks gets **+20 (`songOwnership`)**. A tie gives nobody the bonus.
  - It costs 1 call per ambiguous artist, needs no new dependency, and it reflects who actually has the songs.
  - The MusicBrainz external-ID hook (+20) stays available for later.
- **Consequence:** the matching module takes `TrackCatalog` as an extra dependency.

### D-042 · Event search is a first-class module (type-ahead)

- **Status:** Accepted · **Owner:** Events (backend) + UI (front end) · **Date:** 2026-11-21
- **Context:** The user called search "the most important part". The first version only did a title substring match, and it had a light-mode contrast bug, which is fixed.
- **Backend:** `GET /api/events/suggest?q=`, using Postgres `pg_trgm` and `unaccent` (migration 0002, with trigram GIN indexes on event titles, artist names and venues). It matches:
  - **Event title:** prefix, word-start, substring and typo-tolerant (e.g. "lolapalooza", "sunbrn").
  - **Nicknames and aliases:** "lolla" → Lollapalooza, "nh7" → NH7 Weekender, via a small alias table or rules.
  - **Artist names:** "diljit" → every upcoming event where Diljit plays, labelled "Diljit Dosanjh plays here".
  - **City and venue:** "mumbai", "palace grounds".
- **Ranking:** exact or prefix title first, then word-start, alias, artist, venue or city, then fuzzy. Ties go to the soonest upcoming event. Past events are excluded by default.
- **Each result** returns `matchReason` (`title` | `alias` | `artist` | `venue` | `city` | `fuzzy`) and the matched text for highlighting.
- **Limits and input:** at most 8 results. Input is normalized (case, diacritics, whitespace), and queries are 2–100 characters. Strict Zod validation, and p95 under 100ms on the local DB.
- **Front end:** the search is a self-contained module:
  - a `useEventSearch` hook: debounce, request cancellation with AbortController, race-safety (stale responses ignored), a small LRU cache, and retry on transient errors;
  - presentational components;
  - the full ARIA combobox pattern;
  - grouped results ("Events", "Artists playing"), highlighted matches, recent searches stored locally, and empty, error and offline states.
- Both halves get dev tests plus independent QA (unit, browser E2E and exploratory).

### D-043 · Playlist Engine conventions (P2.1–P2.5)

- **Status:** Accepted · **Owner:** Engine · **Date:** 2026-11-21
- **Decision:**
  - An artist counts as matched only when it has a `spotifyId`.
  - "Trending" means the artist appears in Apple's India most-played chart, matched by normalized name.
  - A shared playlist is "built" once `lineup_hash_at_build` is set. It's "stale" when that differs from the event's `lineup_hash`.
  - Playlist steps use their own Spotify retry budget (`maxWaitSeconds` 5, `maxAttempts` 3) so a step stays near 8 seconds. The Lead will move this into the container, with one engine-scoped Spotify instance.
  - Starts are rate-limited to 10 per IP per hour, in memory per process (MVP; moves to Postgres before launch).
- **Accepted follow-ups:**
  - `PlaylistWriter.updateDetails`, so the description's "Updated" date refreshes on rebuild.
  - `mbid` on `LineupArtist`, for Last.fm lookups.
  - The scheduled sweep script steps running and paused jobs (P4.1).

### D-044 · Nothing reaches the user before end-to-end QA

- **Status:** Accepted · **Owner:** Lead (user requirement) · **Date:** 2026-11-21
- **Decision:** The Lead gives the user a link, screen or step to try only after:
  - the app compiles;
  - `npm run check` is green;
  - QA's Playwright suites pass (`npm run test:e2e` and `tests/qa/e2e`);
  - the Lead has run a manual smoke check.

  Steps that need the user's own credentials (e.g. a Spotify login) are requested only after the Lead has verified that route works.

- **Also:** teams keep the shared dev tree compiling at every step (add new code, switch imports, then delete old code).

### D-045 · Playlist Engine rules clarified by QA

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - **Mid-card:** 3 songs = 2 most-listened + 1 trending, or 1 newest if the artist isn't charting.
  - **A rebuild that finds 0 songs** keeps the existing playlist and marks it stale. It never empties a playlist people follow.
  - **Version filter:** only marker words in brackets or after " - " count ("(Live)", "- Remix", "[Sped Up]"). Real titles such as "Live Forever" are kept.
  - **Last.fm order:** results are sorted by playcount defensively; the API's order isn't trusted.
  - **Chart credits:** Apple chart credits are split on commas, "&", "and", feat. and x, using the shared credit splitter (DRY with `splitArtistCredit`).
  - **Timeouts:** every outbound request (Last.fm, Apple, Spotify) during a step has a timeout well under the 15-second lease (≤ 6s). A step re-checks its lease before each write.
  - **Missing publisher:** when no publisher is connected or it needs reauth, the 503 is logged at `warn` once per minute, not as an error stack trace on every request.

### D-046 · Late writes after a lease expires: accepted residual risk

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - Every request in a step times out at 4s (`REQUEST_TIMEOUT_MS`).
  - The engine's Spotify calls make at most 2 attempts.
  - A write starts only when at least 13s of the 15s lease remain (`WRITE_LEASE_MARGIN_MS`).
  - So a real write can't outlive its lease. QA's test with a write that can never be cancelled is kept as documentation (skipped). Revisit if `PlaylistWriter` gains `AbortSignal` support.

### D-047 · Search recommendations: deeper backend (user request)

- **Status:** Accepted · **Owner:** Events (backend) + UI · **Date:** 2026-11-21
- **Context:** The user wants search to _recommend_, not just match typed text.
- **Decision:** `GET /api/events/suggest` gains these features:
  1. **Zero-query recommendations** (`q` empty, shown on focus). Sections:
     - "Trending now" (highest `event_stats.trend_score`);
     - "This weekend" (upcoming Fri–Sun, IST);
     - "Near you" (city from the optional `city` parameter, or the user's saved city);
     - "For you" (logged-in users: events with artists from their Spotify top or followed artists, D-030; needs the extra scopes);
     - "Popular searches" (top normalized queries from `search_log`, last 7 days).
     - Each section has at most 5 items, and an event appears once across sections.
  2. **Query understanding.** City words ("lolla mumbai", "gigs in pune") and date words ("this weekend", "tonight", "december", "2027") become filters. The rest of the query is matched as today.
  3. **Entity suggestions.** Artists are their own results ("Prateek Kuhad · 2 upcoming shows"), listed above their events. Cities are too ("Pune · 5 upcoming").
  4. **Popularity-aware ranking.** Within the same match tier, `trend_score` breaks ties before date. `trend_score` decays exponentially with a 7-day half-life and is bumped by views (1), search clicks (3) and playlist opens (5).
  5. **Better typo and phonetic tolerance** for Indian names ("diljeet" → Diljit, "arjit" → Arijit, "badshaah" → Badshah). Use trigram similarity on artist names plus a small, data-driven transliteration-variant normalizer (ee→i, aa→a, sh/s, double letters).
  6. **Learning loop:** anonymous `search_log` (query, results count, clicked event; no user id or IP). Zero-result queries appear on an admin list so aliases can be added. Logs older than 90 days are deleted by the sweep.
- **Schema:** `search_log`, `event_stats` (migration 0003).
- **New endpoints:**
  - `POST /api/events/:id/view` and `POST /api/search/click`: rate-limited, no PII.
- **Latency targets** (local): p95 under 100ms for typed queries and under 150ms for zero-query recommendations.

### D-048 · The search-to-playlist journey is specified in `docs/SEARCH_FLOW.md`

- **Status:** Accepted · **Owner:** Lead (user requirement: "think of when the user starts typing, and after clicking") · **Date:** 2026-11-21
- **Decision:** `docs/SEARCH_FLOW.md` is the source of truth for every state:
  - before typing,
  - while typing,
  - after clicking (event, artist, city, chip, Enter),
  - the playlist button states on the event page.

  The UI implements all of them, and QA covers each with an E2E test.

- **New backend needs (Events team):**
  - `GET /api/search?q=&city=&artist=&from=&to=&type=&page=` → the full results page, using the same engine as suggest, paginated.
  - Artist and city filters on that endpoint.

### D-049 · No sample data in the real database; E2E has its own server and database

- **Status:** Accepted · **Owner:** Lead (user request) · **Date:** 2026-11-21
- **Decision:**
  - Sample events, artists and venues are deleted from the local `concert` DB, and `seed-demo.ts` is removed. Local data now comes only from real sources (Ticketmaster and the automatic collector, P1.11).
  - **Playwright E2E runs its own dev server** on port 3100 with `DATABASE_URL=concert_e2e` and `NEXT_DIST_DIR=.next-e2e`. `tests/e2e/global-setup.ts` recreates, migrates and seeds that DB from `tests/e2e/fixtures/seed.ts`.
  - **Fixture names** are realistic (Lollapalooza India 2027, NH7 Weekender Pune, Diljit Dosanjh Live in Bengaluru) and exist only in the test DB.
  - **Unit and integration tests** keep using `concert_test` (unchanged).

### D-050 · Fresh, location-aware catalogue with live lookup

- **Status:** Accepted · **Owner:** Lead (user decision) · **Date:** 2026-11-21
- **Catalogue model:**
  - Events are collected **ahead of time** into our DB by the scheduled collector, **every 3 hours** via GitHub Actions. Users always read from our DB, which is fast and doesn't depend on a source being up.
  - New announcements merge into existing events, and lineup changes rebuild the shared playlist.
  - Past events drop out of search and home; their playlists stay in Spotify.
- **Location:**
  - The home page uses the visitor's **city**: the switcher cookie, then Vercel's free `x-vercel-ip-city` header, then "All India". Implemented in `src/server/location.ts`.
  - There's a "📍 City ▾" switcher, and no location-permission prompt on load. Precise geolocation is a later optional button (needs venue coordinates).
- **Live lookup for unknown searches:** when a typed search has no results, the UI calls `POST /api/lookup {q}`:
  - **Recognise:** Spotify artist search, so we can say "Coldplay: no India dates yet" instead of a blank.
  - **Look up now:** Wikipedia search, plus Ticketmaster keyword search once a key exists. Confirmed upcoming events found this way are ingested immediately through the normal pipeline (dedupe, artist matching). Structured or official sources may publish with a "source" label; free text still needs corroboration.
  - **Watch list:** unresolved queries go on a watch list (from `search_log` zero-result queries), and the next scheduled run searches its feeds for them.
  - **Response:** `{status:"found", results} | {status:"not_found", artist?} | {status:"searching"}`.
  - **Limits:** rate-limited per IP and globally; concurrent lookups for the same query are deduped; a 6-second timeout.
- **Later:** "Know about this show? Paste the link or poster" submissions, and "notify me" alerts.

### D-051 · More free open sources (research 2026-11-21)

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Add now** (all $0, no new sign-ups):
  - **Wikidata SPARQL:** Indian festival series and official sites; artist ID crosswalk (P1902 Spotify, P434 MusicBrainz, P3192 Last.fm); venue coordinates. CC0. Custom User-Agent.
  - **MusicBrainz URL relationships:** a second route to an artist's Spotify ID, for fewer review cases. 1 req/s, CC0.
  - **Last.fm `geo.getTopTracks` / `geo.getTopArtists` (country=India):** a second India trending signal with the existing key.
  - **Nominatim geocoding at venue save:** 1 req/s, cached forever, ODbL attribution shown. Feeds "near you" distance later.
  - **Open-Meteo:** a weather and rain-risk badge on outdoor event pages (16-day horizon). CC BY, attribution.
  - **India holidays (Google public ICS):** "long weekend 🎉" tags. Filter to national gazetted holidays.
  - **chrono-node** (MIT, local) for date extraction in the collector.
- **Add next:**
  - setlist.fm "likely setlist" (free non-commercial key; short-term cache only, per its terms).
  - Cover Art Archive and Wikimedia Commons images, with an attribution component.
  - A Bluesky author-feed watcher for official festival accounts (confirmation signal only).
- **Needs a decision:**
  - Free hosted LLM extraction (Gemini or Cloudflare free tier), which conflicts with D-024's "no paid AI" spirit and has data-use terms.
  - JamBase Developer free plan (1k calls/month).
- **Don't use:** Songkick, Bandsintown, Eventbrite search (shut down), SeatGeek, Skiddle, PredictHQ, Resident Advisor (bans bots), the Reddit API, Telegram scraping, Spotify Charts CSV, Kworb, unofficial JioSaavn/Gaana, MusicBrainz for upcoming events, live Overpass, Nager.Date.

### D-052 · No AI extraction for now; measure first

- **Status:** Accepted · **Owner:** Lead (delegated by user) · **Date:** 2026-11-21
- **Decision:**
  - Lineup extraction stays rule-based (D-024, D-033), with every candidate name validated on Spotify.
  - The collector logs, per article, whether rules found a lineup (`extraction: found | partial | none`).
  - After about 2 weeks of real runs, if more than 20% of relevant articles end `none` or `partial`, add a free hosted LLM (Gemini free tier) as a fallback extractor behind a flag. It would only see public article text, its output would be validated the same way, and it would switch off gracefully if the tier changes.

### D-053 · New collector sources and cross-run corroboration

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - `event_source` gains `rollingstone`, `pollstar`, `wikipedia`, `sunburn` and `teaminnovation` (migration 0004).
  - **Precedence:** admin > jambase > ticketmaster > sunburn > teaminnovation > wikipedia > rollingstone > pollstar > user_submission. Every source must be in `SOURCE_PRECEDENCE`, and a QA test enforces that.
  - The new `event_candidates` table keeps single-source events across runs (unique on `(source, external_id)`), so two sources reporting on different runs still corroborate. Candidates are never shown publicly.

### D-054 · Data-quality gate before anything is shown

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** A Wikipedia tour table (Ed Sheeran's Mathematics Tour, India leg, **2025**) was published as 7 events in **2027**, with the opening act (Prateek Kuhad) as headliner. The year was guessed, and the headliner was read from the wrong column. The events were deleted.
- **Decision:**
  - Extractors never guess years. Rows without an explicit year are dropped.
  - Past dates are never published.
  - Tour articles: the headliner is the article's subject; opening and support columns become support tier.
  - Single-source publishing needs all of: an explicit future date (≤ 18 months), a city, and at least one headliner confirmed on Spotify.
  - A single article can't publish more than ~10 events in one run without corroboration.
  - The Lead reviews the published list after each real run until the collector has a clean record.

### D-055 · The collector never publishes without the Lead's review

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** A second bad publish happened before the D-054 fixes landed. "Sunburn Festival 2026, Goa, 27–29 Dec", with a 2013–15 lineup (Paul van Dyk…), was taken from the history section of the Wikipedia article, along with a made-up "Sunburn Festival 2027". The real event is Mumbai, 18–19 Dec 2026 (DJ Snake, Sebastian Ingrosso, The Chainsmokers, Jason Derulo, Anyma). All events and candidates were wiped.
- **Decision:**
  - `ingest.ts` defaults to candidates only. `--publish` is run only by the Lead after reviewing a dry-run report.
  - Agents use `--dry-run` or a scratch DB, never the real `concert` DB.
  - Wikipedia festival articles contribute only an explicit current-edition section or infobox; history sections and past editions are ignored, and future editions are never synthesised.
  - Official organiser sources win on city and venue. Sources that disagree on city stay unpublished and flagged.

### D-056 · Every stored event is verified in layers, and re-verified continuously

- **Status:** Accepted · **Owner:** Lead (user requirement: "data always correct, cross-verified multiple times") · **Date:** 2026-11-21
- **Schema** (migration 0005):
  - `events.visibility` is `held | published | archived`, default **held**.
  - `events.confidence` (0–1).
  - `events.verification` (jsonb: per-field provenance and check results).
  - `events.last_verified_at`.
  - Public endpoints (list, detail, suggest, search, lookup results, home, playlists) only ever return `published`.
- **Layer 1, extraction checks (per source):**
  - the date is explicit in the text, never inferred, and the year is explicit;
  - the date is in the future and ≤ 18 months away;
  - the city is in the India city list (or a known country);
  - content comes only from current-edition sections (D-054/055).
- **Layer 2, cross-source agreement, field by field:**
  - **Date, city, venue, headliners** are each checked separately.
  - A field is **verified** when ≥ 2 _independent_ sources agree. Syndicated copies of one press release count once (same text or same origin URL).
  - Alternatively, a field is verified when one **official** source (the organiser's or festival's own site, or the official ticketing listing it links) states it.
  - Any disagreement on date or city keeps the event `held` and flags it.
- **Layer 3, entity checks:**
  - every artist is confirmed on Spotify;
  - headliners are cross-checked with Wikidata or MusicBrainz identity where available (D-051) and must be active (a release in the last ~5 years);
  - the venue geocodes inside the stated city (Nominatim, D-051).
- **Layer 4, sanity checks:**
  - reject a lineup identical or ≥ 80% similar to a past edition of the same series (stale copy);
  - reject a city that isn't where official sources say the series runs this year;
  - reject implausible artist counts or durations;
  - a single source can't create many events in one run.
- **Layer 5, fact-check before publish:**
  - Every `held` event that passes layers 1–4 gets a **fact-check agent pass**: an independent web search for the event, date, city and headliners against official and reputable pages, with evidence links recorded in `verification`.
  - Only then does the Lead publish it.
  - After the collector has a clean record of 2 weeks, auto-publish at confidence ≥ 0.9 with fact-checked fields, while the Lead keeps spot-checking samples.
- **Layer 6, continuous re-verification:**
  - Every collector run re-checks published events. If a source disappears, the date or city changes, or a conflict appears, the event goes back to `held` and the change is logged.
  - Events whose date has passed become `archived`.
- **UI:** shows a small "✓ Verified from N sources · checked 2h ago", with the sources linked.
- **Regression set:** a golden fixture set of known-real and known-fake cases (Ed Sheeran 2025 tour, Sunburn old Goa lineup, Sunburn 2026 Mumbai) must pass in CI.

### D-057 · Search speed budget

- **Status:** Accepted · **Owner:** Lead (user: "search is very slow, make it faster and more robust") · **Date:** 2026-11-21
- **Measured (dev server, loaded machine):** suggest 12–50 ms ✅; zero-query 12–40 ms ✅; **live lookup 5.5–8 s, with no cache hit on repeat** ❌; `/search` page 0.07–2.6 s ⚠️.
- **Decision:**
  - **Live lookup never blocks.**
    - `POST /api/lookup` answers in < 300 ms with `{status:"searching", lookupId}` (or a cached final answer), and finishes in the background.
    - The UI polls `GET /api/lookup/:lookupId` every 700 ms (max ~8 s), or gets the result on the next keystroke.
    - Spotify artist recognition is answered first (< 1 s); Wikipedia and Ticketmaster continue after.
  - **Lookup cache really works:** found → 10 min; not_found → 30 min; ambiguous → 10 min. Keyed on the normalized query and shared across requests. A repeat lookup returns in < 50 ms.
  - **`/search` SSR** never runs a live lookup. The page renders from the DB at once, and lookup happens client-side.
  - **Budgets** (production build, local):
    - suggest p95 < 100 ms; zero-query < 150 ms;
    - first lookup response < 300 ms;
    - search box: visible feedback (local results or recommendations) within 50 ms of a keystroke;
    - `/search` page TTFB < 300 ms.
  - Budgets are checked by timing tests (API) and a Playwright perf spec (UI) **against `next build && next start`**, because dev mode compiles routes on demand and isn't representative.

### D-058 · Hidden events leave no trace

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:** Held and archived events are indistinguishable from missing ones on every public path:
  - the same 404 for view, click, detail, playlist status/start, and playlist-job status/step;
  - no names from them in `didYouMean`, aliases or entity suggestions;
  - publishing an event changes only `visibility`, never source rows, ownership or precedence.

### D-059 · Dedicated app contact for API etiquette

- **Status:** Accepted · **Owner:** Lead (user chose option b) · **Date:** 2026-11-21
- **Decision:** The collector's User-Agent includes `APP_CONTACT_EMAIL`, a free mailbox created only for the app. Never a personal or work address, and never the GitHub username. If it isn't set, no contact is sent.

### D-060 · Event lifecycle decisions

- **Status:** Accepted · **Owner:** Lead (delegated by user) · **Date:** 2026-11-21
- **Decision:**
  1. **Past events:**
     - They're archived a day after they end and leave home, search and upcoming lists.
     - A direct link still opens the page, labelled "This happened on {date}", with the playlist.
     - Data is never deleted.
  2. **Cancelled events:** shown with a "Cancelled" banner for 30 days, with no "upcoming" placement, then archived.
  3. **Alerts** go to lineupmixes@gmail.com: source failing 3 runs in a row, events needing review, publisher needing reauth.
  4. **Publishing:**
     - Manual review until the collector has 14 clean days.
     - After that, events with confidence ≥ 0.9 that pass layers 1–4 and the automated fact-check auto-publish.
     - The Lead spot-checks a sample weekly.
     - Anything below 0.9 stays held for review.
  5. **Re-verification cadence:** more than 60 days out daily, 7–60 days every 6h, under 7 days every 3h. Candidates older than 30 days are cleaned up.
- **Addendum (alert channel, Platform, 2026-11-21):**
  - Alerts go through the `Alerts` port (`src/application/ports/alerts.ts`); adapters live in `src/infrastructure/alerts/`.
  - **Primary: Gmail SMTP** (implicit TLS, port 465, app password) to lineupmixes@gmail.com, when `ALERT_SMTP_USER` and `ALERT_SMTP_PASS` are set. $0, no dependency.
  - **Fallback: GitHub Actions job summary.** Without SMTP, the alert is written to the run's job summary as an error annotation and the run is marked failed, so GitHub's failed-run email reaches the repository owner.
  - Every alert is also logged. A lasting condition repeats at most once a day; a failing source alerts on its 3rd consecutive failed run, then every 8 runs (about daily).
  - Senders: the sweep (held events, publisher reauth) and the ingest workflow's source-health step. Setup in `docs/DEPLOY.md` §7.

### D-061 · AI models (Gemini / OpenAI) are helpers, never a source of truth

- **Status:** Accepted · **Owner:** Lead (user offered API keys) · **Date:** 2026-11-21. Supersedes the "no AI" part of D-052.
- **Context:** Language models confidently invent concerts, dates and lineups, which is exactly the failure behind D-054 and D-055.
- **Decision:** AI models may be used **only** where their output is checked against real sources:
  1. **Reading:** they extract lineup, date, city and venue from a page we already fetched from a trusted source (grounded extraction). Output is validated by the same 6 layers (D-056). They never invent fields that aren't in the text.
  2. **Discovery:**
     - Gemini with Google Search grounding may suggest _where to look_ (candidate event and source URLs).
     - We then fetch the cited pages ourselves and verify them.
     - A claim with no fetchable source is dropped.
  3. **Search understanding** (later): turning messy queries into filters.
- **Never:** AI-only facts stored or shown; AI answers used as a second "source" for corroboration.
- **Efficiency:**
  - AI is used only after free rule-based parsing fails (`extraction: none|partial`).
  - Cheapest capable models (Gemini Flash-Lite first, then a small GPT model).
  - Prompts are trimmed to the relevant paragraphs, with structured JSON output.
  - Results are cached per URL and content hash.
  - Per-run and daily token and call caps, with a kill switch.
  - Usage and cost are logged per run.
- **Keys:** `GEMINI_API_KEY`, `OPENAI_API_KEY` in `.env`, entered by the user and never pasted in chat. Prefer Gemini's free tier. If OpenAI is used, the user sets a hard monthly budget limit in the OpenAI dashboard.

### D-062 · AI is called only when there's doubt, with a strong model

- **Status:** Accepted · **Owner:** Lead (user decision) · **Date:** 2026-11-21. Refines D-061.
- **Decision:** Gemini or OpenAI are called **only** to resolve doubt:
  - a held event missing a field (lineup, venue, date);
  - sources that disagree (date or city conflict);
  - confidence just under the publish threshold;
  - a page the free parser couldn't read.

  They are **never** called on normal search, typing, or for events that already pass verification.

- **Models:**
  - Use a strong current model (Gemini Pro-class with Google Search grounding first; a strong OpenAI model as the fallback reader). No "lite" or "mini" models for fact work.
  - Model names are configured in `.env` (`GEMINI_MODEL`, `OPENAI_MODEL`).
- **Efficiency:** one targeted call per doubtful event per run, relevant text only, results cached by event and content, daily caps, usage log.
- **Output:** answers still pass D-061 grounding (real cited pages) and all D-056 layers before anything is stored.

### D-063 · Which AI to use: OpenAI with web search for doubt resolution and regional discovery

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Findings:** The Gemini free tier is unusable for this project. Pro models: "limit 0"; Flash with Google Search: quota exceeded on the first call; then 404s on `generateContent` (Google is steering new keys to its Interactions API).
- **Decision:**
  - Use OpenAI `gpt-5.5` (strong, not mini or nano) through the Responses API with the **web_search** tool. Configured as `OPENAI_MODEL`.
  - It's used only on doubt (D-062): missing lineup, venue or date, conflicts, near-threshold confidence.
  - Also used for targeted **regional artist discovery** (Punjabi, Tamil, Telugu, Malayalam, Bengali, Marathi and other regional scenes poorly covered by our English feeds) as a scheduled low-frequency task: at most a few calls per day.
  - Every claim must come with web-search citations. We fetch the cited pages ourselves (allowed domains only), and the claim must pass all D-056 layers. Uncited claims are dropped.
  - A hard daily cap on calls and tokens, a usage log, and the user's $ budget limit in the OpenAI dashboard.
  - Gemini stays wired as an optional provider (`GEMINI_MODEL`), off until billing is enabled.
- **Blocked on:** OpenAI credit balance is $0 (`credit_balance_exhausted`). The user must add prepaid credit and set a monthly limit.

### D-064 · Free doubt resolver: Tavily search + GitHub Models (gpt-5.5)

- **Status:** Accepted · **Owner:** Lead (user chose free) · **Date:** 2026-11-21. Supersedes the paid parts of D-063.
- **Verified live:**
  - Tavily search returns real pages with text. "Sunburn Festival 2026 Mumbai lineup" found sunburn.in's official event page and DJ Mag's full-lineup article.
  - GitHub Models, with the user's personal token (Models: read only), serves `openai/gpt-5.5` for free, rate-limited.
- **Pipeline (only on doubt, D-062):**
  1. Tavily search → candidate pages.
  2. Keep only **allowed domains**: official organiser and festival sites, plus reputable outlets that allow automated use (e.g. DJ Mag, Rolling Stone India, Pollstar). Never Instagram, Facebook, BookMyShow, District, Time Out, The Hindu or HT.
  3. The GitHub Models gpt-5.5 call does **grounded extraction** from that text only, returning structured JSON with a quote for each fact.
  4. The quote must appear verbatim in the page text, or the fact is dropped.
  5. All D-056 layers apply, then the Lead reviews.
- **Fallbacks:** if GitHub Models hits its daily limit, the step is skipped for the day. OpenAI (`OPENAI_API_KEY`, needs credit) and Gemini (needs billing) stay optional and off.
- **Keys:** `TAVILY_API_KEY`, `GITHUB_MODELS_TOKEN`, `GITHUB_MODELS_MODEL=openai/gpt-5.5`. Both were pasted in chat, so rotate them before deploy.

### D-065 · Playlist length matches the real show; every artist included, weighted by billing and popularity

- **Status:** Accepted · **Owner:** Engine (user requirement) · **Date:** 2026-11-21. Supersedes the fixed per-tier song counts in D-038.
- **Total length = the event's real performance time**, summed over days:
  - **Hours per day:** from verified event data (`verification.hours` or start and end times). HOME Festival: 14:00–22:00 × 2 days = **16 h**.
  - **Defaults when unknown:** festival day 8 h; single-artist concert 2 h 30 m; multi-artist concert 4 h.
  - **Single-artist concert** (e.g. Diljit): the whole duration is that artist's songs.
- **Every matched artist is included.** Each artist's share of the total time is:
  - `weight = tierWeight × popularityFactor`, normalised over the lineup.
  - `tierWeight`: headliner 10, sub 5, mid 2.5, support 1.
  - `popularityFactor` comes from free, real popularity data: **Last.fm listeners** (`artist.getInfo`), log-scaled into 0.6–1.6. Missing data gives 1.0, so tier decides.
  - **Floor:** every artist gets at least 2 songs, or 1 if the lineup is huge. **Cap:** one artist can't exceed 40% of a multi-artist festival.
- **Filling an artist's time:** add songs from that artist's ranked pool (D-038 signals: most-listened, trending, newest) until their time is used, using real track durations. Stop before overshooting by more than half a song.
  - If the pool runs out, extend it from their albums by release-date recency and popularity proxies.
- **Order** stays D-040: headliners first, interleaved within a tier. Optionally grouped by day, if day assignments are known.
- **Spotify limits:** add in chunks of 100 within the step budget, so a 16 h playlist (~250 songs) builds in a handful of steps.
- **The UI estimate** ("N songs · about X h") must use the same calculation, so the preview matches the result.

### D-066 · Every lineup artist must end with a correct Spotify link

- **Status:** Accepted · **Owner:** Matching (user requirement) · **Date:** 2026-11-21
- **Context:** On HOME Festival, 12 of 33 artists stayed unmatched. Lineup names differ from Spotify names (suffixes like "Live" or "Music", band vs member, collab names, common short names).
- **Decision:** A multi-strategy resolver:
  1. name variants;
  2. context scoring (genre fit, recently active, owns the songs);
  3. web corroboration through the Tavily search port: Spotify artist links found on the web for that artist plus festival context;
  4. band ↔ member relations through MusicBrainz;
  5. auto-accept only with strong evidence, otherwise review with the top 3 candidates and their evidence.
- The goal is a Spotify link for every lineup artist. Unresolved ones are listed for review, never guessed.

### D-067 · Parallel teams get isolated test databases

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - The integration setup reads `TEST_DB_NAME` (validated as `[a-z0-9_]+`), and every team sets its own. This stops concurrent runs from dropping each other's database, which had caused mass false failures.
  - Playwright runs one suite at a time.

### D-068 · `web` source and configurable doubt caps

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Decision:**
  - `event_source` gains `web` (migration 0006), for allow-listed pages found by the doubt resolver (DJ Mag, Esquire India…). Precedence: just above `user_submission`.
  - `DOUBT_SEARCHES_PER_DAY` and `DOUBT_MODEL_CALLS_PER_DAY` (default 30) are configurable in `env()`.
  - **Correction:** the GitHub Models check in D-064 was a false positive. This session's network sandbox answers `models.github.ai` with a stub "OK" response. Real access must be allowed by the user in the sandbox network settings, or the resolver run from the user's own terminal or CI.

### D-069 · GitHub Models is blocked on this laptop; the AI step runs in the cloud

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Finding:** `models.github.ai` answers a bare `200 text/plain "OK"` to every request on this Mac, **even with an invalid token**. That means something on this machine's network path (most likely the work laptop's endpoint-security filtering of AI services) intercepts it. It isn't GitHub and it isn't the Claude Code sandbox: a project sandbox allow-rule changed nothing, so it was removed. The same token works on `api.github.com`.
- **Decision:**
  - Don't try to bypass the laptop's security controls.
  - The AI doubt-resolver step runs in the **scheduled GitHub Actions job** (cloud runner, not this laptop), and later on Vercel.
  - Locally, the resolver skips the AI step gracefully, and the Lead verifies doubtful events manually.
  - If local AI is needed, OpenAI is reachable from this machine but needs prepaid credit.

### D-070 · Security review fixes (pre-launch) and the archived-event rule

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Archived vs held (resolves the D-058 / D-060 conflict):**
  - **held** = 404 everywhere, indistinguishable from missing.
  - **archived** = the detail page stays reachable by direct link with a "This happened on {date}" label and the playlist link. It's excluded from every list, search, suggestion, count and recommendation, and can't start a new playlist build.
- **Fixes assigned:**
  - **Spotify:** `DELETE /api/me` (deletes the user, cascading tokens and sessions); expired-session cleanup.
  - **Ingestion:**
    - live lookup becomes serverless-safe: synchronous with a 6 s cap and a Postgres-cached result, no `globalThis` job registry;
    - SSRF guard in `polite-fetch` (block private and reserved IPs after DNS; manual redirects, at most 3 hops, each re-checked; streamed byte cap; content-type check; detail links same-host);
    - Wikipedia is `trusted`, not `official`, and `en.` only;
    - doubt-resolver pages are re-fetched through PoliteFetcher;
    - output length caps;
    - Ticketmaster timeout.
  - **Platform:** security headers and CSP; client IP from the platform header, not raw XFF; Postgres-backed limits for lookup and playlist start; Neon pooler URL with a small pool; logger redaction for apikey, api_key and token.
  - **Engine:** compare lease times on one clock (DB time).
  - **Events:** `search_log` retention of 90 days, through the sweep.
- **Keys exposed in chat** get rotated at deploy (`docs/DEPLOY.md`), and production gets fresh `TOKEN_ENC_KEY` and `SESSION_SECRET`.

### D-071 · Session lifetime; and pacing parallel work on one laptop

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Sessions:** expire after 14 days idle, capped at 30 days from sign-in, with the expiry pushed forward at most once a day. `DELETE /api/me` deletes the account (tokens, sessions and personal playlists cascade). `deleteExpiredSessions()` runs in the sweep.
- **Pacing:** at most ~5 teams in parallel on this laptop. Load average hit about 26 and dev pages took 5–6 minutes. Playwright QA and production builds run only when the dev teams are idle.

### D-072 · Dedupe never merges separate nights, and a merge never quietly moves a date

- **Status:** Accepted · **Owner:** Events · **Date:** 2026-11-21
- **Context:** A Mumbai residency (5, 6, 9 Dec, 19:30 IST, same title, artist and a "TBA" venue) was merged: the 6 Dec entry moved the 5 Dec event to 6 Dec. The ±1 day block plus matching title, lineup and "TBA" venue reached the merge score, and the equal-rank (admin) merge overwrote `starts_at`.
- **Decision** (`src/domain/events/dedupe.ts`, `src/application/events/write-event.ts`):
  - **Merge guard**, applied before scoring and to the same-dedupe-key shortcut:
    - Same local (IST) date: allowed; scoring decides.
    - Different local dates, both with a confirmed time, and one source behind both (or an admin on either side): **never** merged. These are separate shows (residency, tour).
    - Different local dates otherwise (two different sources, or a date-only listing): at most **review**. This keeps the ±1 day tolerance for a timezone or date slip between sources, but a person confirms it.
  - **Placeholder venues** ("TBA", "TBD", "To be announced", "Secret location") count as no venue: zero venue similarity, never evidence of the same place.
  - **Start-time protection:** when a merge would change `starts_at` (or the date-only flag) and the incoming source has the _same_ rank as the event's owner, it becomes a review (a separate event plus an `event_merge_reviews` row) instead. Lower ranks never overwrite it (they only fill gaps). A strictly higher rank may correct it. A source updating its own listing (same external ID) is not a merge and still may move its date.
  - **Same-UTC-date siblings** (an early and a late show, or 19:30 and 00:30 IST) are stored with the start time appended to `dedupe_key` (`…|2026-12-05|mumbai|19:00`). The key stays stable on later updates.
  - **Admin creates** that land in review now record the `event_merge_reviews` row too, as ingest does.

### D-073 · Gig coverage: artist-first discovery, HighApe, leads, and per-night candidates

- **Status:** Accepted · **Owner:** Gig Coverage · **Date:** 2026-11-21
- **Context:** "Sketchbook by Bhuwin Khursija" (Mumbai, 5, 6 and 9 Dec 2026, OML) was missed. Its facts are only on BookMyShow, Instagram and the artist's Linktree. The terms of all three forbid automated access (Linktree's robots.txt also has `User-agent: * Disallow: /`). The research is in `docs/research/gig-sources.md`.
- **Decision:**
  - **Sources:**
    - Allowed and built: **HighApe** (`highape`): city pages carry schema.org Event JSON-LD, robots allows them, and the terms say nothing on automated access.
    - Newly denied (added to `DENIED_DOMAINS`): AllEvents (terms forbid crawling), Linktree (terms), Songkick and Bandsintown (no key without written consent), Shazam (`Disallow: */events/*`), Apple Music (terms), Insider (now District), X/Twitter.
    - Not used yet:
      - Skillboxes: its terms page needs JS and couldn't be read;
      - NCPA: its terms forbid storing content on other sites;
      - The Piano Man: two-digit years;
      - OML: its WAF blocks bots and it has no listing;
      - Zeppelin: no India shows.
  - **Crawling vs a user-given link:**
    - robots.txt binds crawlers (our scheduled runs).
    - A single page a user explicitly gives us is not crawling, **but the site's terms still apply**. Linktree, BookMyShow and District forbid any automated access, so even a user-given link to them is stored as a lead for a human, never fetched.
  - **Artist-first discovery** (`src/application/gigs`):
    - **Watchlist:**
      - zero-result searches (`search_log`), mapped to our own artist when the term is a word of one ("garrix" → Martin Garrix), and dropped when it's a city;
      - catalogue artists with an `auto`/`manual` match;
      - Last.fm `geo.getTopArtists` for India.
        Each run takes every searched artist, then a rotating slice (`GIG_ARTISTS_PER_RUN`, default 15).
    - **Per artist:**
      - the official site (Wikidata P856 from the Spotify ID) and up to 2 tour pages;
      - one Tavily search. Allow-listed pages are fetched by PoliteFetcher; pages on denied or unknown sites become **leads** (`gig_leads`: URL plus the search result's title only, never page text or snippets, at most 5 per artist, none for shows already past).
    - **Budget:** searches share the doubt resolver's daily counter (`DOUBT_SEARCHES_PER_DAY`).
  - **Extraction is rule-based and quote-grounded** (no model, so it runs on the laptop, D-069):
    - **Dates:**
      - the year must be written out (four digits);
      - a list ("5th, 6th and 9th December 2026") is **one candidate per night**;
      - a listing range ("Sat 5 Dec 2026 – Wed 9 Dec 2026") stays a range and never becomes nights.
    - **City:**
      - an outlet page needs the city and the artist on the date's own line;
      - the artist's own site may use the line above, never the line below (the next show's heading).
    - **Quotes:** every field keeps its exact text span (`provenance.quotes`), stored in `event_candidates.payload`.
  - **Source enum and precedence:**
    - New `event_source` values: `highape`, `artist_site` and `gig_web` (migration 0010).
    - Precedence: … teaminnovation > **artist_site > highape** > wikipedia > rollingstone > pollstar > **gig_web** > web > user_submission.
    - `artist_site` is an organiser-level (official) source for the D-056 layers.
    - `highape` is only `trusted` there: anyone can list on it, and its acts come from free-text titles.
  - **HighApe runs in the gig pipeline, not in `ingest.ts`.** The collector's ±1-day, title-overlap clustering merged different club nights ("… Night ft. DJ X") into one event in the dry run. Gigs group only on the same IST date, city and headliner (`groupNights`).
  - **Live lookup:** when Spotify recognises the query as an artist, `artistGigs` runs discovery for that artist inside the 6 s cap and stores candidates. `not_found` gains `checking: <count>`; no dates or titles are returned.
- **Consequence:**
  - A show listed only on BookMyShow, District or Linktree is now surfaced as a lead with its link for the Lead, instead of being missed silently. It can't be confirmed automatically.
  - Missing from the city list (Events): Guwahati. Peter Cat Recording Co.'s 10 Jan 2027 Guwahati show was skipped for that reason.

### D-074 · Scheduled auto-publish behind a strict gate (amends D-055/D-056: gate-or-Lead)

- **Status:** Accepted · **Owner:** Gig Coverage (Lead decision) · **Date:** 2026-11-21
- **Decision:** `autoPublishDecision` (pure, `src/domain/gigs/auto-publish.ts`) publishes one night only when **all** of these hold:
  1. ≥ 2 independent sources (different registrable domains), and ≥ 1 official one: the artist's site, the organiser, the venue, or a primary ticketing page (HighApe counts here).
  2. The official source quotes the title (or a composed "<Headliner> Live in <City>" whose two parts are both quoted), the date with its year, the start time (or an explicit date-only), the city and the headliner.
  3. No source conflicts with another on date, time, city or headliner. A conflict holds; the majority never wins.
  4. The night is in the future and ≤ 18 months away.
  5. The headliner's match is `auto` or `manual`.
  6. The lineup isn't identical to a past edition of the series.
  7. D-056 confidence ≥ 0.9.
  8. No source says the show is cancelled.

  A failed rule 4 or 6 **rejects**; any other failure **holds**.
  - Regression tests cover Ed Sheeran's 2025 dates read as 2027, and Sunburn 2026 with the 2013–15 lineup.

- **`publishDueCandidates`:**
  - It judges every upcoming night and upserts the verdict into `gate_decisions`.
  - On publish, it writes the event through the normal ingest and checks it was stored under **that night** (otherwise it's left for the Lead). It then sets `published`, saves the verification with `gate` and `reviewedBy: "auto-gate"`, and appends to `publish_audit`.
  - An auto-published night that later fails the gate goes back to `held`, with an audit row and an alert.
- **Re-verification** (`reverifyAutoPublished`): every 3 days, re-read the official page.
  - Unchanged → audited as `reverified`.
  - Same night at a new time → re-gated; if it passes, `updated` in place, otherwise held.
  - Gone (404/410), cancelled, or the night no longer listed → `held`, audited and alerted.
  - Transient failures change nothing.
- **Switches:**
  - Publishing runs only when `AUTO_PUBLISH_ENABLED` is exactly `true` (anything else is off, so it fails closed) and `settings.auto_publish_paused_until` is absent or past. An unreadable pause value also pauses.
  - With publishing off, nights are still discovered and judged.
- **Schema** (migration 0010, pure add):
  - tables `gate_decisions`, `publish_audit` (append-only), `gig_leads`;
  - enums `gate_verdict`, `publish_action`;
  - the three `event_source` values above.
- **Known limit:** the existing organiser adapters (Sunburn, Team Innovation) attach no quotes, so their events always go to the Lead.

### D-075 · The GitHub repository is public

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** The scheduled jobs (sweep every 30 min, ingest every 3 h, gig discovery every 6 h, weekly revalidate) use roughly 2,000 GitHub Actions minutes a month, counting install overhead. That is about the whole private-repo free quota. Public repos get unlimited standard-runner minutes. The owner delegated the choice.
- **Decision:** Make `virajsinghkalra/tixtape` (personal account only) public.
  - Before the first push and before every release: run a secret scan over the working tree **and the full git history**. Commit no `.env*` except `.env.example`. Everything sensitive lives in GitHub/Vercel secrets.
  - No personal or work email in commit metadata. The first commit's author is re-stamped to the personal noreply address.
  - Workflows keep `contents: read`, secrets scoped to single steps, and no `pull_request_target`. Fork PRs never receive secrets.
  - Admin routes stay behind `requireAdmin`. Security does not rely on the code being hidden.
- **Consequences:** Anyone can read the code; the protections above make that safe. If the project later goes commercial, we can make the repo private again and move the schedules (see the free-resources research).

### D-076 · Production stack: Vercel Hobby (sin1) + Neon (Singapore) + public-repo GitHub Actions + Gmail SMTP

- **Status:** Accepted · **Owner:** Lead · **Date:** 2026-11-21
- **Context:** Free-resources research, checked on official pricing and terms pages on 2026-11-21:
  - **Cloudflare:** 10 ms CPU and 3 MiB limits are too tight for Next.js server rendering.
  - **Render, Railway, Koyeb:** sleep or lack an Asian region.
  - **Fly.io:** no free tier.
  - **Cloud Run:** needs billing.
  - **Oracle Always Free:** needs a card and self-managed ops, and idle VMs can be reclaimed.
  - **Supabase:** Mumbai region but only 500 MB, and a 7-day pause.
  - **Neon free:** 1 GB, 100 CU-hrs/month, pg_trgm and unaccent confirmed on PG16, Singapore is the nearest region.
- **Decision:**
  - **App:** Vercel Hobby with the function region pinned to **sin1**, next to Neon. Without the pin, every query would cross from the default iad1 region to Singapore. The project is personal and non-commercial, which Hobby requires. Ads, affiliate links or paid features would require revisiting this choice (Vercel Pro or a self-hosted VM).
  - **Database:** Neon free in Singapore, with the pooled URL for the app and the direct URL for migrations (D-043 deploy notes).
  - **Schedules:** GitHub Actions on the public repo (D-075). The **sweep runs hourly, not every 30 min.** Each sweep keeps Neon compute awake about 6 min, so hourly keeps CU-hours at roughly a quarter of the free 100. Browsers already step jobs live; the sweep only rescues abandoned ones. A monthly keepalive workflow stops GitHub disabling scheduled workflows after 60 days without repo activity.
  - **Email:** Gmail SMTP app password to lineupmixes@gmail.com. There's no custom domain yet, so Resend isn't usable.
  - **Monitoring:** UptimeRobot free (5-min checks on `/` and one API route) and Sentry free (errors, plus one cron monitor on ingest). Both are optional at launch.
  - **Domain:** start on `*.vercel.app`. A custom domain can come later.

### D-077 · The product is named Tixtape

- **Status:** Accepted · **Owner:** Lead (chosen by the owner) · **Date:** 2026-11-21
- **Context:** The owner asked for a Gen Z name. "Pregame" was weighed: `pregame.vercel.app` and `pregame.app` are taken, and the word is generic, crowded by sports playlists. For "Tixtape" (ticket + mixtape), RDAP checks on 2026-11-21 showed `tixtape.vercel.app`, `.in`, `.app`, `.fm` and `.co` free (`.com` taken), and a web search found no app or company with that exact name. The closest names are TixScape (ticket price comparison), Vixtape and TixTube. This was not a trademark registry search.
- **Decision:** Brand everything as **Tixtape** (wordmark: lowercase "tix" plus a lime "tape" sticker):
  - Page titles: `%s · Tixtape`.
  - Shared playlist names: `{Event} · Tixtape` (was `· Lineup Mix`), and descriptions end "Made with Tixtape."
  - Alert emails: `[Tixtape]`.
  - Footer tagline: "every ticket gets a mixtape ✦".
  - Production URL: `tixtape.vercel.app`.
  - The owner renames the Spotify publisher account's display name to Tixtape.
- **Names:** the npm package and GitHub repo are `tixtape` (renamed 2026-11-21; the local folder stays `concert-playlist-app`). Unchanged: the bot User-Agent token and contact mailbox (`lineupmixes@gmail.com`) stay as they are. Changing them adds risk and no user-visible value.
- **Also fixed:** `clip()` in `src/domain/playlists/naming.ts` could cut an emoji (surrogate pair) in half. The rename moved the cut point and exposed it. It now never splits a pair.
- **Addendum (2026-11-21):**
  - Neon created the project on **Postgres 18.7**; local and CI run 16. All migrations 0000–0009 apply cleanly, and pg_trgm and unaccent are present. Move local Docker and the CI service to 18 so all environments match.
  - The first catalogue copy took only published and archived events plus their venues, artists, sources, lineups and shared playlists. The `published` content fingerprint (md5 of id, title, starts_at) matches local.
  - **Reset the Neon `neondb_owner` password before go-live.** It was pasted in chat.

### D-078 · Collector clustering doesn't join different club nights

- **Status:** Accepted · **Owner:** Events · **Date:** 2026-11-21
- **Context:** The Gig Coverage team's HighApe dry run found that `clusterCandidates` (`src/domain/events/extract/corroborate.ts`) joined separate club nights. "CROSS/OVER Ft Nikhil Chinapa" and "CROSS/OVER Ft <another DJ>" share "cross", "over" and "ft", which gives a title overlap of 0.6 (≥ 0.5). HighApe was taken out of `ingest.ts` because of this (D-073).
- **Decision** (`sameEvent` and `clusterCandidates`):
  - **Generic words carry no title similarity:** night, presents, ft/feat/featuring, live, party, club, show, concert, gig, tour, music, festival/fest, dj, b2b, x, vs, and connecting words. The event's own venue and city words are dropped from titles too.
  - **Recurring brands carry no title similarity:** a title word that appears in one city's listings on ≥ 3 different IST dates spanning ≥ 7 days (a weekly series, venue or promoter brand) is ignored for that clustering run. One festival weekend (many articles, dates within days) is not a brand.
  - **Different headliners in the titles never cluster.** Headliners are read from "ft/feat/featuring X", "X live (at …)", and the candidate's own artists that appear in the title. If both titles name headliners and they share none, the candidates are separate.
  - **Same venue, same IST date, different headliner = separate show**, unless the sources agree on artists (≥ 70% overlap, or each one's headliner is on the other's bill).
  - **One listing source, two items, consecutive IST nights, same venue = two nights** (the D-072 residency rule for candidates). The ±1 day window stays for date slips _between_ sources.
  - A title made only of ignored words gives no title evidence. Artist overlap ≥ 70% can still cluster.
  - D-072 (event dedupe in `dedupe.ts`) is unchanged.
- **Tests:** domain cases built from the HighApe fixture titles, plus an end-to-end test that runs the real HighApe adapter over its fixtures and clusters the output, including with every night moved onto one date and venue.

### D-079 · Ranked, location-aware home page

- **Status:** Accepted · **Owner:** Lead (decisions), UI (implementation) · **Date:** 2026-11-21
- **Context:** With ~200 events, "the 12 soonest" let a 10-city tour fill the page and hid big festivals a few months out.
- **Decision:**
  - **Score = size × proximity × timing** (pure: `src/domain/events/front-page.ts`).
    - _Size_ = 1 + 3 × popularity + festival 0.6 + lineup (≤ 0.3, log of artist count) + extra sources (0.05 each, ≤ 0.15) + engagement (views + 5 × playlist opens, log-scaled, capped at 0.15).
    - _Popularity_ = the best-known top-billed artist's Last.fm listeners, `(log10 − 3) / 4` clamped to 0–1 (1k → 0, 100k → 0.5, 10M → 1). No regional bias. Unknown = 0.35 (neutral, about 25k listeners).
    - _Proximity:_ same city 1.0, same metro cluster 0.7 (static map: Mumbai/Navi Mumbai/Thane/Pune, Delhi NCR, Bengaluru, Hyderabad/Secunderabad, Chennai, Kolkata, Goa, Ahmedabad/Gandhinagar, Chandigarh/Mohali/Panchkula, and more), elsewhere 0.3. With no city known, everything is 1.0.
    - _Timing:_ this week 1.0, ≤ 30 days 0.9, ≤ 90 days 0.75, beyond 0.55. Past events are never shown. One still running counts as this week.
  - **Sections, in order:**
    - Near you · {city} (city known and has events; top 6 by score; no city cap here, since the city is the point);
    - The big ones (top 5 India-wide by size × timing);
    - This week;
    - Just announced (newest `created_at`);
    - Tours (collapsed).
    - A card appears in one section only. The story strip ("Happening this week") may repeat them.
  - **Diversity:**
    - One card per tour: same top-billed names and title stem (text before " – ") within 90 days. The card shows "10 cities" (or "3 dates" for a residency) and the visitor's city, else their metro, else the next date, and lists every stop.
    - At most 2 cards per city (exact) or per headliner in a section.
  - **"See all" on every section:** `/search?city=` for Near you; `/search?from=today` (and `&to=` for This week) for the rest.
  - **Performance:**
    - One feed query (`EventFeedReader` → `PgEventFeed`) returns up to 300 published, upcoming rows with summary, top-billed names, cached listeners, solo photo, ticket URL, source count and engagement. No per-card `getEvent`.
    - Rows are cached for 5 minutes per server instance (`src/server/front-page.ts`). Ranking runs per request because the visitor's city comes from a cookie.
- **Schema:** migration 0011 adds `artists.lastfm_listeners` and `lastfm_listeners_at` (nullable, pure add).
  - They're filled by `refreshArtistPopularity`, through the Playlist Engine's `LastfmPopularity` (D-065, no second client): `npx tsx src/scripts/refresh-popularity.ts`, and at the end of the weekly `revalidate.ts`.
  - Values are refreshed after 7 days. A missing value stays neutral.
- **Tests:**
  - Unit tests for every factor, metro clustering, tour grouping, featured dates and the diversity caps.
  - A seeded 200-event scenario (a 10-city tour, a far-away mega festival, a tiny local gig, a past event) asserting what Mumbai, Kolkata and no-city visitors see.

### D-080 · Fast "Make playlist": cached songs, pre-warm, and one prioritised Spotify call budget

- **Status:** Accepted · **Owner:** Engine (owner P0) · **Date:** 2026-11-22. Amends D-038/D-065 (how songs are fetched), D-006/D-020 (who may call Spotify, and how often).
- **Context:** The real HOME build (24 artists) made about 14 Spotify calls per artist: a search for every Last.fm title, newest releases and album tracks. Only 4 artists finished in 90 s, then a 429 on `/search` returned `Retry-After: ~63,700 s`. The shared gate honoured it, so the whole app was paused for ~17.7 h. Matching re-runs and gig validation were calling Spotify at the same time.
- **Spotify facts (developer docs, checked 2026-11-22):**
  - The rate limit is app-wide over a rolling 30 s window, not per endpoint. So one gate for every endpoint is correct, and a `/search` ban does block playlist writes.
  - `Retry-After` is in seconds. We parse seconds or an HTTP date, with no cap, and honour it.
  - Since February 2026, batch `GET /tracks|/albums|/artists` and artist top tracks are removed. Search returns at most 10 results per page (`offset` paging is the advice), artist albums at most 10, and album tracks at most 50.
- **Songs per artist (≤ 3 calls for festival artists):**
  - Ranking comes from Last.fm, which is free: `artist.getTopTracks` and listeners.
  - Spotify only resolves titles. It uses `artist:"Name"` search pages sized to the artist's D-065 budget: 1 page for ≤ 7 songs, 2–3 for subs, 4–5 for a big headliner, 6 at most for a solo 150-min show. Then targeted `track:"T" artist:"A"` searches for top Last.fm titles the pages missed, within 3 calls in total.
  - It never pages a whole catalogue, and newest releases and album tracks are no longer fetched.
  - The "newest" signal comes from release dates already in the search results.
- **Cache:**
  - Each artist's resolved songs are stored in `artist_track_cache` (mode `hits`, per market) for 14 days: id, name, artists, ISRC, duration, release date, search rank, Last.fm rank, plus Last.fm listeners.
  - The cache is shared by every event, rebuild and estimate.
  - It had 0 rows before because nothing wrote to it; the engine only cached in process memory.
  - Interim encoding: JSON per element of `spotify_track_ids`, with a header in element 0. **Proposed:** a `candidates jsonb` column (Lead, schema).
- **Pre-warm:**
  - `prewarmEvent` resolves uncached artists as the `prewarm` class. It runs after `ingest --publish` (2 min) and in every sweep (4 min, soonest events first).
  - A warm build is create + ≤ 3 writes, finishing in 1–2 steps.
  - The estimate returns `readiness {cachedArtists, artists, seconds}`, and the panel shows "Ready in about 5 s" or "Takes about 2 min to make".
- **One call budget with priorities:**
  - Every Spotify request takes a slot first (`SpotifyCallBudget`). The counters live in Postgres (`rate_limits`) and are shared by every instance.
  - Classes: `build` (playlist builds, sign-in) > `match` (matching, live-lookup validation) > `prewarm` > `discovery` (gigs, ingest validation) / `revalidate`.
  - **App-wide:** 8 calls per fixed 10 s window, so any rolling 30 s holds ≤ 32 calls (~1 per second).
  - **Background:** at most 3 of the 8 slots. Per window: match 2, prewarm 1, discovery 1, revalidate 1. Per day: match 1,500, prewarm 1,000, discovery 400, revalidate 400. So builds always keep ≥ 5 of 8 slots.
  - **When the window is full:** builds wait ≤ 1.5 s, then return a short pause (the next step retries). Background classes wait up to 60 s, and stop for the day at their cap.
  - Scripts declare their class with `runAsSpotifyClass`. Module defaults: the main instance counts as `match`, the engine's instance as `build`.
  - A 429 still closes the shared gate for everyone, and the class that triggered it is logged and counted.
  - The sweep logs calls and 429s per class for today and yesterday.
- **Steps:** a step starts no new unit after 6 s, and writes need ≥ 13 s of lease left (D-045).

### D-081 · Discovery follows where visitors are (city demand)

- **Status:** Accepted · **Owner:** Gig Coverage (owner request) · **Date:** 2026-11-22. Extends D-073.
- **Recording demand, privacy-safe:**
  - The new table `city_demand(day, city, kind, count)` (migration 0012, pure add) keeps one counter per IST day, city and kind (`view` or `search`). It never stores an IP, user, session or query.
  - Only known Indian cities are counted (`demandCity`, canonical names), so a hand-made `city` cookie can't add rows.
  - `search_log` has no city and stays unchanged.
  - `noteVisitorDemand(kind)` (`src/server/demand.ts`) resolves the visitor city with `visitorCity` (switcher cookie, then Vercel IP city) and counts after the response with `next/server` `after()`. A failure is only logged.
  - It's called from the home page, the event page (views) and `GET /api/search` when `q` is set. Type-ahead suggest is not counted.
  - The ranking code is untouched.
- **Weighting** (`src/domain/gigs/demand.ts`, pure):
  - Demand per metro is views + 3 × searches over 14 days, with a 7-day half-life. Cities fold into the home page's metro clusters (`metroOf` from `front-page.ts`).
  - The top 3 metros share 70% of a run's artist slots (`GIG_ARTISTS_PER_RUN`) in proportion to demand, and each gets at least 1 slot.
  - The remaining 30% is a **floor** that keeps rotating through every other artist, so new markets are still covered. Slots a metro can't fill go to the floor.
  - A metro's artists are those our lineups place there in the last 12 months (`event_artists` → `venues.city`).
  - Their Tavily search names the metro's cities first. Floor artists get 2 pages instead of 4.
  - HighApe city pages: every planned city is read, plus 2 rotating others.
  - With no demand data (or if it can't be read) the run is the plain D-073 rotation.
- **Scarcity first:** a top metro with fewer than 5 upcoming **published** shows is served before anything else, fewest first. Searched artists come next, then the other demand metros, then the floor.
- **Retention:** counters are aggregate and anonymous. A sweep may delete rows older than 90 days (Platform, optional).

### D-082 · Minimal copy, and real pictures for every event

- **Status:** Accepted · **Owner:** UI (owner request) · **Date:** 2026-11-22. Supersedes the copy parts of D-065 and D-077.
- **Copy rule:**
  - Tiny Gen Z copy: 2–4 words where possible. No explanatory sentences.
  - **Never shown:**
    - song or minute counts, durations, per-tier breakdowns, "matches the show";
    - billing-order lines;
    - Spotify-match commentary ("N of M found", "X is on Spotify", skipped artists), "no login needed", slide counts.
  - **Unmatched artists:** just the name. Match dots stay on admin pages only.
  - **Where it lives:** one copy module, `src/components/lineup-copy.ts` (`PLAYLIST_SOON`, `STORY_CTA`, `introLine`, `moreLine`), and the playlist states in `playlist-state.ts`. Unit tests check the word limits.
  - Screen-reader-only hints may stay longer.
- **Playlist panel:**
  - A title, the Make/Open button, and the state in a few words: "Matching…", "Picking songs…", "Paused · back at 5:33 pm", "Live on Spotify 🎉", "Opening soon 😴".
  - With nothing matched (or a 0-song estimate) it says "Playlist soon ⏳" and hides "Make playlist".
- **Story:**
  - A headline and at most one short line per slide.
  - The last slide always has "Open playlist →" (`/events/{id}#playlist`) and, off the event page, "See event →".
  - Tap zones are handled on the track, so links inside a slide always get the tap. The old overlay buttons swallowed them and closed the modal.
- **Pictures, best first** (`visualFor`, `EventVisual`):
  1. **The official poster:** `events.poster_url` (migration 0013, pure add). It is a separate column from `image_url`, so ingestion merges never blank it.
     - `src/scripts/fill-event-images.ts` fills it from the `og:image` of an allow-listed `official` source page, read through `PolitePageReader`: robots.txt, pacing and the SSRF guard apply, and denied domains are never fetched.
     - The URL is hotlinked, never re-hosted.
  2. **A collage** of the top tier's Spotify photos (up to 4).
  3. **A branded gradient** with a sticker.
  - Plain lazy `<img>` with `referrerPolicy="no-referrer"`; no `next/image` remote patterns.

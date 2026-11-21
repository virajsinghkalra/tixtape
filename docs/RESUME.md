# Resume point (saved 2026-11-21, ~18:45 IST)

Read this first when development resumes. The decision log is `docs/DECISIONS.md` (D-001 to D-049). The tracker is https://claude.ai/artifact/9eSorm2kgoe4bGUjTLJt3o (`tasks` collection, one document per pointer).

## Product in one paragraph

A user types a concert or festival ("lolla"), picks it, sees the lineup, and opens **one shared public Spotify playlist per concert**, owned by the free "Lineup Mixes" account (D-036). No login is needed for users. Song picking per artist: most-listened (Last.fm) + trending (Apple Music India chart) + newest (Spotify) (D-038). Everything runs at $0: Vercel + Neon + GitHub Actions (D-002). Real event data is collected automatically from trusted sources (D-024, D-033), with no scraping of BookMyShow, District or Instagram.

## Done and QA-passed

| Area                                                | Pointers       | Notes                                                                                                      |
| --------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------- |
| Foundation                                          | P0.1–P0.5      | P0.6 CI written, not pushed yet                                                                            |
| Spotify integration                                 | P1.1–P1.3      | Real login works (Premium account `31hmxzxnk5oouvbeweglwlm6d3fa` is admin)                                 |
| Events + venues + dedupe + Ticketmaster + admin API | P1.4–P1.7      |                                                                                                            |
| Artist matching                                     | P1.8–P1.9      | Real Spotify: 13/13 matched after D-039 and D-041                                                          |
| Playlist Engine                                     | P2.1–P2.5      | 308 tests; D-045 and D-046                                                                                 |
| Search backend                                      | (P3.6 backend) | Suggest + zero-query recommendations + `/api/search` live; the Events team was finishing D-047/D-048 items |

## Agents stopped on purpose at ~18:50 IST (user going offline). Last known state:

- **Events (search D-047/D-048):** _all 548 tests passing across 29 files_. It was only writing its report. Treat it as done after a verification run.
- **UI redesign:** was running its own E2E suite; had just noticed the empty real DB on :3000, a good moment to check the empty-home state.
- **Ingestion P1.11:** had only started reading the docs. Restart from its brief.
- **Web UI QA (first pass):** stopped. Its specs in `tests/qa/e2e/` are kept for the final E2E QA.

## In flight when we stopped (re-check each)

1. **UI: Gen Z redesign + full search journey** (P3.1, P3.2, P3.6, P3.8). Spec: `docs/SEARCH_FLOW.md` (D-048). Was writing `tests/e2e/search-journey.spec.ts` and `playlist.spec.ts`. Last known: 3 type errors in `search-journey.spec.ts`. It was also told: E2E runs on port 3100 with DB `concert_e2e` (D-049); update `tests/e2e/helpers.ts` (no "(sample)" titles, no seed-demo); add an empty-catalogue home state.
2. **Events: search recommendations** (D-047, D-048). Code looked finished (0 type errors); no hand-back received. Verify: `npx vitest run src/domain/events src/application/events src/infrastructure/db src/app/api/events src/app/api/search`.
3. **Ingestion: automatic collector P1.11.** Just started. Brief: Rolling Stone India + Pollstar RSS, Wikipedia API, Sunburn WP REST, Team Innovation HTML; $0 extraction + Spotify validation; corroboration before publishing; `src/scripts/ingest.ts`. Then **run a real ingest locally**.

If an agent didn't finish, start a fresh one with the same brief. The `.claude/skills/*` skills have the conventions: `ship-pointer`, `develop-*`, `run-qa-signoff`, `add-event-source`, `change-db-schema`.

## Next steps, in order

1. Check the state: `npm run typecheck`, `npm run lint`, `npm test` (machine was heavily loaded; run targeted suites if slow).
2. Finish or restart the three in-flight agents above.
3. **Full end-to-end QA** (D-031, D-044): `npm run test:e2e` plus `npx playwright test -c tests/qa/e2e/playwright.qa.config.ts`, plus an exploratory QA agent, before showing the user anything.
4. The user connects the **Lineup Mixes** account as publisher: open `http://127.0.0.1:3000/api/auth/spotify/login`, click **"Not you?"**, log in as Lineup Mixes, then **Agree**. Add its Spotify id to `ADMIN_SPOTIFY_USER_IDS` in `.env`, restart, and call `POST /api/admin/publisher` from its session, or insert the `spotify_publisher` row for that user.
5. Build the **first real playlist** from a real ingested event, and check it in Spotify with the user.
6. **P1.10 data-integrity code:** `mergeInto`, `findBySpotifyId`, use the `artist_match_candidates` and `event_merge_reviews` tables (schema exists, migration 0001).
7. **Container wiring:** move `src/server/{events,matching,playlists}.ts` and `auth/spotify-auth.ts` into `src/server/container.ts` (one engine-scoped Spotify instance, D-043).
8. **First git push** to the private repo `virajsinghkalra/tixtape` (personal account only, never a work account). Commit identity is set per repo. Before pushing, re-stamp the first create-next-app commit's author (it has the work email), commit with `--no-verify`, and add no Claude attribution (user's CLAUDE.md). Push only after `npm run check` is green, then confirm CI (P0.6).
9. **Deploy (P4.5)** after the first playlist works:
   - the user signs up to Neon + Vercel with personal GitHub;
   - **rotate the Spotify client secret** (it was pasted in chat);
   - add the prod redirect URI.
10. Spotify scopes: add `user-top-read user-follow-read` for "Concerts for you" (P3.7, D-030).

## Local environment

- Postgres 16 in Docker: `docker compose up -d db` (port 54329). DBs: `concert` (dev, real data only; samples deleted), `concert_test` (integration), `concert_e2e` (Playwright fixtures).
- Migrations 0000–0003 are applied to `concert`.
- Dev server: `npm run dev -- -H 127.0.0.1 -p 3000`. E2E server: port 3100 (Playwright starts it).
- `.env` (git-ignored) contains: Spotify client id and secret, the token and session keys, `ADMIN_SPOTIFY_USER_IDS`, `LASTFM_API_KEY`. `TICKETMASTER_API_KEY` is **empty**: the user should get a free key at developer.ticketmaster.com for international events.
- The `gh` CLI has both accounts. Use `virajsinghkalra` (personal) for this repo.

## Waiting on the user

- [ ] Lineup Mixes publisher login (step 4), after QA passes
- [ ] Optional: Ticketmaster API key
- [ ] Later: Neon and Vercel sign-up for deploy

---

## Resume point #2 (saved 2026-11-21 ~21:20 IST, usage limit reached)

All agents were stopped on purpose. Decisions now run up to **D-067**. Published events (real, Lead-verified):

- Sunburn 2026 (Mumbai, 4 headliners)
- HOME Festival 2026 (Goa, 33 artists, 21 matched)
- Johnnie & Co. (Mumbai, Charlie Puth)

**Restart these teams from their briefs**, using the team skills and `TEST_DB_NAME` per team (D-067):

1. **Engine:** D-065 duration-based playlist (show length; weights by tier and Last.fm popularity; every artist). Also: refuse terminal jobs; steps were 8–14s, so enforce the budget. Last state: "writing the build plan with show length and budgets".
2. **Matching:** D-066 multi-strategy resolver (name variants, context, Tavily web links, MusicBrainz band↔member). Run it on the 12 unmatched HOME artists. Last state: mid-implementation, fixing an edge case where a name with no letters produced a "DJ !!!" variant.
3. **Ingestion:** D-064 free doubt resolver (Tavily + GitHub Models gpt-5.5, quote-verified) plus lineup coverage. Last state: running final checks on its paths.
4. **QA final E2E:** repair `tests/qa/e2e` and cover SEARCH_FLOW A–D. Only this team runs Playwright.
5. **Not started yet** (briefs in this session; re-spawn them): Admin console (P3.5), Platform (container wiring, CI, schedules, alerts, DEPLOY.md, security headers), Data Integrity (P1.10 merges and audit script), Security review.

**Don't let the user press "Make playlist" on HOME until D-065 and D-066 land.** Its old job was cancelled.

**Keys in `.env`:** Spotify, Last.fm, setlist.fm, Tavily, GitHub Models, OpenAI (no credit), Gemini (unusable on the free tier), and `APP_CONTACT_EMAIL`. All keys pasted in chat must be rotated before deploy.

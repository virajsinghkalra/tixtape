# Code quality audit (D-086)

Run 2026-11-22 on the working tree, which includes other teams' in-progress changes.

## Tooling results

| Check                                                               | Result                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx jscpd src` (≥ 8 lines, 70 tokens, tests and fixtures excluded) | 4 clones, 46 lines (**0.1%**). At ≥ 5 lines: 17 clones (0.3%). Very low.                                                                                                                                                                                                               |
| ESLint layering (`no-restricted-imports`)                           | **Holds.** No domain → application/infrastructure, no application → infrastructure, no app → db/infrastructure. Relative imports checked too (the alias rules can't see them): none cross a layer.                                                                                     |
| Components layer                                                    | **There was no rule.** No violations today; **added** a rule (see Fixed).                                                                                                                                                                                                              |
| `npx knip` (dead code)                                              | 88 unused exports, 89 unused exported types. Almost all are tunables or types exported for tests and docs (`MAX_*`, `*_MS`, `*Deps`). The "unused files" are script entry points run by GitHub Actions and components other teams are adding now. **No safe deletions**; see the plan. |
| Cyclomatic complexity (ESLint `complexity` > 15)                    | 34 functions. Top items in the table below.                                                                                                                                                                                                                                            |

### Complexity hotspots (> 20)

| Complexity | Function                  | File                                              |
| ---------: | ------------------------- | ------------------------------------------------- |
|         57 | `collectEvents`           | `src/application/ingestion/collect-events.ts:138` |
|         48 | `verifyEvent`             | `src/domain/events/extract/verify.ts:259`         |
|         35 | `tourEditions`            | `src/domain/events/extract/wikitext.ts:257`       |
|         31 | `EventSearch`             | `src/components/search/EventSearch.tsx:59`        |
|         25 | `groundExtraction`        | `src/domain/events/extract/grounding.ts:58`       |
|         24 | `main`                    | `src/scripts/ingest.ts:199`                       |
|         24 | `tribeEventCandidate`     | `src/infrastructure/sources/sunburn.ts:80`        |
|         24 | `extractArticleCandidate` | `src/domain/events/extract/article.ts:444`        |
|         24 | `writeEvent`              | `src/application/events/write-event.ts:61`        |
|         23 | `autoPublishDecision`     | `src/domain/gigs/auto-publish.ts:278`             |
|         23 | `planSearch`              | `src/domain/events/search.ts:143`                 |
|         23 | `EventCard`               | `src/components/EventCard.tsx:44`                 |
|         23 | `discover`                | `src/application/gigs/discover-artist-gigs.ts:71` |
|         22 | `v6Blocked`               | `src/infrastructure/sources/ip-guard.ts:56`       |
|         20 | `resolveArtist`           | `src/application/matching/resolve-artist.ts:253`  |

## SOLID and DRY findings

1. **SRP / DIP: the composition root is one module for everything.**
   - Where: `src/server/container.ts:12-58`, the static imports.
   - Problem: every route, even a read-only one, loads ingestion sources, gig discovery and every Spotify, Tavily and Last.fm adapter. That's ~265 KB of cold-start parse (PERF_REPORT §5).
   - Fix: split it into slices (read: db, events, playlists; write and jobs: lookup, gigs, matching), each behind its own `src/server/*` helper.
2. **SRP: `collectEvents` has complexity 57** (`collect-events.ts:138`).
   - Problem: fetch, extract, verify, dedupe and persist are all in one function.
   - Fix: split it into per-stage functions with the existing ports. Owner: Events. Risky; it needs the ingest QA suite.
3. **DRY, duplicated knowledge: the "public and upcoming" rule (D-056).** It is written out separately in:
   - `event-search.ts` (`publicUpcoming`);
   - `event-feed.ts` (`e.visibility = 'published' and stillOn >= …`), in both `upcoming` and `due`;
   - `event-repository.ts` (list filter).

   Fix: one exported `publicUpcomingSql(alias, now, graceMs)` next to `eventEndSql` in `event-time.ts`. Owner: Events, once the feed edits land.

4. **DRY: D-083 alt-photo reads go through `to_jsonb(a) ->> 'alt_image_url'`** (`event-feed.ts`). Now that 0014 adds the columns, read them directly, as `event-repository.ts` already does. Owner: Matching/UI.
5. **DRY: repeated reads of the same data in one request** (PERF_REPORT §3.5):
   - The event page loads the event 3 times (`src/app/events/[id]/page.tsx` → `shared-builds.ts:86`, `playlists/index.ts:127`).
   - Estimate reads the songs cache twice (`playlists/index.ts:128` and `prewarm.ts:48`).

   Owners: Engine and UI.

6. **ISP: `EventsModule`** (`src/infrastructure/events-module.ts`) mixes read use cases with ingestion factories (`ticketmasterSource`, `collectorSources`, `collectorServices`). Read routes depend on an interface far wider than they use. Fix: separate `EventsReader` and `EventsIngestion` types; this pairs with finding 1.
7. **DRY in routes:** many routes repeat `type Ctx = { params: Promise<{ id: string }> }` plus `parseEventId((await ctx.params).id)`. Fix: a small `eventIdFrom(ctx)` helper in `src/server/http.ts`. Low value; do it when those routes are next touched.
8. **Minor clones:**
   - Last.fm and setlist.fm response handling: `lastfm.ts:97` ↔ `setlistfm.ts:131`, 9 lines.
   - A self-clone in `run-discovery.ts:133` ↔ `:261`, 13 lines.
   - `live-lookup.ts:27` ↔ `search/source.ts:21` (components), 9 lines.

   All are small, and each would need its owning team.

## Fixed now (behaviour identical, covered by tests)

| Change                                                                                                                                                                              | Tests                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| The Wikidata API URL and response schemas were duplicated in `sources/identity.ts` and `gigs/web-adapters.ts`. They're now in one module, `src/infrastructure/sources/wikidata.ts`. | `verification-clients.test.ts`, `web-adapters.test.ts`       |
| `PgEventRepository.findById` re-listed the 9 event fields that `fieldsOf` already maps; it now spreads `...fieldsOf(e)`.                                                            | `event-repository.int.test.ts`, `data-integrity.int.test.ts` |
| Added an ESLint layer rule: `src/components/**` may not import `@/infrastructure`, `@/db` or `@/server`. There were 0 violations.                                                   | `eslint src tests`                                           |
| `route()` was split into error mapping plus Server-Timing (one wrapper, one place).                                                                                                 | `tests/qa/*/routes*.test.ts` (210 tests)                     |

## Plan, ordered by value

1. Split the container (finding 1). This is the cold-start win; Platform.
2. Remove the repeated event and cache reads on the event page and in estimate (finding 5); Engine and UI.
3. Make suggest scoring cheaper: filter artists before scoring, store a phonetic key (PERF_REPORT §3.3); Events.
4. One public-and-upcoming SQL predicate (finding 3); Events.
5. Break up `collectEvents` and `verifyEvent` (finding 2); Events, with QA.
6. Prune knip's unused exports once each team confirms they're not used in tests.

---
name: add-event-source
description: Add a new automatic source of concerts and lineups to concert-playlist-app (an organiser website like Team Innovation or EVA Live, a festival site, a news outlet RSS feed, Wikipedia) as a SourceAdapter plugin at zero cost. Use when the user says 'add this site as a source', 'fetch events from Team Innovation', or 'read lineups from a news outlet'.
---

# Add an event source

## Constraints (D-008, D-024)

- **$0:** no paid AI or paid APIs. Use RSS, schema.org `Event`/`MusicEvent` JSON-LD, stable HTML selectors, or official APIs.
- **Allowed sources only:** trusted whitelist sources whose robots.txt allows the path. Never BookMyShow, District, Instagram or Facebook scraping. Respect rate limits (≤1 req/s per host) and send an identifying User-Agent without personal details.
- **Facts only:** store event facts plus the source URL. Don't republish article text.

## Steps

1. **Check the source.** Fetch robots.txt and one sample page. Note: feed URL, JSON-LD present?, how lineups appear.
2. **Write the adapter.** Create `src/infrastructure/sources/<source>.ts` implementing `SourceAdapter` from `src/application/ports/event-source.ts`:
   - `source` is a new value (adding it to the `event_source` enum is a schema change: use `change-db-schema`).
   - `fetch(opts)` yields `RawEvent`s validated by `RawEventSchema` (`src/domain/events/raw-event.ts`).
   - Inject `fetch`, `sleep`, `clock` and `logger`. Skip malformed items with a warning; never fail the whole run.
3. **Extract the full billed lineup (D-091).** Capture every act the source bills, not just the headliners, in billing order with tiers:
   - Tiers from the source's own billing (poster line or font size, "headlined by", "also featuring"); otherwise headliners first, then the rest as `mid` in announced order.
   - Record how many acts the source announces, so a short stored bill is flagged `lineup_incomplete` (a festival with fewer than 8 acts is flagged too).
   - Keep names exactly as billed. Never split a known act on x / ft / & / and / with / vs / + ("TOMORROW X TOGETHER", "Simon & Garfunkel", "Florence + The Machine"): use `splitLineupCredit` from `src/domain/events/credits.ts`, and add new compound acts to `KNOWN_COMPOUND_ACTS`. A duo credited together ("Khan & Noor") stays one row for Matching's review (D-066).
   - For free-text lineups, pull candidate names (lines under "lineup", comma-separated lists) and keep only names that resolve on Spotify artist search (the free validator). Mark confidence.
4. **Set trust:** official organiser or festival = `official`, whitelisted outlet = `trusted`. An event auto-publishes only when two sources agree, or one official plus one trusted (D-024).
   - **Pictures (D-091):** nothing is published without a poster or a headliner photo. Capture the official page's poster (og:image) where the source has one. An otherwise-ready event without a picture stays held as `no_image` and is retried daily; publish only through `publishIfVisual` (`src/application/events/publish-visual.ts`), never by setting `visibility` directly.
5. **Register it:** add a factory in `src/infrastructure/events-module.ts` and a schedule in `.github/workflows/`. The ingest pipeline itself doesn't change (open/closed).
6. **Test it:** fixtures saved under `src/infrastructure/sources/__fixtures__/<source>/` (trimmed real pages), msw handlers, and tests for paging, malformed items, robots or ToS stop conditions, and idempotent re-ingest.

## Common mistakes

- Parsing with brittle positional selectors. Prefer JSON-LD, then semantic markup.
- Creating artists for every capitalised phrase. Validate against Spotify first.
- Storing only the headliners of a festival. Store the whole bill with tiers (D-091).
- Splitting a band name on "x" or "&". Use `splitLineupCredit`, never a hand-rolled split.

## Ground rules (every module)

- Read `ENGINEERING.md`, `docs/DECISIONS.md` and `docs/TEAMS.md` before writing code. Decisions there override the LLD.
- Layers: `domain` (pure) → `application` (use cases + ports) → `infrastructure` (IO). Routes and pages go through `src/server/*`. ESLint enforces this, so never silence it.
- No duplicate data (ENGINEERING.md §10): natural key + unique constraint + upsert; merge duplicates; never copy facts across tables.
- Validate every boundary with Zod; request schemas use `z.strictObject` (D-018). Expected failures return `Result`; unexpected ones throw `AppError` subclasses.
- Unit tests are colocated `*.test.ts`; DB tests are `*.int.test.ts` using `tests/setup/db.ts` (Postgres via `npm run db:up`, port 54329). Inject `Clock`, `Random` and `sleep`; no real network, no real sleeps.
- Shared files (`package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint/TS config, `docs/DECISIONS.md`) are changed only by the Lead (D-014). Propose changes in your hand-back.
- Never run state-changing git commands unless the user asks. Only ever use the personal GitHub account for this repo.
- Done = `npm run lint`, `npm run typecheck`, `npx prettier --check src` and `npx vitest run <paths>` all pass, then independent QA signs off (`run-qa-signoff`).

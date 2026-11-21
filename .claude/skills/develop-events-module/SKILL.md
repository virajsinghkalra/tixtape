---
name: develop-events-module
description: Conventions for the events and ingestion module of concert-playlist-app: venue/city normalization, event dedupe, lineups, the Ticketmaster adapter, the ingest use case and event APIs. Use when changing how events are stored, merged, listed or searched, editing lineup or tier logic, or touching /api/events routes.
---

# Events & Ingestion module

## Where things live

| Concern                                          | Path                                                                        |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| Venue/city normalization, similarity             | `src/domain/events/venue.ts`, `similarity.ts`, `text.ts`                    |
| Dedupe and merge rules                           | `src/domain/events/dedupe.ts`                                               |
| Lineup building and hash                         | `src/domain/events/lineup.ts`                                               |
| Raw event schema                                 | `src/domain/events/raw-event.ts`                                            |
| Use cases (ingest, admin save, read/list)        | `src/application/events/`                                                   |
| Ports                                            | `src/application/ports/{event-source,events,venues,ingest-runs,artists}.ts` |
| Repositories (incl. shared `PgArtistRepository`) | `src/infrastructure/db/`                                                    |
| Ticketmaster adapter                             | `src/infrastructure/sources/ticketmaster.ts`                                |
| Module factory                                   | `src/infrastructure/events-module.ts` → `src/server/events.ts`              |
| Routes                                           | `src/app/api/events/`, `src/app/api/admin/events/`                          |

## Rules that must hold (D-008, D-024, D-026, D-027, D-029)

- Artist names go through `normalizeArtistName` and `splitArtistCredit` from `src/domain/shared/normalize.ts` (owned by Matching). Never write another normalizer.
- Dedupe: block on country + city + date ±1 day. Score 0.4 venue + 0.3 title (Dice) + 0.3 artists. ≥0.85 merge, 0.6–0.85 review, else new.
- Source precedence: admin > jambase > ticketmaster > user_submission. Admin fields are never overwritten automatically (D-026).
- Every write is an upsert on a natural key. Re-ingesting the same feed must change nothing.
- List endpoints are paginated (pageSize ≤ 100). Public detail never exposes `event_sources.raw`.
- To add a new source, use the `add-event-source` skill instead of editing the pipeline.

## Ground rules (every module)

- Read `ENGINEERING.md`, `docs/DECISIONS.md` and `docs/TEAMS.md` before writing code. Decisions there override the LLD.
- Layers: `domain` (pure) → `application` (use cases + ports) → `infrastructure` (IO). Routes and pages go through `src/server/*`. ESLint enforces this, so never silence it.
- No duplicate data (ENGINEERING.md §10): natural key + unique constraint + upsert; merge duplicates; never copy facts across tables.
- Validate every boundary with Zod; request schemas use `z.strictObject` (D-018). Expected failures return `Result`; unexpected ones throw `AppError` subclasses.
- Unit tests are colocated `*.test.ts`; DB tests are `*.int.test.ts` using `tests/setup/db.ts` (Postgres via `npm run db:up`, port 54329). Inject `Clock`, `Random` and `sleep`; no real network, no real sleeps.
- Shared files (`package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint/TS config, `docs/DECISIONS.md`) are changed only by the Lead (D-014). Propose changes in your hand-back.
- Never run state-changing git commands unless the user asks. Only ever use the personal GitHub account for this repo.
- Done = `npm run lint`, `npm run typecheck`, `npx prettier --check src` and `npx vitest run <paths>` all pass, then independent QA signs off (`run-qa-signoff`).

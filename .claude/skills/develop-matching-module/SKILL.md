---
name: develop-matching-module
description: Conventions for artist matching in concert-playlist-app: name normalization, credit splitting, Spotify candidate scoring, auto-accept vs review decisions, the resolve batch and the admin review queue. Use when a lineup artist matches the wrong Spotify artist, tuning match thresholds, editing normalize.ts, or changing /api/admin/artists.
---

# Artist Matching module

## Where things live

| Concern                                                                                          | Path                             |
| ------------------------------------------------------------------------------------------------ | -------------------------------- |
| `normalizeArtistName`, `splitArtistCredit` (shared, D-013)                                       | `src/domain/shared/normalize.ts` |
| Scoring and decision (`scoreCandidate`, `rankCandidates`, `decideMatch`, `DEFAULT_MATCH_POLICY`) | `src/domain/matching/`           |
| Resolve, batch and review use cases (`createMatchingModule`)                                     | `src/application/matching/`      |
| Admin routes                                                                                     | `src/app/api/admin/artists/`     |

## Rules that must hold (LLD §6, D-009, D-015, D-025, D-026)

- Score: exact +50, diacritics-only +30, DJ-removed +25, rank `15 − 1.5 × rank` (≥0), image +10, genre overlap +10 (only when both sides have genres), external ID +20.
- Auto-accept only if top ≥ 70 and the lead over the runner-up is ≥ 15. Names ≤3 characters and ambiguous words always go to review.
- `needs_review` rows keep `spotify_id = null` (the column is unique). Alias hits count only for `auto`/`manual` owners.
- `manual` matches are never overwritten by re-checks (D-026).
- Anything with `resumeAfter` (a `SpotifyBlockedError`) stops a batch cleanly. Other errors fail one artist only.
- `splitArtistCredit`: split on b2b, vs, feat/ft, and a standalone x/× with names on both sides. Never split on & or "and". "Lil Nas X x Jack Harlow" gives `["Lil Nas X", "Jack Harlow"]`.

## Tuning

Change thresholds only in `DEFAULT_MATCH_POLICY`, and add a table-driven test case for the real lineup name that motivated the change.

## Ground rules (every module)

- Read `ENGINEERING.md`, `docs/DECISIONS.md` and `docs/TEAMS.md` before writing code. Decisions there override the LLD.
- Layers: `domain` (pure) → `application` (use cases + ports) → `infrastructure` (IO). Routes and pages go through `src/server/*`. ESLint enforces this, so never silence it.
- No duplicate data (ENGINEERING.md §10): natural key + unique constraint + upsert; merge duplicates; never copy facts across tables.
- Validate every boundary with Zod; request schemas use `z.strictObject` (D-018). Expected failures return `Result`; unexpected ones throw `AppError` subclasses.
- Unit tests are colocated `*.test.ts`; DB tests are `*.int.test.ts` using `tests/setup/db.ts` (Postgres via `npm run db:up`, port 54329). Inject `Clock`, `Random` and `sleep`; no real network, no real sleeps.
- Shared files (`package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint/TS config, `docs/DECISIONS.md`) are changed only by the Lead (D-014). Propose changes in your hand-back.
- Never run state-changing git commands unless the user asks. Only ever use the personal GitHub account for this repo.
- Done = `npm run lint`, `npm run typecheck`, `npx prettier --check src` and `npx vitest run <paths>` all pass, then independent QA signs off (`run-qa-signoff`).

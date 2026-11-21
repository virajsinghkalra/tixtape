# Engineering guidelines

These rules apply to every team and every agent. They exist so the MVP can grow into a full product without a rewrite. If a rule gets in the way, propose a change in `docs/DECISIONS.md` instead of quietly breaking it.

Sources these rules draw on:

- SOLID and Clean Architecture (Robert C. Martin)
- Hexagonal / Ports & Adapters (Alistair Cockburn)
- The Twelve-Factor App (12factor.net)
- Google Engineering Practices (google.github.io/eng-practices)
- The Testing Trophy (Kent C. Dodds)
- OWASP ASVS
- Conventional Commits (conventionalcommits.org)

---

## 1. Principles

| Principle                 | What it means here                                                                                                                                  |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S**ingle responsibility | One module, one reason to change. `SpotifyRateGate` paces calls; it does not parse tracks.                                                          |
| **O**pen/closed           | Add behaviour by adding code. A new event source is a new `SourceAdapter`, not an `if (source === …)` in the pipeline.                              |
| **L**iskov substitution   | Any implementation of a port must honour its contract, including its errors. A fake must behave like the real thing.                                |
| **I**nterface segregation | Small ports. `ArtistSearch` and `PlaylistWriter` are separate interfaces, even though one Spotify client implements both.                           |
| **D**ependency inversion  | Domain and application code depend on interfaces they own. Infrastructure implements them. Wiring happens in one place (`src/server/container.ts`). |
| YAGNI / KISS              | Build what the LLD and the tracker call for. No speculative abstractions, flags or config.                                                          |
| DRY, carefully            | Remove duplicated _knowledge_. Two similar-looking lines that change for different reasons are not duplication.                                     |
| Twelve-Factor             | Config only from env (validated at boot), stateless web processes, logs to stdout, the same build in every environment.                             |

## 2. Architecture and layers

```
src/
├─ domain/          Pure business rules. No IO, no framework, no clock/random calls (inject them).
│                   e.g. name normalization, match scoring, dedupe scoring, track selection.
├─ application/     Use cases. Orchestrates domain logic through ports (interfaces).
│  └─ ports/        Interfaces the application needs: repositories, Spotify, event sources, clock.
├─ infrastructure/  Adapters that implement ports: Postgres repositories, Spotify HTTP client,
│                   Ticketmaster client, crypto. All IO lives here.
├─ db/              Drizzle schema, client and migrations (used only by infrastructure).
├─ server/          Composition root (container.ts) and request helpers (auth/session) for Next.js.
├─ app/             Next.js routes and pages. Thin: validate input, call a use case, map the result.
├─ components/      React UI components.
├─ lib/             Cross-cutting helpers with no business meaning: env, logger, errors, Result.
└─ scripts/         Entry points for scheduled jobs (GitHub Actions). Same container as the web app.
```

**Dependency rule:** arrows point inward only. `app → server → application → domain`; `infrastructure → application/ports + domain`. ESLint (`no-restricted-imports`) enforces this, so a violation fails CI.

## 3. TypeScript

- `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride` are on. Don't weaken them.
- No `any`. Use `unknown` at boundaries, then validate with Zod.
- **Validate at every boundary:** HTTP request bodies, env vars, third-party API responses, DB JSON columns. Inside the boundary, trust the types.
- Prefer `type` aliases and plain objects for data, and classes only for stateful adapters.
- Named exports only (Next.js page/route files are the exception).
- Brand IDs that are easy to mix up: `SpotifyArtistId`, `EventId`, `UserId` (see `src/domain/shared/ids.ts`).
- Use `import type` for type-only imports (lint-enforced).

## 4. Errors

- **Expected failures are values:** return `Result<T, E>` (`src/lib/result.ts`), e.g. "artist not found" or "match needs review".
- **Unexpected failures throw** typed errors extending `AppError` (`src/lib/errors.ts`), each with a stable `code`.
- Never swallow an error. Either handle it meaningfully or let it reach the boundary, which logs it and maps it to an HTTP response.
- User-facing messages say what happened and what to do next. Internal details go to logs, never to responses.

## 5. Naming and style

- Files `kebab-case.ts`, React components `PascalCase.tsx`, tests next to the code as `*.test.ts`. Integration tests are named `*.int.test.ts`.
- Name things after the domain: `lineup`, `billingTier`, `headliner`, `resolveArtist`. Avoid `data`, `info`, `manager`, `helper`, `utils`.
- Functions do one thing. Keep them under ~40 lines; split them when they need a comment to explain the parts.
- Comments explain **why**, not what. Link the LLD section or decision ID when a rule comes from there (e.g. `// D-007`).
- Prettier formats, ESLint lints. Don't argue style in review.

## 6. Data and the database

- Schema changes go only through Drizzle migrations (`npm run db:generate`). Never edit an applied migration.
- Make every write idempotent where a retry is possible: upsert on natural keys, and use idempotency keys for jobs.
- Repositories return domain types, not Drizzle rows.
- Keep time in UTC (`timestamptz`). Convert to the user's time zone only in the UI.

## 7. Security

- Secrets come only from env and never appear in code, logs or error messages. `.env*` is git-ignored except `.env.example`.
- Spotify tokens are encrypted at rest (AES-256-GCM) and never sent to the browser.
- Use parameterized queries only (Drizzle does this; no string-built SQL).
- Session cookies are httpOnly, Secure and SameSite=Lax. The OAuth flow uses `state` and PKCE.
- Treat all third-party data as untrusted: validate it, and never render raw HTML from it.
- Give each process least privilege: scheduled jobs get only the secrets they need.

## 8. Testing

Two independent kinds of testing (see `docs/TEAMS.md`):

1. **Dev tests:** written by the team building the code. Unit tests for domain logic, and adapter tests with fakes. They prove the happy path and obvious edges.
2. **QA tests:** written by the QA team, who haven't seen how the code was built. They test against the LLD and the public interface, focusing on edge cases, failure modes, concurrency, malicious input and contract violations. They live in `tests/qa/<pointer>/`.

General rules:

- Domain logic gets unit tests with table-driven cases. No mocks are needed because it's pure.
- Infrastructure is tested against real Postgres (Docker) and `msw` fakes for HTTP. Never call real third-party APIs in CI.
- Test behaviour through public interfaces, not private internals.
- Tests are deterministic: inject `Clock` and `Random`, and use no sleeps.
- A pointer is **done** only when `npm run check` is green and QA has signed off.

## 9. Workflow

- One pointer is one focused change. Name branches `p1.1-spotify-rate-gate`.
- Commits follow Conventional Commits: `feat(spotify): add shared rate gate`.
- Run `npm run check` (lint, typecheck, tests) before handing work back.
- Any decision that affects another team goes in `docs/DECISIONS.md` **before** the code that depends on it.
- Update the LLD if a decision changes it.

## 10. Data integrity: no duplicate data

Every real-world thing exists **once** in the database. Each layer of defence below backs up the one before it:

1. **Natural keys with unique constraints in Postgres, the final guard.** The database rejects duplicates even if code has a bug.
   - Venue: `(normalized_name, city)`; venue alias: globally unique.
   - Event: `dedupe_key`.
   - Event source: `(source, external_id)`; lineup entry: `(event_id, artist_id)`.
   - Artist: `spotify_id`; artist alias: `alias_normalized`.
   - User: `spotify_user_id`; playlist: `(user_id, event_id, options_hash)`; job: `(user_id, idempotency_key)`.
2. **Upserts, never blind inserts.** Every write path that can run twice (ingest, resolve, retries, double-clicks) uses `INSERT … ON CONFLICT` on the natural key.
3. **Normalize before comparing.** Names, venues and cities go through the shared normalizers in `src/domain/shared/normalize.ts` and `src/domain/events/venue.ts`. Never write a second normalizer.
4. **Merge, don't fork.** When two rows turn out to be the same thing (two artist rows for one Spotify artist, two events for one show), merge them into the canonical row in one transaction (`mergeInto`) instead of leaving a second copy. Unsure cases go to a review table, not into a new row.
5. **One source of truth per fact.** Store a fact once and reference it by ID. Don't copy artist names into lineup rows, or event titles into playlists; join instead. Caches (`artist_track_cache`) are clearly marked and have a TTL.
6. **Provenance, not copies.** Each source's raw payload goes into `event_sources.raw` once per `(source, external_id)`, so merges can be audited without duplicating events.

## 11. Scalability and extensibility

- **New sources are plugins.** Implement `SourceAdapter` and register it in the container. The ingest pipeline never changes (open/closed).
- **New music services are ports.** Spotify sits behind `ArtistCatalog`, `TrackCatalog` and `PlaylistWriter`, so Apple Music or YouTube Music would be new adapters, not a rewrite.
- **Stateless web, state in Postgres.** Any number of web instances or job runners can run. Coordination uses row leases and `GREATEST()` updates, not in-memory locks.
- **Bounded work.** Every list endpoint is paginated (max page size 100), every job step has a time budget, and every query that can grow has an index.
- **Swap infrastructure via the container.** Moving from GitHub Actions to a real queue, or from Neon to another Postgres host, touches only infrastructure adapters and `src/server/container.ts`.

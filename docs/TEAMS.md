# Teams and workflow

Every team is one or more Claude subagents. The **Lead** (the main Claude session) plans, assigns pointers, resolves conflicts between teams, keeps `docs/DECISIONS.md` and the tracker up to date, and merges work.

## Teams

| Team                    | Agents         | Owns                                                           | Pointers                |
| ----------------------- | -------------- | -------------------------------------------------------------- | ----------------------- |
| **Platform** (Lead)     | 1              | Foundation, composition root, CI, schedules, deployment        | P0.x, P4.1–P4.3, P4.5   |
| **Spotify Integration** | 1–2            | `infrastructure/spotify/*`, Spotify ports, token store         | P1.1–P1.3               |
| **Events & Ingestion**  | 1–2            | `domain/events/*`, `infrastructure/sources/*`, event use cases | P1.4–P1.7               |
| **Artist Matching**     | 1              | `domain/matching/*`, resolve use case, review queue            | P1.8–P1.9               |
| **Playlist Engine**     | 1–2            | `domain/playlists/*`, job runner, playlist writer, job API     | P2.1–P2.4               |
| **Web UI**              | 1–2            | `app/*` pages, `components/*`                                  | P3.1–P3.5               |
| **QA**                  | 1 per dev team | `tests/qa/**` only                                             | Signs off every pointer |

## Rules between teams

1. **Ports are contracts.** A team that needs something from another team codes against an interface in `src/application/ports/`. If the interface doesn't exist yet, the needing team proposes it in `DECISIONS.md`, and the owning team implements it.
2. **Stay in your folders.** Edit only the folders your team owns. Shared files (`src/db/schema.ts`, `src/server/container.ts`, `package.json`) are changed by the Lead, or by a team with the change recorded in `DECISIONS.md`.
3. **Decisions first.** Anything another team must know (a new port, a schema change, a changed behaviour) goes in `DECISIONS.md` before the code.

## Pointer lifecycle

```
To do → Building (dev team) → Testing (QA team) → Done ✓
                    ↑                   │
                    └── QA finds bugs ──┘
```

1. **Building:** the dev team implements the pointer and its dev tests. `npm run check` must pass. It hands back a short note: what was built, the public interface, and any known limits.
2. **Testing:** a QA agent gets **only**:
   - the LLD section,
   - `DECISIONS.md`,
   - the public interface (exported types and function signatures).

   It does not see the dev team's notes on how the code works. It writes adversarial tests in `tests/qa/<pointer>/`: boundaries, invalid input, failure injection, concurrency, idempotency, and security abuse cases.

3. If QA tests fail, the bug report goes back to the dev team. QA must not fix product code itself.
4. **Done:** all dev and QA tests are green. The Lead ticks the pointer in the tracker and records the test counts.

## Waiting on the user

Some pointers need the user's accounts. Those show as **Waiting on you** in the tracker, with exactly what is needed. Secrets go into a local `.env` file (git-ignored) that the user edits. Never paste them into chat.

## QA levels (D-031)

| Level           | What QA checks                                                                                                  | Where                              |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Unit / contract | Each function and module against the LLD, using adversarial inputs                                              | `tests/qa/<pointer>/*.test.ts`     |
| Integration     | Real Postgres, real HTTP handlers, fake third-party servers                                                     | `tests/qa/<pointer>/*.int.test.ts` |
| **End-to-end**  | A real browser (desktop and phone) using the running app like a user: search, open event, log in, make playlist | `tests/e2e/*.spec.ts` (Playwright) |
| **Exploratory** | A QA agent browses the app, takes screenshots, and reports confusing, broken or slow things                     | Written report                     |

User-facing pointers (Phase 2 onward) need all four levels before they're ticked.

## Parallel teams: isolation rules (D-067)
- **Integration tests:** each team uses its own database, `TEST_DB_NAME=concert_test_<team>` (e.g. `concert_test_admin`). The default `concert_test` is for the Lead only.
- **Browser tests:** one Playwright suite at a time on this machine. QA owns `:3100`. Teams use `npx vitest` for their own work and ask the Lead before running Playwright.
- **Files:** each team edits only its own folders. Shared files go through the Lead, or through the team that the decision log names as owner.

---
name: develop-spotify-module
description: Conventions for changing the Spotify integration in concert-playlist-app: the rate-limited HTTP client, OAuth login, encrypted token store and catalog/playlist calls. Use when adding or fixing a Spotify API call, changing scopes, handling 429/Retry-After, token refresh, or adding endpoints like top artists or followed artists.
---

# Spotify module

## Where things live

| Concern                                                           | Path                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------- |
| Ports + errors (`SpotifyBlockedError`, `ReauthRequiredError`)     | `src/application/ports/spotify.ts`                          |
| Auth ports + service                                              | `src/application/auth/`                                     |
| HTTP client, rate gate, catalog, playlist writer                  | `src/infrastructure/spotify/` (`createSpotifyModule(deps)`) |
| Token cipher (AES-256-GCM, AAD `spotify_tokens:<userId>:<field>`) | `src/infrastructure/crypto/`                                |
| Gate, token, user and session repositories                        | `src/infrastructure/db/`                                    |
| Guards and cookies                                                | `src/server/auth/`                                          |
| Login, callback and logout routes                                 | `src/app/api/auth/`                                         |

## Rules that must hold (D-006, D-007, D-019–D-023, D-030)

- Every call goes through `SpotifyHttp.request({method, path, query?, body?, auth, schema})`, the only path to `api.spotify.com`. Responses are Zod-validated.
- New apps can't use: top-tracks, batch gets, `popularity`, `followers`. Use `POST /me/playlists` and `/playlists/{id}/items` (≤100). Search `limit ≤ 10`. Track calls pass `market`.
- Retry-After above 120s or `QUOTA_EXCEEDED` sets the shared gate (`GREATEST`) and throws `SpotifyBlockedError`. During a pause, never call Spotify.
- Ids are validated as base62 before building paths. Tokens never reach logs or responses.
- Scopes live in one constant: `playlist-modify-private playlist-modify-public user-top-read user-follow-read` (D-030).

## Adding an endpoint

1. Add a method to the right port (`ArtistCatalog`, `TrackCatalog`, `PlaylistWriter`, or a new small interface; keep interfaces segregated).
2. Implement it in `src/infrastructure/spotify/` with a Zod schema for the response, mapping to port types.
3. Write unit tests with msw: happy path, malformed JSON, 429 short and long, 401 → refresh once, 5xx.
4. Expose it through `createSpotifyModule`.

## Ground rules (every module)

- Read `ENGINEERING.md`, `docs/DECISIONS.md` and `docs/TEAMS.md` before writing code. Decisions there override the LLD.
- Layers: `domain` (pure) → `application` (use cases + ports) → `infrastructure` (IO). Routes and pages go through `src/server/*`. ESLint enforces this, so never silence it.
- No duplicate data (ENGINEERING.md §10): natural key + unique constraint + upsert; merge duplicates; never copy facts across tables.
- Validate every boundary with Zod; request schemas use `z.strictObject` (D-018). Expected failures return `Result`; unexpected ones throw `AppError` subclasses.
- Unit tests are colocated `*.test.ts`; DB tests are `*.int.test.ts` using `tests/setup/db.ts` (Postgres via `npm run db:up`, port 54329). Inject `Clock`, `Random` and `sleep`; no real network, no real sleeps.
- Shared files (`package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint/TS config, `docs/DECISIONS.md`) are changed only by the Lead (D-014). Propose changes in your hand-back.
- Never run state-changing git commands unless the user asks. Only ever use the personal GitHub account for this repo.
- Done = `npm run lint`, `npm run typecheck`, `npx prettier --check src` and `npx vitest run <paths>` all pass, then independent QA signs off (`run-qa-signoff`).

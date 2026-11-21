---
name: develop-playlist-engine
description: Conventions for the playlist engine in concert-playlist-app: track selection per billing tier, the step-based job runner with leases and checkpoints, idempotent Spotify playlist writes and the playlist-jobs API. Use when building or fixing playlist generation, job progress, pause/resume on Spotify blocks, or POST /api/playlist-jobs.
---

# Playlist Engine module (Phase 2)

## Target layout

| Concern                                                                             | Path                         |
| ----------------------------------------------------------------------------------- | ---------------------------- |
| Track selection (tier quotas, artist-id filter, dedupe by id → ISRC → title+artist) | `src/domain/playlists/`      |
| Job runner (claim, step, checkpoint, pause) and use cases                           | `src/application/playlists/` |
| Job and playlist repositories                                                       | `src/infrastructure/db/`     |
| Routes: create (`Idempotency-Key`), step, status                                    | `src/app/api/playlist-jobs/` |

## Rules that must hold (LLD §7, D-005, D-006, D-020)

- **No long-running work.** `POST /api/playlist-jobs/:id/step` does ≤ ~8s of work. The claim is `UPDATE … SET locked_until = now()+15s WHERE id=$1 AND (locked_until IS NULL OR locked_until < now())`. No row back means another step is running; return progress.
- **Checkpoint after every unit of work:** `{selectedTrackIds, playlistId, chunksDone}`. A resume never repeats work.
- **Save the Spotify playlist id right after `createPlaylist`, before adding items.** Add tracks in chunks of 100. "Update existing" uses `replaceItems` for the first chunk.
- **On `SpotifyBlockedError`:**
  - `gate_paused` with a short pause → return progress and let the next step retry.
  - A long pause or quota → status `paused` with `resume_after`.
  - `ReauthRequiredError` → `failed` with a reconnect message.
- **Default tiers:** headliner 10, sub 5, mid 3, support 2 tracks. Hits mode: track search `artist:"name"`, keep tracks containing the resolved artist id, and fall back to the newest albums.
- **Playlist ids are deduped on** `(user_id, event_id, options_hash)`, and jobs on `(user_id, idempotency_key)`. Limit: 5 jobs per user per hour.
- **Configure Spotify backoff** to fit the step budget.

## Tests

- Domain selection: table-driven.
- Runner: a fake clock plus fake Spotify ports. Kill mid-chunk, then resume. Run two concurrent steps and assert no duplicate playlist or tracks.
- E2E (D-031): generate a playlist through the UI against a stub Spotify server.

## Ground rules (every module)

- Read `ENGINEERING.md`, `docs/DECISIONS.md` and `docs/TEAMS.md` before writing code. Decisions there override the LLD.
- Layers: `domain` (pure) → `application` (use cases + ports) → `infrastructure` (IO). Routes and pages go through `src/server/*`. ESLint enforces this, so never silence it.
- No duplicate data (ENGINEERING.md §10): natural key + unique constraint + upsert; merge duplicates; never copy facts across tables.
- Validate every boundary with Zod; request schemas use `z.strictObject` (D-018). Expected failures return `Result`; unexpected ones throw `AppError` subclasses.
- Unit tests are colocated `*.test.ts`; DB tests are `*.int.test.ts` using `tests/setup/db.ts` (Postgres via `npm run db:up`, port 54329). Inject `Clock`, `Random` and `sleep`; no real network, no real sleeps.
- Shared files (`package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint/TS config, `docs/DECISIONS.md`) are changed only by the Lead (D-014). Propose changes in your hand-back.
- Never run state-changing git commands unless the user asks. Only ever use the personal GitHub account for this repo.
- Done = `npm run lint`, `npm run typecheck`, `npx prettier --check src` and `npx vitest run <paths>` all pass, then independent QA signs off (`run-qa-signoff`).

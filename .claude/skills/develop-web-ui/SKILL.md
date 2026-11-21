---
name: develop-web-ui
description: Conventions for the Next.js web UI of concert-playlist-app: pages, components, type-ahead event search, event/lineup page, generate-playlist panel, Concerts for you, home feed and admin screens. Use when building or changing any page or component, or fixing layout, mobile or accessibility issues.
---

# Web UI module (Phase 3)

## Where things live

- Pages and route handlers: `src/app/`. Components: `src/components/` (PascalCase `.tsx`). Tailwind v4.
- Pages and server components get data **only** via `src/server/*` (`events()`, `container()`, guards). They never import `@/infrastructure` or `@/db` (lint enforced).
- `src/app/page.tsx` and `src/app/events/[id]/page.tsx` are a **temporary developer preview**. Replace them in P3.2/P3.6/P3.8.

## Product rules

- Users never type artists. They search events (type-ahead from 2 characters, debounced ~200ms, keyboard navigable), pick one, and see the lineup by tier (poster style).
- Home: Concerts for you (D-030), Upcoming near you, Just announced. Each event has a "Buy tickets" link out to the official page (BookMyShow/District/organiser). No scraping.
- Generate panel: options → start job → call `/step` every 1.5s → show stage/progress → paused (with time) / failed (with fix) / done (open in Spotify).
- Spotify attribution and links wherever tracks or artists show (Policy II.4). The app name must not start with "Spot".
- Show times in IST (`Asia/Kolkata`). Store UTC.

## Quality bar

- Works at 360px wide, keyboard accessible, visible focus, `prefers-reduced-motion` respected, dark mode.
- Errors say what happened and what to do. No raw JSON shown to users (e.g. the OAuth callback should redirect with a message).
- Every user-facing pointer needs a Playwright E2E spec in `tests/e2e/` (desktop + phone projects) before it's ticked (D-031).

## Ground rules (every module)

- Read `ENGINEERING.md`, `docs/DECISIONS.md` and `docs/TEAMS.md` before writing code. Decisions there override the LLD.
- Layers: `domain` (pure) → `application` (use cases + ports) → `infrastructure` (IO). Routes and pages go through `src/server/*`. ESLint enforces this, so never silence it.
- No duplicate data (ENGINEERING.md §10): natural key + unique constraint + upsert; merge duplicates; never copy facts across tables.
- Validate every boundary with Zod; request schemas use `z.strictObject` (D-018). Expected failures return `Result`; unexpected ones throw `AppError` subclasses.
- Unit tests are colocated `*.test.ts`; DB tests are `*.int.test.ts` using `tests/setup/db.ts` (Postgres via `npm run db:up`, port 54329). Inject `Clock`, `Random` and `sleep`; no real network, no real sleeps.
- Shared files (`package.json`, `src/db/schema.ts`, `src/server/container.ts`, lint/TS config, `docs/DECISIONS.md`) are changed only by the Lead (D-014). Propose changes in your hand-back.
- Never run state-changing git commands unless the user asks. Only ever use the personal GitHub account for this repo.
- Done = `npm run lint`, `npm run typecheck`, `npx prettier --check src` and `npx vitest run <paths>` all pass, then independent QA signs off (`run-qa-signoff`).

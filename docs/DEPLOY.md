# Deploying Lineup Mixes (Vercel Hobby sin1 + Neon Singapore + GitHub Actions)

Everything here is on free tiers (D-002, D-076). Nothing is deployed yet: follow this once the first real playlist works locally (RESUME step 9). The project is personal and non-commercial, which Vercel Hobby requires; ads, affiliate links or paid features would mean revisiting D-076.

```
Browser ──> Vercel functions (sin1) ──┐
                                      ├──> Neon Postgres, Singapore (pooled URL)
GitHub Actions (ingest 3 h, sweep 1 h,┘
  gigs daily, weekly, keepalive monthly)
        └──> alerts: Gmail SMTP → lineupmixes@gmail.com (or job summary + failed-run email)
```

## Sign-up order (owner)

Do these in order; each step names the section with the details.

1. **Neon:** sign up and create the Singapore project (§1). Copy both connection strings into a password manager.
2. **Vercel:** sign up with the personal GitHub account **virajsinghkalra** (never the work account) and import the repo, but don't add env vars yet (§3, steps 1–2).
3. **Gmail app password:** in the lineupmixes@gmail.com Google account, turn on 2-Step Verification and create an app password (§7).
4. **Rotate keys:** rotate every key that was pasted in chat and generate the production-only secrets (§0).
5. **Env vars:** set the Vercel environment variables (§3, step 3) and the GitHub secrets and variables (§5). Then run the migrations (§2), deploy, add the Spotify redirect URI (§4) and connect the publisher (§6).

## 0. Rotate every key that was pasted in chat

These were pasted into chat sessions, so treat them as leaked. Create new ones, put the new values only in `.env` (local), Vercel and GitHub secrets, then revoke the old ones.

| Key                     | Where to rotate                                                                                                             |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SPOTIFY_CLIENT_SECRET` | developer.spotify.com → your app → Settings → **Rotate client secret**                                                      |
| `OPENAI_API_KEY`        | platform.openai.com → API keys → revoke and create                                                                          |
| `GEMINI_API_KEY`        | aistudio.google.com → API keys → delete and create                                                                          |
| `TAVILY_API_KEY`        | app.tavily.com → API keys                                                                                                   |
| `GITHUB_MODELS_TOKEN`   | github.com → Settings → Developer settings → fine-grained tokens → revoke, then create a new one with **Models: read** only |
| `SETLISTFM_API_KEY`     | setlist.fm → Settings → API → request a new key, delete the old                                                             |
| `LASTFM_API_KEY`        | last.fm/api/accounts → create a new API account, delete the old one                                                         |

Also generate fresh production-only secrets (never reuse local ones):

```sh
openssl rand -base64 32   # TOKEN_ENC_KEY
openssl rand -base64 48   # SESSION_SECRET (also keys the rate-limit HMAC, D-070)
```

Rotating `TOKEN_ENC_KEY` later: bump `TOKEN_ENC_KEY_VERSION`; stored tokens with the old version can no longer be read, so the publisher must reconnect (§6).

## 1. Neon (database)

1. Sign up at neon.tech with the personal GitHub account. Create a project in **AWS ap-southeast-1 (Singapore)**, the nearest Neon region to India (D-076), Postgres 16, database `concert`.
2. Copy **two** connection strings from _Connection details_:
   - **Pooled** (host contains `-pooler`, e.g. `ep-xxx-pooler.ap-southeast-1.aws.neon.tech`): the app and the scheduled jobs use this as `DATABASE_URL`. Neon's PgBouncer runs in transaction mode; our client already sets `prepare: false`, which it needs.
   - **Direct** (same host without `-pooler`): only for migrations, as `DATABASE_URL_UNPOOLED`.
   - Both end in `?sslmode=require`.
3. Pool size: each Vercel function instance opens its own small pool. `DB_POOL_MAX` defaults to **2 on Vercel** and 5 elsewhere; leave it unset unless Neon reports too many connections.
4. Free tier (D-076): 1 GB storage and 100 compute-hours a month; compute suspends after 5 minutes idle, and the first request after that takes ~0.5–1 s. `pg_trgm` and `unaccent` are available on PG16. The hourly sweep is sized to stay well inside the compute-hours.

## 2. Migrations

Never run migrations from the Vercel build: preview builds would migrate production, and the build has only the pooled URL.

- **First time**, from your machine:
  ```sh
  DATABASE_URL='<direct URL>' npm run db:migrate
  ```
- **Afterwards**, for every deploy that adds a file under `drizzle/`: GitHub → Actions → **Migrate database** → _Run workflow_ (`.github/workflows/migrate.yml`, uses the `DATABASE_URL_UNPOOLED` secret in the `production` environment). Migrate first, then let Vercel deploy. Migrations must stay backward compatible with the running code (add, then use; never drop in the same deploy).

## 3. Vercel (web)

1. Sign up at vercel.com with the personal GitHub account **virajsinghkalra**; import `virajsinghkalra/tixtape`. Framework: Next.js (auto); the build is `next build`. Scheduled work runs in GitHub Actions, not Vercel Cron.
2. Settings → General → **Node.js 24.x**. The function region is pinned to **sin1 (Singapore)**, next to Neon, by `vercel.json` (`"regions": ["sin1"]`; Hobby allows one region). Without the pin, functions default to iad1 and every query would cross to Singapore. Check it after the first deploy under Settings → Functions.
3. Environment variables (Production; add Preview only if you want previews to work, ideally with a Neon branch):

   | Variable                                     | Value                                                           |
   | -------------------------------------------- | --------------------------------------------------------------- |
   | `DATABASE_URL`                               | Neon **pooled** URL                                             |
   | `APP_URL`                                    | `https://<your-domain>` (e.g. `https://lineupmixes.vercel.app`) |
   | `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | the rotated pair                                                |
   | `TOKEN_ENC_KEY`, `TOKEN_ENC_KEY_VERSION=1`   | new production key                                              |
   | `SESSION_SECRET`                             | new production secret                                           |
   | `ADMIN_SPOTIFY_USER_IDS`                     | the admin Spotify user id(s), comma-separated                   |
   | `LASTFM_API_KEY`                             | rotated                                                         |
   | `TICKETMASTER_API_KEY`                       | optional (live lookup)                                          |
   | `APP_CONTACT_EMAIL`                          | the app mailbox (D-059)                                         |
   | `LOG_LEVEL`                                  | `info`                                                          |

   The web app doesn't need `TAVILY_API_KEY`, `GITHUB_MODELS_*`, `OPENAI_*`, `GEMINI_*`, `SETLISTFM_API_KEY` or the alert SMTP secrets: only scheduled jobs use those (least privilege). Vercel sets `VERCEL` itself, which turns on the trusted client-IP headers (D-070).

4. Deploy. Check `/` and an event page, and check that `curl -I https://<domain>/` shows the security headers (CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `frame-ancestors 'none'`).

## 4. Spotify app (production redirect URI)

developer.spotify.com → your app → Settings → **Redirect URIs** → add exactly:

```
https://<your-domain>/api/auth/spotify/callback
```

Keep `http://127.0.0.1:3000/api/auth/spotify/callback` for local work. It must match `APP_URL` exactly (scheme, host, no trailing slash). The app stays in Development Mode (D-001): add each user (max 5) under _User Management_.

## 5. GitHub Actions (scheduled jobs and CI)

Repository → Settings → Secrets and variables → Actions. The repo is public (D-075), so Actions minutes are free.

**Secrets**

| Secret                                                            | Used by                                                   |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| `DATABASE_URL` (pooled)                                           | ingest, sweep, weekly checks, discover gigs               |
| `DATABASE_URL_UNPOOLED` (direct; in the `production` environment) | migrate                                                   |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `TOKEN_ENC_KEY`     | ingest, sweep, revalidate, discover gigs                  |
| `LASTFM_API_KEY`                                                  | ingest, sweep (playlist steps), discover gigs             |
| `TAVILY_API_KEY`                                                  | discover gigs; revalidate (optional, D-066)               |
| `GITHUB_MODELS_TOKEN`                                             | discover gigs                                             |
| `TICKETMASTER_API_KEY`                                            | ingest (optional)                                         |
| `ALERT_SMTP_USER`, `ALERT_SMTP_PASS`                              | sweep, ingest alert step, discover gigs (optional, see 7) |

**Variables:** `APP_CONTACT_EMAIL` (ingest and discover-gigs User-Agent), `AUTO_PUBLISH_ENABLED` (see 7a), `TOKEN_ENC_KEY_VERSION` if not 1.

Each job gets only the secrets it uses. Workflows default to `permissions: contents: read` (keepalive alone gets `actions: write`), and each has a `concurrency` group and a timeout.

| Workflow            | Schedule                | What                                                                                                                                                                                                      |
| ------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ingest.yml`        | every 3 h at :17        | collector in candidates-only mode (D-055), then the source-health alert step                                                                                                                              |
| `sweep.yml`         | hourly at :07 (D-076)   | finish abandoned playlist builds; archive past events; delete candidates > 30 days, search logs > 90 days, expired sessions, old rate-limit windows; held-events, publisher and auto-publish spike alerts |
| `discover-gigs.yml` | daily 02:41 UTC         | Gig Coverage discovery, strict auto-publish gate, publishing, re-verification; then the daily gig digest (7a). Shares the `ingest` concurrency group                                                      |
| `revalidate.yml`    | Mondays 03:41 UTC       | re-check artist Spotify ids older than 30 days; read-only data audit (never `--fix`)                                                                                                                      |
| `keepalive.yml`     | 1st of month, 04:23 UTC | re-enables every scheduled workflow, which resets GitHub's 60-day inactivity timer                                                                                                                        |
| `migrate.yml`       | manual                  | apply migrations                                                                                                                                                                                          |
| `ci.yml`            | push / PR               | format, lint, typecheck, unit, integration (Postgres service); optional Playwright on a production build (manual run with `e2e`, or a PR labelled `e2e`)                                                  |

Notes:

- GitHub may delay scheduled runs by several minutes.
- GitHub disables scheduled workflows after 60 days without repository activity. `keepalive.yml` re-enables them monthly through the API (`gh workflow enable`), with no commits. If one was disabled anyway, re-enable it in the Actions tab.
- The sweep runs hourly rather than every 30 min because each run keeps Neon awake about 6 minutes (D-076). Browsers step builds live; the sweep only rescues abandoned ones.

## 6. Connect the publisher on production

Shared playlists are owned by the "Lineup Mixes" Spotify account (D-036). Tokens are encrypted with the production `TOKEN_ENC_KEY`, so the local connection doesn't carry over.

1. Make sure the Lineup Mixes Spotify user id is in `ADMIN_SPOTIFY_USER_IDS` on Vercel (redeploy after changing env).
2. Open `https://<domain>/api/auth/spotify/login`, click **Not you?**, sign in as Lineup Mixes, **Agree**.
3. From that session, call `POST /api/admin/publisher` (from the admin screen, or the browser console: `fetch("/api/admin/publisher", { method: "POST" })`).
4. Check `GET /api/admin/publisher` shows `connected: true, needsReauth: false`.

Repeat steps 2–3 whenever the sweep sends "The playlist publisher must sign in to Spotify again".

## 7. Alerts (D-060)

Alerts go to **lineupmixes@gmail.com**: a source failing 3 runs in a row (then about daily while it stays down), upcoming events held for review, and a publisher that needs reauth. A lasting condition repeats at most once a day.

- **Recommended ($0): Gmail SMTP.** In the lineupmixes Google account turn on 2-Step Verification, create an **App password** (myaccount.google.com/apppasswords), then set the GitHub secrets `ALERT_SMTP_USER=lineupmixes@gmail.com` and `ALERT_SMTP_PASS=<16-char app password>`. Mail is sent from and to that mailbox (`ALERT_SMTP_HOST`/`ALERT_SMTP_PORT` default to `smtp.gmail.com:465`; `ALERT_EMAIL_TO` defaults to lineupmixes@gmail.com).
- **Fallback (no setup):** without SMTP secrets, the alert is written to the run's job summary as an error annotation and the run is marked failed, so GitHub's own "run failed" email goes to the repository owner's account email.

## 7a. Gig Coverage auto-publish (D-073/D-074)

`discover-gigs.yml` runs `npx tsx src/scripts/discover-gigs.ts --report=gigs-report.json` **once a day at 02:41 UTC** (08:11 IST). It reads listings, discovers gigs for `GIG_ARTISTS_PER_RUN` (8) artists, passes every upcoming night through the strict auto-publish gate, publishes what passes, re-verifies earlier auto-published events, and holds the rest for review. It runs daily because discovery shares the Tavily budget (`DOUBT_SEARCHES_PER_DAY`) with the doubt resolver, and the free credits are small.

- **Kill switch:** the repository variable `AUTO_PUBLISH_ENABLED` (Settings → Secrets and variables → Actions → Variables). Only `true` turns auto-publish on; unset or anything else means nights are still discovered and judged but held for review. Changing it takes effect on the next run, with no deploy.
- **Spike guard (automatic pause):** the hourly sweep counts `publish_audit` rows from the auto-gate. Over 30 in 24 hours, it writes `settings.auto_publish_paused_until` = now + 24 h and sends an alert; the script won't auto-publish while that is in the future. An existing pause isn't extended. To resume early, delete that `settings` row.
- **Daily digest:** right after the run, `src/scripts/gig-digest.ts` emails lineupmixes@gmail.com (or writes the job summary) with the last 24 hours: auto-published events (title, date, city, sources), nights held or rejected and why, re-verification changes, and new leads to check by hand. Nothing is sent on a quiet day.
- **Report:** each run uploads `gigs-report.json` as the `gigs-report` artifact (kept 14 days).
- **Manual run:** Actions → _Discover gigs_ → _Run workflow_, with **dry run** (writes nothing; no digest) and an optional **max artists**.
- **Concurrency and state:** it shares the `ingest` concurrency group with `ingest.yml`, so the two never overlap, and it restores and saves the same collector-state cache.
- **Secrets used** (scoped to the step that needs them): discovery uses `DATABASE_URL`, `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, `TOKEN_ENC_KEY`, `TAVILY_API_KEY`, `LASTFM_API_KEY`, `GITHUB_MODELS_TOKEN` and the alert secrets; the digest uses only `DATABASE_URL` and the alert secrets. Variable: `APP_CONTACT_EMAIL`.
- **Before turning it on:** run a dry run, read the report, and confirm the D-060 rule (14 clean days of manual review) is met.

## 7b. Monitoring (optional, free, D-076)

Neither is needed at launch; both are free and take about 10 minutes.

**UptimeRobot** (uptime, 5-minute checks):

1. Sign up at uptimerobot.com with lineupmixes@gmail.com.
2. Add an **HTTP(s)** monitor for `https://<domain>/`, interval 5 minutes.
3. Add a **Keyword** monitor for `https://<domain>/api/events/suggest?q=lo` that expects the keyword `results`. This catches the app being up while the database is down.
4. Alert contact: lineupmixes@gmail.com.

The 5-minute checks hit Vercel, and the API check also wakes Neon. If Neon compute-hours get tight, raise that monitor's interval to 15–30 minutes or monitor `/` only.

**Sentry** (errors, plus a cron check on ingest):

1. Sign up at sentry.io (free Developer plan) and create a **Next.js** project.
2. Sentry's setup wizard (`npx @sentry/wizard@latest -i nextjs`) adds `@sentry/nextjs` and config files. That's a dependency change, so it goes through the Lead (D-014) as its own pointer, and the CSP (`next.config.ts`) must then allow Sentry's ingest host in `connect-src`.
3. Set `SENTRY_DSN` on Vercel. Never send cookies, tokens or request bodies: keep `sendDefaultPii: false`.
4. **Cron monitor for ingest:** in Sentry → Crons, create a monitor with schedule `17 */3 * * *` and a check-in margin of about 30 minutes. Add a check-in step to `ingest.yml` (Sentry's cURL check-in URL, stored as the secret `SENTRY_CRON_INGEST_URL`), so a missed or failed run raises an alert.

## 8. Go-live checklist

- [ ] All keys in §0 rotated and old ones revoked
- [ ] Neon project in Singapore; migrations applied with the direct URL
- [ ] Vercel env set, Node 24, functions in sin1; site loads with security headers
- [ ] Spotify production redirect URI added; users allow-listed
- [ ] GitHub secrets and variables set; run _Sweep_, _Ingest events_ and _Keepalive_ once by hand and read the logs
- [ ] Publisher connected on production
- [ ] One test alert received (e.g. run the sweep while an event is held)
- [ ] `AUTO_PUBLISH_ENABLED` left unset until a dry run of _Discover gigs_ has been reviewed
- [ ] Optional: UptimeRobot monitors and Sentry
- [ ] End-to-end QA passed (D-044) before sharing the URL

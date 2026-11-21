# Tixtape UX plan: top 15 improvements

- **Status:** Proposal · **Owner:** UX Research & Product Design lead · **Date:** 2026-11-22
- **Ask (owner):** "more smooth, more robust, better UI and app experience, more user friendly … make a top-class app."
- **Scope:** spec only. No code was changed, no Spotify calls were made, and no builds were triggered.
- **Respects:** D-082 (tiny copy, no counts or durations, no "no login"), $0 budget (Vercel Hobby, Neon free, GitHub Actions), no visitor login (Spotify Dev Mode allows 5 users), D-079 home ranking, D-048 `SEARCH_FLOW.md`, and QA-before-users (D-044).

Items marked **🟡 OWNER** need a product decision before they're built. They're collected in [Owner decisions](#owner-decisions).

---

## 1. What I saw (evidence)

I studied the live app on 2026-11-22 with WebFetch and curl from outside India, and read the repo at `b19b5e2`.

| #   | Finding                                                                                                                                                                                                                                                                                                                       | Where                                                                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| E1  | **No Open Graph or Twitter tags at all.** There's no `og:image`, `og:title` or `og:url`. Every event page has the same generic `description` ("Every lineup. One playlist. Concerts and festivals across India."). A link pasted into WhatsApp shows a bare URL or a generic card.                                            | HTML `<head>` of `/` and `/events/248b…`; `generateMetadata` returns only `title`     |
| E2  | **No way to remember a show.** There's no calendar, save or remind option, so the only re-engagement is the visitor coming back by chance.                                                                                                                                                                                    | Event page                                                                            |
| E3  | **Share is a URL only.** `ShareButton` sends `{title, text, url}`. There's no image to post to Instagram Stories or WhatsApp Status, which are the main growth surfaces in India.                                                                                                                                             | `src/components/ShareButton.tsx`                                                      |
| E4  | **Repeated CTAs on the event page:** "Get the playlist" ×2, plus "Open playlist", "Open in Spotify" and Share ×3–4. Date and venue appear 3 times (header, rundown slide 1, lineup poster). Headliners appear 3 times (rundown slide 2, caption, lineup).                                                                     | `/events/248b…` (Sunburn 2026)                                                        |
| E5  | **"Buy tickets" sometimes opens a news article.** Lollapalooza goes to a Live Nation news post, and Johnnie & Co. goes to a Rolling Stone India article. That hurts trust.                                                                                                                                                    | Home cards, `/search?q=lolla`                                                         |
| E6  | **Home repeats itself.** Shreya Ghoshal Bengaluru shows in Next up, Happening this week, Near you and Tours (4×). Two separate "Shreya Ghoshal" tours share a near-identical name.                                                                                                                                            | `/` (Bengaluru)                                                                       |
| E7  | **Cards don't say whether the playlist is ready.** The product's core value ("one playlist") is invisible until the visitor opens an event and scrolls.                                                                                                                                                                       | `EventCard`, search rows                                                              |
| E8  | **No instant feedback when tapping a home card.** `/events/[id]` deliberately has no `loading.tsx` (QA-UI-1, so a 404 stays a 404). Search results get `EventShell`, but home cards, rings and tours show nothing until the server answers. On Indian 4G that's 0.5–2 s of "did my tap work?".                                | `EventShell` is used only in `EventSearch.tsx:443`; there's no `loading.tsx` anywhere |
| E9  | **Zero results are a soft dead end.** "No coldplay shows yet" (with the query in lowercase), "Try an artist or city", then "Try these instead", which is just the soonest shows and unrelated to the query. There's no way to say "tell me when they come".                                                                   | `/search?q=coldplay` (SSR)                                                            |
| E10 | **No PWA plumbing beyond the manifest.** `/sw.js`, `/robots.txt` and `/sitemap.xml` all return 404. There's no offline page and no install prompt.                                                                                                                                                                            | curl                                                                                  |
| E11 | **Images have empty alt text everywhere.** That includes official posters, which carry real information (dates, lineup).                                                                                                                                                                                                      | `EventVisual.tsx:37`, `ArtistAvatar.tsx:80`                                           |
| E12 | **Spotify links open inside in-app browsers.** A link shared to Instagram or WhatsApp opens in the in-app webview. There, `open.spotify.com` often loads the web player and not the Spotify app (universal links are suppressed in webviews), so a "Play" becomes a "log in to Spotify" wall.                                 | `PlaylistPanel` "Open in Spotify" uses the https URL only                             |
| E13 | **Good foundations to build on:** motion tokens (`ui/motion.ts`: `SPRING` 420/28, `SPRING_SOFT` 260/26, `EASE_OUT_EXPO`, 150/250/500 ms), a reduced-motion guard in `globals.css`, a skip link, `BottomBar` with safe-area padding, recents in `localStorage`, toasts, confetti, a story viewer, `EventShell` and `Skeleton`. | repo                                                                                  |
| E14 | **Speed is fine at the server:** TTFB is about 0.25 s for `/`, the event page and `/search`, and suggest answers in about 0.38 s round-trip from outside India. The home HTML is 175 KB with 13 script chunks. Perceived speed is the gap, not raw speed.                                                                     | curl timings                                                                          |
| E15 | **Contrast traps in the brand palette:** lime on white is 1.28:1, sky on white 1.88:1, orange on white 2.35:1, pink on white 2.83:1, and violet on night 3.74:1. These are fine as block fills with night text, but they fail as text colours.                                                                                | computed (WCAG 2.x)                                                                   |

## 2. Benchmarks: what the best do, and what we take from each

| App                                                | Pattern                                                                                                                              | What we adopt                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| **Partiful**                                       | Link-first growth: the link pasted into WhatsApp or IG DMs _is_ the product. Rich preview, no app or account to view, meme-y covers. | Per-event OG cards (#1), share-first event page (#5)                        |
| **Spotify Wrapped**                                | 9:16 share cards with one big fact per card, loud type and textures. Built to be posted, not read.                                   | Story card (#4)                                                             |
| **Spotify Live Events / Bandsintown / Songkick**   | "Track artist" means an alert when they announce near you. "Interested" saves a show. A "Your events" hub.                           | Local Saved / My gigs (#12), zero-result "Ping me" (#7), push (#15)         |
| **DICE**                                           | A quiet, poster-first event page with one primary CTA. Waiting list: "get an alert if tickets come back".                            | Event hierarchy (#5), remind me (#2)                                        |
| **District (Zomato) / Insider**                    | City-first going-out feed and date chips, India-native (₹, IST, city names).                                                         | Keep the city switcher prominent; date chips in the search sheet (#11)      |
| **Shotgun / RA**                                   | Lineup as the hero, artist faces, "friends going" social proof.                                                                      | Faces in search rows (#11). Social proof is a non-goal (it needs accounts). |
| **Airbnb search**                                  | A search pill that expands into a full sheet with recents, suggestions and chips. Instant, never blank.                              | Search sheet polish (#11)                                                   |
| **Instagram Stories / Snapchat / Locket / BeReal** | Zero onboarding: you land in the content. Tap zones, progress bars, haptic ticks.                                                    | No onboarding carousel; content-first hero (#6); haptics (#9)               |
| **Arc Search / Linear / Raycast / Vercel**         | Instant optimistic UI, 150–250 ms springs, skeletons that match the final layout, keyboard-first.                                    | Instant navigation shell (#3), motion spec (#9)                             |
| **Shazam**                                         | One giant button. The result card lands with a satisfying motion and a "Open in Apple Music / Spotify" deep link.                    | Spotify app deep link (#10)                                                 |
| **Fever**                                          | Strong "save" heart with a count, plus calendar add after purchase.                                                                  | Save (#12, without counts per D-082), calendar (#2)                         |

Platform facts this plan relies on (checked 2026-11-22):

- **WhatsApp previews:** Meta's docs say `og:image` must be under 600 KB, at least 300 px wide and no wider than 4:1. Field reports say previews fail above about 300 KB, so **target under 250 KB**. The `<meta>` tags must sit in the first 300 KB of the HTML.
- **Web push on iOS:** works from 16.4, but **only for Home-Screen web apps**, and the permission prompt must follow a tap. If the visitor taps Deny, it's permanent for that web app. Declarative Web Push (iOS 18.4+) drops the service-worker requirement, but still needs the Home Screen. Android Chrome supports push from the browser.
- **Web Share with files:** supported by Android Chrome and iOS Safari 15+. Check `navigator.canShare({files})` first and fall back to a download. Instagram accepts a shared image and opens its composer, where the user picks Story.
- **Cross-document view transitions:** Chrome and Edge 126+ and Safari 18.2+; Firefox no. They don't apply to Next.js client-side navigations, which need same-document transitions or a hand-rolled shell.
- **Haptics:** `navigator.vibrate` works on Android only. iOS Safari 17.4/18+ emits a system haptic when a `<input type="checkbox" switch>` is toggled through its `<label>`. That's a non-standard side effect, so treat it as progressive enhancement only.

## 3. Ranking: the top 15 by impact ÷ effort

Effort: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2 weeks (one engineer, including tests and QA).

| Rank | Improvement                                                                | Track | Impact                                | Effort | Owner?    |
| ---- | -------------------------------------------------------------------------- | ----- | ------------------------------------- | ------ | --------- |
| 1    | Per-event OG share cards (WhatsApp / iMessage / X previews)                | 1     | ★★★★★ growth loop                     | S      | 🟡 OD-1   |
| 2    | "Remind me": add to calendar (.ics plus a Google Calendar link)            | 1     | ★★★★ retention                        | S      |           |
| 3    | Instant tap feedback: shell for every event link, plus smooth transitions  | 2     | ★★★★ perceived speed                  | M      |           |
| 4    | Story share card (1080×1920) for IG Stories and WA Status                  | 1     | ★★★★★ growth loop                     | M      | 🟡 OD-1   |
| 5    | Event page hierarchy: one primary CTA, dedupe, honest ticket label         | 1     | ★★★★ clarity and conversion           | M      | 🟡 OD-5/6 |
| 6    | "Playlist live" badge on every card, plus a first-run hero and home dedupe | 1     | ★★★★ value at a glance                | M      | 🟡 OD-7   |
| 7    | Zero-result search becomes discovery, with "Ping me" stored locally        | 1     | ★★★★ demand capture                   | M      | 🟡 OD-8   |
| 8    | Accessibility pass plus automated checks                                   | 2     | ★★★ inclusion, SEO                    | S      |           |
| 9    | Micro-interactions and haptics system                                      | 1     | ★★★ delight, "feels like an app"      | S      |           |
| 10   | Spotify deep link that escapes in-app browsers                             | 1     | ★★★★ playlist open rate               | S      |           |
| 11   | Search sheet polish: faces, live badges, trending, date chips, recents     | 1     | ★★★ search success                    | S–M    |           |
| 12   | Saved shows and artists ("My gigs"), stored locally                        | 1     | ★★★ return visits                     | M      | 🟡 OD-9   |
| 13   | Resilience, SEO and perf infra: section error boundaries, sitemap, RUM     | 2     | ★★★ robustness, organic discovery     | M      |           |
| 14   | PWA: service worker, offline shell, smart install prompt                   | 2     | ★★★ return visits, robustness         | M      |           |
| 15   | Web push "Ping me" (new shows, playlist live, day-of)                      | 2     | ★★★★ retention, but iOS needs install | L      | 🟡 OD-2   |

**Suggested order of work:** sprint A is 1, 2, 3, 8, 10 (all S or small M, ship together). Sprint B is 4, 5, 6, 9. Sprint C is 7, 11, 12, 13. Sprint D is 14, then 15 if the owner approves it.

---

## 4. Shared conventions for every item

- **Viewport:** design at **390×844** first (iPhone 14/15 class; also typical Android 393×873). Side gutter 16 px. Tap targets ≥ 44×44 px (`min-h-11`). Primary actions live in the `BottomBar` thumb zone.
- **Motion tokens** (existing, `ui/motion.ts` and `globals.css`):
  - `fast` 150 ms, `base` 250 ms, `slow` 500 ms;
  - `EASE_OUT_EXPO` `cubic-bezier(0.16,1,0.3,1)` for enters;
  - `cubic-bezier(0.4,0,1,1)` (ease-in) at `fast` for exits;
  - `SPRING` (stiffness 420, damping 28) for presses and toggles, `SPRING_SOFT` (260/26) for sheets.
  - **Every** animation has a `prefers-reduced-motion` variant: a crossfade ≤ 120 ms, or none.
- **Copy:** all visible strings are ≤ 4 words, live in `lineup-copy.ts` or a new `ux-copy.ts`, and get a word-limit unit test (the D-082 pattern). Screen-reader text may be longer.
- **Privacy-safe measurement:** reuse the D-081 pattern. Add one new aggregate table, `ux_counters(day, kind, count)`, with no IP, id or query, incremented with `after()`. Proposed kinds:
  - `share_link`, `share_story`, `ics`, `gcal`;
  - `save`, `ping_me`;
  - `install_prompt_shown`, `install_accepted`;
  - `push_optin`;
  - `spotify_open_app`, `spotify_open_web`;
  - `og_hit` (the OG image route was fetched, a proxy for links pasted).
  - Shared links carry `?via=wa|ig|copy|native` so referred views can be counted (`view_via_*`).
  - 🟡 **OD-4** (schema change, Lead).

---

## 5. Track 1: UI and features

### #1 · Per-event OG share cards · S · 🟡 OD-1

- **Problem:** E1. A pasted link gives WhatsApp nothing to render, and India's main sharing channel is WhatsApp DMs and groups. Partiful's whole growth loop is "the link preview is the invite".
- **Pattern:** Partiful and DICE link previews; Spotify playlist cards.
- **Spec:**
  - Add `src/app/events/[id]/opengraph-image.tsx` (Next `ImageResponse`, which is free on Hobby; Node runtime so the Postgres client works), size 1200×630, PNG.
  - `generateMetadata` adds `openGraph {title, description, url, siteName: "Tixtape", images}`, `twitter: summary_large_image`, `alternates.canonical`, and `metadataBase = https://tixtape.vercel.app` in the root layout.
  - **Layout:**
    - left 60%: a night background with the event tone as a 16 px chunky border; the title in Bricolage 800, 72→48 px auto-fit, max 3 lines;
    - beneath it, the date and city ("18–19 Dec · Mumbai");
    - a 2-line headliner list with up to 4 names joined by " · ";
    - right 40%: the ticket-cassette logo sticker rotated −6°, plus a lime sticker "🎧 Playlist live" when the playlist is ready, else "🎧 Playlist soon".
  - **No song counts or durations** (D-082).
  - **Imagery:** 🟡 OD-1. The default is **typographic only** (zero rights risk, about 60–120 KB). Option B composites the official poster or the Spotify artist photos, which is a derived re-host and conflicts in spirit with D-082's "hotlinked, never re-hosted".
  - **Fonts:** load Bricolage and Inter TTF from `/public/fonts`. Satori can't read woff2.
  - **Cache busting:** WhatsApp caches per URL, so the image URL carries `?v=<hash(title, startsAt, top names, playlistReady)>`. The route sends `Cache-Control: public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800`.
  - **Budget:** ≤ 250 KB; CI asserts the byte size on 3 fixture events.
  - Home and `/search` get one static brand OG card ("Every lineup. One playlist.").
  - Event `description` = `"{date} · {city} · {top 3 names}"`. This is metadata only, so the 4-word rule doesn't apply.
- **Accessibility:** set `og:image:alt` = "{title}, {date}, {city}".
- **Metrics:** `og_hit`/day; `view_via_wa` share of event views; event views per share (target ≥ 1.5 within 4 weeks).

### #2 · "Remind me": add to calendar · S

- **Problem:** E2. People plan gigs weeks ahead (Sunburn: 26 days to go), and today nothing brings them back on the day.
- **Pattern:** DICE and Fever "Add to calendar"; Bandsintown "RSVP → calendar".
- **Spec:**
  - **Button:** a secondary `🗓️ Remind me` in the event header CTA row and in the event `BottomBar` overflow.
  - **Behaviour:** tapping opens a small `Sheet` (bottom sheet at 390 px, popover at ≥ 640 px) with:
    - `Apple / Outlook (.ics)` → `GET /events/[id]/calendar.ics`;
    - `Google Calendar` → `https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…&location=…&details=…`.
  - **Smart default** (the sheet is skipped on a first tap when the platform is unambiguous):
    - iOS Safari → .ics, which opens the native "Add Event" sheet;
    - Android → the Google link;
    - desktop or unknown → show the sheet;
    - in-app browsers (UA contains `Instagram`, `FBAN`, `FBAV`, `WhatsApp` or `Line`) → the Google link, because a .ics download fails silently in those webviews.
  - **.ics content:**
    - `VEVENT` with `UID=<eventId>@tixtape`, `DTSTART` in UTC (or `VALUE=DATE` for date-only shows) and `DTEND` (`endsAt`, else start + 4 h for a concert or an all-day span for festivals);
    - `SUMMARY` = title; `LOCATION` = venue, city;
    - `URL` and `DESCRIPTION` = event URL + "#playlist" (one line: "Playlist: https://…");
    - two `VALARM`s: −P1D and −PT3H;
    - `Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="<slug>.ics"`.
    - A lineup or time change keeps the same UID, so re-adding updates the entry.
  - **States:** idle → after the tap, toast `Added? Nice 🗓️`. We can't detect success, so the toast copy hedges. The button then shows `🗓️ Reminded` (stored per event in `localStorage`; it's a nicety, so storage failure is ignored).
  - **Motion:**
    - the sheet slides up with `SPRING_SOFT` and a backdrop fade at 250 ms `EASE_OUT_EXPO`;
    - the sheet exits at 150 ms ease-in;
    - the button label swaps with a 150 ms crossfade and a 0.96→1 scale `SPRING`.
- **Accessibility:** the sheet is a `role="dialog"` with focus trap, Esc to close and focus returned to the trigger. The Google link announces "opens in a new tab".
- **Copy:** `Remind me`, `Reminded`, `Apple calendar`, `Google Calendar`, `Added? Nice 🗓️`.
- **Metrics:** `ics` + `gcal` per 100 event views (target ≥ 4%). Watch the trend of `view_via_*` on show day.

### #4 · Story share card (IG Stories and WhatsApp Status) · M · 🟡 OD-1

- **Problem:** E3. Gen Z India shares going-out plans as **Stories and Status**, not links. Today there's nothing visual to post.
- **Pattern:** Spotify Wrapped and Spotify "Share to Instagram" cards; Partiful covers; Shazam's share card.
- **Spec:**
  - **Route:** `GET /events/[id]/story.png`, 1080×1920 (`ImageResponse`), same caching and versioning as #1, ≤ 400 KB.
  - **Layout** (safe zone: 250 px clear at top and bottom for IG UI):
    - a big sticker at the top: "I'm going 🎟️" (variant: "Who's coming? 👀", 🟡 OD-1 picks the default, or allow toggling);
    - the event title, huge, in the event tone block with chunky 8 px night borders and a 10° hard shadow;
    - headliner names as stacked stickers alternating tones (max 5);
    - a date + city chip;
    - a cassette illustration (the logo) with "🎧 the mixtape" label;
    - footer: `tixtape.vercel.app` in mono.
    - No counts or durations.
  - **Share flow** (the button is `↗ Share` in the panel and header; a sheet with 2–3 choices):
    - `Story card`: fetch the PNG as a blob, build `File("tixtape-<slug>.png")`, and if `navigator.canShare({files})` then `navigator.share({files, text: "<title> 🎧 <url>?via=ig"})`; else download the file and toast `Saved. Post it 📸`.
    - `Send link`: today's `navigator.share({title, text, url?via=native})`, or copy with toast `Link copied 🔗`.
    - `WhatsApp`: `https://wa.me/?text=<encoded "title 🎧 url?via=wa">` (works in every browser, including in-app).
  - **Preload:** start fetching the PNG when the share sheet opens. While it loads, the `Story card` option shows a spinner inside a fixed-width button, so there's no layout shift.
  - **States:** loading (≤ 1.5 s typical) → ready. On error: toast `Couldn't make card` and fall back to link share.
  - **Motion:**
    - the sheet uses `SPRING_SOFT`;
    - a preview thumbnail of the card (9:16, 120 px wide) pops in at 250 ms `EASE_OUT_EXPO` with scale 0.9→1 and rotate −3°→−2°;
    - success gives haptic #9 "success".
- **Accessibility:** buttons are labelled "Share story image of {title}". The image has `alt`.
- **Copy:** `Share`, `Story card`, `Send link`, `WhatsApp`, `Saved. Post it 📸`.
- **Metrics:** `share_story` per 100 views (target ≥ 3%); `view_via_ig`; the share-to-view multiplier.

### #5 · Event page hierarchy: one primary action, no repeats · M · 🟡 OD-5, OD-6

- **Problem:** E4 and E5. Too many equal-weight buttons and triple-repeated facts. The ticket CTA sometimes lies.
- **Pattern:** DICE (poster, facts, one big CTA); Shazam (one giant button).
- **Spec** (top to bottom at 390 px):
  1. **Hero:**
     - the poster or collage at full bleed in a 4:5 frame (currently 4:3 with a 2° tilt; keep the tilt);
     - countdown and type stickers overlap the bottom edge of the picture;
     - the title;
     - one facts row: `📅 18–19 Dec · 4 pm` and `📍 Mahalaxmi, Mumbai` (wraps to 2 lines max).
     - The `When / Starts / Where` labelled grid goes, which saves about 120 px.
  2. **The primary card is the playlist** (moved up from below the lineup):
     - the `PlaylistPanel` states as today, with `▶ Open in Spotify` (or `Make playlist`) as the **only** filled-lime button on the page;
     - secondary row: `↗ Share` · `🗓️ Remind me` · `🎟️ Tickets`.
  3. **Lineup poster**, as today.
  4. **The rundown (story):** 🟡 **OD-6**. On the event page it repeats the header. The proposal is to replace the inline carousel with a ring button `▶ Rundown` beside the title, opening the existing `StoryViewer`. Home keeps its rings.
- **BottomBar:**
  - before the playlist card has scrolled past: `🎧 Playlist` (primary) + `↗`;
  - after it has scrolled past: `▶ Open in Spotify` (or the state) + `↗`;
  - it never duplicates a button already visible on screen (an `IntersectionObserver` on `#playlist`; the bar hides while the panel is ≥ 50% visible).
  - Bar show and hide: translateY 100%→0, 250 ms `EASE_OUT_EXPO` / 150 ms ease-in.
- **Ticket label honesty** (🟡 **OD-5**): when the best source isn't a ticketing domain (an allow-list: district.in, insider.in, bookmyshow.com, skillboxes.com, ticketmaster, livenation **ticket** paths, highape.com, sortmyscene.com, the official festival domain), show `ℹ️ Info ↗` instead of `🎟️ Tickets`. Never call a news article "Buy tickets". An alternative is to hide it altogether.
- **Remove:** the duplicated `🎧 Get the playlist` in the header (the panel is now right there), and "Copy link" fused with Share (it moves into the #4 share sheet).
- **Accessibility:**
  - one `h1` (the title), `h2`s for Playlist and Lineup;
  - the facts row uses `<time datetime>`;
  - the playlist `role="status"` region stays.
- **Metrics:**
  - `spotify_open_*` / event views (playlist open rate; target +25% relative);
  - scroll depth to `#playlist` (from the IntersectionObserver, counted once: `ux_counters kind=playlist_seen`);
  - ticket-click rate stays the same or rises.

### #6 · "Playlist live" on cards, first-run hero, home dedupe · M · 🟡 OD-7

- **Problem:** E6 and E7. The point of the app is hidden behind a tap, and the same show appears up to 4 times.
- **Pattern:** Instagram, Locket and BeReal (no onboarding, land in content); Spotify (a green "playing" glyph signals readiness).
- **Spec:**
  - **Badge:**
    - The feed query already joins playlist state (add `playlistStatus` to `FeedRow` if it's missing; this is a read only).
    - Cards, rings, search rows and Next-up show a top-right sticker:
      - ready: `🎧 Live` on a lime sticker with night text and a tilt of +4°;
      - building: `⏳ Cooking` (lime outline);
      - none: nothing.
    - A ready badge gets a one-time 600 ms "equalizer" shimmer when it scrolls into view: 3 bars scaling Y 0.4→1, staggered 80 ms, `EASE_OUT_EXPO`. With reduced motion it doesn't animate.
  - **First-run hero (390 px):**
    - the lime hero keeps "Every lineup. One playlist." (H1);
    - the search pill sits right under it;
    - drop the sub-line "Search. Tap. Play." (the hero is already 3 lines tall at 390 px);
    - directly below, a **horizontal snap row of 3 "Next up" cards with a `🎧 Live` badge**, prioritising ready playlists. This is the "aha": the visitor sees the playlist exists before scrolling.
  - **Dedupe (🟡 OD-7, it amends D-079):** an event already in the hero "Next up" is not repeated in "Happening this week" rings or "Near you". Tours stay collapsed and don't count. The two "Shreya Ghoshal" tours are a data issue: tour titles need a disambiguator (the tour name) in `tourInfo` (Events team).
  - **"On the board" stats tile** (35 gigs, 16 cities): keep it on desktop, and hide it below 640 px (low value, high scroll cost).
- **Accessibility:** the badge text is in the accessible name of the card ("Sunburn Festival 2026, playlist live").
- **Metrics:** home → event click-through; home → playlist open within the session (`spotify_open_*` with `via=home`); median scroll depth before the first tap.

### #7 · Zero-result search becomes discovery · M · 🟡 OD-8

- **Problem:** E9. "No coldplay shows yet" followed by the soonest unrelated shows. Searching an artist who isn't touring India is the **most valuable signal we get** (D-050 already logs it), and the user leaves with nothing.
- **Pattern:** Bandsintown and Songkick "Track artist"; DICE "Waiting list"; Airbnb's "Try adjusting your search" with suggested flexible dates.
- **Spec** for `/search?q=` with no rows, and the type-ahead "no match" panel:
  1. **Header:** `Not in India yet 🫠`, plus the recognised artist chip when the lookup knows them (`🎤 Coldplay`). Keep the user's casing: use the lookup's canonical name, else the query as typed. Never lowercase it.
  2. **Primary action, `🔔 Ping me`:**
     - stores `{artist, addedAt}` in `localStorage` (`tixtape.watch`);
     - with #15 approved, it also offers push; without push, the watch is checked on each visit (step 4);
     - it also counts `ping_me` and adds the query to the D-050 watch list (already server-side via `search_log`; no new PII).
     - Tap gives haptic "success" and the label swaps to `🔔 On it`.
  3. **Discovery rows** (each ≤ 6 cards, horizontal snap):
     - `Sounds like this`: upcoming shows whose lineup includes Last.fm `artist.getSimilar` names (free; the engine already calls Last.fm; cache 7 days). 🟡 **OD-8** approves the new Last.fm call. No Spotify.
     - `In your city`: the visitor's city, soonest first.
     - `Playlists live`: the top 6 ready playlists.
     - The current "Try these instead" is replaced.
  4. **Return payoff:** on home load, if any watched artist now has an upcoming show (one cheap `GET /api/search?artist=` per watched name, max 5, after paint), show a top toast-card: `🎉 Coldplay just landed` → links to the event. It's dismissed per event.
  5. **"Did you mean"** stays, styled as a tappable chip (`Diljit?`), not an inline sentence.
- **States:**
  - lookup searching: a pulsing cassette sticker `Checking…` (≤ 8 s, D-057), with discovery rows rendered immediately beneath (they never wait on the lookup);
  - lookup found: results slide in above, and the discovery rows stay;
  - not_found: as above;
  - offline: `You're offline` + Retry.
- **Motion:** discovery rows fade-up 12 px, 250 ms `EASE_OUT_EXPO`, staggered 60 ms.
- **Accessibility:** the `Ping me` toggle is `aria-pressed`, and the result count is announced via `aria-live="polite"`.
- **Metrics:** zero-result exits (sessions ending on a zero-result page; target −40%); `ping_me` per zero-result view; watch→event conversions.

### #9 · Micro-interactions and haptics system · S

- **Problem:** the UI is visually loud but tactilely flat. Presses don't "give", and success moments (outside confetti) are silent.
- **Pattern:** Raycast, Linear and Vercel (150 ms presses, springy toggles); iOS system haptics; Instagram's double-tap heart.
- **Spec** (one `ui/feedback.ts` with `haptic(kind)` and a `<Pressable>` wrapper over `Button`):
  - **Press:** on pointerdown scale 0.96 and the hard shadow 5px→2px with translate (2px, 3px), 100 ms ease-out; on release `SPRING` back. This is the "sticker press-in" that fits the chunky style.
  - **Haptics** (progressive enhancement; on Android `navigator.vibrate`; on iOS 17.4+ a hidden `<input type="checkbox" switch>` toggled via its label; nothing elsewhere):
    - `tap` 8 ms: Save, Ping me, chip select;
    - `success` [12, 40, 12]: playlist ready, share done, calendar added;
    - `warn` 20 ms: an error toast.
    - Never on scroll, typing or page load. No haptics when `prefers-reduced-motion` is set (as a user-intent proxy).
  - **Toasts:** enter from the bottom above the `BottomBar` with y 16→0 and `SPRING_SOFT`; auto-dismiss after 2.4 s; swipe-down dismiss; max 1 visible (a new one replaces the old one).
  - **Save heart (#12):** scale 1→1.25→1 with `SPRING` and a 6-particle burst in brand tones at 400 ms. Reduced motion gives a colour change only.
  - **Playlist ready:** confetti (exists) + `success` haptic + the button morphs from `Make playlist` to `▶ Open in Spotify` with a width-animated label crossfade over 250 ms.
  - **Pull-to-refresh:** not added (it conflicts with browser behaviour).
- **Accessibility:** no information is conveyed only by motion or haptics.
- **Metrics:** qualitative (5-user hallway test: "does it feel like an app?"); no regression in INP (< 200 ms p75).

### #10 · Spotify deep link that escapes in-app browsers · S

- **Problem:** E12. Most shared traffic lands inside the Instagram or WhatsApp webview, where `open.spotify.com` usually stays in the webview and asks the visitor to log in to the web player.
- **Pattern:** Shazam, Linktree and Feature.fm smart links ("open in app").
- **Spec:**
  - The `Open in Spotify` handler:
    1. **Android:** `intent://playlist/<id>#Intent;scheme=spotify;package=com.spotify.music;S.browser_fallback_url=<https url>;end`. This works from Chrome and most webviews.
    2. **iOS:** set `location.href = "spotify:playlist:<id>"`. Then, if `document.visibilityState` is still `visible` after 1200 ms, navigate to the https URL.
    3. **Desktop:** the https URL in a new tab, as today.
  - **In-app browser detected** (an Instagram, FB or WhatsApp UA) and step 2 fails: show a one-line inline hint under the button: `Tap ⋯ → Open in browser`, with an arrow sticker pointing top-right. Dismissible.
  - Track which branch was used (`spotify_open_app` vs `spotify_open_web`).
- **Accessibility:** the button still has an `href` to the https URL, so assistive tech, middle-click and copy-link work. The JS handler only upgrades it.
- **Copy:** `Open in Spotify`, `Tap ⋯ → Open in browser`.
- **Metrics:** share of `spotify_open_app` (target ≥ 60% on mobile); playlist follows (owner can see them in Spotify for Artists or the playlist's follower count, manually).

### #11 · Search sheet polish · S–M

- **Problem:** search is already strong (D-047, D-048, D-057). What's left is visual confidence and speed of choice. Rows are text-only (`suggest?q=lo` returns titles without faces or badges), and the empty-focus state lacks date shortcuts.
- **Pattern:** Airbnb (pill → sheet with recents and chips), Spotify search (faces), Arc Search (instant).
- **Spec:**
  - **Rows:**
    - a 40 px avatar: the artist photo, else the poster thumb, else a tone square with an emoji;
    - title with highlighted match;
    - meta `22 Nov · Mumbai`;
    - right side: the `🎧 Live` badge (#6).
    - The suggest payload gains `image` and `playlistReady` (Events; read-only join).
  - **Empty focus, top to bottom:**
    - `Recent` (with `Clear` and swipe-to-remove);
    - date chips `Tonight`, `This weekend`, `This month`;
    - city chips (top 4 by count, with the current city first);
    - `Trending` (existing);
    - `Popular searches`.
  - **Typing:** keep the existing D-048 behaviour. Add a typo chip at the top when the engine corrects ("diljeet" → `Diljit?`).
  - **Sheet motion (390 px):**
    - the pill expands to full screen as a FLIP from the pill's rect (300 ms `EASE_OUT_EXPO`);
    - the input autofocuses at 120 ms;
    - the back button and swipe-down close it (`SPRING_SOFT`);
    - reduced motion: a 120 ms fade.
  - **No-network:** recents and cached recommendations still render, with an `Offline` chip.
- **Accessibility:** keep the combobox pattern; avatars `alt=""` (the name is in the row text); chips are buttons with `aria-pressed`.
- **Copy:** `Recent`, `Clear`, `Tonight`, `This weekend`, `This month`, `Trending`, `Offline`.
- **Metrics:** search → open rate; median time-to-open; zero-result rate (with #7).

### #12 · Saved shows and artists ("My gigs"), stored locally · M · 🟡 OD-9

- **Problem:** E2. There's no way to come back to "my" stuff. Login is impossible (Spotify Dev Mode), so state must be device-local.
- **Pattern:** Fever and Spotify Live Events "Interested"; Songkick "Your events"; Bandsintown "Track".
- **Spec:**
  - **Save:**
    - a heart sticker on cards (top-left, 44 px hit area) and in the event action row: `♡ Save` / `♥ Saved`;
    - artist rows in the lineup get a small `+` to **follow** that artist locally (`tixtape.artists`).
    - **No counts shown** (D-082 spirit; and counts would need server state).
  - **Storage:** `localStorage` `tixtape.saved = [{id, title, startsAt, city, savedAt}]`, max 50. Storage errors are ignored. Past shows auto-move to a `Been there` group.
  - **Surface:**
    - a header icon button `♥` (with a dot when there's news) → `/me` (a client page, no server data except fetching event summaries by id);
    - sections there: `Coming up`, `New for you` (shows by followed artists, using the same cheap query as #7 step 4), `Been there`.
    - Each upcoming saved show has `🗓️` (#2) and `🎧` quick actions.
  - **Migration safety:** the key is versioned `v1`; unknown shapes are dropped silently.
  - **Motion:** heart per #9. The `/me` list items get layout animations on remove (200 ms).
- 🟡 **OD-9:** is a `/me` page worth it at the current catalogue size (35 shows), or should saved items only appear as a "Your gigs" row at the top of home? The recommendation is **a home row first** and `/me` later.
- **Accessibility:** the heart button has `aria-pressed` and the label "Save {title}".
- **Copy:** `Save`, `Saved`, `Your gigs`, `New for you`, `Been there`.
- **Metrics:** `save` per 100 views; 7-day return visits of savers vs non-savers (from `ux_counters` with `kind=return_saver`, counted client-side once per day).

---

## 6. Track 2: robustness, performance, PWA and accessibility infra

### #3 · Instant tap feedback and smooth page transitions · M

- **Problem:** E8. A tap on a home card shows nothing until the server answers. `EventShell` solves this for search only.
- **Pattern:** Arc and Linear (optimistic UI); Instagram (tap → content frame immediately).
- **Spec:**
  - **`<EventLink event={summary}>`:** a client wrapper used by `EventCard`, rings, Next-up, tours and search rows.
    - On click (not modified, not middle-click) it puts `summary` into a tiny context store and renders the existing `EventShell` (title, date, city, tone, skeletons) **within one frame**, then calls `router.push`.
    - The shell unmounts when the new route commits.
    - The real 404 behaviour is preserved, because the server still answers with 404 for unknown ids (QA-UI-1 unchanged).
  - **Morph:** a FLIP from the tapped card's rect to the shell's hero tile, 280 ms `EASE_OUT_EXPO`, with the card's tone colour carried over. Reduced motion gives a 120 ms crossfade.
  - **Prefetch:** `router.prefetch(href)` on `pointerenter` (desktop) and when a card is ≥ 60% in the viewport for 300 ms (mobile; an IntersectionObserver capped at 4 in-flight prefetches). Under `navigator.connection.saveData` or `effectiveType` `2g`/`slow-2g`, don't prefetch.
  - **Home `loading.tsx`:** allowed (home has no 404 path). It's a skeleton matching the hero + 2 sections, to avoid the white flash on the back navigation from Spotify.
  - **Back navigation:** restore scroll (the Next default). Ensure the shell doesn't flash on back/forward (bfcache): skip the shell when the navigation type is traverse.
  - **Timeout:** if the route hasn't committed after 8 s, the shell shows `Still loading…` + `Retry`.
- **Accessibility:** the shell has `aria-busy` and an sr-only "Opening {title}…" (exists). Focus moves to the new `h1` on commit.
- **Metrics:** time from tap to first visual response < 100 ms (Playwright perf spec, D-057 style); "rage taps" (≥ 2 taps on the same card within 1 s; counted).

### #8 · Accessibility pass and automated checks · S

- **Problem:** E11 and E15, plus no automated a11y gate.
- **Spec:**
  - **Alt text:**
    - poster `alt="Poster: {title}"`;
    - collage: `alt=""` with the figure labelled by the visible caption;
    - artist photos `alt=""` when the name is adjacent;
    - the OG and story images get `og:image:alt`.
  - **Contrast rule** (documented in `globals.css` comments): lime, sky, orange and pink are **fills only**, always with `--color-night` text. Text on light surfaces uses `--accent-text` (#3f5c00). Violet text on night is banned for body copy (3.74:1); use it for borders and shadows only.
  - **Focus:** a visible 3 px lime outline + 2 px night offset ring on every interactive element, including story tap zones and chips.
  - **Story viewer:** pause on focus or hover; ←/→ keys; a visible `Pause` control (WCAG 2.2.2 for auto-advancing content).
  - **Marquee:** pause on hover or focus, and stopped under reduced motion (verify the existing guard covers `animation: marquee`).
  - **Target size:** ≥ 44 px for all tap targets, including the tour `details` items (verify) and the heart (#12).
  - **Language:** `lang="en-IN"` (exists). Wrap names with Devanagari or other scripts in `lang` spans when known (low priority).
  - **Automated:** `@axe-core/playwright` on `/`, an event page, `/search?q=…`, the zero-result page and 404, in CI. Fail on serious or critical violations.
- **Metrics:** 0 serious axe violations; a manual VoiceOver and TalkBack pass on the 3 main flows each release.

### #13 · Resilience, SEO and perf infra · M

- **Problem:** E10 and E14. Every page is `force-dynamic`, a single failing section can take down home (one `error.tsx`), and search engines get no sitemap (organic search for "lollapalooza india lineup" is a free acquisition channel).
- **Spec:**
  - **Section error isolation:**
    - wrap each home section (`FrontSection`, rings, tours) and the event page's playlist panel and story in error boundaries that render a compact `EmptyState` (`Couldn't load this` + `Retry`), not the full-page "We lost the signal";
    - the playlist panel already degrades, so keep it.
  - **Streaming:** home sections inside `<Suspense>` with layout-matched skeletons, so the hero and search paint first (LCP ≤ 2.0 s p75 on a 4G mid-range Android).
  - **SEO:**
    - `app/sitemap.ts`: published upcoming events, `lastModified` = updated_at, plus `/`;
    - `app/robots.ts` (allow all; disallow `/admin`, `/api`);
    - JSON-LD `MusicEvent` on event pages: name, startDate, endDate, location (Place + address city), performer[], image (poster URL, hotlinked), `eventStatus` (cancelled → `EventCancelled`), `offers.url` only when it's a real ticket domain (#5).
  - **RUM, free:**
    - a `useReportWebVitals` beacon → `POST /api/vitals` → `ux_counters` buckets (LCP, INP, CLS) in good / needs-improvement / poor per route, per day;
    - no IDs, sampled at 25%;
    - avoids paid Speed Insights.
  - **Image hygiene:**
    - `width`/`height` or `aspect-ratio` on every `<img>` (CLS < 0.05);
    - `fetchpriority="high"` + no lazy loading on the event hero and the first home card;
    - `decoding="async"` elsewhere.
    - Posters stay hotlinked (D-082).
  - **Fonts:** check `display: swap` and subset to latin (exists). Preload only Bricolage 800.
  - **Budgets** (add to the D-057 perf spec):
    - home JS ≤ 170 KB gz;
    - LCP ≤ 2.5 s and INP ≤ 200 ms;
    - CLS ≤ 0.05 on a Moto G Power profile with Fast 4G throttling.
- **Metrics:** Web Vitals good-rate ≥ 75% per route; organic sessions (`view_via` absent, referrer google); section-error counts.

### #14 · PWA: service worker, offline shell, smart install · M

- **Problem:** E10. There's no service worker. On flaky festival-ground networks, the app just dies, and repeat visitors get no "app" feel.
- **Pattern:** Instagram Lite and Twitter Lite (offline shell); Starbucks PWA; Spotify web (install prompt after engagement).
- **Spec:**
  - **Service worker:** hand-written `public/sw.js` (no Workbox dependency, about 120 lines), registered after `load` in production only.
    - **Precache:** `/offline` (a static page: cassette sticker, `You're offline`, `Try again`), the logo, the fonts.
    - **Runtime caching:**
      - navigations network-first with a 3 s timeout → cache → `/offline`;
      - `/_next/static/*` cache-first (immutable);
      - event pages: keep the last 10 visited for offline reading (stale-while-revalidate);
      - `/api/*` never cached except `GET /api/events/suggest` (zero-query, 5 min);
      - OG and story images network-only.
    - **Update flow:** a new SW waits. A toast `New version · Refresh` appears on the next navigation, and `skipWaiting` happens on tap.
  - **Online/offline banner:** a top sticker that slides down at 250 ms: `You're offline` (orange), then `Back online` (lime, auto-hides after 2 s).
  - **Install prompt (Android/Chromium):**
    - capture `beforeinstallprompt`;
    - show our own chip in the `BottomBar` only after real intent: 2nd visit or later, **and** (a save, a calendar add or a playlist open);
    - copy `📲 Add to home`;
    - dismissed → hidden for 30 days.
  - **iOS:** no API. Show the same chip in Safari (not in-app browsers), which opens a sheet with a 2-step visual: `Tap ⎋ Share` → `Add to Home Screen`.
  - **Manifest:**
    - add `id`, `scope`, `shortcuts` (`Search`, `Your gigs`);
    - add `screenshots` (narrow 1080×1920 ×2) so Android shows the richer install UI;
    - set `display_override: ["standalone"]`;
    - set `theme_color` to night.
- **Accessibility:** banners are `role="status"`; the install sheet is a dialog with a focus trap.
- **Metrics:** `install_prompt_shown` → `install_accepted` rate; standalone sessions (`matchMedia('(display-mode: standalone)')`) per day; offline page views.

### #15 · Web push "Ping me" · L · 🟡 OD-2

- **Problem:** the calendar (#2) covers known shows. Push is the only way to say "Coldplay just landed in Mumbai" or "your playlist is live" without email or a login.
- **Feasibility at $0:**
  - VAPID keys + the `web-push` npm lib; subscriptions stored in Neon (free tier);
  - sends from the existing GitHub Actions cron after `ingest --publish` and in the sweep;
  - push services (FCM, APNs web, Mozilla) are free.
  - **iOS needs the PWA installed first** (#14), so iOS reach will be low.
- **Spec:**
  - **Opt-in only after a tap** on `🔔 Ping me` (#7), `🔔` on a saved show (#12) or `Remind me` (#2) offering "Also ping?". Never on load.
  - Pre-prompt sheet first (our UI): `Get pinged?` with `Yes` / `Not now`. Only `Yes` triggers the browser prompt, because a browser deny is permanent on iOS.
  - **Table `push_subscriptions`:** endpoint (unique), keys, created_at, topics (`event:<id>` or `artist:<normalized name>`, max 20), last_sent_at. There's no user id. The endpoint is a pseudonymous identifier: deleted on unsubscribe, on 404/410 from the push service, and after 180 days idle. 🟡 This is the app's first stored per-device identifier, so it needs owner sign-off and a one-line privacy note in the footer (`Privacy` link).
  - **Triggers:**
    - a watched artist gets a new published event (once);
    - a saved show's playlist goes live (once);
    - a saved show is in 24 h (once);
    - a saved show is cancelled (once).
    - Max 1 push per device per day. Quiet hours 22:00–09:00 IST are queued.
  - **Payload copy** (≤ 4 words + a title): title `Coldplay · Mumbai 🎉`, body `Just landed`; title `{Event}`, body `Playlist live 🎧`; title `{Event}`, body `Tomorrow 🗓️`.
  - **Click** → the event page with `?via=push`.
  - **Unsubscribe:** a `🔕` toggle on `/me` and on any event with an active topic.
- **Metrics:** opt-in rate per prompt; push → open rate (target ≥ 10%); unsubscribes.

---

## 7. What NOT to do

- **No login-gated anything:** no "Sign in to save", no "For you" personalisation needing Spotify scopes, no comments or "friends going". Spotify Dev Mode allows only 5 users. Everything here works logged-out.
- **No D-082 violations:**
  - no song or minute counts, durations, "N of M artists found" or "matches the show" (including on OG and story cards);
  - no explanatory sentences, onboarding carousels, coach-mark tours or "How it works" walls on the home page beyond the existing small-catalogue fallback;
  - never "no login needed".
- **No paid services:** no OneSignal or Braze paid tiers, Vercel Speed Insights or Analytics beyond the free quota, Cloudinary, image CDNs, SMS or WhatsApp Business API, or a custom domain purchase. Keep `tixtape.vercel.app`.
- **No re-hosting posters or artist photos** unless OD-1 approves compositing into share images.
- **No email capture** for reminders. It's PII and a mailbox to run. Use calendar and push instead.
- **No Spotify calls from new UI features:** no embed-preview fetching, no "recognise" calls on page load, no follower counts. Similar-artist data comes from Last.fm (OD-8). The existing live-lookup recognition (D-050/D-057) stays as is.
- **No pull-to-refresh, infinite scroll on home, autoplay audio or video, or haptics on scroll.**
- **No `loading.tsx` on `/events/[id]`.** It breaks the 404 (QA-UI-1). Use the client shell (#3).
- **No dark patterns:** no fake urgency ("only 3 left"), no auto-opening the install or push prompt, no pre-checked opt-ins.
- **No new heavy dependencies** (Workbox, Lottie, a gesture lib). `motion` is already in, and everything else is hand-written.

## 8. Owner decisions

| ID   | Decision                                                                                                                                                                                                                           | Recommendation                                                                         | Blocks  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------- |
| OD-1 | OG and story images: **typographic only**, or composite the official poster and Spotify artist photos (a derived re-host, outside D-082's "hotlink only")? Also the story's default sticker: "I'm going 🎟️" or "Who's coming? 👀". | Typographic now; revisit after measuring share rate. Default sticker: "I'm going 🎟️".  | #1, #4  |
| OD-2 | Build web push (first per-device identifier; iOS needs install)?                                                                                                                                                                   | Yes, after #14 ships and installs are measured. Calendar (#2) covers most needs first. | #15     |
| OD-3 | Spotify embed player (`open.spotify.com/embed`) on the event page? It previews songs for logged-out users, but it's a heavy iframe (~500 KB+) and Spotify-branded.                                                                 | No for now. Maybe tap-to-load later ("▶ Peek").                                        | (none)  |
| OD-4 | New aggregate table `ux_counters(day, kind, count)` for measuring these changes (D-081 style, no PII).                                                                                                                             | Yes. Nothing else here can be measured without it.                                     | metrics |
| OD-5 | When the best source isn't a ticket seller: show `ℹ️ Info ↗` or hide the button?                                                                                                                                                   | `ℹ️ Info ↗`.                                                                           | #5, #13 |
| OD-6 | Event-page rundown: keep the inline carousel, or collapse it to a `▶ Rundown` ring?                                                                                                                                                | Collapse it to a ring.                                                                 | #5      |
| OD-7 | Amend D-079: don't repeat hero "Next up" events in rings or Near you.                                                                                                                                                              | Yes.                                                                                   | #6      |
| OD-8 | Add a Last.fm `artist.getSimilar` call (cached 7 days) for zero-result discovery.                                                                                                                                                  | Yes. Free, and Last.fm is already in the stack.                                        | #7      |
| OD-9 | Saved shows: a home row only, or a dedicated `/me` page as well?                                                                                                                                                                   | A home row first; `/me` when ≥ 5% of visitors save.                                    | #12     |

## 9. Sources

- [Meta: WhatsApp link previews (og:image < 600 KB, ≥ 300 px, ≤ 4:1)](https://developers.facebook.com/documentation/business-messaging/whatsapp/link-previews/)
- [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/?p=13878) · [WebKit: Meet Declarative Web Push](https://webkit.org/?p=16535) · [OneSignal: web push for iOS](https://documentation.onesignal.com/docs/web-push-for-ios) · [firt.dev: iOS PWA compatibility](https://firt.dev/notes/pwa-ios/)
- [web.dev: How to share files](https://web.dev/articles/files/share-files?hl=en) · [MDN: navigator.share](https://developer.mozilla.org/nl/docs/Web/API/Navigator/share)
- [Chrome: cross-document view transitions](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document) · [caniuse: cross-document view transitions](https://caniuse.com/cross-document-view-)
- [Software Mansion: haptic feedback on the web](https://swmansion.com/blog/haptic-feedback-on-the-web-why-the-web-deliberately-refuses-to-be-as-tactile-as-native-apps) · [ios-haptics README](https://unpkg.com/ios-haptics@3.1.1/README.md) · [caniuse: navigator.vibrate](https://caniuse.com/mdn-api_navigator_vibrate)
- [Pratt IxD: DICE design critique (2025)](https://ixd.prattsi.org/2025/02/design-critique-dice/) · [Pratt IxD: DICE iOS critique (2026)](https://ixd.prattsi.org/2026/02/design-critique-dice-ios-app/) · [DICE: waiting list](https://dice.fm/blog/identify-fan-demand-with-the-waiting-list?lng=en-CA) · [Screens Design: DICE showcase](https://screensdesign.com/showcase/dice-live-shows)
- [NoGood: Partiful marketing strategy](https://nogood.io/blog/partiful-marketing-strategy/) · [CNBC via NBC: Meet Partiful](https://www.nbcnewyork.com/news/business/money-report/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple/6231135/?amp=1)
- [Spotify newsroom: 2025 Wrapped](https://newsroom.spotify.com/media-kit/2025-wrapped) · [It's Nice That: Wrapped 2023 identity](https://www.itsnicethat.com/features/spotify-wrapped-campaign-identity-2023-graphic-design-301123) · [UX Collective: What's happened to Spotify Wrapped](https://uxdesign.cc/whats-happened-to-spotify-wrapped-cdfc32bf56a7)
- [Android Authority: Bandsintown and Songkick notifications](https://www.androidauthority.com/bandsintown-songkick-concert-notifications-3492068/) · [Songkick: track artists](https://www.songkick.com/about)
- [Inc42: District app launch](https://inc42.com/buzz/zomato-rolls-out-district-app-for-android-iphone-users) · [Eternal: District](https://eternal.com/our-businesses/district)

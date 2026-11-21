# Search flow: from the first keystroke to the playlist (D-048)

This is the user's journey, step by step. Every state listed here must exist in the UI and be covered by an E2E test.

## A. Before typing (focus, empty box)

- Show the recommendation sections immediately (D-047): Trending, This weekend, Near you, For you, Popular searches, plus Recent searches (local).
- Prefetch the zero-query response when the page loads, so focusing the box shows results with no spinner.
- On phone, tapping the box opens a full-screen search sheet. The device back button closes the sheet; it doesn't leave the page.

## B. While typing

| Moment                              | What the user sees                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1st character                       | Recommendations stay visible, plus a quiet hint: "Keep typing…". No request is sent.                                           |
| 2+ characters, within 50ms          | **Instant local results:** recent searches and cached recommendations filtered by prefix, so something always appears at once. |
| After ~150ms pause                  | Server request (debounced). The previous results stay on screen, slightly dimmed. **No flicker** and no blank list.            |
| Request slower than 300ms           | A small spinner in the box, and `aria-busy`. The old results stay.                                                             |
| Results arrive                      | They replace the list without the layout jumping. Groups appear in order: **Artists**, **Cities**, **Events**.                 |
| Fast typing                         | Older requests are cancelled, so results for an older query are never shown.                                                   |
| Top result is a strong prefix match | **Ghost autocomplete** in the box (lolla → lolla*palooza india 2027*). Tab or → accepts it.                                    |
| Filters understood                  | Chips appear above the results: 📍 Pune, 📅 This weekend, 🎪 Festivals. Each chip has an × to remove it.                       |
| No match                            | "No Coldplay shows yet", then "Did you mean …?" and fallback events. Never a blank dead end.                                   |
| Error or offline                    | "Search isn't responding, retrying…" with one automatic retry, then a Retry button. Offline: "You're offline".                 |
| Clear                               | An × button clears the text and returns to the recommendations. Esc clears first, and a second Esc closes.                     |

Each row also shows **why** it matched: "Ritviz plays here", "in Mumbai", "Did you mean Diljit?".

Keyboard: ↑ and ↓ move through all groups, Enter opens the highlighted row. Enter with **nothing highlighted** opens the full results page `/search?q=…`. It doesn't silently pick the first item.

Logging (D-047) happens only when a query is **committed** (a result is opened, or Enter is pressed), never on every keystroke.

## C. After clicking a result

| Clicked                         | Where it goes                                                                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Event**                       | `/events/:id`. **Prefetch on hover or arrow focus** so it opens instantly. The title, date and city from the suggestion show at once while the rest loads. |
| **Artist with 1 upcoming show** | That event page. The artist is **highlighted in the lineup** (scrolled into view with a glow).                                                             |
| **Artist with 2+ shows**        | `/search?artist=<name>`, a list of their upcoming shows.                                                                                                   |
| **City**                        | `/search?city=Pune`, upcoming shows there, with date chips (This weekend, This month).                                                                     |
| **Popular-search chip**         | Fills the box and runs the search.                                                                                                                         |
| **Enter with no selection**     | `/search?q=…`, the full results page: same engine, paginated, same groups and filters.                                                                     |

The chosen query is saved to Recent searches. `POST /api/search/click` is fired (fire-and-forget).

**Back button:** returns to where the user was, with the query and results restored. The URL keeps `?q=`, so a refresh or a shared link reproduces the same search.

## D. On the event page: the playlist button (D-036)

The button's state comes from `GET /api/events/:id/playlist`:

| State                                | Button                                                  | Details                                                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ready`                              | **Open in Spotify** (primary), plus Copy link and Share | "265 songs · updated 21 Nov · by Lineup Mixes"                                                                                                                                                                 |
| `none`                               | **Make playlist**                                       | On click, a live progress bar that names each stage: "Matching artists 8/13" → "Picking songs" → "Creating playlist" → "Adding songs 100/265". On finish, confetti and the button becomes **Open in Spotify**. |
| `building` (started by someone else) | Joins the same progress                                 | No duplicate build.                                                                                                                                                                                            |
| `ready` + `stale` (lineup changed)   | **Open in Spotify**                                     | "Lineup updated, refreshing playlist…" and an automatic rebuild into the same playlist.                                                                                                                        |
| `partial`                            | **Open in Spotify**                                     | "2 artists aren't on Spotify, so they were skipped" (names listed).                                                                                                                                            |
| `paused`                             | (none)                                                  | "Spotify asked us to slow down, continuing at 6:40 pm". The page keeps polling.                                                                                                                                |
| `unavailable` (publisher problem)    | (none)                                                  | "Playlist making is temporarily unavailable. Try again later."                                                                                                                                                 |

Leaving the page mid-build is fine: the build continues on the next visit or through the scheduled sweep, and returning shows the current progress.

`POST /api/events/:id/view` fires once per visit, and **Open in Spotify** counts as a playlist open (D-047).

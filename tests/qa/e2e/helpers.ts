import {
  test as base,
  expect,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import postgres from "postgres";

/** Fixture titles (tests/e2e/fixtures/seed.ts, D-049). Ids change on every run, so look them up. */
export const LOLLA_TITLE = "Lollapalooza India 2027";
export const NH7_TITLE = "NH7 Weekender Pune";
export const DILJIT_TITLE = "Diljit Dosanjh Live in Bengaluru";

export const E2E_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgres://app:app@127.0.0.1:54329/concert_e2e";

const idCache = new Map<string, string>();

/** Finds a published event's id by its exact title through the public list API. */
export async function eventId(request: APIRequestContext, title: string): Promise<string> {
  const hit = idCache.get(title);
  if (hit) return hit;
  const res = await request.get(`/api/events?q=${encodeURIComponent(title)}`);
  expect(res.status(), `GET /api/events?q=${title}`).toBe(200);
  const body = (await res.json()) as { events: { id: string; title: string }[] };
  const ev = body.events.find((e) => e.title === title);
  expect(ev, `fixture "${title}" not found`).toBeTruthy();
  idCache.set(title, ev!.id);
  return ev!.id;
}

/** Direct access to the E2E database (concert_e2e only) for hidden/ready fixtures. */
export function e2eDb() {
  return postgres(E2E_DATABASE_URL, { max: 1, onnotice: () => {} });
}

/**
 * Every test gets a default stub for the live lookup, so the dev server never calls real
 * Spotify, Wikipedia, Ticketmaster or OpenAI from a test. Tests that need a specific lookup
 * answer register their own route, which takes precedence.
 */
export const test = base.extend<{ lookupStub: void }>({
  lookupStub: [
    async ({ page }, use) => {
      await page.route("**/api/lookup**", (r) =>
        r.fulfill({ status: 200, contentType: "application/json", body: '{"status":"not_found"}' }),
      );
      // The admin login URL redirects to Spotify's authorize page: never load the real one.
      await page.route(/accounts\.spotify\.com/, (r) =>
        r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Spotify login (stub)</h1>" }),
      );
      await use();
    },
    { auto: true },
  ],
});
export { expect };

/** Collects console errors, uncaught page errors and 4xx/5xx responses during a flow. */
export function watch(
  page: Page,
  opts: {
    allowStatus?: (url: string, status: number) => boolean;
    allowConsole?: RegExp;
  } = {},
) {
  const problems: string[] = [];
  page.on("console", (m) => {
    const text = m.text();
    if (opts.allowConsole?.test(text)) return;
    if (m.type() === "error") problems.push(`console.error: ${text.slice(0, 300)}`);
    if (m.type() === "warning" && /key|hydrat/i.test(text))
      problems.push(`console.warn: ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 300)}`));
  page.on("response", (r) => {
    const s = r.status();
    if (s >= 400 && !(opts.allowStatus?.(r.url(), s) ?? false))
      problems.push(`HTTP ${s} ${r.request().method()} ${r.url()}`);
  });
  return {
    problems,
    assertClean() {
      expect(problems, problems.join("\n")).toEqual([]);
    },
  };
}

export function search(page: Page) {
  return page
    .getByRole("combobox", { name: /search|festival|gig/i })
    .or(page.getByRole("combobox"))
    .first();
}

export function options(page: Page) {
  return page.getByRole("listbox").getByRole("option");
}

/** Options inside one result group ("Artists", "Cities", "Events"). */
export function groupOptions(page: Page, group: RegExp) {
  return page.getByRole("listbox").getByRole("group", { name: group }).getByRole("option");
}

export async function shot(page: Page, info: TestInfo, name: string, fullPage = false) {
  await page.screenshot({
    path: `tests/qa/e2e/screenshots/${info.project.name}-${name}.png`,
    fullPage,
  });
}

/** Final-pass screenshots for the exploratory report. */
export async function finalShot(page: Page, info: TestInfo, name: string, fullPage = true) {
  await page.screenshot({
    path: `tests/qa/e2e/screenshots/final/${info.project.name}-${name}.png`,
    fullPage,
  });
}

/** Waits until client JS is hydrated; dev-mode HMR can keep the network busy. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

export async function gotoHome(page: Page) {
  await page.goto("/");
  await expect(search(page)).toBeVisible();
  await settle(page);
}

/**
 * Focuses the search box. On a phone, tapping it opens the full-screen search sheet, whose
 * own input becomes the active combobox.
 */
export async function openSearch(page: Page) {
  await search(page).click();
  await expect(search(page)).toBeFocused();
}

export async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw, `scrollWidth ${sw} > clientWidth ${cw}`).toBeLessThanOrEqual(cw);
}

/** Visible, focusable controls smaller than `min` px in either dimension. */
export async function smallTapTargets(page: Page, min = 44) {
  return page.evaluate(
    (m) =>
      [...document.querySelectorAll("a[href], button, input, [role=option]")]
        .filter((e) => {
          const r = e.getBoundingClientRect();
          const st = getComputedStyle(e);
          return (
            r.width > 0 &&
            r.height > 0 &&
            st.visibility !== "hidden" &&
            e.getAttribute("tabindex") !== "-1" &&
            !e.closest("[aria-hidden=true]") &&
            // inline links inside running text are exempt (WCAG 2.5.8 "inline" exception)
            !(e.tagName === "A" && e.closest("p") && getComputedStyle(e).display === "inline")
          );
        })
        .map((e) => ({
          t: ((e as HTMLElement).innerText || e.getAttribute("aria-label") || e.tagName)
            .slice(0, 30)
            .replace(/\n/g, " "),
          h: Math.round(e.getBoundingClientRect().height),
          w: Math.round(e.getBoundingClientRect().width),
        }))
        .filter((x) => x.h < m || x.w < m),
    min,
  );
}

export async function clippedText(page: Page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main h1, main h2, main h3, main p, main a, main button, main li span",
      ),
    ]
      .filter((e) => {
        const el = e as HTMLElement;
        const st = getComputedStyle(el);
        if (el.closest("[aria-hidden=true]") || st.overflow === "visible") return false;
        if (el.getBoundingClientRect().width <= 1 || st.clip !== "auto" || st.clipPath !== "none")
          return false; // screen-reader-only text
        return el.scrollWidth > el.clientWidth + 1 && st.textOverflow !== "ellipsis";
      })
      .map((e) => (e as HTMLElement).innerText.slice(0, 40)),
  );
}

export const JSON_HEADERS = { "content-type": "application/json" };

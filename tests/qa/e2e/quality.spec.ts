/**
 * Phone (Pixel 7) and desktop, light and dark, reduced motion, keyboard only:
 * no horizontal scroll, no clipped text, tap targets >= 44px, no console errors, no 4xx/5xx.
 */
import type { Page } from "@playwright/test";
import {
  LOLLA_TITLE,
  clippedText,
  eventId,
  expect,
  finalShot,
  noHorizontalScroll,
  openSearch,
  search,
  settle,
  smallTapTargets,
  test,
  watch,
} from "./helpers";

const PAGES = ["home", "home-search-open", "event", "search-city", "search-q"] as const;
type P = (typeof PAGES)[number];

async function open(page: Page, p: P) {
  const lolla = await eventId(page.request, LOLLA_TITLE);
  const path = {
    home: "/",
    "home-search-open": "/",
    event: `/events/${lolla}`,
    "search-city": "/search?city=Pune",
    "search-q": "/search?q=lolla",
  }[p];
  await page.goto(path);
  await settle(page);
  if (p === "home-search-open") {
    await openSearch(page);
    await search(page).pressSequentially("diljit", { delay: 30 });
    await expect(page.getByRole("option").first()).toBeVisible();
  }
}

for (const scheme of ["light", "dark"] as const) {
  for (const p of PAGES) {
    test(`${scheme} · ${p}: no h-scroll, no clipped text, no console errors or 4xx/5xx`, async ({
      page,
    }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      const w = watch(page);
      await open(page, p);
      await finalShot(page, info, `${scheme}-${p}`, p !== "home-search-open");
      await noHorizontalScroll(page);
      expect(await clippedText(page)).toEqual([]);
      w.assertClean();
    });
  }
}

for (const p of PAGES) {
  test(`tap targets >= 44px · ${p}`, async ({ page }) => {
    await open(page, p);
    const small = await smallTapTargets(page, 44);
    expect(small, JSON.stringify(small)).toEqual([]);
  });
}

test("reduced motion: event page and search show everything, nothing stuck mid-animation", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "event");
  await finalShot(page, info, "reduced-motion-event");
  const faded = await page
    .locator("main h1, main h2, main li, main button, main a")
    .evaluateAll((els) =>
      els
        .filter(
          (e) =>
            !e.closest("[aria-hidden=true]") &&
            !(e as HTMLButtonElement).disabled &&
            e.getBoundingClientRect().height > 0,
        )
        .filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.9)
        .map((e) => (e as HTMLElement).innerText.slice(0, 30)),
    );
  expect(faded).toEqual([]);
  const animated = await page.evaluate(
    () =>
      document
        .getAnimations()
        .filter(
          (a) => a.playState === "running" && (a.effect?.getTiming().iterations ?? 1) === Infinity,
        ).length,
  );
  expect(animated, "infinite animations still running under reduced motion").toBe(0);
});

test("keyboard only: / focuses search, arrows + Enter open an event, Tab reaches the playlist button", async ({
  page,
}, info) => {
  test.skip(info.project.name === "phone", "keyboard journey is a desktop concern");
  const w = watch(page, {
    allowStatus: (u, s) => /\/playlist$/.test(u) && (s === 422 || s === 503),
    allowConsole: /status of (422|503)/,
  });
  await page.goto("/");
  await settle(page);
  await page.keyboard.press("/");
  await expect(search(page)).toBeFocused();
  await page.keyboard.type("lolla", { delay: 40 });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/events\//);
  await settle(page);
  let reached = "";
  for (let i = 0; i < 40 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const e = document.activeElement as HTMLElement;
      const st = getComputedStyle(e);
      const visible =
        (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) || st.boxShadow !== "none";
      return /make playlist|open in spotify/i.test(e.innerText ?? "")
        ? visible
          ? "visible"
          : "invisible"
        : "";
    });
  }
  expect(reached).toBe("visible");
  await page.keyboard.press("Enter");
  await expect(page.locator("#playlist")).toContainText(/unavailable|opens soon|try again later/i);
  w.assertClean();
});

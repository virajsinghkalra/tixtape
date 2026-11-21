/**
 * Single-artist layouts (UI fix after D-077): story slide plan (solo 2, duo/trio 3, festival 5),
 * progress-bar count = slides, singular playlist copy, no horizontal scroll at 390px.
 */
import type { Page } from "@playwright/test";
import {
  DILJIT_TITLE,
  LOLLA_TITLE,
  NH7_TITLE,
  eventId,
  expect,
  finalShot,
  noHorizontalScroll,
  settle,
  test,
  watch,
} from "./helpers";

async function story(page: Page) {
  // the story is the carousel whose slides are labelled "1/N: …"
  return page.evaluate(() => {
    const slides = [...document.querySelectorAll("li[aria-label]")].filter((l) =>
      /^\d+\/\d+:/.test(l.getAttribute("aria-label") ?? ""),
    );
    const declared = Number(
      /^\d+\/(\d+):/.exec(slides[0]?.getAttribute("aria-label") ?? "")?.[1] ?? NaN,
    );
    const root = slides[0]?.closest("section") ?? document.body;
    // progress segments: the largest group of thin (≤ 8 px tall) siblings in the story
    let bars = 0;
    for (const el of root.querySelectorAll("*")) {
      const kids = [...el.children].filter((c) => {
        const b = c.getBoundingClientRect();
        return b.height > 0 && b.height <= 8 && b.width > 10;
      });
      if (kids.length >= 2 && kids.length === el.children.length)
        bars = Math.max(bars, kids.length);
    }
    return { declared, slides: slides.length, bars };
  });
}

for (const [title, kind, expected] of [
  [DILJIT_TITLE, "solo", 2],
  [LOLLA_TITLE, "festival", 5],
  [NH7_TITLE, "festival", 5],
] as const) {
  test(`${kind} (${title.split(" ")[0]}): story has ${expected} slides and as many progress bars`, async ({
    page,
  }, info) => {
    const w = watch(page);
    await page.goto(`/events/${await eventId(page.request, title)}`);
    await settle(page);
    await finalShot(page, info, `story-${kind}-${title.split(" ")[0]}`);
    const s = await story(page);
    expect(s.declared, JSON.stringify(s)).toBe(expected);
    expect(s.slides, JSON.stringify(s)).toBe(expected);
    expect(s.bars, `progress bars vs slides ${JSON.stringify(s)}`).toBe(expected);
    w.assertClean();
  });
}

test("solo show: playlist copy is singular (no 'each', no 'openers last', no 'headliners first')", async ({
  page,
}) => {
  await page.goto(`/events/${await eventId(page.request, DILJIT_TITLE)}`);
  await settle(page);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  expect(text).not.toMatch(/\beach\b/i);
  expect(text).not.toMatch(/openers last/i);
  expect(text).not.toMatch(/headliners first/i);
  expect(text).not.toMatch(/\b1 artists\b/i);
  expect(text).not.toMatch(/sub-headliners|mid-card|support\b/i);
});

for (const path of ["home", "solo", "festival"] as const) {
  test(`390px: no horizontal scroll (${path})`, async ({ page }, info) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const url =
      path === "home"
        ? "/"
        : `/events/${await eventId(page.request, path === "solo" ? DILJIT_TITLE : LOLLA_TITLE)}`;
    await page.goto(url);
    await settle(page);
    await page.waitForTimeout(1500); // let the marquee/carousel run
    await finalShot(page, info, `w390-${path}`);
    await noHorizontalScroll(page);
    const wide = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(wide).toBeLessThanOrEqual(390);
  });
}

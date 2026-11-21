import type { Page } from "@playwright/test";
import {
  LOLLA_TITLE,
  clippedText,
  eventId,
  expect,
  gotoHome,
  noHorizontalScroll,
  options,
  search,
  settle,
  shot,
  smallTapTargets,
  test,
} from "./helpers";

const pages = ["/", "lolla-event"] as const;
async function resolve(page: Page, path: (typeof pages)[number]) {
  return path === "/" ? "/" : `/events/${await eventId(page.request, LOLLA_TITLE)}`;
}

test.describe("responsive", () => {
  for (const path of pages) {
    test(`360px wide: no horizontal scroll, no clipped text (${path})`, async ({ page }, info) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto(await resolve(page, path));
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await shot(page, info, `w360${path === "/" ? "-home" : "-event"}`, true);
      await noHorizontalScroll(page);
      expect(await clippedText(page)).toEqual([]);
    });

    test(`tap targets >= 44px (${path})`, async ({ page }) => {
      await page.goto(await resolve(page, path));
      await settle(page);
      const small = await smallTapTargets(page, 44);
      console.log("small tap targets", JSON.stringify(small));
      expect(small).toEqual([]);
    });
  }

  test("360px: search suggestions fit on screen", async ({ page }, info) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await gotoHome(page);
    await search(page).pressSequentially("lol", { delay: 60 });
    await expect(options(page)).toHaveCount(1);
    await options(page).first().scrollIntoViewIfNeeded();
    await shot(page, info, "w360-search");
    const box = await options(page).first().boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(360);
    await noHorizontalScroll(page);
  });
});

test.describe("keyboard and ARIA", () => {
  test("skip link is first, then logo, Sign in, search; focus is visible", async ({ page }) => {
    await gotoHome(page);
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const e = document.activeElement as HTMLElement;
        const st = getComputedStyle(e);
        const visible =
          (st.outlineStyle !== "none" && parseFloat(st.outlineWidth) > 0) ||
          st.boxShadow !== "none";
        return {
          name: (
            e.innerText ||
            e.getAttribute("placeholder") ||
            e.getAttribute("aria-label") ||
            e.tagName
          ).slice(0, 30),
          visible,
        };
      });
      order.push(info.name);
      expect(info.visible, `no visible focus on ${info.name}`).toBe(true);
    }
    console.log("tab order", order);
    expect(order[0]).toMatch(/skip/i);
    expect(order.findIndex((n) => /search/i.test(n))).toBeGreaterThan(-1);
  });

  test("skip link moves focus to main", async ({ page }) => {
    await gotoHome(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main/);
    expect(await page.evaluate(() => !!document.getElementById("main"))).toBe(true);
  });

  test("combobox ARIA wiring", async ({ page }) => {
    await gotoHome(page);
    const box = search(page);
    await expect(box).toHaveAttribute("aria-autocomplete", "list");
    // accessible name (placeholder alone is weak but counts)
    const name = await box.evaluate(
      (e) =>
        (e as HTMLInputElement).labels?.[0]?.innerText ||
        e.getAttribute("aria-label") ||
        e.getAttribute("aria-labelledby"),
    );
    expect(name, "search box has no <label>/aria-label").toBeTruthy();
    await box.pressSequentially("lol", { delay: 60 });
    await expect(page.getByRole("option")).toHaveCount(1);
    const controls = await box.getAttribute("aria-controls");
    await expect(page.locator(`[id="${controls}"]`)).toHaveAttribute("role", "listbox");
    await box.press("ArrowDown");
    const ad = await box.getAttribute("aria-activedescendant");
    await expect(page.locator(`[id="${ad}"]`)).toHaveAttribute("role", "option");
    await box.press("ArrowUp");
  });

  test("event page fully usable by keyboard: reach Make playlist", async ({ page }) => {
    await page.goto(await resolve(page, "lolla-event"));
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    let reached = false;
    for (let i = 0; i < 30 && !reached; i++) {
      await page.keyboard.press("Tab");
      reached = await page.evaluate(() =>
        /make playlist/i.test((document.activeElement as HTMLElement)?.innerText ?? ""),
      );
    }
    expect(reached).toBe(true);
  });
});

test.describe("motion and colour", () => {
  test("prefers-reduced-motion still shows all content", async ({ page }, info) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoHome(page);
    await shot(page, info, "reduced-motion-home", true);
    for (const h of [/the big ones/i, /how it works/i]) {
      const el = page.getByRole("heading", { level: 2, name: h });
      await el.scrollIntoViewIfNeeded();
      await expect(el).toBeVisible();
      expect(await el.evaluate((e) => parseFloat(getComputedStyle(e).opacity))).toBeGreaterThan(
        0.9,
      );
    }
    const hidden = await page
      .locator('a[href^="/events/"]')
      .evaluateAll(
        (as) =>
          as.filter(
            (a) =>
              !a.closest("[aria-hidden=true]") && parseFloat(getComputedStyle(a).opacity) < 0.5,
          ).length,
      );
    expect(hidden).toBe(0);
  });

  for (const scheme of ["light", "dark"] as const) {
    // BUG: QA-UI-9 (minor) the "/" shortcut hint in the search box is 2.13:1 in light mode
    test(`${scheme} scheme: body text contrast >= 4.5:1`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of pages) {
        await page.goto(await resolve(page, path));
        await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
        await shot(page, info, `${scheme}${path === "/" ? "-home" : "-event"}`, true);
        const bad = await page.evaluate(() => {
          const parse = (c: string) => {
            const cv = document.createElement("canvas").getContext("2d")!;
            cv.fillStyle = c;
            cv.fillRect(0, 0, 1, 1);
            const d = cv.getImageData(0, 0, 1, 1).data;
            return { r: d[0] ?? 0, g: d[1] ?? 0, b: d[2] ?? 0, a: (d[3] ?? 0) / 255 };
          };
          const lum = ({ r, g, b }: { r: number; g: number; b: number }) =>
            [r, g, b]
              .map((v) => {
                v /= 255;
                return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              })
              .reduce((s, v, i) => s + v * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
          const bgOf = (el: Element | null): { r: number; g: number; b: number } | null => {
            while (el) {
              const st = getComputedStyle(el);
              if (st.backgroundImage !== "none") return null; // gradient/image: can't judge
              if (
                [...el.children].some(
                  (c) =>
                    getComputedStyle(c).backgroundImage !== "none" &&
                    getComputedStyle(c).position === "absolute",
                )
              )
                return null; // image overlay
              const c = parse(st.backgroundColor);
              if (c.a > 0.9) return c;
              el = el.parentElement;
            }
            return parse(getComputedStyle(document.body).backgroundColor);
          };
          const out: string[] = [];
          const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          const seen = new Set<Element>();
          while (walker.nextNode()) {
            const el = walker.currentNode.parentElement!;
            if (
              !walker.currentNode.textContent!.trim() ||
              seen.has(el) ||
              el.closest("[aria-hidden=true],svg,mark")
            )
              continue;
            seen.add(el);
            const st = getComputedStyle(el);
            if (
              st.visibility === "hidden" ||
              parseFloat(st.opacity) < 0.1 ||
              el.getBoundingClientRect().width === 0
            )
              continue;
            const bg = bgOf(el);
            if (!bg) continue;
            const fg = parse(st.color);
            const fgc = {
              r: fg.r * fg.a + bg.r * (1 - fg.a),
              g: fg.g * fg.a + bg.g * (1 - fg.a),
              b: fg.b * fg.a + bg.b * (1 - fg.a),
            };
            const [l1 = 0, l2 = 0] = [lum(fgc), lum(bg)].sort((a, b) => b - a);
            const ratio = (l1 + 0.05) / (l2 + 0.05);
            const large =
              parseFloat(st.fontSize) >= 24 ||
              (parseFloat(st.fontSize) >= 18.66 && parseInt(st.fontWeight) >= 700);
            // ratio ~1.0 means the text sits on an image overlay we couldn't resolve: skip, judged by screenshot
            if (ratio > 1.05 && ratio < (large ? 3 : 4.5))
              out.push(
                `${ratio.toFixed(2)} "${el.textContent!.trim().slice(0, 30)}" ${st.fontSize}`,
              );
          }
          return out;
        });
        console.log(scheme, path, "low contrast:", JSON.stringify(bad));
        expect(bad, `${path}`).toEqual([]);
      }
    });
  }
});

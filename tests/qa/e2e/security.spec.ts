/**
 * D-070 security headers and CSP; bad input on public endpoints (D-018 strict bodies).
 * Lookup inputs here are all invalid, so they're rejected before any third party is called.
 */
import type { Page } from "@playwright/test";
import {
  LOLLA_TITLE,
  eventId,
  expect,
  gotoHome,
  openSearch,
  search,
  settle,
  test,
  watch,
} from "./helpers";

async function cspWatch(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) =>
      w.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const consoleCsp: string[] = [];
  page.on("console", (m) => /content security policy/i.test(m.text()) && consoleCsp.push(m.text()));
  return async () => {
    const dom = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp ?? []);
    expect([...dom, ...consoleCsp], "CSP violations").toEqual([]);
  };
}

test("security headers on pages and APIs", async ({ request }) => {
  const lolla = await eventId(request, LOLLA_TITLE);
  for (const p of ["/", `/events/${lolla}`, "/search?q=lolla", "/api/events/suggest?q=lolla"]) {
    const h = (await request.get(p)).headers();
    expect(h["content-security-policy"], p).toBeTruthy();
    expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
    expect(h["content-security-policy"]).toMatch(/object-src 'none'/);
    expect(h["x-content-type-options"], p).toBe("nosniff");
    expect(h["referrer-policy"], p).toBeTruthy();
    expect(h["x-powered-by"], p).toBeUndefined();
  }
});

test("CSP doesn't break client JS: full journey with no violations", async ({ page }) => {
  const check = await cspWatch(page);
  const w = watch(page, {
    allowStatus: (u, s) => /\/playlist$/.test(u) && s === 422,
    allowConsole: /status of 422/,
  });
  await gotoHome(page);
  await openSearch(page);
  await search(page).pressSequentially("lolla", { delay: 40 });
  await expect(page.getByRole("option").first()).toBeVisible();
  await page.getByRole("option").first().click();
  await expect(page).toHaveURL(/\/events\//);
  await settle(page);
  await page.getByRole("button", { name: /next slide/i }).click();
  await page.getByRole("button", { name: /make playlist/i }).click();
  await page.waitForTimeout(1500);
  await page.goto("/search?city=Pune");
  await settle(page);
  // BUG: QA-F-13 (low) every page reports a CSP violation "script-src eval": Zod v4 probes
  // `Function("")` for its JIT in chunk 161; harmless fallback, but a console error on every page.
  await check();
  w.assertClean();
});

test("XSS: HTML/script in the query is shown as text everywhere", async ({ page }) => {
  let dialog = false;
  page.on("dialog", async (d) => {
    dialog = true;
    await d.dismiss();
  });
  const payload = `<img src=x onerror=alert(1)><script>alert(2)</script>`;
  await page.goto(`/search?q=${encodeURIComponent(payload)}`);
  await settle(page);
  await page.goto(`/?q=${encodeURIComponent(payload)}`);
  await settle(page);
  await openSearch(page);
  await search(page).fill(`"><svg onload=alert(3)>`);
  await page.waitForTimeout(1500);
  expect(dialog).toBe(false);
  expect(await page.locator("img[src=x], svg[onload]").count()).toBe(0);
});

test("bad input on suggest/search: huge, unicode, emoji, SQL-ish answer 200/400, never 5xx", async ({
  request,
}) => {
  const qs = [
    "x".repeat(5000),
    "दिलजीत दोसांझ",
    "🎸🔥🎤",
    "' OR 1=1; DROP TABLE events;--",
    "%' UNION SELECT * FROM users --",
    "\\u0000\u0000null",
    "<script>",
    "  ",
    "%%%%",
  ];
  for (const q of qs) {
    for (const path of ["/api/events/suggest", "/api/search", "/api/events"]) {
      const r = await request.get(`${path}?q=${encodeURIComponent(q)}`);
      // BUG: QA-F-14 (low) a NUL byte in q makes GET /api/events answer 500
      expect([200, 400], `${path} q=${q.slice(0, 20)} → ${r.status()}`).toContain(r.status());
      const t = await r.text();
      expect(t).not.toMatch(/stack|postgres|syntax error|at .*\.ts:\d+/i);
    }
  }
  // the events table is still there
  expect((await (await request.get("/api/events")).json()).events.length).toBeGreaterThan(0);
});

test("bad input on POST endpoints: malformed JSON, unknown fields, out-of-range → 400; wrong method → 405", async ({
  request,
}) => {
  const lolla = await eventId(request, LOLLA_TITLE);
  const raw = (path: string, body: string) =>
    request.post(path, { data: body, headers: { "content-type": "application/json" } });
  const cases: [string, Promise<import("@playwright/test").APIResponse>, number[]][] = [
    ["lookup malformed", raw("/api/lookup", "{not json"), [400]],
    ["lookup unknown field", raw("/api/lookup", JSON.stringify({ q: "ab", evil: 1 })), [400]],
    ["lookup too short", raw("/api/lookup", JSON.stringify({ q: "a" })), [400]],
    ["lookup too long", raw("/api/lookup", JSON.stringify({ q: "y".repeat(101) })), [400]],
    ["lookup wrong type", raw("/api/lookup", JSON.stringify({ q: 42 })), [400]],
    ["lookup array", raw("/api/lookup", "[]"), [400]],
    ["click malformed", raw("/api/search/click", "{"), [400]],
    ["click unknown field", raw("/api/search/click", JSON.stringify({ zzz: 1 })), [400]],
    ["playlist malformed", raw(`/api/events/${lolla}/playlist`, "{"), [400]],
    [
      "playlist unknown field",
      raw(`/api/events/${lolla}/playlist`, JSON.stringify({ zzz: 1 })),
      [400],
    ],
    ["view bad id", raw("/api/events/not-a-uuid/view", "{}"), [404]],
    ["step bad id", raw("/api/playlist-jobs/not-a-uuid/step", "{}"), [404]],
  ];
  for (const [name, p, ok] of cases) {
    const r = await p;
    expect(ok, `${name} → ${r.status()} ${(await r.text()).slice(0, 120)}`).toContain(r.status());
  }
  const methods: [string, "put" | "delete" | "patch", number[]][] = [
    ["/api/events/suggest?q=lolla", "delete", [405]],
    [`/api/events/${lolla}`, "delete", [405]],
    [`/api/events/${lolla}/playlist`, "put", [405]],
    ["/api/lookup", "patch", [405]],
  ];
  for (const [path, m, ok] of methods) {
    const r = await request[m](path);
    expect(ok, `${m.toUpperCase()} ${path} → ${r.status()}`).toContain(r.status());
  }
  expect((await request.get("/api/lookup")).status()).toBe(405);
});

test("error responses never leak stack traces or internals", async ({ request }) => {
  for (const p of [
    "/api/events/00000000-0000-4000-8000-000000000000",
    "/api/events/abc",
    "/api/playlist-jobs/00000000-0000-4000-8000-000000000000",
    "/api/lookup/zzz",
  ]) {
    const r = await request.get(p);
    expect(r.status(), p).toBeLessThan(500);
    expect(await r.text(), p).not.toMatch(/stack|node_modules|at .*\.ts:\d+|postgres/i);
  }
});

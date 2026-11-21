/**
 * Admin console (D-012, D-075 "admin routes stay behind requireAdmin"): 404 pages and 401/403 APIs
 * without an admin session; usable with one. Sessions are inserted straight into concert_e2e.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { e2eDb, expect, finalShot, settle, test, watch } from "./helpers";

/** Admin is decided by ADMIN_SPOTIFY_USER_IDS (env), not the users.role column. */
const ADMIN_SPOTIFY_ID =
  /^ADMIN_SPOTIFY_USER_IDS=(.*)$/m
    .exec(readFileSync(".env", "utf8"))?.[1]
    ?.split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "") ?? "";

const PAGES = ["/admin", "/admin/events", "/admin/jobs", "/admin/artists"];
const APIS = [
  "/api/admin/events",
  "/api/admin/artists",
  "/api/admin/publisher",
  "/api/admin/playlist-jobs",
];

async function sessionFor(role: "user" | "admin"): Promise<{ cookie: string; userId: string }> {
  const sql = e2eDb();
  const raw = randomBytes(32).toString("base64url");
  const [u] = await sql<{ id: string }[]>`
    insert into users (spotify_user_id, display_name, role)
    values (${role === "admin" ? ADMIN_SPOTIFY_ID : "qa-user-" + raw.slice(0, 8)}, ${"QA " + role}, ${role})
    on conflict (spotify_user_id) do update set display_name = excluded.display_name
    returning id`;
  await sql`insert into sessions (id_hash, user_id, expires_at)
            values (${createHash("sha256").update(raw, "utf8").digest("hex")}, ${u!.id}, now() + interval '1 day')`;
  await sql.end();
  return { cookie: raw, userId: u!.id };
}

async function dropUser(userId: string) {
  const sql = e2eDb();
  await sql`delete from sessions where user_id = ${userId}`;
  await sql`delete from users where id = ${userId}`;
  await sql.end();
}

test("no session: every admin page is a plain 404, every admin API is 401", async ({ request }) => {
  const missing = await request.get("/this-page-does-not-exist-qa");
  expect(missing.status()).toBe(404);
  for (const p of PAGES) {
    const r = await request.get(p);
    expect(r.status(), p).toBe(404);
    expect(await r.text(), `${p} must not hint that an admin area exists`).not.toMatch(
      /admin only|sign in as admin|for admins/i,
    );
  }
  for (const a of APIS) {
    const r = await request.get(a);
    expect([401, 404], a).toContain(r.status());
    expect(await r.text()).not.toMatch(/stack|at .*\.ts:\d+/);
  }
});

test("signed-in non-admin: admin pages 404, admin APIs 403", async ({ page, baseURL }) => {
  const { cookie, userId } = await sessionFor("user");
  try {
    await page.context().addCookies([{ name: "session", value: cookie, url: baseURL! }]);
    for (const p of PAGES) expect((await page.request.get(p)).status(), p).toBe(404);
    for (const a of APIS) expect([403, 404], a).toContain((await page.request.get(a)).status());
  } finally {
    await dropUser(userId);
  }
});

test("admin session: console pages render, no console errors or CSP violations", async ({
  page,
  baseURL,
}, info) => {
  const { cookie, userId } = await sessionFor("admin");
  try {
    await page.context().addCookies([{ name: "session", value: cookie, url: baseURL! }]);
    const w = watch(page);
    for (const p of PAGES) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(200);
      await settle(page);
      await expect(page.locator("body")).not.toContainText(/undefined|NaN|\{"error"/);
      await finalShot(page, info, `admin${p.replace(/\//g, "-")}`);
    }
    expect((await page.request.get("/api/admin/events")).status()).toBe(200);
    w.assertClean();
  } finally {
    await dropUser(userId);
  }
});

test("an expired admin session is treated as no session", async ({ page, baseURL }) => {
  const { cookie, userId } = await sessionFor("admin");
  try {
    const sql = e2eDb();
    await sql`update sessions set expires_at = now() - interval '1 minute' where user_id = ${userId}`;
    await sql.end();
    await page.context().addCookies([{ name: "session", value: cookie, url: baseURL! }]);
    expect((await page.request.get("/admin")).status()).toBe(404);
    expect((await page.request.get("/api/admin/events")).status()).toBe(401);
  } finally {
    await dropUser(userId);
  }
});

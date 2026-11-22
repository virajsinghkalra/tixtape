/**
 * D-090: product analytics and opt-in identity for routes and admin pages. Kept out of
 * container.ts (Lead-owned, D-014) like `discovery.ts`: built lazily, once per process.
 *
 * Beacons answer at once; the work runs after the response (`after`), and a failure is only
 * logged. Nothing here logs a nickname, name or email (the logger also redacts them).
 */
import { after } from "next/server";
import {
  recordBeacon,
  saveContact,
  saveNickname,
  type ContactInput,
} from "@/application/analytics";
import type {
  AnalyticsDashboard,
  AnalyticsReadModel,
  SavedChanges,
  SyncedShow,
} from "@/application/ports/analytics";
import type { RateLimiter } from "@/application/ports/engagement";
import type { Beacon } from "@/domain/analytics/beacon";
import { demandCity } from "@/domain/gigs/demand";
import { PgAnalyticsDashboard } from "@/infrastructure/db/analytics-dashboard";
import { PgAnalyticsStore } from "@/infrastructure/db/analytics-store";
import { PgRateLimiter } from "@/infrastructure/db/pg-rate-limiter";
import { PgSavedShowsStore } from "@/infrastructure/db/saved-shows-store";
import { InMemoryRateLimiter } from "@/infrastructure/in-memory-rate-limiter";
import { env } from "@/lib/env";
import { RateLimitedError } from "@/lib/errors";
import { SITE_URL } from "@/lib/site";
import { clientKey } from "@/server/client-key";
import { container } from "@/server/container";
import { CITY_COOKIE, visitorCity } from "@/server/location";

/** Per client (IP, hashed): a busy tab sends a beacon every few seconds at most. */
const BEACON_LIMIT = { limit: 120, windowMs: 60_000 };
/** Nickname, email and delete: people do these once; this blunts scripted abuse. */
const IDENTITY_LIMIT = { limit: 10, windowMs: 60 * 60_000 };
/** D-092: saves, unsaves and one sync per session. */
const SAVED_LIMIT = { limit: 120, windowMs: 10 * 60_000 };

type Analytics = {
  store: PgAnalyticsStore;
  dashboard: AnalyticsReadModel;
  beaconLimiter: RateLimiter;
  identityLimiter: RateLimiter;
  saved: PgSavedShowsStore;
  savedLimiter: RateLimiter;
};

function limiter(name: string, cfg: { limit: number; windowMs: number }): RateLimiter {
  const secret = env().SESSION_SECRET;
  // D-070: shared across instances when the HMAC secret is configured (always on Vercel).
  return secret
    ? new PgRateLimiter(container().db, { name, ...cfg, keySecret: secret })
    : new InMemoryRateLimiter(cfg.limit, cfg.windowMs);
}

function build(): Analytics {
  const { db } = container();
  return {
    store: new PgAnalyticsStore(db),
    dashboard: new PgAnalyticsDashboard(db),
    beaconLimiter: limiter("analytics:beacon", BEACON_LIMIT),
    identityLimiter: limiter("analytics:identity", IDENTITY_LIMIT),
    saved: new PgSavedShowsStore(db),
    savedLimiter: limiter("analytics:saved", SAVED_LIMIT),
  };
}

const holder = globalThis as typeof globalThis & { __tixtapeAnalytics?: Analytics };
const analytics = () => (holder.__tixtapeAnalytics ??= build());

/** `DNT: 1` or `Sec-GPC: 1`: the browser asked not to be tracked. */
export function optedOut(req: Request): boolean {
  return req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1";
}

function cityOf(req: Request): string | null {
  const cookie = req.headers
    .get("cookie")
    ?.split(/;\s*/)
    .find((c) => c.startsWith(`${CITY_COOKIE}=`))
    ?.slice(CITY_COOKIE.length + 1);
  return demandCity(visitorCity({ headers: req.headers, cookie })?.city);
}

/** Records a validated beacon after the response. Bots, DNT/GPC and busy clients are dropped. */
export function acceptBeacon(req: Request, beacon: Beacon): void {
  const request = {
    beacon,
    userAgent: req.headers.get("user-agent"),
    optedOut: optedOut(req),
    clientKey: clientKey(req),
    city: cityOf(req),
    selfHost: new URL(SITE_URL).host,
  };
  const run = async () => {
    const c = container();
    const a = analytics();
    try {
      await recordBeacon(
        { store: a.store, limiter: a.beaconLimiter },
        { ...request, now: c.clock.now() },
      );
    } catch (e) {
      c.logger.warn({ err: e }, "analytics: failed to record a beacon");
    }
  };
  try {
    after(run);
  } catch {
    // Outside a request scope (tests): run inline.
    void run();
  }
}

async function guardIdentity(req: Request): Promise<void> {
  const a = analytics();
  if (!(await a.identityLimiter.take(clientKey(req), container().clock.now()))) {
    throw new RateLimitedError("Too many tries. Try again later.", 3600);
  }
}

export async function rememberNickname(
  req: Request,
  deviceId: string,
  nickname: string,
): Promise<void> {
  await guardIdentity(req);
  await saveNickname(analytics().store, deviceId, nickname, container().clock.now());
}

export async function rememberContact(
  req: Request,
  deviceId: string,
  input: ContactInput,
): Promise<void> {
  await guardIdentity(req);
  await saveContact(analytics().store, deviceId, input, container().clock.now());
}

/** What this device already told us (booleans only), so prompts never ask twice (D-090). */
export async function deviceIdentityStatus(
  req: Request,
  deviceId: string,
): Promise<{ hasNickname: boolean; hasEmail: boolean }> {
  await guardIdentity(req);
  return analytics().store.identityStatus(deviceId);
}

export async function forgetDevice(req: Request, deviceId: string): Promise<void> {
  await guardIdentity(req);
  await analytics().store.deleteDeviceData(deviceId);
}

/** Admin pages only (they call `requireAdminPage` first). */
export function analyticsDashboard(): Promise<AnalyticsDashboard> {
  return analytics().dashboard.dashboard(container().clock.now());
}

export function analyticsPerson(id: string) {
  return analytics().dashboard.person(id);
}

async function guardSaved(req: Request): Promise<void> {
  if (!(await analytics().savedLimiter.take(clientKey(req), container().clock.now()))) {
    throw new RateLimitedError("Too many tries. Try again later.", 600);
  }
}

/** D-092: this device's person's saved shows (empty and `synced: false` unless emailed). */
export async function savedShowsOf(
  req: Request,
  deviceId: string,
): Promise<{ synced: boolean; shows: SyncedShow[] }> {
  await guardSaved(req);
  return analytics().saved.list(deviceId);
}

export async function applySavedChanges(
  req: Request,
  deviceId: string,
  changes: SavedChanges,
): Promise<boolean> {
  await guardSaved(req);
  return analytics().saved.apply(deviceId, changes);
}

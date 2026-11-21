/**
 * D-090 use cases: record a beacon, save a nickname or a contact, delete a device's data.
 * Privacy rules live here so every entry point applies them the same way: bots, Do Not Track
 * and Global Privacy Control are dropped before anything is stored.
 */
import type { AnalyticsStore } from "@/application/ports/analytics";
import type { RateLimiter } from "@/application/ports/engagement";
import type { Beacon } from "@/domain/analytics/beacon";
import { isBotUserAgent } from "@/domain/analytics/bots";
import { CONSENT_VERSION, type ContactSource } from "@/domain/analytics/identity";
import { trafficSource } from "@/domain/analytics/source";

export type AnalyticsDeps = {
  store: AnalyticsStore;
  limiter: RateLimiter;
};

export type BeaconRequest = {
  beacon: Beacon;
  userAgent: string | null;
  /** `DNT: 1` or `Sec-GPC: 1` was sent. */
  optedOut: boolean;
  /** The rate-limit key (client IP); hashed by the limiter, never stored. */
  clientKey: string;
  city: string | null;
  selfHost: string | null;
  now: Date;
};

export type BeaconOutcome = "stored" | "bot" | "opted_out" | "limited";

export async function recordBeacon(deps: AnalyticsDeps, r: BeaconRequest): Promise<BeaconOutcome> {
  if (r.optedOut) return "opted_out";
  if (isBotUserAgent(r.userAgent)) return "bot";
  if (!(await deps.limiter.take(r.clientKey, r.now))) return "limited";
  await deps.store.record(
    {
      deviceId: r.beacon.did,
      source: trafficSource(r.beacon.src, r.selfHost),
      city: r.city,
      at: r.now,
    },
    r.beacon.ev,
  );
  return "stored";
}

export type ContactInput = {
  email: string;
  personName: string | null;
  source: ContactSource;
};

export function saveNickname(
  store: AnalyticsStore,
  deviceId: string,
  nickname: string,
  now: Date,
): Promise<void> {
  return store.setNickname(deviceId, nickname, now);
}

/** The caller has validated that consent was ticked; the current wording version is recorded. */
export function saveContact(
  store: AnalyticsStore,
  deviceId: string,
  input: ContactInput,
  now: Date,
) {
  return store.saveContact(deviceId, { ...input, consentVersion: CONSENT_VERSION }, now);
}

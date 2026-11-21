/**
 * Re-verification of auto-published gigs (D-074): every 3 days, re-read each future
 * auto-published night's official page and compare it with what was published.
 * - Page gone (404/410), or the show is cancelled or postponed → `held`, audit, alert.
 * - The night is no longer listed (the date changed) → `held`, audit, alert. The new date is
 *   an ordinary candidate from discovery and goes through the gate like any other night.
 * - Same night, different start time → re-run the gate on the new data: if it still passes,
 *   the event is updated in place (same night, same dedupe key) and audited `updated`;
 *   otherwise `held`, audit, alert.
 * - Unchanged → audited `reverified` (this also restarts its 3-day clock).
 * A transient failure (timeout, robots, 5xx) changes nothing; the next run tries again.
 */
import type { EventVerificationStore } from "@/application/ingestion/ports";
import type { Alerts } from "@/application/ports/alerts";
import type { Clock } from "@/application/ports/clock";
import { autoPublishDecision, type GateSource } from "@/domain/gigs/auto-publish";
import {
  extractArtistGigs,
  gigsFromJsonLd,
  jsonLdEvents,
  namesArtist,
} from "@/domain/gigs/extract";
import type { GigCandidate } from "@/domain/gigs/provenance";
import { toGateSource } from "@/domain/gigs/nights";
import { normalizeCity } from "@/domain/events/venue";
import type { EventId } from "@/domain/shared/ids";
import type { Logger } from "@/lib/logger";
import type { ArtistMatches, AutoPublished, PageReader, PublishAuditLog } from "./ports";

export const REVERIFY_EVERY_MS = 3 * 86_400_000;

export type ReverifyDeps = {
  audit: PublishAuditLog;
  reader: PageReader;
  verification: EventVerificationStore;
  matches: ArtistMatches;
  /** Re-ingests the official facts with the new start time (same night). */
  updateStartTime(eventId: EventId, official: GateSource, hhmm: string): Promise<void>;
  alerts: Alerts | null;
  clock: Clock;
  logger: Pick<Logger, "info" | "warn">;
};

export type ReverifyOutcome = {
  eventId: EventId;
  nightKey: string;
  result: "unchanged" | "updated" | "held" | "skipped";
  detail: string;
};

export async function reverifyAutoPublished(deps: ReverifyDeps): Promise<ReverifyOutcome[]> {
  const now = deps.clock.now();
  const due = await deps.audit.dueForReverification(new Date(now.getTime() - REVERIFY_EVERY_MS));
  const out: ReverifyOutcome[] = [];
  for (const item of due) {
    try {
      out.push(await reverifyOne(deps, item, now));
    } catch (e) {
      deps.logger.warn({ err: e, eventId: item.eventId }, "gigs: re-verification failed");
      out.push({ ...ids(item), result: "skipped", detail: String(e) });
    }
  }
  return out;
}

const ids = (i: AutoPublished) => ({ eventId: i.eventId, nightKey: i.nightKey });

async function reverifyOne(
  deps: ReverifyDeps,
  item: AutoPublished,
  now: Date,
): Promise<ReverifyOutcome> {
  const stored = await deps.verification.get(item.eventId);
  if (!stored || stored.visibility !== "published") {
    return {
      ...ids(item),
      result: "skipped",
      detail: `visibility ${stored?.visibility ?? "missing"}`,
    };
  }
  if ((stored.endsAt ?? stored.startsAt).getTime() < now.getTime()) {
    return { ...ids(item), result: "skipped", detail: "in the past" };
  }
  const official = item.sources.find((s) => s.officialKind !== null);
  if (!official) return { ...ids(item), result: "skipped", detail: "no official source on record" };
  const headliner = official.artists[0] ?? "";

  let page;
  try {
    page = await deps.reader.read(official.url);
  } catch (e) {
    return { ...ids(item), result: "skipped", detail: `not reachable now: ${String(e)}` };
  }
  if (page.status === "gone") {
    return hold(deps, item, now, `official page is gone: ${official.url}`, null);
  }
  const ctx = {
    now,
    source: "artist_site" as const,
    trust: "official" as const,
    officialKind: official.officialKind,
    via: "listing" as const,
  };
  const fresh: GigCandidate[] = [
    ...gigsFromJsonLd(
      jsonLdEvents(page.jsonLd).filter((e) => namesArtist(e.name, headliner)),
      { url: page.url, city: official.city, cityQuote: null },
      { ...ctx, acts: () => [{ name: headliner, parts: [] }] },
    ),
    ...extractArtistGigs(page, headliner, ctx),
  ].filter((c) => normalizeCity(c.city) === normalizeCity(official.city));
  const sameNight = fresh.filter((c) => toGateSource(validated(c)).night === official.night);
  if (sameNight.some((c) => c.cancelled)) {
    return hold(deps, item, now, "the official page says it is cancelled or postponed", null);
  }
  if (sameNight.length === 0) {
    const nights = [...new Set(fresh.map((c) => toGateSource(validated(c)).night))];
    return hold(deps, item, now, `night ${official.night} no longer listed on ${official.url}`, {
      night: { from: official.night, to: nights },
    });
  }
  const current = sameNight.find((c) => c.provenance.startTime !== null) ?? sameNight[0]!;
  const newTime = current.provenance.startTime;
  if (newTime === official.startTime || newTime === null) {
    await audit(deps, item, now, "reverified", ["official page unchanged"], null);
    return { ...ids(item), result: "unchanged", detail: official.url };
  }
  // The time changed: the gate decides again on the new data.
  const updated: GateSource = {
    ...official,
    startTime: newTime,
    quotes: current.provenance.quotes,
  };
  const sources = item.sources.map((s) => (s === official ? updated : s));
  const match = await deps.matches.statusOf(headliner);
  const gate = autoPublishDecision({
    now,
    sources,
    headlinerMatch: match?.matchStatus ?? null,
    archivedLineups: [],
    confidence: stored.verification?.confidence ?? 0,
  });
  const changes = { startTime: { from: official.startTime, to: newTime } };
  if (gate.decision !== "publish") {
    return hold(
      deps,
      item,
      now,
      `start time changed and the gate now says: ${gate.reasons.join("; ")}`,
      changes,
    );
  }
  await deps.updateStartTime(item.eventId, updated, newTime);
  await audit(
    deps,
    item,
    now,
    "updated",
    gate.checks.map((c) => `${c.rule}: ${c.detail}`),
    changes,
    sources,
  );
  return {
    ...ids(item),
    result: "updated",
    detail: `start time ${official.startTime} → ${newTime}`,
  };
}

/** A fresh candidate seen as a validated one (its artists are the artist we searched for). */
const validated = (c: GigCandidate) => ({
  ...c,
  title: c.title ?? "",
  artists: c.artists.map((a) => a.name),
  supportActs: [],
});

async function hold(
  deps: ReverifyDeps,
  item: AutoPublished,
  now: Date,
  reason: string,
  changes: Record<string, { from: unknown; to: unknown }> | null,
): Promise<ReverifyOutcome> {
  await deps.verification.setVisibility(item.eventId, "held");
  await audit(deps, item, now, "held", [reason], changes);
  await deps.alerts?.send({
    key: `gig-reverify:${item.eventId}`,
    subject: `Auto-published gig moved back to held (${item.nightKey})`,
    body: `${reason}\nEvent ${item.eventId} is held until the Lead reviews it.`,
  });
  deps.logger.warn({ eventId: item.eventId, reason }, "gigs: auto-published event held");
  return { ...ids(item), result: "held", detail: reason };
}

async function audit(
  deps: ReverifyDeps,
  item: AutoPublished,
  now: Date,
  action: "reverified" | "updated" | "held",
  reasons: string[],
  changes: Record<string, { from: unknown; to: unknown }> | null,
  sources: GateSource[] = item.sources,
): Promise<void> {
  await deps.audit.append({
    eventId: item.eventId,
    nightKey: item.nightKey,
    action,
    actor: "auto-gate",
    reasons,
    sources,
    changes,
    at: now,
  });
}

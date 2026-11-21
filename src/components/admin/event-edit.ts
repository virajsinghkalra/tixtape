/**
 * The admin event editor's rules: IST date inputs, lineup moves, and turning the form into
 * the smallest valid `PATCH /api/admin/events/:id` body. The server validates again (D-018).
 */
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const LOCAL_INPUT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u;

export type LineupRow = {
  /** Stable React key; never sent. */
  key: string;
  name: string;
  tier: BillingTier;
  day: number | null;
  stage: string | null;
};

export type VenueForm = { name: string; city: string; state: string; country: string };

export type EventForm = {
  /** `datetime-local` values in IST, e.g. "2026-12-18T19:00". */
  startsAt: string;
  endsAt: string;
  venue: VenueForm;
  url: string;
  lineup: LineupRow[];
};

/** A UTC instant as an IST `datetime-local` value. */
export function toIstInput(iso: string | null): string {
  if (!iso) return "";
  return new Date(new Date(iso).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** An IST `datetime-local` value as an ISO date-time with offset, or null if malformed. */
export function fromIstInput(value: string): string | null {
  if (!LOCAL_INPUT.test(value)) return null;
  const iso = `${value}:00+05:30`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** Moves the row at `from` by `delta` places; out-of-range moves return the same list. */
export function moveRow<T>(rows: readonly T[], from: number, delta: -1 | 1): T[] {
  const to = from + delta;
  if (from < 0 || from >= rows.length || to < 0 || to >= rows.length) return [...rows];
  const next = [...rows];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row as T);
  return next;
}

export function isTier(value: string): value is BillingTier {
  return (BILLING_TIERS as readonly string[]).includes(value);
}

const sameLineup = (a: readonly LineupRow[], b: readonly LineupRow[]) =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i]!;
    return (
      r.name.trim() === o.name.trim() && r.tier === o.tier && r.day === o.day && r.stage === o.stage
    );
  });

const sameVenue = (a: VenueForm, b: VenueForm) =>
  (["name", "city", "state", "country"] as const).every((k) => a[k].trim() === b[k].trim());

export type PatchResult =
  { ok: true; patch: Record<string, unknown>; changes: string[] } | { ok: false; errors: string[] };

function dateErrors(form: EventForm): {
  errors: string[];
  startsAt: string | null;
  endsAt: string | null;
} {
  const errors: string[] = [];
  const startsAt = fromIstInput(form.startsAt);
  if (!startsAt) errors.push("Enter a start date and time.");
  const endsAt = form.endsAt === "" ? null : fromIstInput(form.endsAt);
  if (form.endsAt !== "" && !endsAt) errors.push("The end date and time isn't valid.");
  if (startsAt && endsAt && new Date(endsAt) < new Date(startsAt)) {
    errors.push("The end can't be before the start.");
  }
  return { errors, startsAt, endsAt };
}

function venueErrors(v: VenueForm): string[] {
  const errors: string[] = [];
  if (!v.name.trim()) errors.push("Enter the venue name.");
  if (!v.city.trim()) errors.push("Enter the venue city.");
  if (!/^[A-Za-z]{2}$/u.test(v.country.trim()))
    errors.push("Use a two-letter country code, e.g. IN.");
  return errors;
}

function lineupErrors(rows: readonly LineupRow[]): string[] {
  if (rows.length === 0) return ["Add at least one artist."];
  const errors: string[] = [];
  if (rows.some((r) => !r.name.trim())) errors.push("Every lineup row needs an artist name.");
  if (rows.some((r) => r.name.trim().length > 200))
    errors.push("Artist names must be 200 characters or fewer.");
  return errors;
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (u.protocol === "http:" || u.protocol === "https:") && value.length <= 2000;
  } catch {
    return false;
  }
}

/** Only changed fields go in the patch; `lineup`, when sent, replaces the whole lineup. */
export function buildEventPatch(initial: EventForm, form: EventForm): PatchResult {
  const dates = dateErrors(form);
  const errors = [...dates.errors, ...venueErrors(form.venue), ...lineupErrors(form.lineup)];
  const url = form.url.trim();
  if (url !== "" && !isHttpUrl(url))
    errors.push("The event link must start with http:// or https://.");
  if (errors.length > 0) return { ok: false, errors };

  const patch: Record<string, unknown> = {};
  const changes: string[] = [];
  if (form.startsAt !== initial.startsAt) {
    patch.startsAt = dates.startsAt;
    changes.push("Start date");
  }
  if (form.endsAt !== initial.endsAt) {
    patch.endsAt = dates.endsAt;
    changes.push("End date");
  }
  if (!sameVenue(form.venue, initial.venue)) {
    const { name, city, state, country } = form.venue;
    patch.venue = {
      name: name.trim(),
      city: city.trim(),
      country: country.trim().toUpperCase(),
      ...(state.trim() ? { state: state.trim() } : {}),
    };
    changes.push("Venue");
  }
  if (url !== initial.url.trim()) {
    patch.url = url === "" ? null : url;
    changes.push("Event link");
  }
  if (!sameLineup(form.lineup, initial.lineup)) {
    patch.lineup = form.lineup.map((r) => ({
      name: r.name.trim(),
      tier: r.tier,
      ...(r.day === null ? {} : { day: r.day }),
      ...(r.stage === null ? {} : { stage: r.stage }),
    }));
    changes.push(`Lineup (${form.lineup.length} artists)`);
  }
  if (changes.length === 0) return { ok: false, errors: ["Nothing has changed yet."] };
  return { ok: true, patch, changes };
}

import { sql, type SQL } from "drizzle-orm";

type Cols = { startsAt: unknown; endsAt: unknown; dateOnly: unknown };

/** The raw-SQL columns of `events` under an alias, e.g. `from events e`. */
export const aliasCols = (alias: string): Cols => ({
  startsAt: sql.raw(`${alias}.starts_at`),
  endsAt: sql.raw(`${alias}.ends_at`),
  dateOnly: sql.raw(`${alias}.starts_at_date_only`),
});

/**
 * SQL twin of `eventEnd` (domain/events/ist-calendar.ts): `ends_at`, else the end of the IST
 * day for a date-only event, else `starts_at` plus `timedGraceMs`. Compare with `>= now`.
 */
export function eventEndSql(cols: Cols, timedGraceMs = 0): SQL {
  return sql`coalesce(${cols.endsAt}, case
    when ${cols.dateOnly} then ((date_trunc('day', ${cols.startsAt} at time zone 'Asia/Kolkata') + interval '1 day') at time zone 'Asia/Kolkata') - interval '1 millisecond'
    else ${cols.startsAt} + make_interval(secs => ${timedGraceMs / 1000}) end)`;
}

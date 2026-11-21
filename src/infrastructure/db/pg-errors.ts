/** Postgres error helpers for the events repositories. */

/** True when `e` (or a Drizzle wrapper's `cause`) is a unique violation on `constraint`. */
export function isUniqueViolation(e: unknown, constraint: string): boolean {
  for (let cur: unknown = e; cur instanceof Error || isRecord(cur); cur = getCause(cur)) {
    if (isRecord(cur) && cur.code === "23505" && cur.constraint_name === constraint) return true;
    if (getCause(cur) === cur) break;
  }
  return false;
}

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;
const getCause = (x: unknown): unknown => (isRecord(x) ? x.cause : undefined);

/** True when `e` (or a Drizzle wrapper's `cause`) is a foreign-key violation. */
export function isForeignKeyViolation(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; isRecord(cur) && depth < 5; cur = getCause(cur), depth++) {
    if (cur.code === "23503") return true;
  }
  return false;
}

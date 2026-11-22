/**
 * D-092: merging this device's saved shows with the server copy (only for a person who opted in
 * with an email, D-090). Every save and unsave carries a timestamp; for each show the latest
 * action wins, so an unsave on one side beats an older save on the other. Pure.
 */

export type SavedEntry = { eventId: string; savedAt: string | null; removedAt: string | null };

export type SyncPlan = {
  /** Shows to add to this device (saved on the server, newer than any local unsave). */
  addLocally: string[];
  /** Shows to drop from this device (unsaved on the server after the local save). */
  removeLocally: { eventId: string; removedAt: string }[];
  /** Changes the server hasn't seen yet. */
  pushSaves: { eventId: string; at: string }[];
  pushRemoves: { eventId: string; at: string }[];
};

const t = (iso: string | null | undefined): number => {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? ms : -Infinity;
};

const iso = (ms: number) => new Date(ms).toISOString();

export function planSync(
  local: { saves: { id: string; savedAt: string }[]; removes: { id: string; removedAt: string }[] },
  server: readonly SavedEntry[],
): SyncPlan {
  const ids = new Set<string>();
  const ls = new Map<string, number>();
  const lr = new Map<string, number>();
  for (const s of local.saves) ls.set(s.id, Math.max(ls.get(s.id) ?? -Infinity, t(s.savedAt)));
  for (const r of local.removes) lr.set(r.id, Math.max(lr.get(r.id) ?? -Infinity, t(r.removedAt)));
  const srv = new Map(server.map((e) => [e.eventId, e]));
  for (const id of [...ls.keys(), ...lr.keys(), ...srv.keys()]) ids.add(id);

  const plan: SyncPlan = { addLocally: [], removeLocally: [], pushSaves: [], pushRemoves: [] };
  for (const id of ids) {
    const localSave = ls.get(id) ?? -Infinity;
    const localRemove = lr.get(id) ?? -Infinity;
    const serverSave = t(srv.get(id)?.savedAt);
    const serverRemove = t(srv.get(id)?.removedAt);
    const lastSave = Math.max(localSave, serverSave);
    const lastRemove = Math.max(localRemove, serverRemove);
    const saved = lastSave > lastRemove;
    const savedHere = ls.has(id);

    if (localSave > serverSave) plan.pushSaves.push({ eventId: id, at: iso(localSave) });
    if (localRemove > serverRemove) plan.pushRemoves.push({ eventId: id, at: iso(localRemove) });
    if (saved && !savedHere) plan.addLocally.push(id);
    if (!saved && savedHere) plan.removeLocally.push({ eventId: id, removedAt: iso(lastRemove) });
  }
  return plan;
}

/** A client clock can't write the far future or the distant past into the server copy. */
export function clampActionTime(at: Date, now: Date): Date {
  const max = now.getTime() + 5 * 60_000;
  const min = now.getTime() - 400 * 86_400_000;
  return new Date(Math.min(max, Math.max(min, at.getTime())));
}

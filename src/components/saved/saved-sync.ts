/**
 * D-092: keeps this device's saved shows in step with the server copy, only for a person who
 * opted in with an email (D-090). Anonymous devices never call the server. Unsaves are kept as
 * timestamped tombstones so the latest action wins on merge (`planSync`).
 */
import { z } from "zod";
import { planSync } from "@/domain/saved/sync";
import { deviceId, readDeviceId } from "../analytics/device-id";
import {
  readList,
  SAVED,
  withItem,
  withoutItem,
  writeList,
  type ListSpec,
  type SavedShow,
} from "../device/device-lists";
import { CHANGE_EVENT } from "../device/use-device-list";
import { parsePromptState, PROMPT_STATE_KEY } from "../identity/prompt-rules";

export type Unsave = { id: string; removedAt: string };
export const UNSAVED: ListSpec<Unsave> = {
  key: "tixtape.unsaved.v1",
  schema: z.object({ id: z.string().min(1).max(64), removedAt: z.string() }),
  max: 200,
  idOf: (u) => u.id,
};

/** Fired by the email sheet once an email is saved: the first sync uploads local saves. */
export const EMAIL_SAVED_EVENT = "tixtape:email-saved";
const URL_ = "/api/me/saved";

const local = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function syncEnabled(): boolean {
  try {
    return parsePromptState(localStorage.getItem(PROMPT_STATE_KEY)).emailSaved;
  } catch {
    return false;
  }
}

function send(method: "POST" | "DELETE", body: Record<string, unknown>): void {
  const did = readDeviceId();
  if (!did || !syncEnabled()) return;
  void fetch(URL_, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ did, ...body }),
    keepalive: true,
  }).catch(() => {});
}

/** Records a save here (clears its tombstone) and, if synced, on the server. */
export function noteSave(eventId: string, at: string): void {
  writeList(UNSAVED, withoutItem(UNSAVED, readList(UNSAVED, local()), eventId), local());
  send("POST", { saves: [{ eventId, at }] });
}

/** Records an unsave as a tombstone here and, if synced, on the server. */
export function noteUnsave(eventId: string, at: string): void {
  writeList(
    UNSAVED,
    withItem(UNSAVED, readList(UNSAVED, local()), { id: eventId, removedAt: at }),
    local(),
  );
  send("DELETE", { eventId, at });
}

const ServerBody = z.object({
  synced: z.boolean(),
  shows: z.array(
    z.object({
      eventId: z.string(),
      savedAt: z.string().nullable(),
      removedAt: z.string().nullable(),
      show: z
        .object({ title: z.string(), startsAt: z.string(), city: z.string().nullable() })
        .nullable(),
    }),
  ),
});

/** Merges the server copy into this device and uploads what the server lacks. */
export async function runSync(): Promise<void> {
  const did = deviceId();
  if (!did || !syncEnabled()) return;
  const res = await fetch(URL_, { headers: { "x-tixtape-device": did }, cache: "no-store" });
  const body = ServerBody.safeParse(res.ok ? await res.json() : null);
  if (!body.success || !body.data.synced) return;
  const store = local();
  let saved: SavedShow[] = readList(SAVED, store);
  let removes = readList(UNSAVED, store);
  const plan = planSync(
    { saves: saved.map((s) => ({ id: s.id, savedAt: s.savedAt })), removes },
    body.data.shows,
  );
  const byId = new Map(body.data.shows.map((s) => [s.eventId, s]));
  for (const id of plan.addLocally) {
    const s = byId.get(id);
    if (!s?.show) continue;
    saved = withItem(SAVED, saved, {
      id,
      ...s.show,
      savedAt: s.savedAt ?? new Date().toISOString(),
    });
    removes = withoutItem(UNSAVED, removes, id);
  }
  for (const r of plan.removeLocally) {
    saved = withoutItem(SAVED, saved, r.eventId);
    removes = withItem(UNSAVED, removes, { id: r.eventId, removedAt: r.removedAt });
  }
  writeList(SAVED, saved, store);
  writeList(UNSAVED, removes, store);
  window.dispatchEvent(new Event(CHANGE_EVENT));
  if (plan.pushSaves.length || plan.pushRemoves.length) {
    await fetch(URL_, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        did,
        saves: plan.pushSaves.slice(0, 50),
        removes: plan.pushRemoves.slice(0, 50),
      }),
    });
  }
}

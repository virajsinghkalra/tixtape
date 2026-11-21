/**
 * D-084: the public facts an event's link preview, metadata and JSON-LD need, read once per
 * request (React `cache`). Null when the event doesn't exist or isn't public. The playlist state
 * is optional: a slow or failing read just says "Playlist soon".
 */
import { cache } from "react";
import { parseEventId } from "@/application/events";
import type { EventDetail } from "@/application/ports/events";
import { withTimeout } from "@/lib/timeout";
import { events } from "@/server/events";
import { playlists } from "@/server/playlists";

const STATUS_TIMEOUT_MS = 1500;

export type ShareEvent = { event: EventDetail; playlistLive: boolean };

export const loadShareEvent = cache(async (rawId: string): Promise<ShareEvent | null> => {
  let event: EventDetail;
  try {
    event = await events().getEvent(parseEventId(rawId));
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "not_found") return null;
    throw err;
  }
  const status = await withTimeout(playlists().getSharedStatus(event.id), STATUS_TIMEOUT_MS, null);
  return { event, playlistLive: status?.status === "ready" };
});

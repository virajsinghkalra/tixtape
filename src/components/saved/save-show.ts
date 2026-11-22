import type { SavedShow } from "../device/device-lists";

/** What a heart needs to save a show on this device; `city` is null when the venue is unknown. */
export function toSavedShowInput(event: {
  id: string;
  title: string;
  startsAt: Date | string;
  venue?: { city: string } | null;
}): Omit<SavedShow, "savedAt"> {
  return {
    id: event.id,
    title: event.title,
    startsAt: typeof event.startsAt === "string" ? event.startsAt : event.startsAt.toISOString(),
    city: event.venue?.city ?? null,
  };
}

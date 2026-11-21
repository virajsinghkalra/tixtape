/** The editor's starting values for one event (server side; plain data for the client). */
import type { EventDetail } from "@/application/ports/events";
import { toIstInput, type EventForm } from "./event-edit";

export function toEventForm(
  event: Pick<EventDetail, "startsAt" | "endsAt" | "venue" | "sources" | "lineup">,
): EventForm {
  const adminUrl = event.sources.find((s) => s.source === "admin")?.url ?? "";
  return {
    startsAt: toIstInput(event.startsAt.toISOString()),
    endsAt: toIstInput(event.endsAt ? event.endsAt.toISOString() : null),
    venue: {
      name: event.venue?.name ?? "",
      city: event.venue?.city ?? "",
      state: "",
      country: event.venue?.country ?? "IN",
    },
    url: adminUrl,
    lineup: [...event.lineup]
      .sort((a, b) => a.billingRank - b.billingRank)
      .map((a) => ({ key: a.artistId, name: a.name, tier: a.tier, day: a.day, stage: a.stage })),
  };
}

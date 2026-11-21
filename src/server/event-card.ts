/** D-084: an event's link-preview card plan, from the same facts as its page. */
import { planOgCard, type OgCardPlan } from "@/components/og/og-card";
import type { ShareEvent } from "./event-share";

export function eventCardPlan({ event, playlistLive }: ShareEvent): OgCardPlan {
  return planOgCard({
    id: event.id,
    title: event.title,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    city: event.venue?.city ?? null,
    posterUrl: event.posterUrl ?? null,
    lineup: event.lineup,
    playlistLive,
  });
}

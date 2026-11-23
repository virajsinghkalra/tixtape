/**
 * D-084 (UX plan #13): schema.org `MusicEvent` JSON-LD for an event page, and the share
 * description. Pure; images stay hotlinked (D-082).
 */
import { orderForVisuals, type VisualArtist } from "@/domain/visuals/visuals";
import { shortDateRange } from "./og-card";
import { venueName } from "../venue";

export type JsonLdEvent = {
  title: string;
  status: string;
  startsAt: Date;
  endsAt: Date | null;
  venue: { name: string; city: string } | null;
  posterUrl: string | null;
  lineup: readonly VisualArtist[];
};

/** "23–24 Jan · Mumbai · A, B, C": metadata only, so the 4-word rule doesn't apply. */
export function shareDescription(e: JsonLdEvent): string {
  const names = orderForVisuals(e.lineup)
    .slice(0, 3)
    .map((a) => a.name);
  return [shortDateRange(e.startsAt, e.endsAt), e.venue?.city, names.join(", ")]
    .filter(Boolean)
    .join(" · ");
}

export function eventJsonLd(e: JsonLdEvent, pageUrl: string, imageUrl: string) {
  return {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: e.title,
    url: pageUrl,
    startDate: e.startsAt.toISOString(),
    ...(e.endsAt ? { endDate: e.endsAt.toISOString() } : {}),
    eventStatus:
      e.status === "cancelled"
        ? "https://schema.org/EventCancelled"
        : "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    ...(e.venue
      ? {
          location: {
            "@type": "Place",
            name: venueName(e.venue.name) ?? e.venue.city,
            address: {
              "@type": "PostalAddress",
              addressLocality: e.venue.city,
              addressCountry: "IN",
            },
          },
        }
      : {}),
    image: [e.posterUrl ?? imageUrl],
    performer: orderForVisuals(e.lineup)
      .slice(0, 20)
      .map((a) => ({ "@type": "MusicGroup", name: a.name })),
  };
}

/** Safe inside <script>: no "</script>" or HTML comment can break out. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

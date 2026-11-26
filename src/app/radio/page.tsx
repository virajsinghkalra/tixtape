import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { metroOf } from "@/domain/events/front-page";
import { GigRadio, type RadioCard } from "@/components/radio/GigRadio";
import { radioOrder } from "@/components/radio/radio-order";
import { countdownBadge, shortDate } from "@/components/event-format";
import { shortTitle } from "@/components/hero-copy";
import { vibeEmoji, vibeOf, vibeTag } from "@/components/vibe-copy";
import { ogVersion } from "@/components/og/og-card";
import { eventCardPlan } from "@/server/event-card";
import { loadShareEvent } from "@/server/event-share";
import { storedFirstSongs } from "@/server/song-preview";
import { frontPage, recentSpotifyOpens } from "@/server/front-page";
import { CITY_COOKIE, visitorCity } from "@/server/location";

/** "⏰ 3 days to go" for a gig within a week (urgency: save the playlist before it). */
function soonChip(startsAt: Date, endsAt: Date | null, now: Date): string | null {
  const b = countdownBadge(startsAt, endsAt, now);
  const days = (startsAt.getTime() - now.getTime()) / 86_400_000;
  return b.label !== "Ended" && days <= 7 ? `${b.emoji} ${b.label}` : null;
}

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ g?: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A shared link (?g=) previews that gig; otherwise a generic Gig Radio card. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { g } = await searchParams;
  const share = g && UUID.test(g) ? await loadShareEvent(g).catch(() => null) : null;
  if (!share) {
    return {
      title: "Gig Radio",
      description: "Swipe through every gig in India. Each one plays its song.",
    };
  }
  const { event } = share;
  const top = [...event.lineup].sort((a, b) => a.billingRank - b.billingRank)[0]?.name;
  const title = `${shortTitle(event.title, top)} on Gig Radio 📻`;
  const description = "Swipe the gigs. Each one plays.";
  const image = {
    url: `/events/${event.id}/share-image?v=${ogVersion(eventCardPlan(share))}`,
    width: 1200,
    height: 630,
  };
  return {
    title,
    description,
    openGraph: { title, description, siteName: "Tixtape", type: "website", images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/** 📻 Gig Radio: every gig with a playlist, one full-screen card each, mixed like a station. */
export default async function RadioPage({ searchParams }: Props) {
  const { g } = await searchParams;
  const now = new Date();
  const jar = await cookies();
  const city =
    visitorCity({ headers: await headers(), cookie: jar.get(CITY_COOKIE)?.value })?.city ?? null;
  const [{ rows }, opens] = await Promise.all([frontPage({ now, city }), recentSpotifyOpens(now)]);
  const ordered = radioOrder(
    rows.map((e) => ({
      ...e,
      local: Boolean(city && e.city && metroOf(e.city) === metroOf(city)),
      vibe: vibeOf(e.genre, e.type),
      heat: opens.get(e.id) ?? 0,
      daysAway: Math.max(0, Math.floor((e.startsAt.getTime() - now.getTime()) / 86_400_000)),
    })),
  );
  // A shared link (?g=) plays that gig first.
  const shared = g ? ordered.findIndex((e) => e.id === g) : -1;
  if (shared > 0) ordered.unshift(...ordered.splice(shared, 1));
  const songs = await storedFirstSongs(ordered.map((e) => e.playlistUrl!));
  const cards: RadioCard[] = ordered.map((e) => {
    const tag = vibeTag(e.vibe);
    return {
      id: e.id,
      title: e.title,
      artist:
        e.artistCount === 1 && e.headliners[0]
          ? e.headliners[0]
          : shortTitle(e.title, e.headliners[0]),
      when: shortDate(e.startsAt, now),
      city: e.city ?? null,
      startsAt: e.startsAt.toISOString(),
      poster: e.posterUrl ?? null,
      artists: e.headlinerArtists,
      playlistUrl: e.playlistUrl!,
      ticketUrl: e.ticketUrl,
      tag: tag
        ? `${tag.emoji} ${tag.label}`
        : `${vibeEmoji(e.vibe)} ${e.vibe === "festival" ? "Festival" : "Live"}`,
      vibe: e.vibe,
      soon: soonChip(e.startsAt, e.endsAt, now),
      song: songs.get(e.playlistUrl!) ?? null,
    };
  });
  return <GigRadio cards={cards} />;
}

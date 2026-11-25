import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { metroOf } from "@/domain/events/front-page";
import { GigRadio, type RadioCard } from "@/components/radio/GigRadio";
import { radioOrder } from "@/components/radio/radio-order";
import { shortDate } from "@/components/event-format";
import { shortTitle } from "@/components/hero-copy";
import { vibeEmoji, vibeOf, vibeTag } from "@/components/vibe-copy";
import { frontPage, recentSpotifyOpens } from "@/server/front-page";
import { CITY_COOKIE, visitorCity } from "@/server/location";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Gig Radio",
  description: "Swipe through every gig in India. Each one plays its song.",
};

type Props = { searchParams: Promise<{ g?: string }> };

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
    })),
  );
  // A shared link (?g=) plays that gig first.
  const shared = g ? ordered.findIndex((e) => e.id === g) : -1;
  if (shared > 0) ordered.unshift(...ordered.splice(shared, 1));
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
      tag: tag ? `${tag.emoji} ${tag.label}` : `${vibeEmoji(e.vibe)} Live`,
    };
  });
  return <GigRadio cards={cards} />;
}

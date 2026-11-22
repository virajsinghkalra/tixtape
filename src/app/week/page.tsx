import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { weekShows } from "@/components/nav/browse";
import { BrowsePage } from "@/components/nav/BrowsePage";
import { CITY_COOKIE, visitorCity } from "@/server/location";
import { upcomingRows } from "@/server/front-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "This week" };

export default async function Page() {
  const now = new Date();
  const jar = await cookies();
  const city =
    visitorCity({ headers: await headers(), cookie: jar.get(CITY_COOKIE)?.value })?.city ?? null;
  const rows = weekShows(await upcomingRows(now), now);
  return (
    <BrowsePage
      emoji="📅"
      title="This week"
      empty="Nothing this week."
      rows={rows}
      now={now}
      city={city}
    />
  );
}

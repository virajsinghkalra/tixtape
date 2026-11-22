import type { Metadata } from "next";
import { BrowsePage } from "@/components/nav/BrowsePage";
import { pastRows } from "@/server/front-page";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Past gigs" };

export default async function Page() {
  const now = new Date();
  const rows = await pastRows(now);
  return (
    <BrowsePage
      emoji="🕰️"
      title="Past gigs"
      empty="Nothing yet."
      rows={rows}
      now={now}
      city={null}
    />
  );
}

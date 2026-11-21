import type { Metadata } from "next";
import type { ReactNode } from "react";
import { eventJsonLd, jsonLdScript, shareDescription } from "@/components/og/event-json-ld";
import { ogVersion } from "@/components/og/og-card";
import { SITE_URL } from "@/lib/site";
import { eventCardPlan } from "@/server/event-card";
import { loadShareEvent, type ShareEvent } from "@/server/event-share";

type Props = { params: Promise<{ id: string }> };

/**
 * D-084: an event's share metadata (Open Graph, Twitter, canonical) and its schema.org JSON-LD.
 * It lives in a layout so the page stays the UI team's; the page's own `title` still wins.
 * Nothing streams before the page, so unknown ids keep their real 404 (QA-UI-1).
 */
async function load(id: string): Promise<ShareEvent | null> {
  // Metadata is a nice-to-have: a failure here must not fail the page.
  return loadShareEvent(id).catch(() => null);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const share = await load(id);
  if (!share) return {};
  const { event } = share;
  const plan = eventCardPlan(share);
  const path = `/events/${event.id}`;
  const image = {
    url: `${path}/share-image?v=${ogVersion(plan)}`,
    width: 1200,
    height: 630,
    alt: plan.alt,
  };
  const description = shareDescription({ ...event, posterUrl: event.posterUrl ?? null });
  return {
    description,
    alternates: { canonical: path },
    openGraph: {
      title: event.title,
      description,
      url: path,
      siteName: "Tixtape",
      type: "website",
      locale: "en_IN",
      images: [image],
    },
    twitter: { card: "summary_large_image", title: event.title, description, images: [image] },
  };
}

export default async function EventLayout({ params, children }: Props & { children: ReactNode }) {
  const { id } = await params;
  const share = await load(id);
  const base = SITE_URL;
  const ld = share
    ? eventJsonLd(
        { ...share.event, posterUrl: share.event.posterUrl ?? null },
        `${base}/events/${share.event.id}`,
        `${base}/events/${share.event.id}/share-image?v=${ogVersion(eventCardPlan(share))}`,
      )
    : null;
  return (
    <>
      {ld && (
        <script
          type="application/ld+json"
          // Escaped by jsonLdScript: no tag can close the script early.
          dangerouslySetInnerHTML={{ __html: jsonLdScript(ld) }}
        />
      )}
      {children}
    </>
  );
}

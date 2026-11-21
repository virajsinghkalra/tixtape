"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ShowRow, type ShowRowItem } from "../ShowRow";
import { COPY, typoChip } from "../ux-copy";
import { liveLookup, worthLookingUp, type LookupView } from "./live-lookup";
import { NotInIndia } from "./NotInIndia";
import { LookupBlock } from "./SearchPanels";
import { useSimilarShows } from "./useSimilarShows";

type Props = {
  /** The search text exactly as given. */
  query: string;
  /** "In Mumbai", or "Up next" with no city. */
  nearTitle: string;
  nearRow: ShowRowItem[];
  didYouMean?: string;
};

/**
 * /search with nothing found becomes discovery (UX #7, D-088): the typo chip, "Not in India
 * yet 🫠" with the artist and "🔔 Ping me", then "Sounds like this" (Last.fm similar artists
 * with shows here) and the visitor's city. The live lookup (D-050) runs after paint; the rows
 * never wait for it. If the lookup finds shows after all, they slide in on top.
 */
export function ZeroResults({ query, nearTitle, nearRow, didYouMean }: Props) {
  const router = useRouter();
  const [view, setView] = useState<LookupView>({ kind: "idle" });

  useEffect(() => {
    if (!worthLookingUp(query)) return;
    const controller = new AbortController();
    setView({ kind: "looking", query, artist: null });
    void liveLookup(query, controller.signal, {
      onUpdate: (v) => !controller.signal.aborted && setView(v),
    }).then((v) => {
      if (!controller.signal.aborted) setView(v ?? { kind: "idle" });
    });
    return () => controller.abort();
  }, [query]);

  const artist = view.kind === "looking" || view.kind === "not_found" ? view.artist : null;
  const name = artist?.name ?? query;
  const similar = useSimilarShows(query);
  const ambiguous = view.kind === "not_found" && view.candidates.length > 0;

  return (
    <div className="space-y-8">
      {didYouMean && (
        <Link
          href={`/search?q=${encodeURIComponent(didYouMean)}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-chip border-2 border-ink bg-lime px-4 text-sm font-semibold text-on-block"
        >
          <span aria-hidden>✨</span> {typoChip(didYouMean)}
        </Link>
      )}
      {view.kind === "found" || ambiguous ? (
        <div className="rounded-card border-2 border-night bg-surface pb-4 text-ink">
          <LookupBlock
            lookup={view}
            onOpenEvent={() => {}}
            onPick={(n) => router.push(`/search?q=${encodeURIComponent(n)}`)}
          />
        </div>
      ) : (
        <NotInIndia name={name} imageUrl={artist?.imageUrl} checking={view.kind === "looking"} />
      )}
      <p role="status" className="sr-only">
        {view.kind === "found" ? COPY.foundIt : similar.length > 0 ? COPY.soundsLike : ""}
      </p>
      <ShowRow title={COPY.soundsLike} emoji="🎧" items={similar} index={0} />
      <ShowRow title={nearTitle} emoji="📍" items={nearRow} index={1} />
    </div>
  );
}

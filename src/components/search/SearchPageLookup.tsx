"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { liveLookup, worthLookingUp, type LookupView } from "./live-lookup";
import { LookupBlock } from "./SearchPanels";

/**
 * On /search with no results: run the live lookup in the browser after the page has painted
 * (D-057: the server render never waits on a lookup).
 */
export function SearchPageLookup({ query }: { query: string }) {
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

  if (view.kind === "idle") return null;
  return (
    <div className="rounded-card border-2 border-night bg-surface pb-4 text-ink">
      <LookupBlock
        lookup={view}
        onOpenEvent={() => {}}
        onPick={(name) => router.push(`/search?q=${encodeURIComponent(name)}`)}
      />
    </div>
  );
}

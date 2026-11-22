"use client";

import { runSearch } from "./search/run-search";
import { ChipButton } from "./ui/Chip";
import { Sticker } from "./ui/Sticker";
import { Tile } from "./ui/Tile";

type Props = { queries: string[] };

/**
 * The empty-catalogue hero tile (D-049): one friendly line, then chips that fill the search and
 * run it, so search finds the event or the live lookup (D-050) fetches it.
 */
export function TrySearchingTile({ queries }: Props) {
  return (
    <Tile tone="pink" className="pop-in flex w-full flex-col justify-between gap-5 [--i:1]">
      <Sticker tone="night" emoji="🛠️" tilt={3} className="self-start">
        Lineups loading
      </Sticker>
      <div>
        <h2 className="font-display text-big font-extrabold">New gigs soon</h2>
      </div>
      {/* QA-F-6: chips are checked to find something, so there may be none to offer. */}
      {queries.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-bold">Try searching</p>
          <ul className="flex flex-wrap gap-2">
            {queries.map((q) => (
              <li key={q}>
                <ChipButton
                  onClick={() => runSearch(q)}
                  className="border-night bg-surface text-ink hover:-rotate-2"
                >
                  {q}
                </ChipButton>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Tile>
  );
}

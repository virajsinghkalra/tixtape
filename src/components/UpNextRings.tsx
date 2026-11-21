"use client";

import { useState } from "react";
import type { StoryPlan } from "./story-plan";
import { renderStory } from "./StorySlides";
import { StoryRing } from "./ui/StoryRing";
import { StoryViewer } from "./ui/StoryViewer";
import type { BlockTone } from "./ui/tone";

export type RingEvent = {
  id: string;
  title: string;
  day: string;
  month: string;
  tone: BlockTone;
  /** A headliner photo (or the poster) behind the date, when there is one. */
  image?: string | null;
  /** UX #6: the playlist is live. */
  live?: boolean;
  /** Planned on the server (`planStory`): 2 slides for a solo show, more for a festival. */
  story: StoryPlan;
};

/** Instagram-style rings for this week's events; tapping one plays its story. */
export function UpNextRings({ events }: { events: RingEvent[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const open = events.find((e) => e.id === openId);

  return (
    <>
      <ul className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 [contain:paint] sm:-mx-6 sm:px-6">
        {events.map((e) => (
          <li key={e.id}>
            <StoryRing
              label={e.title}
              face={e.day}
              subface={e.month}
              tone={e.tone}
              image={e.image}
              badge={e.live ? "🎧" : null}
              seen={seen.has(e.id)}
              aria-label={`${e.day} ${e.month} ${e.title}: story${e.live ? ", playlist live" : ""}`}
              onClick={() => {
                setOpenId(e.id);
                setSeen((s) => new Set(s).add(e.id));
              }}
            />
          </li>
        ))}
      </ul>
      {open && (
        <StoryViewer
          variant="modal"
          open
          onClose={() => setOpenId(null)}
          title={`${open.title}: ${open.story.heading}`}
          slides={renderStory(open.id, open.story)}
        />
      )}
    </>
  );
}

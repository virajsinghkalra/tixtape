"use client";

import { useEffect, useState } from "react";
import { countdownBadge } from "../event-format";
import { Sticker } from "./Sticker";

type Props = {
  /** ISO instants. `now` comes from the server so the first render matches hydration. */
  startsAt: string;
  endsAt: string | null;
  now: string;
  size?: "sm" | "md";
  tilt?: number;
};

const TICK_MS = 60_000;

/** A live "⏰ 21 days to go" / "🔴 Tonight" sticker that keeps itself current. */
export function Countdown({ startsAt, endsAt, now, size, tilt }: Props) {
  const [current, setCurrent] = useState(() => new Date(now));
  useEffect(() => {
    const id = setInterval(() => setCurrent(new Date()), TICK_MS);
    return () => clearInterval(id);
  }, []);
  const badge = countdownBadge(new Date(startsAt), endsAt ? new Date(endsAt) : null, current);
  return (
    <Sticker emoji={badge.emoji} tone={badge.tone} size={size} tilt={tilt}>
      {badge.label}
    </Sticker>
  );
}

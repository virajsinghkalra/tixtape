/** Labels and formatting for the admin console. Times show in IST (develop-web-ui skill). */
import type { JobStatus } from "@/application/ports/playlists";
import type { EventVisibility } from "@/domain/events/visibility";

const MINUTE_MS = 60_000;

const istFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "18 Dec 2026, 19:00 IST". */
export function formatIst(date: Date | string): string {
  return `${istFormat.format(new Date(date))} IST`;
}

/** "just now", "12 min ago", "3 h ago", "4 d ago"; future times read "in …". */
export function formatAgo(date: Date | string, now: Date): string {
  const diff = now.getTime() - new Date(date).getTime();
  const mins = Math.round(Math.abs(diff) / MINUTE_MS);
  if (mins < 1) return "just now";
  const amount =
    mins < 60
      ? `${mins} min`
      : mins < 48 * 60
        ? `${Math.round(mins / 60)} h`
        : `${Math.round(mins / 1440)} d`;
  return diff >= 0 ? `${amount} ago` : `in ${amount}`;
}

/** 0.873 → "87%". */
export function formatConfidence(confidence: number): string {
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

export const VISIBILITY_LABEL: Record<EventVisibility, string> = {
  held: "Held",
  published: "Published",
  archived: "Archived",
};

/** Chip colours: held needs attention, published is live, archived is quiet. */
export const VISIBILITY_TONE: Record<EventVisibility, string> = {
  held: "bg-orange text-on-block border-transparent",
  published: "bg-lime text-on-block border-transparent",
  archived: "bg-surface-2 text-muted",
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  paused: "Paused",
  succeeded: "Done",
  partial: "Partly done",
  failed: "Failed",
};

const ACTIVE: readonly JobStatus[] = ["queued", "running", "paused"];
export function isActiveJob(status: JobStatus): boolean {
  return ACTIVE.includes(status);
}

/** What each visibility change does, for the confirm step. */
export const VISIBILITY_ACTION: Record<EventVisibility, { verb: string; effect: string }> = {
  published: {
    verb: "Publish",
    effect: "It appears in search, home and its event page, and people can make its playlist.",
  },
  held: {
    verb: "Hold",
    effect: "It disappears from every public page at once (its link becomes a 404).",
  },
  archived: {
    verb: "Archive",
    effect: "It's hidden from every public page, like a held event. Its data is kept.",
  },
};

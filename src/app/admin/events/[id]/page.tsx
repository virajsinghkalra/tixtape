import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { parseEventId } from "@/application/events";
import {
  formatAgo,
  formatConfidence,
  formatIst,
  VISIBILITY_LABEL,
  VISIBILITY_TONE,
} from "@/components/admin/admin-format";
import { toEventForm } from "@/components/admin/event-form";
import { EventEditor } from "@/components/admin/EventEditor";
import { VerificationTable } from "@/components/admin/VerificationTable";
import { VisibilityActions } from "@/components/admin/VisibilityActions";
import { groupByTier, MATCH_STATE, TIER_LABEL } from "@/components/lineup-view";
import { spotifyArtistUrl } from "@/components/links";
import { MatchBadge } from "@/components/MatchBadge";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { safeHttpUrl } from "@/domain/events/http-url";
import { NotFoundError } from "@/lib/errors";
import { adminConsole } from "@/server/admin-console";
import type { AdminEventView } from "@/application/events";
import { events } from "@/server/events";
import { requireAdminPage } from "../../admin-guard";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const loadEvent = cache(async (raw: string): Promise<AdminEventView | null> => {
  await requireAdminPage();
  try {
    return await events().getAdminEvent(parseEventId(raw));
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const event = await loadEvent((await params).id);
  return { title: event?.title ?? "Event not found" };
}

export default async function AdminEventPage({ params }: Params) {
  const event = await loadEvent((await params).id);
  if (!event) notFound();
  const view = (await adminConsole().eventVerification(event.id)) ?? { state: "none" as const };
  const now = new Date();
  const verification = view.state === "verified" ? view.verification : null;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/admin/events" className="w-fit text-sm underline underline-offset-2">
          ← All events
        </Link>
        <h1 className="font-display text-big font-extrabold">{event.title}</h1>
        <div className="flex flex-wrap gap-2">
          <Chip className={VISIBILITY_TONE[event.visibility]}>
            {VISIBILITY_LABEL[event.visibility]}
          </Chip>
          <Chip>Confidence {formatConfidence(event.confidence)}</Chip>
          <Chip>{event.type}</Chip>
          <Chip>{event.status.replace(/_/gu, " ")}</Chip>
          {/* D-091: what still keeps this event from being complete or publishable. */}
          {event.lineupCompleteness.status === "incomplete" && (
            <Chip>
              Lineup incomplete: {event.lineupCompleteness.stored}
              {event.lineupCompleteness.announced !== null
                ? ` of ${event.lineupCompleteness.announced}`
                : ""}{" "}
              acts
            </Chip>
          )}
          {!event.picture.ok && <Chip>Needs a poster or headliner photo</Chip>}
        </div>
        {event.lineupCompleteness.reason && (
          <p className="text-sm">{event.lineupCompleteness.reason}</p>
        )}
        <VisibilityActions
          eventId={event.id}
          title={event.title}
          visibility={event.visibility}
          passes={verification ? verification.passes : null}
          flags={verification ? verification.flags : []}
        />
      </div>

      <section aria-labelledby="fields" className="flex flex-col gap-3">
        <h2 id="fields" className="font-display text-xl font-bold">
          Event
        </h2>
        <Card className="p-4">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="font-semibold">Starts</dt>
            <dd>{formatIst(event.startsAt)}</dd>
            <dt className="font-semibold">Ends</dt>
            <dd>{event.endsAt ? formatIst(event.endsAt) : "—"}</dd>
            <dt className="font-semibold">Venue</dt>
            <dd>
              {event.venue
                ? `${event.venue.name}, ${event.venue.city}, ${event.venue.country}`
                : "TBA"}
            </dd>
            <dt className="font-semibold">Genre</dt>
            <dd>{event.genre ?? "—"}</dd>
            <dt className="font-semibold">Last verified</dt>
            <dd>
              {event.lastVerifiedAt
                ? `${formatAgo(event.lastVerifiedAt, now)} (${formatIst(event.lastVerifiedAt)})`
                : "Never"}
            </dd>
            <dt className="font-semibold">Sources</dt>
            <dd>
              <ul className="flex flex-col gap-1">
                {event.sources.map((s) => {
                  const url = s.url ? safeHttpUrl(s.url) : undefined;
                  return (
                    <li key={`${s.source}:${s.externalId}`}>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline underline-offset-2"
                        >
                          {s.source}
                          <span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : (
                        s.source
                      )}{" "}
                      <span className="text-muted">· seen {formatAgo(s.lastSeenAt, now)}</span>
                    </li>
                  );
                })}
              </ul>
            </dd>
          </dl>
        </Card>
      </section>

      <section aria-labelledby="verification" className="flex flex-col gap-3">
        <h2 id="verification" className="font-display text-xl font-bold">
          Verification
        </h2>
        <VerificationTable view={view} now={now} />
      </section>

      <section aria-labelledby="lineup" className="flex flex-col gap-3">
        <h2 id="lineup" className="font-display text-xl font-bold">
          Lineup
        </h2>
        {event.lineup.length === 0 ? (
          <p className="text-sm text-muted">No lineup yet.</p>
        ) : (
          groupByTier(event.lineup).map((g) => (
            <div key={g.tier}>
              <h3 className="font-semibold">{TIER_LABEL[g.tier]}</h3>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {g.artists.map((a) => (
                  <li key={a.artistId} className="flex flex-wrap items-center gap-2">
                    <MatchBadge status={a.matchStatus} />
                    <span className="font-semibold">{a.name}</span>
                    <span className="text-muted">{MATCH_STATE[a.matchStatus].label}</span>
                    {a.spotifyId && (
                      <a
                        href={spotifyArtistUrl(a.spotifyId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2"
                      >
                        Spotify
                        <span className="sr-only"> page for {a.name} (opens in a new tab)</span>
                      </a>
                    )}
                    {a.matchStatus === "needs_review" && (
                      <Link href="/admin/artists" className="underline underline-offset-2">
                        Review
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <section aria-labelledby="edit" className="flex flex-col gap-3">
        <h2 id="edit" className="font-display text-xl font-bold">
          Edit
        </h2>
        <Card className="p-4">
          <EventEditor
            key={event.updatedAt.toISOString()}
            eventId={event.id}
            initial={toEventForm(event)}
          />
        </Card>
      </section>
    </div>
  );
}

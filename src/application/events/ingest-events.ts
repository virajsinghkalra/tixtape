/**
 * Ingest one source (P1.6, LLD §5.2): fetch → resolve venue → dedupe/merge → upsert →
 * record an `ingest_runs` row. New artists are created `pending`; the artist-resolve job
 * (P1.8) picks them up from `ArtistRepository.listNeedingResolution`.
 */
import type { SourceAdapter, SourceFetchOptions } from "@/application/ports/event-source";
import type { IngestRunId, IngestRunRepository } from "@/application/ports/ingest-runs";
import type { EventMerge, EventRepository } from "@/application/ports/events";
import type { VenueRepository } from "@/application/ports/venues";
import type { RawEvent } from "@/domain/events/raw-event";
import type { Logger } from "@/lib/logger";
import { resolveVenue } from "./resolve-venue";
import { writeEvent, type EventWriterDeps, type WriteOutcome } from "./write-event";

export type IngestDeps = Omit<EventWriterDeps, "events"> & {
  /** D-028: possible duplicates are recorded for review, not only logged. */
  events: EventRepository & EventMerge;
  venues: VenueRepository;
  ingestRuns: IngestRunRepository;
  logger: Pick<Logger, "info" | "warn" | "error">;
};

export type IngestSummary = {
  runId: IngestRunId;
  status: "succeeded" | "failed";
  itemsSeen: number;
  /** Events created (including ones flagged for review). */
  itemsNew: number;
  itemsMerged: number;
  itemsUpdated: number;
  itemsForReview: number;
  itemsFailed: number;
};

type Counts = Omit<IngestSummary, "runId" | "status">;

/**
 * One event failing to save is logged and counted; the run continues. The run fails only
 * when the source itself fails (e.g. Ticketmaster returns 5xx), and that error is rethrown
 * after the run row is closed.
 */
export async function ingestEvents(
  deps: IngestDeps,
  adapter: SourceAdapter,
  opts: SourceFetchOptions,
): Promise<IngestSummary> {
  const runId = await deps.ingestRuns.start(adapter.source, deps.clock.now());
  const counts: Counts = {
    itemsSeen: 0,
    itemsNew: 0,
    itemsMerged: 0,
    itemsUpdated: 0,
    itemsForReview: 0,
    itemsFailed: 0,
  };
  try {
    for await (const raw of adapter.fetch(opts)) {
      counts.itemsSeen++;
      await ingestOne(deps, raw, counts);
    }
  } catch (e) {
    await finish(deps, runId, "failed", counts, e instanceof Error ? e.message : String(e));
    throw e;
  }
  const error = counts.itemsFailed > 0 ? `${counts.itemsFailed} event(s) failed to save` : null;
  await finish(deps, runId, "succeeded", counts, error);
  deps.logger.info({ source: adapter.source, runId, ...counts }, "ingest run finished");
  return { runId, status: "succeeded", ...counts };
}

async function ingestOne(deps: IngestDeps, raw: RawEvent, counts: Counts): Promise<void> {
  try {
    const venue = await resolveVenue(deps.venues, raw.venue);
    const outcome = await writeEvent(deps, { ...raw, venue, lineup: raw.lineup });
    if (outcome.kind === "created_for_review") {
      // D-028: the review queue (`event_merge_reviews`); idempotent on re-ingest.
      await deps.events.recordMergeReview(outcome.eventId, outcome.similarTo, outcome.score);
    }
    tally(deps, raw, outcome, counts);
  } catch (e) {
    counts.itemsFailed++;
    deps.logger.error(
      { err: e, source: raw.source, externalId: raw.externalId },
      "ingest: event failed to save",
    );
  }
}

function tally(deps: IngestDeps, raw: RawEvent, outcome: WriteOutcome, counts: Counts): void {
  switch (outcome.kind) {
    case "created":
      counts.itemsNew++;
      return;
    case "created_for_review":
      counts.itemsNew++;
      counts.itemsForReview++;
      // Recorded in the review queue by `ingestOne`; the log line stays for operators.
      deps.logger.warn(
        {
          source: raw.source,
          externalId: raw.externalId,
          eventId: outcome.eventId,
          similarTo: outcome.similarTo,
          score: outcome.score,
        },
        "ingest: possible duplicate event needs review",
      );
      return;
    case "merged":
      counts.itemsMerged++;
      return;
    case "updated":
      counts.itemsUpdated++;
      return;
  }
}

async function finish(
  deps: IngestDeps,
  runId: IngestRunId,
  status: "succeeded" | "failed",
  counts: Counts,
  error: string | null,
): Promise<void> {
  await deps.ingestRuns.finish(runId, {
    status,
    finishedAt: deps.clock.now(),
    itemsSeen: counts.itemsSeen,
    itemsNew: counts.itemsNew,
    error,
  });
}

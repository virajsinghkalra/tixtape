/**
 * Event source adapter contract (LLD §5.2). One implementation per source
 * (Ticketmaster today, admin entry doesn't need one). Owned by Events & Ingestion.
 */
import type { RawEvent } from "@/domain/events/raw-event";
import type { EventSource } from "@/domain/shared/lineup";

export type { RawEvent } from "@/domain/events/raw-event";

export type SourceFetchOptions = {
  /** Only events starting at or after this instant. */
  from: Date;
  /** Only events starting at or before this instant. Open-ended when omitted. */
  to?: Date;
};

export interface SourceAdapter {
  readonly source: EventSource;
  /**
   * Yields validated events. Malformed items are skipped (and logged) by the adapter;
   * an upstream failure (HTTP error, unusable page) throws an `UpstreamError`.
   */
  fetch(opts: SourceFetchOptions): AsyncIterable<RawEvent>;
}

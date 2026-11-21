/** Audit rows for ingest runs (`ingest_runs`). */
import type { EventSource } from "@/domain/shared/lineup";

export type IngestRunId = string & { readonly __brand: "IngestRunId" };

export type IngestRunResult = {
  status: "succeeded" | "failed";
  finishedAt: Date;
  itemsSeen: number;
  itemsNew: number;
  error: string | null;
};

export interface IngestRunRepository {
  start(source: EventSource, startedAt: Date): Promise<IngestRunId>;
  finish(id: IngestRunId, result: IngestRunResult): Promise<void>;
}

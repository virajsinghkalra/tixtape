import { eq } from "drizzle-orm";
import type {
  IngestRunId,
  IngestRunRepository,
  IngestRunResult,
} from "@/application/ports/ingest-runs";
import type { Database } from "@/db/client";
import { ingestRuns } from "@/db/schema";
import type { EventSource } from "@/domain/shared/lineup";

export class PgIngestRunRepository implements IngestRunRepository {
  constructor(private readonly db: Database) {}

  async start(source: EventSource, startedAt: Date): Promise<IngestRunId> {
    const rows = await this.db
      .insert(ingestRuns)
      .values({ source, startedAt, status: "running" })
      .returning({ id: ingestRuns.id });
    if (!rows[0]) throw new Error("ingest_runs insert returned no row");
    return rows[0].id as IngestRunId;
  }

  async finish(id: IngestRunId, result: IngestRunResult): Promise<void> {
    await this.db.update(ingestRuns).set(result).where(eq(ingestRuns.id, id));
  }
}

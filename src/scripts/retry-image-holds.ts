/**
 * D-091 daily retry: upcoming events held only because they had no picture get the image
 * providers run for them (poster, headliner photos), and are published once a picture exists.
 * Run daily after discovery, before the digest.
 *
 *   npx tsx src/scripts/retry-image-holds.ts [--limit=50]
 */
import "dotenv/config";
import { retryImageHolds } from "@/application/events";
import { PgEventVerificationRepository } from "@/infrastructure/db/event-verification-repository";
import { createImagesModule } from "@/infrastructure/images/images-module";
import { container } from "@/server/container";

async function main(): Promise<void> {
  const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 50);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  const c = container();
  const images = createImagesModule(c);
  const results = await retryImageHolds(
    {
      store: new PgEventVerificationRepository(c.db),
      fillForEvent: (id) => images.fillForEvent(id),
      clock: c.clock,
      logger: c.logger,
    },
    limit,
  );
  for (const r of results) console.warn(`${r.eventId}: ${JSON.stringify(r.result)}`);
  const published = results.filter((r) => "published" in r.result && r.result.published).length;
  console.warn(`retry-image-holds: checked=${results.length} published=${published}`);
  await c.db.$close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

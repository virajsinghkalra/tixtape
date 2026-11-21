/**
 * D-082/D-083: fills `events.poster_url` (with `poster_credit`, `poster_source`) through the image
 * pipeline. Today's event provider is the og:image of an allow-listed `official` source page,
 * read through PolitePageReader (robots.txt, pacing, SSRF guard; denied domains such as
 * BookMyShow, District and Instagram are never fetched). The URL is hotlinked, never re-hosted.
 * Stored posters are re-checked after 30 days and replaced when broken. Never touches
 * `image_url`, which ingestion owns.
 *
 *   npx tsx src/scripts/fill-event-images.ts [--dry-run] [--limit=50]
 */
import "dotenv/config";
import { createImagesModule } from "@/infrastructure/images/images-module";
import { container } from "@/server/container";
import { describeOutcome } from "./fill-artist-images";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limit = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 50);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  const c = container();
  const outcomes = await createImagesModule(c).fillEventPosters({ limit, dryRun });
  for (const o of outcomes) console.warn(describeOutcome(o));
  const set = outcomes.filter((o) => o.action === "set").length;
  console.warn(
    `fill-event-images: checked=${outcomes.length} set=${set}${dryRun ? " (dry run)" : ""}`,
  );
  await c.db.$close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

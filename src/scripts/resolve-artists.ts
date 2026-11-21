/**
 * Match pending lineup artists to Spotify (D-009). Run: npx tsx src/scripts/resolve-artists.ts [limit]
 * Scheduled by GitHub Actions later (P4.1).
 */
import "dotenv/config";
import { createImagesModule } from "@/infrastructure/images/images-module";
import { container } from "@/server/container";
import { matching } from "@/server/matching";

async function main(): Promise<void> {
  const limit = Number(process.argv[2] ?? 50);
  const report = await matching().resolvePendingArtists(limit);
  for (const o of report.outcomes) console.warn(JSON.stringify(o));
  console.warn(
    `resolved=${report.resolved} failed=${report.failed.length} blockedUntil=${report.blockedUntil ?? "-"}`,
  );
  // D-083: photos for artists Spotify has none for. Wikimedia only; never fails the run.
  const images = await createImagesModule(container())
    .fillArtistImages({ limit: limit * 2, dryRun: false })
    .catch((e: unknown) => {
      console.warn("artist images failed", e);
      return [];
    });
  console.warn(
    `artist images: checked=${images.length} set=${images.filter((o) => o.action === "set").length}`,
  );
  await container().db.$close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

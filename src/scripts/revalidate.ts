/**
 * Weekly artist re-check (P4.2, D-009): re-resolves Spotify ids last checked more than 30 days
 * ago, plus any still-pending artists, through Artist Matching. The 30-day rule and the
 * selection live in `resolvePendingArtists`; this only runs it in batches.
 *
 *   npx tsx src/scripts/revalidate.ts [maxArtists=500]
 */
import "dotenv/config";
import { createImagesModule } from "@/infrastructure/images/images-module";
import { container } from "@/server/container";
import { refreshPopularity } from "@/server/front-page";
import { matching } from "@/server/matching";
import { runAsSpotifyClass } from "@/infrastructure/spotify";

const BATCH = 50;
/** Leaves headroom inside the workflow's 30-minute timeout. */
const BUDGET_MS = 25 * 60_000;

async function main(): Promise<void> {
  const c = container();
  const max = Number(process.argv[2] ?? 500);
  if (!Number.isInteger(max) || max < 1) throw new Error("maxArtists must be a positive integer.");
  const deadline = c.clock.now().getTime() + BUDGET_MS;
  let resolved = 0;
  let changed = 0;
  let failures = 0;

  while (resolved < max && c.clock.now().getTime() < deadline) {
    const r = await matching().resolvePendingArtists(Math.min(BATCH, max - resolved));
    resolved += r.resolved;
    failures += r.failed.length;
    changed += r.outcomes.filter((o) => o.status !== "auto").length;
    for (const f of r.failed) console.warn(`  failed ${f.artistId}: ${f.message}`);
    if (r.blockedUntil) {
      console.warn(`Spotify asked us to wait until ${r.blockedUntil.toISOString()}; stopping.`);
      break;
    }
    // Nothing left that is due (failed artists stay due, so don't loop on them).
    if (r.resolved === 0) break;
  }

  console.warn(
    `revalidate: resolved=${resolved} needsReviewOrUnmatched=${changed} failed=${failures}`,
  );
  // D-079: keep the home page's Last.fm listeners cache fresh. Never fails the run.
  const pop = await refreshPopularity(500).catch((e: unknown) => {
    console.warn("popularity refresh failed", e);
    return null;
  });
  if (pop) console.warn(`popularity: checked=${pop.checked} known=${pop.known}`);
  // D-083: photo re-checks (30 days, broken links at once). Wikimedia only; never fails the run.
  const images = await createImagesModule(c)
    .fillArtistImages({ limit: 100, dryRun: false })
    .catch((e: unknown) => {
      console.warn("artist images failed", e);
      return [];
    });
  const imageCount = (a: string) => images.filter((o) => o.action === a).length;
  console.warn(
    `artist images: checked=${images.length} set=${imageCount("set")} kept=${imageCount("kept")} cleared=${imageCount("cleared")}`,
  );
  await c.db.$close();
  if (failures > 0) process.exitCode = 1;
}

// D-080: every Spotify call in this script counts as `revalidate` (background, capped).
runAsSpotifyClass("revalidate", main).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

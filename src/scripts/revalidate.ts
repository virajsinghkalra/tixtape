/**
 * Weekly artist re-check (P4.2, D-009): re-resolves Spotify ids last checked more than 30 days
 * ago, plus any still-pending artists, through Artist Matching. The 30-day rule and the
 * selection live in `resolvePendingArtists`; this only runs it in batches.
 *
 *   npx tsx src/scripts/revalidate.ts [maxArtists=500]
 */
import "dotenv/config";
import { container } from "@/server/container";
import { matching } from "@/server/matching";

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
  await c.db.$close();
  if (failures > 0) process.exitCode = 1;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

/**
 * Daily Gig Coverage digest (D-060, D-073/D-074), run right after `discover-gigs.ts` in the same
 * daily workflow. Covers the last 24 hours: events the auto-gate published (title, date, city,
 * sources), nights held or rejected and why, re-verification changes, and new leads. Sent through
 * the Alerts port only when there is something to report.
 *
 *   npx tsx src/scripts/gig-digest.ts
 */
import "dotenv/config";
import { formatGigDigest, loadGigActivity } from "@/infrastructure/alerts/gig-digest";
import { container } from "@/server/container";

const WINDOW_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const c = container();
  const now = c.clock.now();
  const since = new Date(now.getTime() - WINDOW_MS);
  const digest = formatGigDigest(await loadGigActivity(c.db, since), since, now);
  if (digest) {
    await c.alerts.send(digest);
    console.warn(`gig digest sent: ${digest.subject}`);
  } else {
    console.warn("gig digest: nothing to report in the last 24 h");
  }
  await c.db.$close();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

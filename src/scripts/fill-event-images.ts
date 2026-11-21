/**
 * D-082: fills `events.poster_url` from the official source page's og:image.
 *
 *   npx tsx src/scripts/fill-event-images.ts [--dry-run] [--limit=50]
 *
 * Only upcoming published events without a poster, and only source pages on the allow-list
 * with `official` trust. Reads go through PolitePageReader (robots.txt, 1 req/s/host, SSRF guard;
 * denied domains such as BookMyShow, District and Instagram are never fetched). The URL is
 * hotlinked, never re-hosted. Never touches `image_url`, which ingestion owns.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { allowedDomain } from "@/domain/events/extract/allow-list";
import { createGigsModule } from "@/infrastructure/gigs/gigs-module";
import { aliasCols, eventEndSql } from "@/infrastructure/db/event-time";
import { createMemoryHostLog } from "@/infrastructure/sources/polite-fetch";
import { container } from "@/server/container";

const Row = z.object({ id: z.string(), title: z.string(), url: z.string() });

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limit = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 50);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");

  const c = container();
  const reader = createGigsModule({
    db: c.db,
    clock: c.clock,
    logger: c.logger,
    searchesPerDay: 0,
    autoPublishEnabled: false,
  }).reader(createMemoryHostLog());

  const rows = [
    ...(await c.db.execute(sql`
      select e.id, e.title, s.url
      from events e join event_sources s on s.event_id = e.id
      where e.visibility = 'published' and e.poster_url is null and s.url is not null
        and ${eventEndSql(aliasCols("e"))} >= now()
      order by e.starts_at, e.id, (s.url ~ '/(event|upcoming-show)') desc, s.url
    `)),
  ].map((r) => Row.parse(r));

  // One official page per event: the first on the allow-list with `official` trust.
  const pages = new Map<string, z.infer<typeof Row>>();
  for (const r of rows) {
    if (pages.has(r.id) || allowedDomain(r.url)?.trust !== "official") continue;
    pages.set(r.id, r);
  }

  let filled = 0;
  const seen = new Map<string, string | null>(); // tour dates share one page: read it once
  const imageOf = async (url: string) => {
    if (!seen.has(url)) {
      const page = await reader.read(url);
      seen.set(url, page.status === "ok" ? (page.image ?? null) : null);
    }
    return seen.get(url) ?? null;
  };
  for (const r of [...pages.values()].slice(0, limit)) {
    try {
      const image = await imageOf(r.url);
      console.warn(`${image ? "✓" : "·"} ${r.title}: ${image ?? `no og:image (${r.url})`}`);
      if (!image || dryRun) continue;
      await c.db.execute(sql`update events set poster_url = ${image} where id = ${r.id}`);
      filled++;
    } catch (e) {
      console.warn(`✗ ${r.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.warn(
    `fill-event-images: ${pages.size} event(s) with an official page, ${filled} filled${dryRun ? " (dry run)" : ""}.`,
  );
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

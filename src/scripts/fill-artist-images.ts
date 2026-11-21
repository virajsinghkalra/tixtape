/**
 * D-083: free-licensed photos for artists without a Spotify image (Wikidata/Commons first),
 * stored in `artists.alt_image_*` with their credit. Also re-checks stored photos after 30 days
 * and replaces broken ones. Makes no Spotify calls.
 *
 *   npx tsx src/scripts/fill-artist-images.ts [--dry-run] [--limit=100]
 */
import "dotenv/config";
import type { FillOutcome } from "@/application/images/fill-images";
import { createImagesModule } from "@/infrastructure/images/images-module";
import { container } from "@/server/container";

export function describeOutcome(o: FillOutcome): string {
  const mark = { set: "✓", kept: "=", none: "·", cleared: "✗", failed: "!" }[o.action];
  const lines = [`${mark} ${o.name}: ${o.action}${o.image ? ` ${o.image.url}` : ""}`];
  if (o.image?.credit) lines.push(`    credit: ${o.image.credit}`);
  for (const t of o.found?.tried ?? []) {
    const evidence = t.candidate?.evidence.join("; ");
    const what = t.refused ?? (t.candidate ? "candidate" : "nothing");
    lines.push(`    ${t.provider}: ${what}${evidence ? ` (${evidence})` : ""}`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const limit = Number(argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 100);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  const c = container();
  const outcomes = await createImagesModule(c).fillArtistImages({ limit, dryRun });
  for (const o of outcomes) console.warn(describeOutcome(o));
  const count = (a: FillOutcome["action"]) => outcomes.filter((o) => o.action === a).length;
  console.warn(
    `fill-artist-images: checked=${outcomes.length} set=${count("set")} kept=${count("kept")} none=${count("none")} cleared=${count("cleared")} failed=${count("failed")}${dryRun ? " (dry run)" : ""}`,
  );
  await c.db.$close();
}

if (process.argv[1]?.endsWith("fill-artist-images.ts")) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

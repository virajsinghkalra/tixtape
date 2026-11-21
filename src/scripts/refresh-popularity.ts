/**
 * Fills the Last.fm listeners cache that ranks the home page (D-079).
 *   npx tsx src/scripts/refresh-popularity.ts [maxArtists=300]
 * Also runs at the end of the weekly revalidate script.
 */
import "dotenv/config";
import { refreshPopularity } from "@/server/front-page";

async function main(): Promise<void> {
  const max = Number(process.argv[2] ?? 300);
  if (!Number.isInteger(max) || max < 1) throw new Error("maxArtists must be a positive integer.");
  const r = await refreshPopularity(max);
  if (!r) console.warn("refresh-popularity: LASTFM_API_KEY is not set; nothing to do.");
  else console.warn(`refresh-popularity: checked=${r.checked} known=${r.known} failed=${r.failed}`);
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

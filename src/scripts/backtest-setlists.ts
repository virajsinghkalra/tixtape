/**
 * Measures setlist prediction: for each artist's latest K shows, rank songs with the real
 * setlist.fm scorer using only earlier setlists, take the top N (N = songs actually played)
 * and score recall/precision. Titles only, no Spotify.
 *   npm run backtest:setlists -- [--shows=5] [Artist One] [Artist Two]
 * Responses are cached in .cache/setlistfm-backtest.json; delete it to refetch.
 */
import "dotenv/config";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { SETLISTFM_BASE_URL } from "@/infrastructure/music-signals/setlistfm";
import { backtestArtist, type RawSearch } from "@/infrastructure/music-signals/setlistfm-backtest";

const DEFAULT_ARTISTS = [
  "Coldplay",
  "Ed Sheeran",
  "Arijit Singh",
  "Diljit Dosanjh",
  "The Chainsmokers",
  "Fred again..",
  "Shreya Ghoshal",
  "Dua Lipa",
  "Travis Scott",
  "Martin Garrix",
  "Karan Aujla",
  "AP Dhillon",
  "Bryan Adams",
  "Maroon 5",
  "Prateek Kuhad",
  "Anuv Jain",
];
const PAGES = 2;
const CACHE_FILE = ".cache/setlistfm-backtest.json";
const MIN_INTERVAL_MS = 1_100;

type Cache = Record<string, (RawSearch & { pages?: number }) | null>;

async function loadCache(): Promise<Cache> {
  try {
    return JSON.parse(await readFile(CACHE_FILE, "utf8")) as Cache;
  } catch {
    return {};
  }
}

let lastCall = 0;
async function fetchSearch(
  artist: string,
  apiKey: string,
  page: number,
): Promise<RawSearch | null> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const url = new URL(`${SETLISTFM_BASE_URL}/search/setlists`);
  url.search = new URLSearchParams({ artistName: artist, p: String(page) }).toString();
  let res = await fetch(url, { headers: { Accept: "application/json", "x-api-key": apiKey } });
  for (let retry = 0; res.status === 429 && retry < 3; retry++) {
    await new Promise((r) => setTimeout(r, 5_000 * (retry + 1)));
    res = await fetch(url, { headers: { Accept: "application/json", "x-api-key": apiKey } });
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`setlist.fm answered ${res.status} for ${artist}`);
  return (await res.json()) as RawSearch;
}

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const showsArg = args.find((a) => a.startsWith("--shows="));
  const k = showsArg ? Number(showsArg.slice(8)) : 5;
  if (!Number.isInteger(k) || k < 1) throw new Error("--shows must be a positive integer.");
  const names = args.filter((a) => !a.startsWith("--"));
  const artists = names.length > 0 ? names : DEFAULT_ARTISTS;

  const cache = await loadCache();
  const apiKey = process.env.SETLISTFM_API_KEY;
  const recalls: number[] = [];
  const copyRecalls: number[] = [];

  for (const artist of artists) {
    const have = cache[artist]?.pages ?? (artist in cache ? 1 : 0);
    if (have < PAGES) {
      if (!apiKey) throw new Error(`SETLISTFM_API_KEY is not set and ${artist} is not cached.`);
      const merged: RawSearch & { pages?: number } = cache[artist] ?? {};
      for (let page = have + 1; page <= PAGES; page++) {
        const body = await fetchSearch(artist, apiKey, page);
        if (!body) break;
        merged.setlist = [...(merged.setlist ?? []), ...(body.setlist ?? [])];
      }
      merged.pages = PAGES;
      cache[artist] = merged.setlist ? merged : null;
      await mkdir(".cache", { recursive: true });
      await writeFile(CACHE_FILE, JSON.stringify(cache));
    }
    const r = await backtestArtist(artist, cache[artist] ?? {}, k);
    console.warn(`\n${artist}`);
    if (r.insufficient) {
      console.warn("  insufficient data");
      continue;
    }
    console.warn("  date        N   hits  recall  precision");
    for (const { date, score: s } of r.shows) {
      console.warn(
        `  ${date}  ${String(s.actualCount).padStart(2)}  ${String(s.hits).padStart(4)}  ${pct(s.recall).padStart(6)}  ${pct(s.precision).padStart(9)}`,
      );
      recalls.push(s.recall);
    }
    for (const { copyLast } of r.shows) {
      copyRecalls.push(copyLast.recall);
    }
    const mean = r.shows.reduce((a, x) => a + x.score.recall, 0) / r.shows.length;
    console.warn(`  mean recall ${pct(mean)} over ${r.shows.length} shows`);
  }

  const overall = recalls.length ? recalls.reduce((a, b) => a + b, 0) / recalls.length : 0;
  console.warn(
    `\nOverall mean recall: ${(overall * 100).toFixed(1)}% over ${recalls.length} shows`,
  );
  const copy = copyRecalls.reduce((a, b) => a + b, 0) / (copyRecalls.length || 1);
  console.warn(`Copy-last-full-show baseline: ${(copy * 100).toFixed(1)}%`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

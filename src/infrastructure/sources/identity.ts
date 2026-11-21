/**
 * Headliner identity (D-051, D-056 layer 3): Spotify ID → Wikidata item (P1902) → MusicBrainz
 * artist (P434) → most recent release year. Both CC0, polite (1 req/s, identifying
 * User-Agent), and cached in the collector state so each artist is looked up about monthly.
 */
import { z } from "zod";
import type { ArtistIdentityLookup } from "@/application/ingestion/ports";
import type { HeadlinerIdentity } from "@/domain/events/extract/verify";
import type { PoliteFetcher } from "./polite-fetch";
import { WIKIDATA_API, WikidataClaimsSchema, WikidataSearchSchema } from "./wikidata";

const MUSICBRAINZ = "https://musicbrainz.org/ws/2";
const TTL_MS = 30 * 86_400_000;

const ReleaseGroupsSchema = z.object({
  "release-groups": z.array(z.object({ "first-release-date": z.string().optional() })),
});

export interface IdentityCache {
  getIdentity(
    spotifyId: string,
  ): Promise<{ value: HeadlinerIdentity | null; checkedAt: Date } | undefined>;
  setIdentity(spotifyId: string, value: HeadlinerIdentity | null, checkedAt: Date): Promise<void>;
}

export class WikidataMusicBrainzIdentity implements ArtistIdentityLookup {
  constructor(
    private readonly deps: { fetcher: PoliteFetcher; cache: IdentityCache; clock: { now(): Date } },
  ) {}

  async lookup(spotifyId: string): Promise<HeadlinerIdentity | null> {
    if (!/^[0-9A-Za-z]{22}$/u.test(spotifyId)) return null;
    const now = this.deps.clock.now();
    const cached = await this.deps.cache.getIdentity(spotifyId);
    if (cached && now.getTime() - cached.checkedAt.getTime() < TTL_MS) return cached.value;
    const value = await this.fetchIdentity(spotifyId);
    await this.deps.cache.setIdentity(spotifyId, value, now);
    return value;
  }

  private async json(url: URL): Promise<unknown> {
    const text = await this.deps.fetcher.getText(url.href, {
      accept: "application/json",
      policy: "api-etiquette",
    });
    return JSON.parse(text);
  }

  private async fetchIdentity(spotifyId: string): Promise<HeadlinerIdentity | null> {
    const search = new URL(WIKIDATA_API);
    search.search = new URLSearchParams({
      action: "query",
      list: "search",
      srsearch: `haswbstatement:P1902=${spotifyId}`,
      format: "json",
    }).toString();
    const found = WikidataSearchSchema.safeParse(await this.json(search));
    const qid = found.success ? found.data.query.search[0]?.title : undefined;
    if (!qid) return null;
    const entity = new URL(WIKIDATA_API);
    entity.search = new URLSearchParams({
      action: "wbgetentities",
      ids: qid,
      props: "claims",
      format: "json",
    }).toString();
    const parsed = WikidataClaimsSchema.safeParse(await this.json(entity));
    const mbidValue = parsed.success
      ? parsed.data.entities[qid]?.claims?.P434?.[0]?.mainsnak.datavalue?.value
      : undefined;
    const mbid =
      typeof mbidValue === "string" && /^[0-9a-f-]{36}$/u.test(mbidValue) ? mbidValue : null;
    if (!mbid) return { wikidataId: qid, mbid: null, lastReleaseYear: null };
    const releases = new URL(`${MUSICBRAINZ}/release-group`);
    releases.search = new URLSearchParams({ artist: mbid, fmt: "json", limit: "100" }).toString();
    const groups = ReleaseGroupsSchema.safeParse(await this.json(releases));
    const years = groups.success
      ? groups.data["release-groups"]
          .map((g) => Number(g["first-release-date"]?.slice(0, 4)))
          .filter((y) => Number.isInteger(y) && y > 1900)
      : [];
    return { wikidataId: qid, mbid, lastReleaseYear: years.length > 0 ? Math.max(...years) : null };
  }
}

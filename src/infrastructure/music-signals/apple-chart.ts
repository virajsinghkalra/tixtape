/**
 * Apple Music RSS "most played" chart (D-038 "trending"). One request per market per day;
 * no key needed. https://rss.marketingtools.apple.com/api/v2/in/music/most-played/100/songs.json
 */
import { z } from "zod";
import type { Clock } from "@/application/ports/clock";
import type { ChartEntry, TrendingSource } from "@/application/ports/music-signals";
import { REQUEST_TIMEOUT_MS } from "@/application/playlists";
import { UpstreamError } from "@/lib/errors";
import { TtlCache } from "./ttl-cache";

export const APPLE_RSS_BASE_URL = "https://rss.marketingtools.apple.com";
const UPSTREAM = "apple_music_rss";
const CHART_SIZE = 100;

const ResponseSchema = z.object({
  feed: z.object({
    results: z.array(
      z.object({ name: z.string().trim().min(1), artistName: z.string().trim().min(1) }),
    ),
  }),
});

export type AppleChartDeps = {
  fetch: typeof fetch;
  clock: Clock;
  baseUrl?: string;
  /** D-045. Defaults to REQUEST_TIMEOUT_MS. */
  timeoutMs?: number;
};

export class AppleMusicTrending implements TrendingSource {
  private readonly cache: TtlCache<ChartEntry[]>;

  constructor(private readonly deps: AppleChartDeps) {
    this.cache = new TtlCache(deps.clock);
  }

  chart(market: string): Promise<ChartEntry[]> {
    if (!/^[A-Za-z]{2}$/u.test(market)) {
      return Promise.reject(new UpstreamError(UPSTREAM, `Unsupported market "${market}".`));
    }
    const country = market.toLowerCase();
    return this.cache.getOrLoad(country, () => this.fetchChart(country));
  }

  private async fetchChart(country: string): Promise<ChartEntry[]> {
    const base = this.deps.baseUrl ?? APPLE_RSS_BASE_URL;
    const url = `${base}/api/v2/${country}/music/most-played/${CHART_SIZE}/songs.json`;
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(UPSTREAM, "Apple Music charts could not be reached.", { cause: e });
    }
    if (!res.ok) throw new UpstreamError(UPSTREAM, `Apple Music charts answered ${res.status}.`);
    const parsed = ResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success) {
      throw new UpstreamError(UPSTREAM, "Apple Music charts sent an unexpected response.");
    }
    return parsed.data.feed.results.map((r, i) => ({
      title: r.name,
      artistName: r.artistName,
      rank: i + 1,
    }));
  }
}

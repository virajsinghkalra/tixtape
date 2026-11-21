/**
 * setlist.fm (D-085): what an artist actually plays live. One request per artist,
 * `GET /rest/1.0/search/setlists?artistName=…&p=1` (the 20 most recent setlists), turned into
 * per-song scores: the share of recent non-empty setlists with the song, plus a bonus for
 * songs on the current tour (the newest setlist's tour).
 *
 * Terms: free for non-commercial use, with attribution wherever the data is used
 * (`SETLISTFM_ATTRIBUTION`, in the playlist description). Only derived scores are kept, in
 * memory and the song cache, never raw setlists. Paced to 1 request a second with a daily cap,
 * well under their published key limits.
 */
import { z } from "zod";
import { REQUEST_TIMEOUT_MS } from "@/application/playlists";
import type { Clock } from "@/application/ports/clock";
import type { SongScoreProvider } from "@/application/ports/music-signals";
import { setlistScore } from "@/domain/playlists/song-score";
import { normalizeTrackTitle } from "@/domain/playlists/track-title";
import { normalizeArtistName } from "@/domain/shared/normalize";
import { UpstreamError } from "@/lib/errors";
import { DAY_MS, TtlCache } from "./ttl-cache";

export const SETLISTFM_ATTRIBUTION = "Live setlists: setlist.fm";
export const SETLISTFM_BASE_URL = "https://api.setlist.fm/rest/1.0";
const UPSTREAM = "setlistfm";
const MIN_REQUEST_INTERVAL_MS = 1_000;
export const SETLISTFM_DAILY_CAP = 1_000;

const Song = z.object({ name: z.string().default(""), tape: z.boolean().optional() });
const SetlistSchema = z.object({
  eventDate: z.string().optional(),
  artist: z.object({ name: z.string() }),
  tour: z.object({ name: z.string() }).optional(),
  sets: z
    .object({ set: z.array(z.object({ song: z.array(Song).default([]) })).default([]) })
    .default({ set: [] }),
});
const ResponseSchema = z.object({ setlist: z.array(SetlistSchema).default([]) });

export type SetlistfmDeps = {
  apiKey: string;
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
  baseUrl?: string;
  timeoutMs?: number;
};

type Scores = Awaited<ReturnType<SongScoreProvider["scores"]>>;
const UNKNOWN: Scores = { known: false, songs: [] };

export class SetlistfmScores implements SongScoreProvider {
  readonly id = "setlistfm" as const;
  private readonly cache: TtlCache<Scores>;
  private nextRequestAt = 0;
  private day = -1;
  private usedToday = 0;

  constructor(private readonly deps: SetlistfmDeps) {
    this.cache = new TtlCache(deps.clock, 14 * DAY_MS);
  }

  scores(artistName: string): Promise<Scores> {
    return this.cache.getOrLoad(normalizeArtistName(artistName), () => this.load(artistName));
  }

  private async load(artistName: string): Promise<Scores> {
    const body = await this.get(artistName);
    if (!body) return UNKNOWN;
    const target = normalizeArtistName(artistName);
    // The search is fuzzy: keep the artist's own setlists that list songs, newest first.
    const setlists = body.setlist.filter(
      (s) => normalizeArtistName(s.artist.name) === target && songsOf(s).length > 0,
    );
    if (setlists.length === 0) return UNKNOWN;
    const currentTour = setlists[0]?.tour?.name ?? null;
    const plays = new Map<string, { title: string; count: number; onTour: boolean }>();
    for (const s of setlists) {
      const onTour = currentTour !== null && s.tour?.name === currentTour;
      for (const title of new Set(songsOf(s))) {
        const key = normalizeTrackTitle(title);
        const entry = plays.get(key) ?? { title, count: 0, onTour: false };
        entry.count++;
        entry.onTour ||= onTour;
        plays.set(key, entry);
      }
    }
    return {
      known: true,
      songs: [...plays.values()].map((p) => ({
        title: p.title,
        score: setlistScore(p.count, setlists.length, p.onTour),
      })),
    };
  }

  /** Null when setlist.fm has nothing for the name (it answers 404). */
  private async get(artistName: string): Promise<z.infer<typeof ResponseSchema> | null> {
    this.countToday();
    const url = new URL(`${this.deps.baseUrl ?? SETLISTFM_BASE_URL}/search/setlists`);
    url.search = new URLSearchParams({ artistName, p: "1" }).toString();
    await this.pace();
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        headers: { Accept: "application/json", "x-api-key": this.deps.apiKey },
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(UPSTREAM, "setlist.fm could not be reached.", { cause: e });
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new UpstreamError(UPSTREAM, `setlist.fm answered ${res.status}.`);
    const parsed = ResponseSchema.safeParse(await res.json().catch(() => undefined));
    if (!parsed.success)
      throw new UpstreamError(UPSTREAM, "setlist.fm sent an unexpected response.");
    return parsed.data;
  }

  private countToday(): void {
    const day = Math.floor(this.deps.clock.now().getTime() / DAY_MS);
    if (day !== this.day) {
      this.day = day;
      this.usedToday = 0;
    }
    if (this.usedToday >= SETLISTFM_DAILY_CAP) {
      throw new UpstreamError(UPSTREAM, "setlist.fm daily request cap reached.");
    }
    this.usedToday++;
  }

  private async pace(): Promise<void> {
    const now = this.deps.clock.now().getTime();
    const at = Math.max(now, this.nextRequestAt);
    this.nextRequestAt = at + MIN_REQUEST_INTERVAL_MS;
    if (at > now) await this.deps.sleep(at - now);
  }
}

/** A setlist's own songs: intro/outro tapes and blank entries don't count. */
const songsOf = (s: z.infer<typeof SetlistSchema>) =>
  s.sets.set.flatMap((set) =>
    set.song.filter((g) => !g.tape && g.name.trim() !== "").map((g) => g.name),
  );

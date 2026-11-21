/**
 * Small state the collector keeps between local runs, in one JSON file: per-host last fetch
 * and robots.txt (so a crawl-delay holds across runs), and Spotify artist verdicts.
 * Default location is under node_modules/.cache (git-ignored). Losing the file is harmless:
 * robots.txt is re-read and names are re-checked.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ArtistValidationCache, CachedValidation } from "@/application/ingestion/ports";
import type { DoubtStore } from "@/application/ingestion/doubt-resolver";
import type { HeadlinerIdentity } from "@/domain/events/extract/verify";
import type { GeocodeCache } from "./geocoder";
import type { IdentityCache } from "./identity";
import type { HostLog } from "./polite-fetch";

export const DEFAULT_STATE_PATH = "node_modules/.cache/lineupmixes/collector-state.json";

const StateSchema = z.object({
  hosts: z.record(
    z.string(),
    z.object({
      lastFetchAt: z.iso.datetime().nullable(),
      robots: z.object({ text: z.string(), fetchedAt: z.iso.datetime() }).nullable(),
    }),
  ),
  artists: z.record(
    z.string(),
    z.object({
      confirmed: z.string().nullable(),
      spotifyId: z.string().nullable().optional(),
      checkedAt: z.iso.datetime(),
    }),
  ),
  identities: z
    .record(
      z.string(),
      z.object({
        value: z
          .object({
            wikidataId: z.string().nullable(),
            mbid: z.string().nullable(),
            lastReleaseYear: z.number().nullable(),
          })
          .nullable(),
        checkedAt: z.iso.datetime(),
      }),
    )
    .default({}),
  geocodes: z.record(z.string(), z.object({ city: z.string().nullable() })).default({}),
  doubtUsage: z
    .record(z.string(), z.object({ searches: z.number(), modelCalls: z.number() }))
    .default({}),
  doubtCache: z
    .record(z.string(), z.object({ value: z.unknown(), at: z.iso.datetime() }))
    .default({}),
});
type State = z.infer<typeof StateSchema>;
const empty = (): State => ({
  hosts: {},
  artists: {},
  identities: {},
  geocodes: {},
  doubtUsage: {},
  doubtCache: {},
});

export class FileCollectorState
  implements HostLog, ArtistValidationCache, IdentityCache, GeocodeCache, DoubtStore
{
  private state: State | null = null;

  constructor(private readonly path: string = DEFAULT_STATE_PATH) {}

  private async load(): Promise<State> {
    if (this.state) return this.state;
    try {
      const parsed = StateSchema.safeParse(JSON.parse(await readFile(this.path, "utf8")));
      this.state = parsed.success ? parsed.data : empty();
    } catch {
      this.state = empty();
    }
    return this.state;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(this.state));
  }

  private async host(host: string) {
    const state = await this.load();
    state.hosts[host] ??= { lastFetchAt: null, robots: null };
    return state.hosts[host];
  }

  async lastFetchAt(host: string): Promise<Date | null> {
    const at = (await this.host(host)).lastFetchAt;
    return at === null ? null : new Date(at);
  }

  async recordFetch(host: string, at: Date): Promise<void> {
    (await this.host(host)).lastFetchAt = at.toISOString();
    await this.save();
  }

  async robots(host: string) {
    const r = (await this.host(host)).robots;
    return r === null ? undefined : { text: r.text, fetchedAt: new Date(r.fetchedAt) };
  }

  async saveRobots(host: string, value: { text: string; fetchedAt: Date }): Promise<void> {
    (await this.host(host)).robots = { text: value.text, fetchedAt: value.fetchedAt.toISOString() };
    await this.save();
  }

  async get(normalizedName: string): Promise<CachedValidation | undefined> {
    const v = (await this.load()).artists[normalizedName];
    return v
      ? { confirmed: v.confirmed, spotifyId: v.spotifyId ?? null, checkedAt: new Date(v.checkedAt) }
      : undefined;
  }

  async set(normalizedName: string, value: CachedValidation): Promise<void> {
    (await this.load()).artists[normalizedName] = {
      confirmed: value.confirmed,
      spotifyId: value.spotifyId ?? null,
      checkedAt: value.checkedAt.toISOString(),
    };
    await this.save();
  }

  async getIdentity(spotifyId: string) {
    const v = (await this.load()).identities[spotifyId];
    return v ? { value: v.value, checkedAt: new Date(v.checkedAt) } : undefined;
  }

  async setIdentity(spotifyId: string, value: HeadlinerIdentity | null, checkedAt: Date) {
    (await this.load()).identities[spotifyId] = { value, checkedAt: checkedAt.toISOString() };
    await this.save();
  }

  async getGeocode(key: string) {
    return (await this.load()).geocodes[key];
  }

  async setGeocode(key: string, city: string | null) {
    (await this.load()).geocodes[key] = { city };
    await this.save();
  }

  async usage(day: string) {
    return (await this.load()).doubtUsage[day] ?? { searches: 0, modelCalls: 0 };
  }

  async addUsage(day: string, delta: { searches?: number; modelCalls?: number }) {
    const state = await this.load();
    const u = state.doubtUsage[day] ?? { searches: 0, modelCalls: 0 };
    state.doubtUsage[day] = {
      searches: u.searches + (delta.searches ?? 0),
      modelCalls: u.modelCalls + (delta.modelCalls ?? 0),
    };
    await this.save();
  }

  async cached(key: string) {
    const v = (await this.load()).doubtCache[key];
    return v ? { value: v.value, at: new Date(v.at) } : undefined;
  }

  async cache(key: string, value: unknown, at: Date) {
    (await this.load()).doubtCache[key] = { value, at: at.toISOString() };
    await this.save();
  }
}

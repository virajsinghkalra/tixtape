/**
 * Artist validation at $0 (D-024, D-033): a candidate name becomes a lineup artist only when
 * Spotify artist search returns an artist with exactly that normalized name. Verdicts are
 * cached; artists we already matched to Spotify skip the call. `SpotifyBlockedError` (D-006,
 * D-032) propagates so the caller can stop the run cleanly.
 */
import type { ArtistRepository } from "@/application/ports/artists";
import type { Clock } from "@/application/ports/clock";
import type { ArtistCatalog } from "@/application/ports/spotify";
import type { ArtistMention } from "@/domain/events/extract/candidate";
import { normalizeArtistName } from "@/domain/shared/normalize";
import type { ArtistValidationCache } from "./ports";

/** Verdicts are re-checked after 30 days, like artist matches (D-009). */
const TTL_MS = 30 * 86_400_000;

export type ArtistValidatorDeps = {
  catalog: ArtistCatalog;
  artists: Pick<ArtistRepository, "findByAlias">;
  cache: ArtistValidationCache;
  clock: Clock;
};

export class ArtistValidator {
  /** Spotify calls made by this validator (the rest came from caches or our DB). */
  searches = 0;
  private readonly memo = new Map<string, Promise<string | null>>();
  private readonly ids = new Map<string, string>();

  constructor(private readonly deps: ArtistValidatorDeps) {}

  /** The confirmed display name (Spotify's spelling), or null. */
  confirm(name: string): Promise<string | null> {
    const key = normalizeArtistName(name);
    if (key === "") return Promise.resolve(null);
    let pending = this.memo.get(key);
    if (!pending) {
      pending = this.lookUp(name, key);
      this.memo.set(key, pending);
      // A failed lookup (e.g. Spotify blocked) must not be remembered as a verdict.
      pending.catch(() => this.memo.delete(key));
    }
    return pending;
  }

  /** The Spotify ID of a confirmed name, when known (for identity checks, D-056 layer 3). */
  spotifyIdOf(name: string): string | null {
    return this.ids.get(normalizeArtistName(name)) ?? null;
  }

  /** Confirmed names for a mention: the whole name if Spotify knows it, else its parts. */
  async validate(mention: ArtistMention): Promise<string[]> {
    const whole = await this.confirm(mention.name);
    if (whole !== null) return [whole];
    const out: string[] = [];
    for (const part of mention.parts) out.push(...(await this.validate(part)));
    return out;
  }

  private async lookUp(name: string, key: string): Promise<string | null> {
    const now = this.deps.clock.now();
    const cached = await this.deps.cache.get(key);
    // Entries written before Spotify IDs were kept are refreshed once for confirmed names.
    const lacksId = Boolean(cached?.confirmed) && !cached?.spotifyId;
    if (cached && !lacksId && now.getTime() - cached.checkedAt.getTime() < TTL_MS) {
      if (cached.confirmed && cached.spotifyId) this.remember(cached.confirmed, cached.spotifyId);
      return cached.confirmed;
    }
    const known = await this.deps.artists.findByAlias(key);
    if (known?.spotifyId && (known.matchStatus === "auto" || known.matchStatus === "manual")) {
      this.remember(known.name, known.spotifyId);
      return known.name;
    }
    this.searches++;
    const results = await this.deps.catalog.searchArtists(name, { kind: "app" });
    const hit = results.find((r) => normalizeArtistName(r.name) === key);
    const confirmed = hit?.name ?? null;
    if (hit) this.remember(hit.name, hit.id);
    await this.deps.cache.set(key, { confirmed, spotifyId: hit?.id ?? null, checkedAt: now });
    return confirmed;
  }

  private remember(name: string, spotifyId: string): void {
    this.ids.set(normalizeArtistName(name), spotifyId);
  }
}

/**
 * The image pipeline's composition (D-083). The provider lists below are the only config:
 * to add a source (MusicBrainz, Deezer, an organiser API), write one `ImageProvider` adapter
 * and add it to `artistProviders` or `eventProviders`. Order is the order they are asked;
 * which picture wins is decided by `DEFAULT_IMAGE_POLICY` (trust order, licence, confidence).
 */
import {
  fillArtistImages,
  fillEventPosters,
  type FillOptions,
  type FillOutcome,
} from "@/application/images/fill-images";
import type { Clock } from "@/application/ports/clock";
import type { ImageProvider } from "@/application/ports/images";
import type { Database } from "@/db/client";
import type { Logger } from "@/lib/logger";
import { createGigsModule } from "@/infrastructure/gigs/gigs-module";
import { createMemoryHostLog, PoliteFetcher } from "@/infrastructure/sources/polite-fetch";
import { OfficialPosterProvider, StoredSpotifyImageProvider } from "./basic-providers";
import { HttpImageLinkChecker } from "./link-checker";
import { PgArtistImageStore, PgEventPosterStore } from "./pg-image-stores";
import { WikimediaImageProvider } from "./wikimedia-provider";

export type ImagesModule = {
  artistProviders: readonly ImageProvider[];
  eventProviders: readonly ImageProvider[];
  fillArtistImages(opts: FillOptions): Promise<FillOutcome[]>;
  fillEventPosters(opts: FillOptions): Promise<FillOutcome[]>;
};

export function createImagesModule(deps: {
  db: Database;
  clock: Clock;
  logger: Logger;
  fetch?: typeof fetch;
}): ImagesModule {
  const fetchImpl = deps.fetch ?? fetch;
  const fetcher = new PoliteFetcher({
    fetch: fetchImpl,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    clock: deps.clock,
    logger: deps.logger,
    hostLog: createMemoryHostLog(),
    // Batched wbgetentities reads can take longer than the collector's 10 s default.
    timeoutMs: 20_000,
  });
  const pageReader = createGigsModule({
    db: deps.db,
    clock: deps.clock,
    logger: deps.logger,
    searchesPerDay: 0,
    autoPublishEnabled: false,
  }).reader(createMemoryHostLog());

  const artistProviders: ImageProvider[] = [
    new StoredSpotifyImageProvider(),
    new WikimediaImageProvider(fetcher),
  ];
  const eventProviders: ImageProvider[] = [new OfficialPosterProvider(pageReader)];

  const links = new HttpImageLinkChecker({ fetch: fetchImpl });
  const artistStore = new PgArtistImageStore(deps.db);
  const posterStore = new PgEventPosterStore(deps.db);
  return {
    artistProviders,
    eventProviders,
    fillArtistImages: (opts) =>
      fillArtistImages(
        { providers: artistProviders, links, clock: deps.clock, store: artistStore },
        opts,
      ),
    fillEventPosters: (opts) =>
      fillEventPosters(
        { providers: eventProviders, links, clock: deps.clock, store: posterStore },
        opts,
      ),
  };
}

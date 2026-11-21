/**
 * Zod schemas for the Spotify responses we use (D-007). Only the fields we read are declared;
 * unknown fields pass through untouched. `popularity` and `followers` are deliberately absent.
 */
import { z } from "zod";

/** Base62 ids. Checked before an id goes into a URL path, so `..` or `/` can't sneak in. */
export const SPOTIFY_ID = /^[A-Za-z0-9]{1,64}$/;

/** Every id we may later put in a URL path is checked here (LLD §12). */
const spotifyId = z.string().regex(SPOTIFY_ID);

const image = z.object({ url: z.string() });

export const artistSchema = z.object({
  id: spotifyId,
  name: z.string(),
  images: z.array(image).nullish(),
  genres: z.array(z.string()).nullish(),
});

const artistRef = z.object({ id: spotifyId.nullable() });

const albumRef = z.object({
  id: spotifyId,
  release_date: z.string().nullish(),
});

export const trackSchema = z.object({
  id: spotifyId.nullable(),
  name: z.string(),
  artists: z.array(artistRef),
  album: albumRef,
  duration_ms: z.number(),
  external_ids: z.object({ isrc: z.string().optional() }).nullish(),
});

/** Album tracks are "simplified": no album and no external ids. */
export const simplifiedTrackSchema = trackSchema.omit({ album: true, external_ids: true });

/** Spotify sometimes returns null entries inside `items`. */
const page = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item.nullable()) });

export const artistSearchSchema = z.object({ artists: page(artistSchema) });
export const trackSearchSchema = z.object({ tracks: page(trackSchema) });

export const albumSchema = z.object({
  id: spotifyId,
  name: z.string(),
  release_date: z.string().nullish(),
  album_type: z.string(),
  album_group: z.string().optional(),
});
export const artistAlbumsSchema = page(albumSchema);
export const albumTracksSchema = page(simplifiedTrackSchema);

export const createdPlaylistSchema = z.object({
  id: spotifyId,
  external_urls: z.object({ spotify: z.string() }),
  snapshot_id: z.string().nullish(),
});

export const snapshotSchema = z.object({ snapshot_id: z.string() });

export const profileSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().nullish(),
});

/**
 * Image pipeline ports (D-083). A provider proposes a picture for a subject; stores keep the
 * chosen one with its credit. Adding a source (MusicBrainz, Deezer, organiser APIs) is one new
 * `ImageProvider` adapter plus an entry in the provider list (`src/infrastructure/images`).
 */
import type { ImageCandidate, ImageSubject } from "@/domain/images/image";
import type { ArtistId, EventId } from "@/domain/shared/ids";

export interface ImageProvider {
  /** Stable name for logs and dry runs, e.g. "wikimedia". */
  readonly id: string;
  supports(subject: ImageSubject): boolean;
  /** At most one candidate; null when this source has nothing it is sure about. */
  find(subject: ImageSubject): Promise<ImageCandidate | null>;
}

/** Checks a stored image link still serves (HEAD). Broken links trigger a new search. */
export interface ImageLinkChecker {
  isBroken(url: string): Promise<boolean>;
}

/** The image a subject shows now, for re-checks. */
export type StoredImage = { url: string; source: string | null };

export type ArtistImageRow = {
  id: ArtistId;
  name: string;
  spotifyId: string | null;
  mbid: string | null;
  /** Spotify's image (`image_url`), owned by matching. */
  spotifyImageUrl: string | null;
  alt: StoredImage | null;
};

export type SavedImage = { url: string; credit: string | null; source: string };

/** `artists.alt_image_*` (D-083). */
export interface ArtistImageStore {
  /**
   * Artists without a Spotify image whose alternative image is due: never checked, or checked
   * before `checkedBefore`. Ordered oldest check first.
   */
  listDue(checkedBefore: Date, limit: number): Promise<ArtistImageRow[]>;
  /** Null clears the image (none found, or the old one broke); `checkedAt` is always set. */
  save(id: ArtistId, image: SavedImage | null, checkedAt: Date): Promise<void>;
  /** The stored image still works: only the check time moves. */
  touch(id: ArtistId, checkedAt: Date): Promise<void>;
}

export type EventPosterRow = {
  id: EventId;
  title: string;
  /** Allow-listed official source pages for this event (D-082). */
  officialUrls: string[];
  poster: StoredImage | null;
};

/** `events.poster_*` (D-082, D-083). */
export interface EventPosterStore {
  /** Upcoming published events whose poster is due, oldest check first. */
  listDue(checkedBefore: Date, limit: number): Promise<EventPosterRow[]>;
  save(id: EventId, image: SavedImage | null, checkedAt: Date): Promise<void>;
  touch(id: EventId, checkedAt: Date): Promise<void>;
}

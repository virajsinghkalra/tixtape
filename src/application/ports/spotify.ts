/**
 * Spotify ports (owned by the Spotify Integration team, D-007).
 * Consumers: Artist Matching (ArtistCatalog), Playlist Engine (TrackCatalog, PlaylistWriter).
 * Implementations live in src/infrastructure/spotify/ and go through the shared rate gate (D-006).
 */
import type { SpotifyArtistId, SpotifyPlaylistId, SpotifyTrackId } from "@/domain/shared/ids";
import { AppError } from "@/lib/errors";

export type SpotifyArtistCandidate = {
  id: SpotifyArtistId;
  name: string;
  /** 0-based position in Spotify's search results (the only popularity proxy left, D-007). */
  rank: number;
  imageUrl: string | null;
  /** May be empty; Spotify marks `genres` deprecated for new apps. */
  genres: string[];
};

export type SpotifyTrack = {
  id: SpotifyTrackId;
  name: string;
  artistIds: SpotifyArtistId[];
  albumId: string;
  albumReleaseDate: string | null;
  isrc: string | null;
  durationMs: number;
  /** 0-based position in the search results it came from. */
  rank: number;
};

export type SpotifyAlbum = {
  id: string;
  name: string;
  releaseDate: string | null;
  albumType: "album" | "single" | "compilation" | "appears_on";
};

/** Who the call is made for. App calls use a client-credentials token. */
export type SpotifyCaller = { kind: "app" } | { kind: "user"; userId: string };

export interface ArtistCatalog {
  /** `type=artist`, limit ≤ 10 (D-007). */
  searchArtists(
    query: string,
    caller: SpotifyCaller,
    opts?: { offset?: number },
  ): Promise<SpotifyArtistCandidate[]>;
}

export interface TrackCatalog {
  /**
   * `type=track`, limit ≤ 10, with an explicit market (D-007). `offset` pages through results
   * (Spotify's advice for the 10-item limit since February 2026; D-080).
   */
  searchTracks(
    query: string,
    market: string,
    caller: SpotifyCaller,
    opts?: { offset?: number },
  ): Promise<SpotifyTrack[]>;
  getArtistAlbums(
    artistId: SpotifyArtistId,
    market: string,
    caller: SpotifyCaller,
  ): Promise<SpotifyAlbum[]>;
  getAlbumTracks(albumId: string, market: string, caller: SpotifyCaller): Promise<SpotifyTrack[]>;
}

export type CreatedPlaylist = { id: SpotifyPlaylistId; url: string; snapshotId: string | null };

/** One song for "what's inside" (the playlist's first few). */
/** `audio`: a 30-second preview clip ("" = none found), looked up on first "Listen here". */
export type PreviewTrack = { name: string; artist: string; audio?: string };

/** Finds a 30-second preview clip URL for a song; null when none. Never throws. */
export interface SongPreviewFinder {
  find(name: string, artist: string): Promise<string | null>;
}

export interface PlaylistWriter {
  /** `POST /me/playlists`. */
  createPlaylist(
    userId: string,
    input: { name: string; description: string; public: boolean },
  ): Promise<CreatedPlaylist>;
  /** `PUT /playlists/{id}/items`: replaces all items. At most 100 URIs. */
  replaceItems(
    userId: string,
    playlistId: SpotifyPlaylistId,
    trackIds: SpotifyTrackId[],
  ): Promise<{ snapshotId: string }>;
  /**
   * `PUT /playlists/{id}`: rename and re-describe a playlist (D-043 follow-up, D-085). Optional
   * so older fakes keep compiling; the engine skips the rename when a writer lacks it.
   */
  updateDetails?(
    userId: string,
    playlistId: SpotifyPlaylistId,
    details: { name: string; description: string },
  ): Promise<void>;
  /**
   * `GET /playlists/{id}/items`: the first `limit` songs, for "what's inside". Optional so
   * older fakes keep compiling; a build without it just shows no preview.
   */
  readTopItems?(
    userId: string,
    playlistId: SpotifyPlaylistId,
    limit: number,
  ): Promise<PreviewTrack[]>;
  /** `POST /playlists/{id}/items`. At most 100 URIs. */
  addItems(
    userId: string,
    playlistId: SpotifyPlaylistId,
    trackIds: SpotifyTrackId[],
  ): Promise<{ snapshotId: string }>;
}

export type SpotifyBlockedReason = "gate_paused" | "long_retry_after" | "quota_exceeded";

/** What a job runner needs to pause a job until Spotify lets us call again (D-006). */
export interface SpotifyBlockedInfo {
  resumeAfter: Date;
  reason: SpotifyBlockedReason;
}

/**
 * Thrown by the Spotify adapters when Spotify asks us to stop for longer than we will wait,
 * the quota is exhausted, or the shared gate is paused (D-006). Job runners catch this and
 * pause the job until `resumeAfter`. No call was made to Spotify after the pause began.
 */
export class SpotifyBlockedError extends AppError implements SpotifyBlockedInfo {
  readonly code = "spotify_blocked";
  override readonly httpStatus = 503;
  constructor(
    readonly reason: SpotifyBlockedReason,
    readonly resumeAfter: Date,
  ) {
    super("Spotify is busy right now. We'll continue automatically in a little while.");
  }
}

/**
 * The user's Spotify authorization is gone (refresh returned `invalid_grant`, or no tokens are
 * stored). `spotify_tokens.needs_reauth` is set; the user must sign in with Spotify again.
 */
export class ReauthRequiredError extends AppError {
  readonly code = "spotify_reauth_required";
  override readonly httpStatus = 401;
  constructor(message = "Reconnect your Spotify account to continue.") {
    super(message);
  }
}

/** Storage for the shared pause (single `spotify_gate` row, D-006). */
export interface SpotifyGateStore {
  readPausedUntil(): Promise<Date | null>;
  /** Atomically sets the pause to the later of the stored value and `until`; returns the result. */
  extendPausedUntil(until: Date): Promise<Date>;
}

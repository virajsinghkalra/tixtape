/** Playlist writes for the signed-in user (P1.3, D-007, LLD §7.3). */
import { z } from "zod";
import type { CreatedPlaylist, PlaylistWriter, PreviewTrack } from "@/application/ports/spotify";
import {
  asSpotifyPlaylistId,
  type SpotifyPlaylistId,
  type SpotifyTrackId,
} from "@/domain/shared/ids";
import { ValidationError } from "@/lib/errors";
import { checkId } from "./catalog";
import { createdPlaylistSchema, snapshotSchema } from "./schemas";
import type { SpotifyHttp } from "./spotify-http";

/** Spotify accepts at most 100 URIs per items request. */
export const MAX_ITEMS_PER_REQUEST = 100;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 300;

const previewTrack = z
  .object({ name: z.string(), artists: z.array(z.object({ name: z.string() })).optional() })
  .nullish();
/** Lenient: Spotify calls the entry `track` (older) or `item` (newer). */
const topItemsSchema = z.object({
  items: z.array(z.object({ track: previewTrack, item: previewTrack }).partial().nullable()),
});

export class SpotifyPlaylistWriter implements PlaylistWriter {
  constructor(private readonly http: SpotifyHttp) {}

  async createPlaylist(
    userId: string,
    input: { name: string; description: string; public: boolean },
  ): Promise<CreatedPlaylist> {
    const name = input.name.trim();
    if (name === "" || name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(`Playlist name must be 1 to ${MAX_NAME_LENGTH} characters.`);
    }
    if (input.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `Playlist description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }
    const body = await this.http.request({
      method: "POST",
      path: "/me/playlists",
      body: { name, description: input.description, public: input.public },
      auth: { kind: "user", userId },
      schema: createdPlaylistSchema,
    });
    return {
      id: asSpotifyPlaylistId(body.id),
      url: body.external_urls.spotify,
      snapshotId: body.snapshot_id ?? null,
    };
  }

  /** Renames and re-describes a playlist the user owns (`PUT /playlists/{id}`). */
  async updateDetails(
    userId: string,
    playlistId: SpotifyPlaylistId,
    details: { name: string; description: string },
  ): Promise<void> {
    const name = details.name.trim();
    if (name === "" || name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(`Playlist name must be 1 to ${MAX_NAME_LENGTH} characters.`);
    }
    if (details.description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ValidationError(
        `Playlist description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
      );
    }
    await this.http.request({
      method: "PUT",
      path: `/playlists/${checkId(playlistId, "playlist")}`,
      body: { name, description: details.description },
      auth: { kind: "user", userId },
      // Spotify answers 200 with an empty body.
      schema: z.unknown(),
    });
  }

  /** Replaces every item. An empty list clears the playlist. */
  async replaceItems(
    userId: string,
    playlistId: SpotifyPlaylistId,
    trackIds: SpotifyTrackId[],
  ): Promise<{ snapshotId: string }> {
    return this.writeItems("PUT", userId, playlistId, trackIds);
  }

  /** The first few songs (name and first artist). Fields are trimmed to keep it small. */
  async readTopItems(
    userId: string,
    playlistId: SpotifyPlaylistId,
    limit: number,
  ): Promise<PreviewTrack[]> {
    const body = await this.http.request({
      method: "GET",
      path: `/playlists/${checkId(playlistId, "playlist")}/items`,
      query: {
        limit: Math.min(Math.max(limit, 1), 10),
        fields: "items(item(name,artists(name)),track(name,artists(name)))",
      },
      auth: { kind: "user", userId },
      schema: topItemsSchema,
    });
    return body.items.flatMap((i) => {
      const t = i?.track ?? i?.item;
      return t?.name ? [{ name: t.name, artist: t.artists?.[0]?.name ?? "" }] : [];
    });
  }

  async addItems(
    userId: string,
    playlistId: SpotifyPlaylistId,
    trackIds: SpotifyTrackId[],
  ): Promise<{ snapshotId: string }> {
    if (trackIds.length === 0) throw new ValidationError("Add at least one track.");
    return this.writeItems("POST", userId, playlistId, trackIds);
  }

  private async writeItems(
    method: "PUT" | "POST",
    userId: string,
    playlistId: SpotifyPlaylistId,
    trackIds: SpotifyTrackId[],
  ): Promise<{ snapshotId: string }> {
    if (trackIds.length > MAX_ITEMS_PER_REQUEST) {
      throw new ValidationError(`At most ${MAX_ITEMS_PER_REQUEST} tracks per request.`);
    }
    const uris = trackIds.map((id) => `spotify:track:${checkId(id, "track")}`);
    const body = await this.http.request({
      method,
      path: `/playlists/${checkId(playlistId, "playlist")}/items`,
      body: { uris },
      auth: { kind: "user", userId },
      schema: snapshotSchema,
    });
    return { snapshotId: body.snapshot_id };
  }
}

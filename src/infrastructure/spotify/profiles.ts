import type { SpotifyProfileReader } from "@/application/auth/ports";
import { profileSchema } from "./schemas";
import type { SpotifyHttp } from "./spotify-http";

/** `GET /me` right after sign-in. `/me` no longer returns `country` (D-007). */
export class SpotifyProfiles implements SpotifyProfileReader {
  constructor(private readonly http: SpotifyHttp) {}

  async getCurrentUser(
    accessToken: string,
  ): Promise<{ spotifyUserId: string; displayName: string | null }> {
    const me = await this.http.request({
      method: "GET",
      path: "/me",
      auth: { kind: "token", accessToken },
      schema: profileSchema,
    });
    return { spotifyUserId: me.id, displayName: me.display_name ?? null };
  }
}

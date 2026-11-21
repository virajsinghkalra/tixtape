/** Spotify auth entry points for routes and jobs; wired in the container (D-004, D-014). */
import type { SpotifyAuthService } from "@/application/auth/spotify-auth-service";
import type { SpotifyModule } from "@/infrastructure/spotify";
import { container } from "@/server/container";

export function spotifyModule(): SpotifyModule {
  return container().spotify;
}

export function authService(): SpotifyAuthService {
  return container().auth;
}

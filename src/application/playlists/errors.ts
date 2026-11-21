import { AppError } from "@/lib/errors";

/** Shown to users when the publisher account is missing or must be reconnected (D-036). */
export const UNAVAILABLE_MESSAGE = "Playlist making is temporarily unavailable";

/** No publisher account, or it needs reauth. An admin has to (re)connect it. */
export class PlaylistUnavailableError extends AppError {
  readonly code = "playlist_unavailable";
  override readonly httpStatus = 503;
  constructor() {
    super(`${UNAVAILABLE_MESSAGE}. Please try again later.`);
  }
}

/** The lineup has no artist matched on Spotify yet, so there is nothing to build. */
export class NoMatchedArtistsError extends AppError {
  readonly code = "no_matched_artists";
  override readonly httpStatus = 422;
  constructor() {
    super("None of this lineup's artists are on Spotify yet. Check back soon.");
  }
}

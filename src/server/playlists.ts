/**
 * Playlist Engine entry point for routes and jobs; wired in the container (D-004), including the
 * engine's own step-budget Spotify instance (D-043).
 */
import { z } from "zod";
import type { PlaylistsModule } from "@/infrastructure/playlists-module";
import { container } from "./container";
import { parseWith } from "./http";

export { clientKey } from "./client-key";

export function playlists(): PlaylistsModule {
  return container().playlists;
}

const emptyBody = z.strictObject({});

/** These POSTs take no input: an empty body or `{}`. Anything else is a 400 (D-018). */
export async function requireEmptyBody(req: Request): Promise<void> {
  const text = await req.text();
  if (text.trim() === "") return;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = text;
  }
  parseWith(emptyBody, raw);
}

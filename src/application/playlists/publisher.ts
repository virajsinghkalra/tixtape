/** The publisher account that owns every shared playlist (P2.5, D-036). */
import type { SpotifyTokenRepository, UserRepository } from "@/application/auth/ports";
import type { Clock } from "@/application/ports/clock";
import type { PublisherRepository } from "@/application/ports/playlists";
import type { UserId } from "@/domain/shared/ids";
import { ConflictError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { err, ok, type Result } from "@/lib/result";

export type PublisherDeps = {
  publisher: PublisherRepository;
  users: Pick<UserRepository, "findById">;
  tokens: Pick<SpotifyTokenRepository, "find">;
  clock: Clock;
};

export type PublisherProblem = "not_connected" | "needs_reauth";
export type PublisherStatus = {
  connected: boolean;
  displayName: string | null;
  needsReauth: boolean;
};

/** How often the "publisher unavailable" warning may repeat (D-045). */
export const UNAVAILABLE_ALERT_INTERVAL_MS = 60_000;

/**
 * D-045: a missing or reauth publisher is logged at `warn`, at most once a minute per process,
 * so admins see it without a stack trace on every visitor's request.
 */
export function unavailableAlert(
  logger: Pick<Logger, "warn">,
  clock: Clock,
): (problem: PublisherProblem) => void {
  let lastAt = Number.NEGATIVE_INFINITY;
  return (problem) => {
    const now = clock.now().getTime();
    if (now - lastAt < UNAVAILABLE_ALERT_INTERVAL_MS) return;
    lastAt = now;
    logger.warn(
      { problem },
      "shared playlists unavailable: an admin must connect or reconnect the publisher account",
    );
  };
}

/** The account to write with, or why there is none usable. */
export async function getPublisher(
  deps: PublisherDeps,
): Promise<Result<{ userId: UserId }, PublisherProblem>> {
  const row = await deps.publisher.find();
  if (!row) return err("not_connected");
  const tokens = await deps.tokens.find(row.userId);
  if (!tokens || tokens.needsReauth) return err("needs_reauth");
  return ok({ userId: row.userId });
}

export async function getPublisherStatus(deps: PublisherDeps): Promise<PublisherStatus> {
  const row = await deps.publisher.find();
  if (!row) return { connected: false, displayName: null, needsReauth: false };
  const [user, tokens] = await Promise.all([
    deps.users.findById(row.userId),
    deps.tokens.find(row.userId),
  ]);
  return {
    connected: true,
    displayName: user?.displayName ?? null,
    needsReauth: !tokens || tokens.needsReauth,
  };
}

/** Makes `userId` (the signed-in admin) the publisher. Their Spotify tokens must be healthy. */
export async function setPublisher(deps: PublisherDeps, userId: UserId): Promise<PublisherStatus> {
  const tokens = await deps.tokens.find(userId);
  if (!tokens || tokens.needsReauth) {
    throw new ConflictError("Sign in with Spotify again before becoming the publisher.");
  }
  await deps.publisher.set(userId, deps.clock.now());
  return getPublisherStatus(deps);
}

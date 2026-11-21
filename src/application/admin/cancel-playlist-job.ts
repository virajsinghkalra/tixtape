/**
 * Admin cancel for a playlist job (P3.5). There is no `cancelled` status, so a cancel is a
 * `failed` job whose error says it was stopped. The error is shown to anyone watching the
 * build, so it must read well to a user.
 */
import { z } from "zod";
import type { PlaylistJobId } from "@/domain/shared/ids";
import { ConflictError, NotFoundError } from "@/lib/errors";
import type { AdminConsoleStore } from "./ports";

export const DEFAULT_CANCEL_REASON = "Try again in a few minutes.";

// D-018: unknown fields are rejected.
export const CancelJobInputSchema = z.strictObject({
  /** Shown to people waiting on the playlist. */
  reason: z.string().trim().min(1).max(200).optional(),
});
export type CancelJobInput = z.infer<typeof CancelJobInputSchema>;

export function cancelMessage(reason: string | undefined): string {
  return `This playlist build was stopped by the team. ${reason ?? DEFAULT_CANCEL_REASON}`;
}

/** Throws `NotFoundError` for an unknown job and `ConflictError` for a finished one. */
export async function cancelPlaylistJob(
  store: Pick<AdminConsoleStore, "failActiveJob">,
  id: PlaylistJobId,
  input: CancelJobInput,
): Promise<{ jobId: PlaylistJobId; status: "failed"; error: string }> {
  const error = cancelMessage(input.reason);
  const outcome = await store.failActiveJob(id, error);
  if (outcome === "not_found") throw new NotFoundError("That playlist job doesn't exist.");
  if (outcome === "not_active") {
    throw new ConflictError("That job already finished, so there's nothing to cancel.");
  }
  return { jobId: id, status: "failed", error };
}

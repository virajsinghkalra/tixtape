"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * D-084: retry for an error boundary. `reset()` alone only re-renders on the client, so a
 * server component that failed would fail again from the router cache. Refresh first, then reset.
 */
export function useRetry(reset: () => void): { retry: () => void; retrying: boolean } {
  const router = useRouter();
  const [retrying, start] = useTransition();
  const retry = useCallback(
    () =>
      start(() => {
        router.refresh();
        reset();
      }),
    [router, reset],
  );
  return { retry, retrying };
}

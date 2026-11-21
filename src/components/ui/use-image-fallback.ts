"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";

/**
 * D-084: shared image-failure state for hotlinked pictures (posters, artist photos). Spread
 * `imgProps` on the <img>; when it 404s (or failed before hydration), `failed` turns true and the
 * caller renders its designed fallback (e.g. ArtistAvatar's gradient + initials) instead.
 *
 *   const { failed, imgProps } = useImageFallback(url);
 *   return failed || !url ? <Fallback /> : <img src={url} alt="" {...imgProps} />;
 *
 * It resets when `src` changes.
 */
export function useImageFallback(src: string | null | undefined) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => setFailed(false), [src]);
  // An image that errored before React hydrated never fires onError; catch it on mount.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0 && img.currentSrc) setFailed(true);
  }, [src]);

  const onError = useCallback((_: SyntheticEvent<HTMLImageElement>) => setFailed(true), []);
  return { failed, imgProps: { ref, onError } };
}

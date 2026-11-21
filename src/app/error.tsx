"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sticker } from "@/components/ui/Sticker";
import { useRetry } from "@/components/ui/use-retry";

/** Any page that throws lands here. The error is logged, never shown (D-084). */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { retry, retrying } = useRetry(reset);
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Sticker tone="orange" size="md" emoji="🔌" tilt={3}>
        Sound check failed
      </Sticker>
      <h1 className="mt-5 font-display text-huge font-extrabold">We lost the signal</h1>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button size="lg" onClick={retry} disabled={retrying} aria-disabled={retrying}>
          {retrying ? "Retrying…" : "Try again"}
        </Button>
        <ButtonLink href="/" variant="secondary" size="lg">
          Back home
        </ButtonLink>
      </div>
    </div>
  );
}

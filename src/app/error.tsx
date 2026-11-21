"use client";

import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Sticker } from "@/components/ui/Sticker";

export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
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
        <Button size="lg" onClick={reset}>
          Try again
        </Button>
        <ButtonLink href="/" variant="secondary" size="lg">
          Back home
        </ButtonLink>
      </div>
    </div>
  );
}

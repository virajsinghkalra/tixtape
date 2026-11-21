import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/Button";
import { Sticker } from "@/components/ui/Sticker";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Sticker tone="pink" size="md" emoji="🫠" tilt={-4}>
        404
      </Sticker>
      <h1 className="mt-5 font-display text-huge font-extrabold">Not on the bill</h1>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <ButtonLink href="/search" size="lg">
          <span aria-hidden>🔎</span> Find a gig
        </ButtonLink>
        <ButtonLink href="/" variant="secondary" size="lg">
          Back home
        </ButtonLink>
      </div>
    </div>
  );
}

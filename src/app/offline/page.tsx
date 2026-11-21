import type { Metadata } from "next";
import { ReloadButton } from "@/components/pwa/ReloadButton";
import { SavedGigs } from "@/components/pwa/SavedGigs";
import { Sticker } from "@/components/ui/Sticker";

export const metadata: Metadata = { title: "Offline", robots: { index: false } };

/** D-084: the service worker's fallback when the network is gone and the page isn't saved. */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center">
      <Sticker tone="orange" size="md" emoji="📼" tilt={-3}>
        No signal
      </Sticker>
      <h1 className="mt-5 font-display text-huge font-extrabold">
        You&apos;re offline <span aria-hidden>📴</span>
      </h1>
      <div className="mt-8">
        <ReloadButton />
      </div>
      <SavedGigs />
    </div>
  );
}

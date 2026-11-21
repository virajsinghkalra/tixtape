"use client";

import { useEffect } from "react";
import "./globals.css";

/**
 * D-084: the last line of defence, when the root layout itself fails. It replaces the whole
 * document, so it renders its own <html> and uses no providers, fonts or data. A full reload
 * is the safest retry here.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en-IN">
      <body className="grid min-h-dvh place-items-center bg-bg px-4 text-center text-ink antialiased">
        <main className="flex flex-col items-center">
          <p aria-hidden className="text-6xl">
            📼
          </p>
          <h1 className="mt-4 text-4xl font-extrabold">Tape got tangled</h1>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-14 rounded-full bg-lime px-7 font-semibold text-on-block active:scale-[0.96]"
            >
              Try again
            </button>
            {/* A full page load: the client router may be what broke. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              className="inline-flex min-h-14 items-center rounded-full border-2 border-ink px-7 font-semibold active:scale-[0.96]"
            >
              Back home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}

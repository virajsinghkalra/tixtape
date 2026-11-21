import Link from "next/link";
import { SPOTIFY_LOGIN_URL } from "./links";
import { LogoutButton } from "./LogoutButton";
import { Wordmark } from "./Wordmark";

export type HeaderUser = { name: string };

/** Logged out: a quiet "Sign in" (playlists never need it). Logged in: who + Log out. */
export function SiteHeader({ user }: { user: HeaderUser | null }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link
          href="/"
          aria-label="Tixtape, home"
          className="flex min-h-11 items-center rounded-field px-1"
        >
          <Wordmark />
        </Link>
        {user ? (
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid size-10 place-items-center rounded-full border-2 border-night bg-pink font-display text-lg font-extrabold text-on-block"
            >
              {user.name.charAt(0).toUpperCase()}
            </span>
            <span className="hidden max-w-[12rem] truncate text-sm font-semibold sm:inline">
              {user.name}
            </span>
            <span className="sr-only sm:hidden">Logged in as {user.name}</span>
            <LogoutButton />
          </div>
        ) : (
          // Secondary on purpose: playlists need no login, and Spotify's Development Mode lets
          // only a few allow-listed people sign in at all.
          <a
            href={SPOTIFY_LOGIN_URL}
            className="inline-flex min-h-11 items-center px-2 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline"
          >
            Sign in
          </a>
        )}
      </div>
    </header>
  );
}

import Link from "next/link";
import { CitySwitcher } from "./CitySwitcher";
import { LogoutButton } from "./LogoutButton";
import { Wordmark } from "./Wordmark";

export type HeaderUser = { name: string };

/**
 * Logged out: nothing. Playlists never need a login, and Spotify Development Mode lets only
 * allow-listed accounts sign in, so a public button would send visitors to a Spotify error.
 * Admins sign in at /api/auth/spotify/login. Logged in: who + Log out.
 */
export function SiteHeader({ user, city }: { user: HeaderUser | null; city: string | null }) {
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
        <div className="flex min-w-0 items-center gap-2">
          <CitySwitcher city={city} cities={city ? [city] : []} />
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
          ) : null}
        </div>
      </div>
    </header>
  );
}

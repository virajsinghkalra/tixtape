import { Wordmark } from "./Wordmark";

/** D-036: one shared playlist per concert, made by the Tixtape account. No login needed. */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-10 pb-28 text-sm text-muted sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pb-10">
        <div className="max-w-lg space-y-3">
          <Wordmark />
          <p>
            Every concert gets one shared playlist on Spotify, made by our Tixtape account. No login
            needed: open it in Spotify and follow it. It updates when the lineup does.
          </p>
          <p>Event details come from organisers and ticketing partners. Times are in IST.</p>
        </div>
        <p className="font-semibold text-ink">every ticket gets a mixtape ✦</p>
      </div>
    </footer>
  );
}

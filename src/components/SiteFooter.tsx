import { Wordmark } from "./Wordmark";

/** D-082: the wordmark and the tagline, nothing else. */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-10 pb-28 text-sm text-muted sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pb-10">
        <Wordmark />
        <p className="font-semibold text-ink">every ticket gets a mixtape ✦</p>
      </div>
    </footer>
  );
}

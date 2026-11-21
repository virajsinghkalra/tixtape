import Link from "next/link";
import { ID_COPY } from "./identity/identity-copy";
import { Wordmark } from "./Wordmark";

/** D-082: the wordmark and the tagline; D-090: a tiny "Privacy" link. */
export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pt-10 pb-28 text-sm text-muted sm:flex-row sm:items-end sm:justify-between sm:px-6 sm:pb-10">
        <Wordmark />
        <div className="flex flex-col gap-2 sm:items-end">
          <p className="font-semibold text-ink">every ticket gets a mixtape ✦</p>
          <Link href="/privacy" className="text-xs text-muted underline-offset-4 hover:underline">
            {ID_COPY.privacy}
          </Link>
        </div>
      </div>
    </footer>
  );
}

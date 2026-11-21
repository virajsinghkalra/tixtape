import { Skeleton } from "@/components/ui/Skeleton";

/**
 * D-084: shown instantly while /search renders. Same boxes and spacing as the page (search box,
 * heading, count, date chips, a card grid), so nothing jumps when results arrive.
 */
export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-6 sm:px-6" aria-busy="true">
      <p role="status" className="sr-only">
        Searching…
      </p>
      <div aria-hidden>
        <Skeleton className="h-16 max-w-2xl rounded-field" />
        <Skeleton className="mt-10 h-10 w-2/3 max-w-md" />
        <Skeleton className="mt-2 h-6 w-20" />
        <div className="mt-5 flex flex-wrap gap-2">
          {["w-24", "w-36", "w-32"].map((w) => (
            <Skeleton key={w} className={`h-11 rounded-chip ${w}`} />
          ))}
        </div>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <li key={i}>
              <Skeleton className="h-[22rem] rounded-card" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

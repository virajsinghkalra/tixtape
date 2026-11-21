import type { Metadata } from "next";
import Link from "next/link";
import { AdminListEventsQuerySchema } from "@/application/events";
import {
  formatConfidence,
  formatIst,
  VISIBILITY_LABEL,
  VISIBILITY_TONE,
} from "@/components/admin/admin-format";
import { listHref, readEventListParams } from "@/components/admin/event-list-params";
import { FilterTabs } from "@/components/admin/FilterTabs";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { EVENT_VISIBILITIES } from "@/domain/events/visibility";
import { events } from "@/server/events";
import { requireAdminPage } from "../admin-guard";

export const metadata: Metadata = { title: "Events" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminEventsPage({ searchParams }: Props) {
  await requireAdminPage();
  const params = readEventListParams(await searchParams);
  const page = await events().listAdminEvents(
    AdminListEventsQuerySchema.parse({
      page: params.page,
      pageSize: PAGE_SIZE,
      ...(params.visibility ? { visibility: params.visibility } : {}),
      ...(params.q ? { q: params.q } : {}),
    }),
  );
  const lastPage = Math.max(1, Math.ceil(page.total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-big font-extrabold">Events</h1>
      <FilterTabs
        label="Filter by visibility"
        tabs={[null, ...EVENT_VISIBILITIES].map((v) => ({
          href: listHref({ ...params, visibility: v, page: 1 }),
          label: v ? VISIBILITY_LABEL[v] : "All",
          current: params.visibility === v,
        }))}
      />
      <form role="search" action="/admin/events" className="flex flex-col gap-2 sm:flex-row">
        {params.visibility && <input type="hidden" name="visibility" value={params.visibility} />}
        <label htmlFor="q" className="sr-only">
          Search event titles
        </label>
        <input
          id="q"
          name="q"
          defaultValue={params.q ?? ""}
          maxLength={100}
          placeholder="Search titles"
          className="min-h-11 flex-1 rounded-field border-2 border-line bg-surface px-3 text-sm focus:border-ink"
        />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <p role="status" className="text-sm text-muted">
        {page.total} {page.total === 1 ? "event" : "events"}
        {params.q ? ` matching “${params.q}”` : ""}
      </p>

      {page.items.length === 0 ? (
        <Card className="p-6 text-center text-muted">No events here.</Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {page.items.map((e) => (
            <li key={e.id}>
              <Link
                href={`/admin/events/${e.id}`}
                className="flex flex-col gap-1 rounded-card border border-line bg-surface p-4 hover:border-ink sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="min-w-0">
                  <span className="block font-semibold">{e.title}</span>
                  <span className="block text-sm text-muted">
                    {formatIst(e.startsAt)} ·{" "}
                    {e.venue ? `${e.venue.name}, ${e.venue.city}` : "Venue TBA"} · {e.artistCount}{" "}
                    artists
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap gap-2">
                  <Chip className={VISIBILITY_TONE[e.visibility]}>
                    {VISIBILITY_LABEL[e.visibility]}
                  </Chip>
                  <Chip>Confidence {formatConfidence(e.confidence)}</Chip>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {lastPage > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between gap-2">
          {params.page > 1 ? (
            <ButtonLink href={listHref({ ...params, page: params.page - 1 })} variant="secondary">
              Previous
            </ButtonLink>
          ) : (
            <span />
          )}
          <span className="text-sm text-muted">
            Page {params.page} of {lastPage}
          </span>
          {params.page < lastPage ? (
            <ButtonLink href={listHref({ ...params, page: params.page + 1 })} variant="secondary">
              Next
            </ButtonLink>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import type { PublisherStatus } from "@/application/playlists";
import { JOB_STATUSES } from "@/application/ports/playlists";
import {
  formatAgo,
  formatIst,
  JOB_STATUS_LABEL,
  VISIBILITY_LABEL,
} from "@/components/admin/admin-format";
import { PublisherConnect } from "@/components/admin/PublisherConnect";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { EVENT_VISIBILITIES } from "@/domain/events/visibility";
import { adminConsole } from "@/server/admin-console";
import { playlists } from "@/server/playlists";
import { requireAdminPage } from "./admin-guard";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Stat({
  href,
  label,
  value,
  alert,
}: {
  href: string;
  label: string;
  value: number;
  alert?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "flex min-h-24 flex-col justify-between rounded-card border-2 p-4 hover:border-ink",
        alert && value > 0 ? "border-orange" : "border-line",
      )}
    >
      <span className="text-sm font-semibold text-muted">{label}</span>
      <span className="font-display text-3xl font-extrabold tabular-nums">{value}</span>
    </Link>
  );
}

/** The publisher's state, or null if it couldn't be read (the rest of the page still shows). */
async function publisherStatus(): Promise<PublisherStatus | null> {
  try {
    return await playlists().getPublisherStatus();
  } catch (err) {
    console.error("Could not read the publisher status", err);
    return null;
  }
}

function PublisherCard({ status }: { status: PublisherStatus | null }) {
  const [tone, text] = !status
    ? ["bg-surface-2 text-muted", "Couldn't check the publisher right now. Reload to retry."]
    : !status.connected
      ? ["bg-pink text-on-block", "Not connected. Shared playlists can't be built."]
      : status.needsReauth
        ? [
            "bg-orange text-on-block",
            `${status.displayName ?? "The publisher"} needs to sign in with Spotify again.`,
          ]
        : [
            "bg-lime text-on-block",
            `Connected as ${status.displayName ?? "the publisher account"}.`,
          ];
  return (
    <Card className="flex flex-col gap-2 p-4">
      <p className={cx("w-fit rounded-chip px-3 py-1 text-sm font-semibold", tone)}>{text}</p>
      {status && (!status.connected || status.needsReauth) && <PublisherConnect />}
    </Card>
  );
}

export default async function AdminDashboard() {
  await requireAdminPage();
  const [dashboard, publisher] = await Promise.all([adminConsole().dashboard(), publisherStatus()]);
  const now = new Date();
  const failedRuns = dashboard.ingestRuns.filter((r) => r.status === "failed").length;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-big font-extrabold">Admin</h1>

      <Section title="Events">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {EVENT_VISIBILITIES.map((v) => (
            <Stat
              key={v}
              href={`/admin/events?visibility=${v}`}
              label={VISIBILITY_LABEL[v]}
              value={dashboard.events[v]}
              alert={v === "held"}
            />
          ))}
        </div>
      </Section>

      <Section title="Artists">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Stat
            href="/admin/artists"
            label="Need review"
            value={dashboard.artistsNeedingReview}
            alert
          />
        </div>
      </Section>

      <Section title="Playlist jobs">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {JOB_STATUSES.map((s) => (
            <Stat
              key={s}
              href={
                s === "failed" || s === "partial"
                  ? "/admin/jobs?filter=failed"
                  : "/admin/jobs?filter=all"
              }
              label={JOB_STATUS_LABEL[s]}
              value={dashboard.jobs[s]}
              alert={s === "failed"}
            />
          ))}
        </div>
      </Section>

      <Section title="Last ingest run per source">
        {dashboard.ingestRuns.length === 0 ? (
          <p className="text-sm text-muted">No ingest has run yet.</p>
        ) : (
          <>
            {failedRuns > 0 && (
              <p role="status" className="text-sm font-semibold">
                {failedRuns} {failedRuns === 1 ? "source" : "sources"} failed on the last run.
              </p>
            )}
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {dashboard.ingestRuns.map((r) => (
                <li key={r.source}>
                  <Card className="flex flex-col gap-1 p-4">
                    <p className="flex flex-wrap items-center gap-2 font-semibold">
                      {r.source}
                      <Chip
                        className={
                          r.status === "succeeded"
                            ? "bg-lime text-on-block"
                            : r.status === "failed"
                              ? "bg-pink text-on-block"
                              : "bg-sky text-on-block"
                        }
                      >
                        {r.status === "succeeded"
                          ? "Success"
                          : r.status === "failed"
                            ? "Failed"
                            : "Running"}
                      </Chip>
                    </p>
                    <p className="text-sm text-muted">
                      Started {formatAgo(r.startedAt, now)} ({formatIst(r.startedAt)}) ·{" "}
                      {r.itemsSeen} seen · {r.itemsNew} new
                    </p>
                    {r.error && <p className="text-sm">Error: {r.error}</p>}
                  </Card>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Playlist publisher">
        <PublisherCard status={publisher} />
      </Section>
    </div>
  );
}

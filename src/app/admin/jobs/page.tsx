import type { Metadata } from "next";
import { JOB_FILTERS, type JobFilter } from "@/application/admin";
import { FilterTabs } from "@/components/admin/FilterTabs";
import { JobsList, type JobView } from "@/components/admin/JobsList";
import { Card } from "@/components/ui/Card";
import { adminConsole } from "@/server/admin-console";
import { requireAdminPage } from "../admin-guard";

export const metadata: Metadata = { title: "Playlist jobs" };
export const dynamic = "force-dynamic";

const LIMIT = 50;
const FILTER_LABEL: Record<JobFilter, string> = { active: "Active", failed: "Failed", all: "All" };

type Props = { searchParams: Promise<{ filter?: string | string[] }> };

export default async function AdminJobsPage({ searchParams }: Props) {
  await requireAdminPage();
  const raw = (await searchParams).filter;
  const filter = JOB_FILTERS.find((f) => f === (Array.isArray(raw) ? raw[0] : raw)) ?? "active";
  const jobs = await adminConsole().listJobs(filter, LIMIT);
  const views: JobView[] = jobs.map((j) => ({
    ...j,
    resumeAfter: j.resumeAfter?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
  }));

  return (
    <div className="flex flex-col gap-5">
      <h1 className="font-display text-big font-extrabold">Playlist jobs</h1>
      <FilterTabs
        label="Filter jobs"
        tabs={JOB_FILTERS.map((f) => ({
          href: f === "active" ? "/admin/jobs" : `/admin/jobs?filter=${f}`,
          label: FILTER_LABEL[f],
          current: f === filter,
        }))}
      />
      <p role="status" className="text-sm text-muted">
        {views.length === LIMIT ? `Showing the newest ${LIMIT}` : views.length}
        {filter === "all" ? "" : ` ${FILTER_LABEL[filter].toLowerCase()}`}
        {views.length === 1 ? " job" : " jobs"}
      </p>
      {views.length === 0 ? (
        <Card className="p-6 text-center text-muted">No jobs here.</Card>
      ) : (
        <JobsList jobs={views} now={new Date().toISOString()} />
      )}
    </div>
  );
}

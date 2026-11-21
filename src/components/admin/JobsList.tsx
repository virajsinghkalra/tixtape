"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JobStatus } from "@/application/ports/playlists";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import { adminRequest } from "./admin-api";
import { formatAgo, isActiveJob, JOB_STATUS_LABEL } from "./admin-format";
import { ConfirmPanel } from "./ConfirmPanel";

/** One job, serialised for the client (dates as ISO strings). */
export type JobView = {
  id: string;
  eventId: string;
  eventTitle: string;
  kind: "shared" | "personal";
  status: JobStatus;
  stage: string | null;
  progress: number;
  artistsDone: number;
  artistsTotal: number;
  error: string | null;
  resumeAfter: string | null;
  createdAt: string;
  updatedAt: string;
};

const STATUS_TONE: Partial<Record<JobStatus, string>> = {
  running: "bg-sky text-on-block border-transparent",
  paused: "bg-orange text-on-block border-transparent",
  succeeded: "bg-lime text-on-block border-transparent",
  failed: "bg-pink text-on-block border-transparent",
  partial: "bg-orange text-on-block border-transparent",
};

function CancelJob({ job, onDone }: { job: JobView; onDone: () => void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    const body = reason.trim() ? { reason: reason.trim() } : {};
    const result = await adminRequest(`/api/admin/playlist-jobs/${job.id}/cancel`, "POST", body);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    toast.show(`Cancelled the build for “${job.eventTitle}”.`);
    onDone();
  }

  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-expanded={open}>
        Cancel job
      </Button>
      {open && (
        <ConfirmPanel
          title={`Cancel the playlist build for “${job.eventTitle}”?`}
          confirmLabel="Cancel the job"
          busy={busy}
          error={error}
          danger
          onConfirm={() => void cancel()}
          onCancel={() => setOpen(false)}
        >
          <p>
            The job is marked failed and stops at its next step. A new build can start afterwards.
          </p>
          <label className="mt-3 flex flex-col gap-1 font-semibold text-ink">
            Reason (optional)
            <input
              className="min-h-11 rounded-field border-2 border-line bg-surface px-3 text-sm font-normal focus:border-ink"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="text-xs font-normal text-muted">
              Shown to people waiting on this playlist. Leave empty for “Try again in a few
              minutes.”
            </span>
          </label>
        </ConfirmPanel>
      )}
    </div>
  );
}

/** Recent playlist jobs with their progress, and a cancel for active ones. */
export function JobsList({ jobs, now }: { jobs: JobView[]; now: string }) {
  const router = useRouter();
  const nowDate = new Date(now);
  return (
    <ul className="flex flex-col gap-3">
      {jobs.map((job) => (
        <li key={job.id}>
          <Card className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/admin/events/${job.eventId}`}
                className="font-semibold underline underline-offset-2"
              >
                {job.eventTitle}
              </Link>
              <Chip className={STATUS_TONE[job.status]}>{JOB_STATUS_LABEL[job.status]}</Chip>
              <Chip>{job.kind === "shared" ? "Shared" : "Personal"}</Chip>
            </div>
            <div>
              <div
                role="progressbar"
                aria-label="Progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={job.progress}
                className="h-2 overflow-hidden rounded-chip bg-surface-2"
              >
                <div className="h-full bg-lime" style={{ width: `${job.progress}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {job.progress}% · stage {job.stage ?? "not started"} · artists {job.artistsDone}/
                {job.artistsTotal} · started {formatAgo(job.createdAt, nowDate)} · updated{" "}
                {formatAgo(job.updatedAt, nowDate)}
                {job.status === "paused" &&
                  job.resumeAfter &&
                  ` · resumes ${formatAgo(job.resumeAfter, nowDate)}`}
              </p>
            </div>
            {job.error && <p className="text-sm">Error: {job.error}</p>}
            {isActiveJob(job.status) && <CancelJob job={job} onDone={() => router.refresh()} />}
          </Card>
        </li>
      ))}
    </ul>
  );
}

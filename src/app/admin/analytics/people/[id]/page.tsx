import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatIst } from "@/components/admin/admin-format";
import { Panel } from "@/components/admin/AnalyticsParts";
import { analyticsPerson } from "@/server/analytics";
import { requireAdminPage } from "../../../admin-guard";

export const metadata: Metadata = { title: "Person" };
export const dynamic = "force-dynamic";

/** One prop as short text: event IDs link to the event, everything else is shown as is. */
function describe(props: Record<string, unknown>) {
  const parts = Object.entries(props).map(([k, v]) =>
    k === "eventId" && typeof v === "string" ? (
      <Link key={k} href={`/events/${v}`} className="underline">
        event
      </Link>
    ) : (
      <span key={k}>
        {k}: {String(v)}
      </span>
    ),
  );
  return parts.length ? (
    <span className="flex flex-wrap gap-x-3 text-sm text-muted">{parts}</span>
  ) : null;
}

/** D-090: a named person and their action timeline (admin only). */
export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const found = await analyticsPerson((await params).id);
  if (!found) notFound();
  const { person: p, timeline } = found;
  const fact = (label: string, value: string | null) => (
    <div className="flex justify-between gap-3 border-b border-line py-2 text-sm last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right font-semibold">{value ?? "–"}</dd>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/analytics" className="text-sm font-semibold text-muted hover:underline">
        ← Analytics
      </Link>
      <h1 className="font-display text-3xl font-extrabold">{p.nickname ?? p.name ?? "No name"}</h1>
      <dl className="rounded-card border-2 border-line px-4">
        {fact("Nickname", p.nickname)}
        {fact("Name", p.name)}
        {fact("Email", p.email)}
        {fact("Consent", p.consentAt ? formatIst(p.consentAt) : null)}
        {fact("First seen", p.firstSeen ? formatIst(p.firstSeen) : null)}
        {fact("Last seen", p.lastSeen ? formatIst(p.lastSeen) : null)}
        {fact("Source", p.source)}
        {fact("Devices", String(p.devices))}
      </dl>
      <Panel title={`Timeline · ${timeline.length}`}>
        {timeline.length === 0 ? (
          <p className="text-sm text-muted">No activity kept.</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line rounded-card border-2 border-line">
            {timeline.map((t, i) => (
              <li key={i} className="flex flex-col gap-1 p-3">
                <span className="flex justify-between gap-3">
                  <span className="font-semibold">{t.name.replaceAll("_", " ")}</span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {formatIst(t.at)}
                  </span>
                </span>
                {describe(t.props)}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}

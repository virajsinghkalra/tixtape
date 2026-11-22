import type { Metadata } from "next";
import Link from "next/link";
import { formatAgo } from "@/components/admin/admin-format";
import { BarList, Panel, Sparkline, StatTile } from "@/components/admin/AnalyticsParts";
import { analyticsDashboard } from "@/server/analytics";
import { requireAdminPage } from "../admin-guard";

export const metadata: Metadata = { title: "Analytics" };
export const dynamic = "force-dynamic";

const pct = (part: number, whole: number) =>
  whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";

/**
 * D-090: who uses Tixtape and what they do, last 30 days. Server-rendered SQL aggregations.
 * Named people (nickname or email) are listed; anonymous devices are only counted.
 */
export default async function AnalyticsPage() {
  await requireAdminPage();
  const d = await analyticsDashboard();
  const now = new Date();
  const { overview: o, funnel, top } = d;
  const visits = funnel[0]?.devices ?? 0;

  return (
    <div className="flex flex-col gap-8">
      <h1 className="font-display text-3xl font-extrabold">Analytics</h1>

      <Panel title="Overview">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="DAU" value={o.dau} hint="last 24 h" />
          <StatTile label="WAU" value={o.wau} hint="last 7 days" />
          <StatTile label="MAU" value={o.mau} hint="last 30 days" />
          <StatTile label="New" value={o.newDevices} hint="this week" />
          <StatTile label="Returning" value={o.returningDevices} hint="this week" />
        </div>
        <Sparkline points={o.daily} />
      </Panel>

      <Panel title="Funnel · 30 days">
        <BarList
          rows={funnel.map((f) => ({
            key: f.step,
            label: f.step,
            value: f.devices,
            note: pct(f.devices, visits),
          }))}
          tone="bg-lime"
        />
      </Panel>

      <div className="grid gap-8 md:grid-cols-2">
        <Panel title="Top events">
          <BarList
            rows={top.events.map((e) => ({
              key: e.eventId,
              label: (
                <Link href={`/events/${e.eventId}`} className="hover:underline">
                  {e.title ?? "Removed event"}
                </Link>
              ),
              value: e.opens,
            }))}
          />
        </Panel>
        <Panel title="Top saved shows ♡">
          <BarList
            rows={top.saved.map((e) => ({
              key: e.eventId,
              label: e.title ?? "Removed event",
              value: e.opens,
            }))}
            tone="bg-pink"
          />
        </Panel>
        <Panel title="Top artists">
          <BarList rows={top.artists.map((a) => ({ key: a.key, label: a.key, value: a.count }))} />
        </Panel>
        <Panel title="Top searches">
          <BarList
            rows={top.searches.map((s) => ({
              key: s.query,
              label: s.query,
              value: s.count,
              note: s.results === 0 ? "0 results" : undefined,
            }))}
          />
        </Panel>
        <Panel title="Zero results 🫠 (demand)">
          <BarList
            rows={top.zeroResults.map((s) => ({ key: s.key, label: s.key, value: s.count }))}
            tone="bg-orange"
            empty="None. Nice."
          />
        </Panel>
        <Panel title="Wanted (ping / follow)">
          <BarList
            rows={top.wanted.map((a) => ({ key: a.key, label: a.key, value: a.count }))}
            tone="bg-pink"
          />
        </Panel>
        <Panel title="Cities">
          <BarList rows={top.cities.map((c) => ({ key: c.key, label: c.key, value: c.count }))} />
        </Panel>
        <Panel title="New devices by source">
          <BarList
            rows={top.sources.map((s) => ({ key: s.key, label: s.key, value: s.count }))}
            tone="bg-lime"
          />
        </Panel>
        <Panel title="Shares by channel">
          <BarList
            rows={top.shares.map((s) => ({ key: s.key, label: s.key, value: s.count }))}
            tone="bg-pink"
          />
        </Panel>
      </div>

      <Panel title="People">
        <p className="text-sm text-muted">
          {d.people.length} named · {d.anonymousDevices.toLocaleString("en-IN")} anonymous devices
          (30 days)
        </p>
        {d.people.length === 0 ? (
          <p className="text-sm text-muted">Nobody named yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line rounded-card border-2 border-line">
            {d.people.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/admin/analytics/people/${p.id}`}
                  className="flex min-h-11 flex-col gap-1 p-3 hover:bg-surface-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <span className="min-w-0">
                    <span className="font-semibold">{p.nickname ?? p.name ?? "No name"}</span>
                    {p.email && (
                      <span className="block truncate text-sm text-muted">
                        {p.email}
                        {p.consentAt ? " · ✉️ consent" : ""}
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted tabular-nums">
                    {p.source ?? "–"} · first {p.firstSeen ? formatAgo(p.firstSeen, now) : "–"} ·
                    last {p.lastSeen ? formatAgo(p.lastSeen, now) : "–"} · {p.events} events
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

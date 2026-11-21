/**
 * Scheduled ingest (P1.11, P4.1; D-050, D-055, D-056).
 *
 *   npx tsx src/scripts/ingest.ts [--source=rollingstone|pollstar|wikipedia|sunburn|teaminnovation|ticketmaster|all]
 *                                 [--dry-run | --hold] [--report=path.json] [--rsi-feed=<tag>]
 *                                 [--no-ai] [--doubt-only=<title>,<title>]
 *   npx tsx src/scripts/ingest.ts --publish <eventId> [<eventId> …]      (the Lead only)
 *
 * Modes:
 * - default: candidates only (`event_candidates`); no events are written (D-055);
 * - `--dry-run`: nothing is written at all; prints what would be held and whether it passes;
 * - `--hold`: also writes verified events as `held` (never `published`), re-verifies stored
 *   events (layer 6), archives past ones, runs Ticketmaster (as `held`) and artist matching;
 * - `--publish`: sets `visibility=published` on the given held events, refusing any whose
 *   layers 1–4 fail or that are in the past (D-056).
 * Every event comes with its per-field verification table, confidence and evidence URLs.
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import {
  collectEvents,
  publishEvents,
  type CollectMode,
  type CollectReport,
  type EventReport,
} from "@/application/ingestion/collect-events";
import { DoubtResolver } from "@/application/ingestion/doubt-resolver";
import { ArtistValidator } from "@/application/ingestion/validate-artists";
import { GitHubModelsExtractor } from "@/infrastructure/ai/github-models";
import { TavilySearch } from "@/infrastructure/ai/tavily";
import type { IngestSummary } from "@/application/events";
import { SpotifyBlockedError } from "@/application/ports/spotify";
import {
  COLLECTOR_SOURCES,
  isAdapterSource,
  type AdapterSource,
} from "@/domain/events/extract/candidate";
import { istDay } from "@/domain/events/ist-calendar";
import type { EventId } from "@/domain/shared/ids";
import { FileCollectorState } from "@/infrastructure/sources/collector-state";
import { env } from "@/lib/env";
import { spotifyModule } from "@/server/auth/spotify-auth";
import { container } from "@/server/container";
import { events } from "@/server/events";
import { watchTerms } from "@/server/lookup";
import { matching } from "@/server/matching";
import { runAsSpotifyClass } from "@/infrastructure/spotify";

/** Sources with their own adapter (D-073: search-driven sources have none). */
const ADAPTERS = COLLECTOR_SOURCES.filter(isAdapterSource);
const ALL = [...ADAPTERS, "ticketmaster"] as const;
type SourceArg = (typeof ALL)[number];
const RESOLVE_LIMIT = 200;

function parseSources(argv: readonly string[]): SourceArg[] {
  const arg = argv.find((a) => a.startsWith("--source="))?.slice("--source=".length) ?? "all";
  if (arg === "all") return [...ALL];
  const picked = arg.split(",").map((s) => s.trim());
  const unknown = picked.filter((s) => !(ALL as readonly string[]).includes(s));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown source(s): ${unknown.join(", ")}. Use one of: ${ALL.join(", ")}, all.`,
    );
  }
  return picked as SourceArg[];
}

/** The IST calendar date, which is what events are stored as (00:00 IST). */
const day = (d: Date) => {
  const { year, month, day: dd } = istDay(d);
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
};
const line = (s: string) => console.warn(s);

function printIngest(label: string, s: IngestSummary): void {
  line(
    `  ${label.padEnd(15)} seen=${s.itemsSeen} new=${s.itemsNew} merged=${s.itemsMerged} updated=${s.itemsUpdated} review=${s.itemsForReview} failed=${s.itemsFailed}`,
  );
}

function printEvent(e: EventReport): void {
  const v = e.verification;
  const dates = e.endsAt ? `${day(e.startsAt)} – ${day(e.endsAt)}` : day(e.startsAt);
  line(`\n■ ${e.title}`);
  line(`  ${dates} · ${e.city}${e.venueName ? ` · ${e.venueName}` : ""}`);
  line(`  headliners: ${e.artists.join(", ") || "(none)"}`);
  if (e.supportActs.length > 0) line(`  support: ${e.supportActs.join(", ")}`);
  line(
    `  ${v.passes ? "PASSES layers 1–4" : "FAILS"} · confidence ${v.confidence} · ${v.independentSources} independent source(s) · outcome: ${e.outcome}${e.detail ? ` (${e.detail})` : ""}${e.eventId ? ` · eventId ${e.eventId}` : ""}`,
  );
  line("  field       status     value                                   agreeing sources");
  for (const [name, f] of Object.entries(v.fields)) {
    line(
      `  ${name.padEnd(11)} ${f.status.padEnd(10)} ${(f.value ?? "—").slice(0, 38).padEnd(39)} ${f.agreeing.map((a) => a.source).join(", ") || "—"}${f.disagreeing.length ? `  ≠ ${f.disagreeing.map((d) => `${d.source}: ${d.value}`).join("; ")}` : ""}`,
    );
  }
  const unconfirmed = v.fields.headliners.artists.filter((a) => !a.confirmed).map((a) => a.name);
  if (unconfirmed.length > 0) line(`  artists named by one source only: ${unconfirmed.join(", ")}`);
  const failed = v.checks.filter((c) => c.ok === false);
  const unknown = v.checks.filter((c) => c.ok === null);
  if (failed.length > 0) {
    line(`  failed checks: ${failed.map((c) => `${c.name} (${c.detail})`).join("; ")}`);
  }
  if (unknown.length > 0) {
    line(`  not checked: ${unknown.map((c) => `${c.name} (${c.detail})`).join("; ")}`);
  }
  for (const s of e.sources) line(`  evidence: [${s.source}] ${s.url}`);
}

function printCollector(r: CollectReport): void {
  line("\nCollector sources (items = event candidates found):");
  for (const s of r.sources) {
    line(`  ${s.source.padEnd(15)} items=${s.itemsSeen}${s.error ? `  FAILED: ${s.error}` : ""}`);
  }
  line(`  Spotify searches for artist validation: ${r.spotifySearches}`);
  if (r.blockedUntil)
    line(`  Spotify blocked until ${r.blockedUntil.toISOString()}: nothing written.`);
  if (r.untitled > 0) line(`  dropped (no event name and no confirmed artist): ${r.untitled}`);
  if (r.focus.length > 0) line(`  looking first for lineups of: ${r.focus.join(", ")}`);
  if (r.notDue > 0) line(`  stored events not yet due for re-verification (D-060): ${r.notDue}`);
  if (r.candidatesDeleted > 0)
    line(`  candidates older than 30 days deleted: ${r.candidatesDeleted}`);
  const passing = r.events.filter((e) => e.verification.passes);
  line(
    `\n${r.mode.toUpperCase()}: ${r.events.length} event(s); ${passing.length} pass layers 1–4 and could be offered for publishing.`,
  );
  for (const e of [...passing, ...r.events.filter((x) => !x.verification.passes)]) printEvent(e);
  if (r.ingest.length > 0) line("\nWritten as held through the ingest use case:");
  for (const s of r.ingest) printIngest("collector", s);
  if (r.archived > 0) line(`Archived ${r.archived} past event(s).`);
}

/** D-064: the free doubt resolver, when both keys are configured. */
function doubtResolver(
  state: FileCollectorState,
  c: ReturnType<typeof container>,
  fetchPage: (url: string) => Promise<string>,
) {
  const { TAVILY_API_KEY, GITHUB_MODELS_TOKEN, GITHUB_MODELS_MODEL } = env();
  if (!TAVILY_API_KEY || !GITHUB_MODELS_TOKEN) {
    line("\nDoubt resolver: off (TAVILY_API_KEY or GITHUB_MODELS_TOKEN not set).");
    return undefined;
  }
  const f: typeof fetch = (...args) => fetch(...args);
  return new DoubtResolver({
    search: new TavilySearch({ apiKey: TAVILY_API_KEY, fetch: f }),
    extractor: new GitHubModelsExtractor({
      token: GITHUB_MODELS_TOKEN,
      model: GITHUB_MODELS_MODEL,
      fetch: f,
    }),
    fetchPage,
    store: state,
    clock: c.clock,
    logger: c.logger,
  });
}

function printDoubt(r: CollectReport): void {
  const d = r.doubt;
  if (!d) return;
  line(
    `\nDoubt resolver (D-064): searches=${d.searches} modelCalls=${d.modelCalls} cacheHits=${d.cacheHits}${d.stopped ? ` stopped: ${d.stopped}` : ""}`,
  );
  for (const n of d.notes) {
    line(`  ${n.title} [${n.reasons.join("; ")}] → ${n.outcome}`);
    if (n.searched.length > 0) line(`    search returned: ${n.searched.join(", ")}`);
    for (const p of n.pages) {
      line(`    page ${p.url}`);
      if (p.kept.length > 0) line(`      grounded: ${p.kept.join(" | ")}`);
      if (p.dropped.length > 0) line(`      dropped: ${p.dropped.join(" | ")}`);
    }
  }
}

async function publish(ids: readonly string[]): Promise<void> {
  const c = container();
  const state = new FileCollectorState();
  const { verification } = events().collectorServices(state);
  const results = await publishEvents({ verification, clock: c.clock }, ids as EventId[]);
  for (const r of results) {
    line(`${r.published ? "PUBLISHED" : "REFUSED  "} ${r.eventId}: ${r.reason}`);
  }
  if (results.some((r) => !r.published)) process.exitCode = 1;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const c = container();
  const publishAt = argv.indexOf("--publish");
  if (publishAt >= 0) {
    const ids = argv.slice(publishAt + 1).filter((a) => !a.startsWith("--"));
    if (ids.length === 0) throw new Error("--publish needs one or more event IDs.");
    await publish(ids);
    await c.db.$close();
    return;
  }
  const mode: CollectMode = argv.includes("--dry-run")
    ? "dry-run"
    : argv.includes("--hold")
      ? "hold"
      : "candidates";
  const reportPath = argv.find((a) => a.startsWith("--report="))?.slice("--report=".length);
  const sources = parseSources(argv);
  const ev = events();
  const now = c.clock.now();
  const state = new FileCollectorState();
  let failed = false;

  line(`Ingest run ${now.toISOString()} mode=${mode} sources=${sources.join(",")}`);

  if (sources.includes("ticketmaster")) {
    const apiKey = env().TICKETMASTER_API_KEY;
    if (!apiKey) line("\nTicketmaster: skipped (TICKETMASTER_API_KEY is not set).");
    else if (mode !== "hold")
      line("\nTicketmaster: skipped (writes events; runs only with --hold).");
    else {
      try {
        line("\nTicketmaster (written as held):");
        printIngest(
          "ticketmaster",
          await ev.ingest(ev.ticketmasterSource({ apiKey, countryCodes: ["IN"] }), { from: now }),
        );
      } catch (e) {
        failed = true;
        line(`  ticketmaster FAILED: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  const picked = sources.filter((s): s is AdapterSource => s !== "ticketmaster");
  if (picked.length > 0) {
    const all = ev.collectorSources(state, {
      rollingStoneFeed: argv.find((a) => a.startsWith("--rsi-feed="))?.slice("--rsi-feed=".length),
    });
    const services = ev.collectorServices(state);
    const terms = await watchTerms();
    if (terms.length > 0) line(`\nWatch list: ${terms.join(", ")}`);
    const validator = new ArtistValidator({
      catalog: spotifyModule().artistCatalog,
      artists: ev.artistRepository,
      cache: state,
      clock: c.clock,
    });
    const report = await collectEvents(
      {
        validator,
        store: services.candidates,
        ingest: ev.ingest,
        findEventId: services.findEventId,
        clock: c.clock,
        logger: c.logger,
        verification: services.verification,
        identity: services.identity,
        geocoder: services.geocoder,
        doubt:
          mode !== "candidates" && !argv.includes("--no-ai")
            ? doubtResolver(state, c, services.fetchPageText)
            : undefined,
        doubtOnly: argv
          .find((a) => a.startsWith("--doubt-only="))
          ?.slice("--doubt-only=".length)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      },
      picked.map((s) => all[s]),
      { mode, watchTerms: terms },
    );
    printDoubt(report);
    printCollector(report);
    if (reportPath) {
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      line(`\nReport written to ${reportPath}`);
    }
    if (report.sources.some((s) => s.error)) failed = true;
  }

  if (mode === "hold") {
    line("\nArtist matching:");
    try {
      const r = await matching().resolvePendingArtists(RESOLVE_LIMIT);
      const matched = r.outcomes.filter((o) => o.status === "auto").length;
      line(
        `  resolved=${r.resolved} matched=${matched} failed=${r.failed.length} blockedUntil=${r.blockedUntil ?? "-"}`,
      );
    } catch (e) {
      if (!(e instanceof SpotifyBlockedError)) throw e;
      line(`  Spotify blocked until ${e.resumeAfter.toISOString()}; matching resumes next run.`);
    }
  }

  await c.db.$close();
  if (failed) process.exitCode = 1;
}

// D-080: every Spotify call in this script counts as `discovery` (background, capped).
runAsSpotifyClass("discovery", main).catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});

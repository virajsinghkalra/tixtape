/**
 * Gig coverage run (D-073 discovery, D-074 gate and publishing).
 *
 *   npx tsx src/scripts/discover-gigs.ts [--dry-run | --candidates-only]
 *        [--artists=<name>,<name>] [--max-artists=<n>] [--report=<path.json>]
 *        [--skip-listings] [--skip-discovery] [--skip-enrich] [--skip-publish] [--skip-reverify]
 *        [--no-demand]
 *
 * Steps (each can be skipped):
 *  0. listings: HighApe city pages, one candidate per night (artists validated on Spotify);
 *  1. discovery: watchlist (search_log + catalogue + Last.fm India) → this run's artists →
 *     official sites and one web search each → quote-grounded nights stored as candidates,
 *     plus leads for pages we may not read. Calls Spotify (artist validation) and Tavily.
 *  2. gate: every upcoming night is judged by `autoPublishDecision`; verdicts go to
 *     `gate_decisions`; passing nights are published when the switch allows (below).
 *  3. re-verification: auto-published future events whose last check is ≥ 3 days old.
 * Publishing runs only when AUTO_PUBLISH_ENABLED=true and `settings.auto_publish_paused_until`
 * is absent or past; otherwise nights are still discovered and judged, never published.
 * Modes:
 *  - default: everything above;
 *  - `--candidates-only`: writes candidates and leads only (no gate decisions, no events);
 *  - `--dry-run`: writes nothing; prints what would happen.
 */
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { DEFAULT_CAPS } from "@/application/ingestion/doubt-resolver";
import { ArtistValidator } from "@/application/ingestion/validate-artists";
import {
  artistsForRun,
  loadRunPlan,
  loadWatchlist,
  runDiscovery,
  runListings,
  type DiscoveryRunReport,
} from "@/application/gigs/run-discovery";
import { enrichPress } from "@/application/gigs/enrich-press";
import { runPipeline, type PipelineStep } from "@/application/gigs/run-pipeline";
import { PgSpotifyGateStore } from "@/infrastructure/db/spotify-gate-store";
import { publishDueCandidates, type NightOutcome } from "@/application/gigs/publish-due-candidates";
import { reverifyAutoPublished, type ReverifyOutcome } from "@/application/gigs/reverify-published";
import { listingsForRun } from "@/domain/gigs/demand";
import { isoDate } from "@/domain/gigs/extract";
import { HIGHAPE_CITIES } from "@/infrastructure/sources/highape";
import { createGigsModule, GigEnvSchema } from "@/infrastructure/gigs/gigs-module";
import { FileCollectorState } from "@/infrastructure/sources/collector-state";
import { env } from "@/lib/env";
import { spotifyModule } from "@/server/auth/spotify-auth";
import { container } from "@/server/container";
import { events } from "@/server/events";
import { runAsSpotifyClass } from "@/infrastructure/spotify";

const line = (s: string) => console.warn(s);
/** D-081: listing cities outside the demand plan read per run (the floor). */
const LISTING_FLOOR_CITIES = 2;
const arg = (argv: readonly string[], name: string) =>
  argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function printDiscovery(r: DiscoveryRunReport): void {
  line(`\nDiscovery: ${r.artists.length} artist(s), ${r.candidates.length} night candidate(s)`);
  for (const a of r.artists) {
    const found = r.candidates.filter((c) => c.provenance?.artist === a.artist);
    line(`\n● ${a.artist}${a.skipped ? `  (search skipped: ${a.skipped})` : ""}`);
    if (a.officialSites.length > 0) line(`  official site(s): ${a.officialSites.join(", ")}`);
    for (const p of a.pages) line(`  page ${p.url}: ${p.error ?? `${p.found} night(s)`}`);
    for (const c of found) {
      const p = c.provenance!;
      line(
        `  ✓ ${isoDate(c.startsAt)}${c.endsAt ? `–${isoDate(c.endsAt)} (range)` : ""} ${c.city}${p.startTime ? ` ${p.startTime}` : ""} · ${c.title} [${c.source}${p.officialKind ? `, official ${p.officialKind}` : ""}] ${c.url}`,
      );
      line(`      date quote: "${p.quotes.date ?? "—"}"`);
    }
    for (const l of a.leads) line(`  lead (${l.reason}) ${l.url} — "${l.title}"`);
  }
  if (r.blockedUntil) line(`Spotify blocked until ${r.blockedUntil.toISOString()}; stopped early.`);
}

function printGate(outcomes: readonly NightOutcome[]): void {
  const by = (d: string) => outcomes.filter((o) => o.decision === d).length;
  line(
    `\nGate: ${outcomes.length} night(s) · publish ${by("publish")} · hold ${by("hold")} · reject ${by("reject")}`,
  );
  for (const o of outcomes) {
    line(
      `\n■ ${o.night} ${o.city} · ${o.title} → ${o.decision.toUpperCase()}${o.path ? ` via ${o.path}` : ""} (${o.action}${o.detail ? `: ${o.detail}` : ""})`,
    );
    line(`  confidence ${o.confidence}${o.eventId ? ` · eventId ${o.eventId}` : ""}`);
    for (const s of o.sources)
      line(`  source [${s.source}${s.official ? ", official" : ""}] ${s.url}`);
    for (const r of o.reasons) line(`  held because ${r}`);
  }
}

function printReverify(outcomes: readonly ReverifyOutcome[]): void {
  line(`\nRe-verification: ${outcomes.length} auto-published event(s) due`);
  for (const o of outcomes) line(`  ${o.result.padEnd(9)} ${o.nightKey} ${o.detail}`);
}

/** The run report, filled as steps finish; always written (`finish`). */
const report: Record<string, unknown> = {};

async function main(): Promise<boolean> {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run");
  const candidatesOnly = argv.includes("--candidates-only");
  const gigEnv = GigEnvSchema.parse(process.env);
  const c = container();
  const ev = events();
  const state = new FileCollectorState();
  const gigs = createGigsModule({
    db: c.db,
    clock: c.clock,
    logger: c.logger,
    lastfmApiKey: env().LASTFM_API_KEY,
    tavilyApiKey: env().TAVILY_API_KEY,
    searchesPerDay: env().DOUBT_SEARCHES_PER_DAY ?? DEFAULT_CAPS.searchesPerDay,
    autoPublishEnabled: gigEnv.AUTO_PUBLISH_ENABLED,
  });
  const services = ev.collectorServices(state);
  const validator = new ArtistValidator({
    catalog: spotifyModule().artistCatalog,
    artists: ev.artistRepository,
    cache: state,
    clock: c.clock,
  });
  const now = c.clock.now();
  const write = !dryRun;
  Object.assign(report, { at: now.toISOString(), dryRun, candidatesOnly });
  line(
    `Gig coverage run ${now.toISOString()} ${dryRun ? "DRY RUN (nothing written)" : candidatesOnly ? "candidates only" : "full"}`,
  );

  // D-081: weight this run by where visitors are looking.
  const perRun = Number(arg(argv, "max-artists") ?? gigEnv.GIG_ARTISTS_PER_RUN);
  const { plan, artistCities } = argv.includes("--no-demand")
    ? { plan: { metros: [], floorSlots: perRun }, artistCities: [] }
    : await loadRunPlan({ ...gigs.demand, clock: c.clock, logger: c.logger }, perRun);
  line(
    plan.metros.length === 0
      ? "Demand: no city data yet; plain rotation."
      : `Demand: ${plan.metros
          .map(
            (m) =>
              `${m.metro} score=${m.score} slots=${m.slots} upcoming=${m.upcoming}${m.scarce ? " (few shows: first)" : ""}`,
          )
          .join(" · ")} · floor=${plan.floorSlots}`,
  );
  const runIndex = Math.floor(now.getTime() / 86_400_000);
  const highApeCities = listingsForRun(
    Object.keys(HIGHAPE_CITIES),
    (slug) => HIGHAPE_CITIES[slug] ?? slug,
    plan,
    LISTING_FLOOR_CITIES,
    runIndex,
  );

  const fresh: NonNullable<Parameters<typeof publishDueCandidates>[1]["extra"]>[number][] = [];
  const steps: PipelineStep[] = [];
  const step = (name: string, needsSpotify: boolean, run: () => Promise<unknown>) => {
    if (!argv.includes(`--skip-${name}`)) steps.push({ name, needsSpotify, run });
  };
  step("listings", true, async () => {
    const listings = await runListings(
      { validator, store: services.candidates, clock: c.clock, logger: c.logger },
      gigs.listings(state, highApeCities),
      { write },
    );
    line(
      `\nListings: ${listings.sources.map((s) => `${s.source} items=${s.items}${s.error ? ` FAILED: ${s.error}` : ""}`).join(", ")}; ${listings.candidates.length} night(s) with a Spotify-confirmed act`,
    );
    fresh.push(...listings.candidates);
    report.listings = listings;
    return listings;
  });

  step("discovery", true, async () => {
    const watchlist = await loadWatchlist({
      ...gigs.watchlist,
      validator,
      clock: c.clock,
      logger: c.logger,
    });
    const only = arg(argv, "artists")?.split(",").filter(Boolean);
    const artists = artistsForRun(watchlist, { perRun, now, only, plan, artistCities });
    line(
      `Watchlist: ${watchlist.length} artist(s); this run: ${artists.map((a) => ("reason" in a ? `${a.name} [${a.reason}]` : a.name)).join(", ") || "none"}`,
    );
    const discovery = await runDiscovery(
      {
        discovery: gigs.discovery(state, { write }),
        validator,
        store: services.candidates,
        clock: c.clock,
        logger: c.logger,
      },
      artists,
      { write },
    );
    printDiscovery(discovery);
    fresh.push(...discovery.candidates);
    report.discovery = discovery;
    return discovery;
  });

  step("enrich", false, async () => {
    // D-089: give already-collected news articles their publisher, date and quotes.
    const enriched = await enrichPress(
      {
        candidates: gigs.stores.candidates,
        reader: gigs.reader(state),
        store: services.candidates,
        clock: c.clock,
        logger: c.logger,
      },
      { write },
    );
    line(
      `\nPress enrichment: ${enriched.read} article(s) read, ${enriched.enriched.length} candidate(s) now carry press provenance${enriched.failed.length ? `, ${enriched.failed.length} failed` : ""}`,
    );
    fresh.push(...enriched.enriched);
    report.enrich = enriched;
  });

  if (!candidatesOnly)
    step("publish", false, async () => {
      const blockedReason = dryRun ? "dry run" : await gigs.publishSwitch.blockedReason(now);
      if (blockedReason)
        line(`\nPublishing is off this run: ${blockedReason}. Nights are judged and held.`);
      const outcomes = await publishDueCandidates(
        {
          ...gigs.stores,
          verification: services.verification,
          store: services.candidates,
          ingest: ev.ingest,
          findEventId: services.findEventId,
          alerts: c.alerts,
          clock: c.clock,
          logger: c.logger,
        },
        {
          blockedReason,
          record: write,
          extraPaths: {
            firstParty: gigEnv.AUTO_PUBLISH_EXTRA_PATHS,
            press: gigEnv.AUTO_PUBLISH_EXTRA_PATHS,
          },
          extra: fresh,
        },
      );
      printGate(outcomes);
      report.gate = outcomes;
    });

  if (!candidatesOnly && !dryRun)
    step("reverify", false, async () => {
      const outcomes = await reverifyAutoPublished({
        audit: gigs.stores.audit,
        reader: gigs.reader(state),
        verification: services.verification,
        matches: gigs.stores.matches,
        updateStartTime: (id, official, hhmm) => gigs.updateStartTime(id, official.night, hhmm),
        alerts: c.alerts,
        clock: c.clock,
        logger: c.logger,
      });
      printReverify(outcomes);
      report.reverify = outcomes;
    });

  // A closed Spotify gate (429 or the D-080 daily cap) defers the Spotify steps, never fails.
  const spotifyPausedUntil = await new PgSpotifyGateStore(c.db).readPausedUntil();
  const run = await runPipeline(steps, { now, spotifyPausedUntil });
  report.steps = run.steps;
  report.deferred = run.deferred;
  for (const d of run.deferred) line(`\n⏸ ${d}`);
  for (const f of run.steps.filter((x) => x.status === "failed")) {
    line(`\n✖ ${f.name} failed: ${"detail" in f ? f.detail : ""}`);
  }
  return run.failed;
}

/** Writes the report whatever happened, then exits: 1 only for real errors (not a Spotify pause). */
async function finish(run: () => Promise<boolean>): Promise<void> {
  const argv = process.argv.slice(2);
  let failed = true;
  try {
    failed = await run();
  } catch (e) {
    console.error(e);
    report.error = e instanceof Error ? e.message : String(e);
  } finally {
    const reportPath = arg(argv, "report");
    if (reportPath) {
      await writeFile(reportPath, JSON.stringify(report, null, 2));
      line(`\nReport written to ${reportPath}`);
    }
    await container()
      .db.$close()
      .catch(() => undefined);
  }
  process.exitCode = failed ? 1 : 0;
}

// D-080: every Spotify call in this script counts as `discovery` (background, capped).
void finish(() => runAsSpotifyClass("discovery", main));

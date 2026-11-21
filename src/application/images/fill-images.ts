/**
 * The image pipeline (D-083): ask each provider in order, keep the candidate the policy picks,
 * store it with its credit. Stored images are verified every 30 days and replaced when broken.
 */
import type { Clock } from "@/application/ports/clock";
import type {
  ArtistImageRow,
  ArtistImageStore,
  EventPosterRow,
  EventPosterStore,
  ImageLinkChecker,
  ImageProvider,
  SavedImage,
  StoredImage,
} from "@/application/ports/images";
import {
  DEFAULT_IMAGE_POLICY,
  IMAGE_RECHECK_DAYS,
  rejectionReason,
  selectImage,
  type ImageCandidate,
  type ImagePolicy,
  type ImageSubject,
} from "@/domain/images/image";

export type FindResult = {
  chosen: ImageCandidate | null;
  /** Every provider's answer, for dry runs: a candidate, why it was refused, or an error. */
  tried: { provider: string; candidate: ImageCandidate | null; refused: string | null }[];
};

/**
 * Asks providers in order. Stops early once the most trusted source has an acceptable picture.
 * A failing provider (network, rate limit) is recorded and skipped: no picture beats a crash.
 */
export async function findImage(
  providers: readonly ImageProvider[],
  subject: ImageSubject,
  policy: ImagePolicy = DEFAULT_IMAGE_POLICY,
): Promise<FindResult> {
  const tried: FindResult["tried"] = [];
  for (const provider of providers.filter((p) => p.supports(subject))) {
    try {
      const candidate = await provider.find(subject);
      tried.push({
        provider: provider.id,
        candidate,
        refused: candidate ? rejectionReason(candidate, policy) : null,
      });
      if (candidate && candidate.source === policy.trustOrder[0] && !tried.at(-1)?.refused) break;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      tried.push({ provider: provider.id, candidate: null, refused: `error: ${message}` });
    }
  }
  const candidates = tried.flatMap((t) => (t.candidate ? [t.candidate] : []));
  return { chosen: selectImage(candidates, policy), tried };
}

export type FillOutcome = {
  id: string;
  name: string;
  /**
   * `set`: a new picture; `kept`: the stored one still works; `cleared`: it broke, none found;
   * `failed`: a provider errored and nothing was found, so nothing is written and it stays due.
   */
  action: "set" | "kept" | "none" | "cleared" | "failed";
  image: SavedImage | null;
  found: FindResult | null;
};

export type FillDeps = {
  providers: readonly ImageProvider[];
  links: ImageLinkChecker;
  clock: Clock;
  policy?: ImagePolicy;
};

const toSaved = (c: ImageCandidate): SavedImage => ({
  url: c.url,
  credit: c.credit,
  source: c.source,
});

type Target = { id: string; name: string; stored: StoredImage | null; subject: ImageSubject };

/** One subject: keep a working stored picture, otherwise search again. */
async function fillOne(deps: FillDeps, target: Target): Promise<FillOutcome> {
  const base = { id: target.id, name: target.name };
  if (target.stored && !(await deps.links.isBroken(target.stored.url))) {
    return { ...base, action: "kept", image: null, found: null };
  }
  const found = await findImage(deps.providers, target.subject, deps.policy);
  if (found.chosen) return { ...base, action: "set", image: toSaved(found.chosen), found };
  // An outage isn't an answer: retry next run instead of waiting 30 days.
  if (found.tried.some((t) => t.refused?.startsWith("error:"))) {
    return { ...base, action: "failed", image: null, found };
  }
  return { ...base, action: target.stored ? "cleared" : "none", image: null, found };
}

export type FillOptions = { limit: number; dryRun: boolean };

async function fillAll<Row>(
  deps: FillDeps,
  rows: readonly Row[],
  toTarget: (row: Row) => Target,
  save: (row: Row, outcome: FillOutcome, at: Date) => Promise<void>,
  dryRun: boolean,
): Promise<FillOutcome[]> {
  const outcomes: FillOutcome[] = [];
  for (const row of rows) {
    const outcome = await fillOne(deps, toTarget(row));
    if (!dryRun && outcome.action !== "failed") await save(row, outcome, deps.clock.now());
    outcomes.push(outcome);
  }
  return outcomes;
}

function dueBefore(clock: Clock): Date {
  return new Date(clock.now().getTime() - IMAGE_RECHECK_DAYS * 86_400_000);
}

type ImageWriter<Id> = {
  save(id: Id, image: SavedImage | null, checkedAt: Date): Promise<void>;
  touch(id: Id, checkedAt: Date): Promise<void>;
};

/** `kept` moves only the check time; `set` writes the picture; `none`/`cleared` write null. */
function writeOutcome<Id>(store: ImageWriter<Id>, id: Id, outcome: FillOutcome, at: Date) {
  return outcome.action === "kept" ? store.touch(id, at) : store.save(id, outcome.image, at);
}

export function artistSubject(row: ArtistImageRow): ImageSubject {
  return {
    kind: "artist",
    name: row.name,
    spotifyId: row.spotifyId,
    mbid: row.mbid,
    spotifyImageUrl: row.spotifyImageUrl,
  };
}

/** D-083: alternative photos for artists without a Spotify image. */
export async function fillArtistImages(
  deps: FillDeps & { store: ArtistImageStore },
  opts: FillOptions,
): Promise<FillOutcome[]> {
  const rows = await deps.store.listDue(dueBefore(deps.clock), opts.limit);
  return fillAll(
    deps,
    rows,
    (row) => ({ id: row.id, name: row.name, stored: row.alt, subject: artistSubject(row) }),
    (row, outcome, at) => writeOutcome(deps.store, row.id, outcome, at),
    opts.dryRun,
  );
}

/** D-082/D-083: official posters for upcoming events. */
export async function fillEventPosters(
  deps: FillDeps & { store: EventPosterStore },
  opts: FillOptions,
): Promise<FillOutcome[]> {
  const rows: EventPosterRow[] = await deps.store.listDue(dueBefore(deps.clock), opts.limit);
  return fillAll(
    deps,
    rows,
    (row) => ({
      id: row.id,
      name: row.title,
      stored: row.poster,
      subject: { kind: "event", title: row.title, officialUrls: row.officialUrls },
    }),
    (row, outcome, at) => writeOutcome(deps.store, row.id, outcome, at),
    opts.dryRun,
  );
}

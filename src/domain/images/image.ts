/**
 * Image subjects, candidates and the pure selection policy (D-083). Providers (Spotify,
 * Wikidata/Commons, official pages…) each propose at most one candidate; this decides which,
 * if any, may be shown. Pure: no IO.
 */

/** What we want a picture of. */
export type ImageSubject =
  | {
      kind: "artist";
      name: string;
      spotifyId: string | null;
      mbid: string | null;
      /** The Spotify image already stored (`artists.image_url`), if any. */
      spotifyImageUrl: string | null;
    }
  | { kind: "event"; title: string; officialUrls: readonly string[] };

/** Where a picture came from. Order of trust is the policy's `trustOrder`. */
export type ImageSource = "spotify" | "wikimedia" | "official";

export type ImageCandidate = {
  url: string;
  /** Shown under the picture, e.g. "Photo: Jane Doe, CC BY-SA 4.0, Wikimedia Commons". */
  credit: string | null;
  /** Licence short name ("CC BY-SA 4.0"), or null for official and Spotify assets. */
  license: string | null;
  source: ImageSource;
  /** 0–1: how sure the provider is that this shows the right subject. */
  confidence: number;
  /** Human-readable reasons, for dry runs and admin review. */
  evidence: readonly string[];
};

export type ImagePolicy = {
  /** Earlier sources win over later ones, whatever their confidence. */
  trustOrder: readonly ImageSource[];
  minConfidence: number;
  /** Image hosts each source may use; a candidate on any other host is dropped. */
  allowedHosts: Readonly<Record<ImageSource, readonly string[] | "any-https">>;
};

export const DEFAULT_IMAGE_POLICY: ImagePolicy = {
  trustOrder: ["spotify", "official", "wikimedia"],
  minConfidence: 0.7,
  allowedHosts: {
    spotify: ["i.scdn.co"],
    wikimedia: ["upload.wikimedia.org"],
    // Official organiser pages host their own posters, on their own domains or CDNs.
    official: "any-https",
  },
};

/** Free licences that allow reuse with credit: Creative Commons BY / BY-SA / CC0, public domain. */
const FREE_LICENSE =
  /^(?:cc0|cc[ -]by(?:[ -]sa)?(?:[ -]\d(?:\.\d)?)?(?:[ -][a-z]{2,})?|public domain|pd(?:[ -].*)?)$/iu;

export function isFreeLicense(license: string | null): boolean {
  return license !== null && FREE_LICENSE.test(license.trim());
}

/** Spotify and official organiser assets are allowed as-is; anything else needs a free licence. */
function licenseOk(c: ImageCandidate): boolean {
  return c.source === "spotify" || c.source === "official" || isFreeLicense(c.license);
}

function hostOk(c: ImageCandidate, policy: ImagePolicy): boolean {
  let url: URL;
  try {
    url = new URL(c.url);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const allowed = policy.allowedHosts[c.source];
  return allowed === "any-https" || allowed.includes(url.hostname.toLowerCase());
}

/** Why a candidate was refused, or null when it may be shown. */
export function rejectionReason(c: ImageCandidate, policy: ImagePolicy): string | null {
  if (!hostOk(c, policy)) return "url is not https on an allowed host";
  if (!licenseOk(c)) return `licence not free: ${c.license ?? "unknown"}`;
  if (c.confidence < policy.minConfidence) return `confidence ${c.confidence} below minimum`;
  return null;
}

/**
 * The picture to show: the most trusted source with an acceptable candidate, then the most
 * confident. Null when nothing passes (better no photo than the wrong person's).
 */
export function selectImage(
  candidates: readonly ImageCandidate[],
  policy: ImagePolicy = DEFAULT_IMAGE_POLICY,
): ImageCandidate | null {
  const trust = (c: ImageCandidate) => {
    const i = policy.trustOrder.indexOf(c.source);
    return i === -1 ? Number.POSITIVE_INFINITY : i;
  };
  const ok = candidates.filter((c) => rejectionReason(c, policy) === null && trust(c) < Infinity);
  return ok.sort((a, b) => trust(a) - trust(b) || b.confidence - a.confidence)[0] ?? null;
}

/** D-083: found images are checked again after this, and broken ones at once. */
export const IMAGE_RECHECK_DAYS = 30;

/**
 * Whether a subject's image should be looked for (or verified) again: never checked, checked
 * more than `IMAGE_RECHECK_DAYS` ago, or its stored link was found broken.
 */
export function isImageCheckDue(
  checkedAt: Date | null,
  now: Date,
  opts: { linkBroken?: boolean } = {},
): boolean {
  if (opts.linkBroken || checkedAt === null) return true;
  return now.getTime() - checkedAt.getTime() >= IMAGE_RECHECK_DAYS * 86_400_000;
}

/** Plain text from a third-party HTML snippet (Commons `Artist` is HTML): tags and entities out. */
export function plainText(html: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
    nbsp: " ",
  };
  return html
    .replace(/<[^>]*>/gu, " ")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/gu, (_m, e: string) => entities[e] ?? "")
    .replace(/\s+/gu, " ")
    .trim();
}

/** "Photo: Jane Doe, CC BY-SA 4.0, Wikimedia Commons"; an unknown author is left out. */
export function photoCredit(author: string | null, license: string, site: string): string {
  const who = author ? plainText(author).slice(0, 120) : "";
  return ["Photo: " + (who || site), license, ...(who ? [site] : [])].join(", ");
}

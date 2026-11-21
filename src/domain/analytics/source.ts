/**
 * D-090: where a visit came from, as one short label. UTM tags win; then the referrer's host,
 * classified (whatsapp, instagram, google…); then our own `?via=` share tag; else "direct".
 * Only the label (plus a cleaned utm medium and campaign) is stored, never a referrer URL.
 */
import type { RawSource } from "./beacon";

export const REFERRER_KINDS = [
  "whatsapp",
  "instagram",
  "google",
  "facebook",
  "twitter",
  "direct",
  "other",
] as const;
export type ReferrerKind = (typeof REFERRER_KINDS)[number];

export type TrafficSource = {
  /** "whatsapp", "instagram", "google", "direct", "other", "share", or a utm_source. */
  source: string;
  medium: string | null;
  campaign: string | null;
};

/** Lower-case, `a-z 0-9 . _ -` only, at most `max` characters; null when nothing is left. */
export function cleanTag(raw: string | null | undefined, max = 40): string | null {
  if (!raw) return null;
  const tag = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return tag.length > 0 ? tag : null;
}

const RULES: [RegExp, ReferrerKind][] = [
  [/(^|\.)(whatsapp\.com|whatsapp\.net|wa\.me)$|^com\.whatsapp$/, "whatsapp"],
  [/(^|\.)(instagram\.com|ig\.me)$|^com\.instagram\.android$/, "instagram"],
  [/(^|\.)google\.[a-z.]{2,6}$|^com\.google\.android\.(gm|googlequicksearchbox)$/, "google"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, "twitter"],
];

/**
 * Classifies a referrer host. An empty referrer, or our own host, is "direct". Android apps can
 * send `android-app://com.whatsapp/`, so a package name is accepted as a host.
 */
export function classifyReferrer(
  host: string | null | undefined,
  selfHost: string | null = null,
): ReferrerKind {
  const h = (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^android-app:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "");
  if (!h || (selfHost && h === selfHost.toLowerCase().replace(/^www\./, ""))) return "direct";
  for (const [pattern, kind] of RULES) if (pattern.test(h)) return kind;
  return "other";
}

/** Our share links carry `?via=`: wa and ig name the app; anything else is a plain share. */
function viaSource(via: string | null): string | null {
  if (!via) return null;
  if (via === "wa") return "whatsapp";
  if (via === "ig") return "instagram";
  return "share";
}

export function trafficSource(
  raw: RawSource | undefined,
  selfHost: string | null = null,
): TrafficSource {
  const utm = cleanTag(raw?.us);
  const medium = cleanTag(raw?.um);
  const campaign = cleanTag(raw?.uc, 60);
  if (utm) return { source: utm, medium, campaign };
  const referrer = classifyReferrer(raw?.ref, selfHost);
  if (referrer !== "direct") return { source: referrer, medium: null, campaign: null };
  return { source: viaSource(cleanTag(raw?.via, 12)) ?? "direct", medium: null, campaign: null };
}

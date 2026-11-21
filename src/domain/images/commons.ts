/**
 * Wikimedia Commons file URLs (D-083). Pure. Thumbnails come only in standard widths; any other
 * width returns HTTP 400 (checked live 2026-11-22: 330/500/960 → 200, 512 → 400).
 */

export const COMMONS_THUMB_WIDTHS = [330, 500, 960] as const;
export type CommonsThumbWidth = (typeof COMMONS_THUMB_WIDTHS)[number];

const COMMONS_ORIGINAL =
  /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/([0-9a-f])\/([0-9a-f]{2})\/([^/?#]+)$/u;
/** Raster and SVG files a browser shows; others (TIFF, PDF, video) are skipped. */
const SHOWABLE = /\.(?:jpe?g|png|gif|webp|svg)$/iu;

/**
 * `upload.wikimedia.org/wikipedia/commons/thumb/a/ab/File.jpg/500px-File.jpg` for an original
 * Commons URL. Files no wider than `width` are returned as they are (Commons won't upscale).
 * SVGs are rendered to PNG. Null for anything that isn't a showable Commons original.
 */
export function commonsThumbUrl(
  originalUrl: string,
  originalWidth: number,
  width: CommonsThumbWidth = 500,
): string | null {
  const clean = originalUrl.split(/[?#]/u)[0] ?? "";
  const m = COMMONS_ORIGINAL.exec(clean);
  if (!m || !SHOWABLE.test(m[3] ?? "")) return null;
  if (originalWidth <= width) return clean;
  const [, a, ab, file] = m;
  const suffix = /\.svg$/iu.test(file ?? "") ? ".png" : "";
  return `https://upload.wikimedia.org/wikipedia/commons/thumb/${a}/${ab}/${file}/${width}px-${file}${suffix}`;
}

const COMMONS_ANY =
  /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/u;

/**
 * The Commons file name behind an image URL (original or thumbnail), or null. Images hosted only
 * on a language Wikipedia (`/wikipedia/en/…`) are often non-free and are refused.
 */
export function commonsFileName(url: string): string | null {
  const m = COMMONS_ANY.exec(url);
  if (!m?.[1]) return null;
  try {
    return decodeURIComponent(m[1]).replace(/_/gu, " ");
  } catch {
    return null;
  }
}

/**
 * Small image providers (D-083): the Spotify image matching already stored, and the official
 * event page's og:image (D-082).
 */
import type { ImageProvider } from "@/application/ports/images";
import { allowedDomain } from "@/domain/events/extract/allow-list";
import type { ImageCandidate, ImageSubject } from "@/domain/images/image";

/** Spotify's artist image, already in `artists.image_url`. Makes no Spotify calls. */
export class StoredSpotifyImageProvider implements ImageProvider {
  readonly id = "spotify";

  supports(subject: ImageSubject): boolean {
    return subject.kind === "artist";
  }

  async find(subject: ImageSubject): Promise<ImageCandidate | null> {
    if (subject.kind !== "artist" || !subject.spotifyImageUrl) return null;
    return {
      url: subject.spotifyImageUrl,
      credit: null,
      license: null,
      source: "spotify",
      confidence: 1,
      evidence: ["matched Spotify artist's image"],
    };
  }
}

/** Reads a page politely and returns its og:image (PolitePageReader, D-082). */
export type PageImageReader = {
  read(url: string): Promise<{ status: string; image?: string | null }>;
};

/** The og:image of the first allow-listed `official` page for the event. */
export class OfficialPosterProvider implements ImageProvider {
  readonly id = "official";

  constructor(private readonly reader: PageImageReader) {}

  supports(subject: ImageSubject): boolean {
    return subject.kind === "event";
  }

  async find(subject: ImageSubject): Promise<ImageCandidate | null> {
    if (subject.kind !== "event") return null;
    for (const page of subject.officialUrls) {
      if (allowedDomain(page)?.trust !== "official") continue;
      const read = await this.reader.read(page);
      if (read.status !== "ok" || !read.image) continue;
      const host = new URL(page).hostname.replace(/^www\./u, "");
      return {
        url: read.image,
        credit: `Poster: ${host}`,
        license: null,
        source: "official",
        confidence: 0.9,
        evidence: [`og:image of ${page}`],
      };
    }
    return null;
  }
}

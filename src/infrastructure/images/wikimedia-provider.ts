/**
 * Artist photos from Wikidata (P18) and the English Wikipedia page summary, served from Commons
 * (D-083). Identity rules live in `identifyArtist`; this adapter only fetches and parses.
 * All calls go through PoliteFetcher (identifying User-Agent, 1 req/s per host) as documented
 * MediaWiki APIs (`api-etiquette`). No Spotify calls.
 */
import { z } from "zod";
import type { ImageProvider } from "@/application/ports/images";
import { commonsFileName, commonsThumbUrl } from "@/domain/images/commons";
import { photoCredit, type ImageCandidate, type ImageSubject } from "@/domain/images/image";
import { identifyArtist, type WikidataArtist } from "@/domain/images/wikidata-identity";
import { nameVariants } from "@/domain/matching/variants";

const WIKIDATA_API = "https://www.wikidata.org/w/api.php";
const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
const ENWIKI_SUMMARY = "https://en.wikipedia.org/api/rest_v1/page/summary/";
/** Search hits per name; namesakes beyond this are rarely music acts. */
const SEARCH_LIMIT = 7;
const MAX_NAME_SEARCHES = 2;

export type JsonFetcher = {
  getText(url: string, opts: { accept: string; policy: "api-etiquette" }): Promise<string>;
};

const SearchEntities = z.object({ search: z.array(z.object({ id: z.string() })) });
const QuerySearch = z.object({
  query: z.object({ search: z.array(z.object({ title: z.string().regex(/^Q\d+$/u) })) }),
});
const Snak = z.object({
  mainsnak: z.object({ datavalue: z.object({ value: z.unknown() }).optional() }),
});
const Entities = z.object({
  entities: z.record(
    z.string(),
    z.object({
      id: z.string().optional(),
      labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
      aliases: z.record(z.string(), z.array(z.object({ value: z.string() }))).optional(),
      claims: z.record(z.string(), z.array(Snak)).optional(),
      sitelinks: z.record(z.string(), z.object({ title: z.string() })).optional(),
    }),
  ),
});
const ImageInfo = z.object({
  query: z.object({
    pages: z.record(
      z.string(),
      z.object({
        imageinfo: z
          .array(
            z.object({
              url: z.string(),
              width: z.number(),
              extmetadata: z
                .object({
                  Artist: z.object({ value: z.string() }).optional(),
                  LicenseShortName: z.object({ value: z.string() }).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    ),
  }),
});
const Summary = z.object({ originalimage: z.object({ source: z.string() }).optional() });

type Claims = Record<string, z.infer<typeof Snak>[]>;

function claimValues(claims: Claims | undefined, property: string): string[] {
  return (claims?.[property] ?? []).flatMap((s) => {
    const v = s.mainsnak.datavalue?.value;
    if (typeof v === "string") return [v];
    if (v && typeof v === "object" && "id" in v && typeof v.id === "string") return [v.id];
    return [];
  });
}

export function parseEntities(json: unknown): WikidataArtist[] {
  const parsed = Entities.safeParse(json);
  if (!parsed.success) return [];
  return Object.entries(parsed.data.entities).flatMap(([id, e]) => {
    if (!/^Q\d+$/u.test(id) || !e.labels) return [];
    const label = e.labels.en?.value;
    const aliases = (e.aliases?.en ?? []).map((a) => a.value);
    return [
      {
        id,
        names: [...(label ? [label] : []), ...aliases],
        instanceOf: claimValues(e.claims, "P31"),
        occupations: claimValues(e.claims, "P106"),
        genres: claimValues(e.claims, "P136"),
        image: claimValues(e.claims, "P18")[0] ?? null,
        spotifyIds: claimValues(e.claims, "P1902"),
        mbids: claimValues(e.claims, "P434"),
        enwikiTitle: e.sitelinks?.enwiki?.title ?? null,
      },
    ];
  });
}

export class WikimediaImageProvider implements ImageProvider {
  readonly id = "wikimedia";

  constructor(private readonly fetcher: JsonFetcher) {}

  supports(subject: ImageSubject): boolean {
    return subject.kind === "artist";
  }

  async find(subject: ImageSubject): Promise<ImageCandidate | null> {
    if (subject.kind !== "artist") return null;
    const ids = await this.candidateIds(subject);
    if (ids.length === 0) return null;
    const identity = identifyArtist(subject, await this.entities(ids));
    if (!identity) return null;
    const { entity } = identity;
    const file =
      entity.image ?? (entity.enwikiTitle ? await this.summaryFile(entity.enwikiTitle) : null);
    if (!file) return null;
    const photo = await this.commonsPhoto(file);
    if (!photo) return null;
    return {
      ...photo,
      source: "wikimedia",
      confidence: identity.confidence,
      evidence: [...identity.evidence, entity.image ? `P18 ${file}` : `enwiki summary ${file}`],
    };
  }

  private async json(url: URL): Promise<unknown> {
    return JSON.parse(
      await this.fetcher.getText(url.href, { accept: "application/json", policy: "api-etiquette" }),
    );
  }

  /** P1902 (our Spotify ID) first, then a label/alias search for the name and its variant. */
  private async candidateIds(
    subject: Extract<ImageSubject, { kind: "artist" }>,
  ): Promise<string[]> {
    const ids = new Set<string>();
    if (subject.spotifyId && /^[0-9A-Za-z]{22}$/u.test(subject.spotifyId)) {
      const url = new URL(WIKIDATA_API);
      url.search = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: `haswbstatement:P1902=${subject.spotifyId}`,
        format: "json",
      }).toString();
      const found = QuerySearch.safeParse(await this.json(url));
      if (found.success) found.data.query.search.forEach((r) => ids.add(r.title));
    }
    const variants = nameVariants(subject.name);
    // The raw name and the cleaned-up one; the added "DJ X" toggle only adds namesakes.
    const names = variants
      .filter((v) => v.kind === "raw" || (v.kind === "variant" && !/^dj /iu.test(v.name)))
      .map((v) => v.name)
      .slice(0, MAX_NAME_SEARCHES);
    // Wikidata search finds "Salim Sulaiman" but not "Salim & Sulaiman": search duos joined too.
    const parts = variants.filter((v) => v.kind === "collab_part").map((v) => v.name);
    if (parts.length > 1) names.push(parts.join(" "));
    for (const name of names) {
      const url = new URL(WIKIDATA_API);
      url.search = new URLSearchParams({
        action: "wbsearchentities",
        search: name,
        language: "en",
        type: "item",
        limit: String(SEARCH_LIMIT),
        format: "json",
      }).toString();
      const found = SearchEntities.safeParse(await this.json(url));
      if (found.success) found.data.search.forEach((r) => ids.add(r.id));
    }
    return [...ids].slice(0, 50);
  }

  private async entities(ids: readonly string[]): Promise<WikidataArtist[]> {
    const url = new URL(WIKIDATA_API);
    url.search = new URLSearchParams({
      action: "wbgetentities",
      ids: ids.join("|"),
      props: "labels|aliases|claims|sitelinks",
      languages: "en",
      sitefilter: "enwiki",
      format: "json",
    }).toString();
    return parseEntities(await this.json(url));
  }

  /** The lead image of the English Wikipedia article, when it is a Commons file. */
  private async summaryFile(title: string): Promise<string | null> {
    const url = new URL(ENWIKI_SUMMARY + encodeURIComponent(title.replace(/ /gu, "_")));
    const summary = Summary.safeParse(await this.json(url));
    const source = summary.success ? summary.data.originalimage?.source : undefined;
    return source ? commonsFileName(source) : null;
  }

  /** A 500 px thumbnail on upload.wikimedia.org with its credit, or null when not showable. */
  private async commonsPhoto(
    file: string,
  ): Promise<Pick<ImageCandidate, "url" | "credit" | "license"> | null> {
    const url = new URL(COMMONS_API);
    url.search = new URLSearchParams({
      action: "query",
      titles: `File:${file}`,
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiextmetadatafilter: "Artist|LicenseShortName",
      format: "json",
    }).toString();
    const parsed = ImageInfo.safeParse(await this.json(url));
    const info = parsed.success
      ? Object.values(parsed.data.query.pages)[0]?.imageinfo?.[0]
      : undefined;
    if (!info) return null;
    const thumb = commonsThumbUrl(info.url, info.width, 500);
    const license = info.extmetadata?.LicenseShortName?.value ?? null;
    if (!thumb || !license) return null;
    const author = info.extmetadata?.Artist?.value ?? null;
    return { url: thumb, license, credit: photoCredit(author, license, "Wikimedia Commons") };
  }
}

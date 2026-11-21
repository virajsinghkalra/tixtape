/**
 * RSS 2.0 items for the news-outlet adapters. Regex-based (feeds are small and regular);
 * every item is validated with Zod and a bad one is skipped, never the whole feed.
 */
import { z } from "zod";
import type { Article } from "@/domain/events/extract/article";
import { decodeEntities, htmlToText } from "@/domain/events/extract/html";
import { httpUrl } from "@/domain/events/http-url";
import { UpstreamError } from "@/lib/errors";

const ItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  link: httpUrl(),
  guid: z.string().trim().min(1).max(500),
  /** Full text (`content:encoded`), else the summary. HTML. */
  html: z.string(),
  publishedAt: z.date().optional(),
});
export type RssItem = z.infer<typeof ItemSchema>;

function tag(xml: string, name: string): string | undefined {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "u").exec(xml);
  if (!m) return undefined;
  const body = m[1] ?? "";
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/u.exec(body);
  return cdata ? cdata[1] : decodeEntities(body);
}

function parseDate(raw: string | undefined): Date | undefined {
  const t = raw === undefined ? NaN : Date.parse(raw.trim());
  return Number.isNaN(t) ? undefined : new Date(t);
}

/** Items of an RSS 2.0 feed. Throws `UpstreamError` when the body isn't a feed at all. */
export function parseRss(
  xml: string,
  upstream: string,
): { items: RssItem[]; skipped: { index: number; reason: string }[] } {
  if (!/<rss\b|<channel\b/u.test(xml)) {
    throw new UpstreamError(upstream, `${upstream} did not return an RSS feed.`);
  }
  const items: RssItem[] = [];
  const skipped: { index: number; reason: string }[] = [];
  [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gu)].forEach((m, index) => {
    const body = m[1] ?? "";
    const link = tag(body, "link")?.trim();
    const parsed = ItemSchema.safeParse({
      title: tag(body, "title") === undefined ? undefined : htmlToText(tag(body, "title")!),
      link,
      guid: tag(body, "guid")?.trim() || link,
      html: tag(body, "content:encoded") ?? tag(body, "description") ?? "",
      publishedAt: parseDate(tag(body, "pubDate")),
    });
    if (parsed.success) items.push(parsed.data);
    else skipped.push({ index, reason: parsed.error.issues[0]?.message ?? "invalid" });
  });
  return { items, skipped };
}

/** An RSS item as an article for the free extractor. The text is used, never stored. */
export function toArticle(
  item: RssItem,
  meta: Pick<Article, "source" | "trust" | "watchTerms">,
): Article {
  return {
    ...meta,
    externalId: item.guid,
    url: item.link,
    title: item.title,
    text: htmlToText(item.html),
    publishedAt: item.publishedAt,
  };
}

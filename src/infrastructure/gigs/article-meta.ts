/**
 * D-089: an article's publication time and byline, from Article/NewsArticle JSON-LD first,
 * then `<meta>` tags (`article:published_time`, `datePublished`, `author`). Raw strings: the
 * domain normalises them (`normalizePublished`, `detectWire`).
 */
import { decodeEntities } from "@/domain/events/extract/html";
import { jsonLdBlocks } from "@/domain/gigs/extract";

const ARTICLE_TYPE = /Article|NewsArticle|BlogPosting|Report/u;

function meta(html: string, name: string): string | null {
  for (const m of html.matchAll(/<meta\b[^>]*>/giu)) {
    const tag = m[0];
    const key = /(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/iu.exec(tag)?.[1];
    if (key?.toLowerCase() !== name.toLowerCase()) continue;
    const content = /content\s*=\s*["']([^"']*)["']/iu.exec(tag)?.[1];
    if (content) return content;
  }
  return null;
}

const authorNames = (author: unknown): string[] =>
  ([] as unknown[]).concat(author ?? []).flatMap((a) => {
    if (typeof a === "string") return [a];
    if (typeof a === "object" && a !== null) {
      const name = (a as { name?: unknown }).name;
      return typeof name === "string" ? [name] : [];
    }
    return [];
  });

export function articleMeta(html: string): { published: string | null; byline: string | null } {
  let published: string | null = null;
  let byline: string | null = null;
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const n = node as Record<string, unknown>;
    const types = ([] as unknown[]).concat(n["@type"]);
    if (types.some((t) => typeof t === "string" && ARTICLE_TYPE.test(t))) {
      if (!published && typeof n.datePublished === "string") published = n.datePublished;
      const names = authorNames(n.author);
      if (!byline && names.length > 0) byline = names.join(", ");
    }
    if ("@graph" in n) visit(n["@graph"]);
  };
  jsonLdBlocks(html).forEach(visit);
  published ??= meta(html, "article:published_time") ?? meta(html, "datePublished");
  byline ??= meta(html, "author");
  return {
    published: published ? decodeEntities(published).trim().slice(0, 60) : null,
    byline: byline ? decodeEntities(byline).trim().slice(0, 200) : null,
  };
}

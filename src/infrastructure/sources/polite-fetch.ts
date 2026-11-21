/**
 * The one way collector adapters reach the web (P1.11, D-024, D-034):
 * - only http/https URLs;
 * - an identifying User-Agent with no personal details;
 * - robots.txt honoured (cached for a day), including Crawl-delay across runs;
 * - at most one request per second per host;
 * - a 10-second timeout per request.
 * When a crawl-delay hasn't passed yet the request is refused (`CrawlDelayError`) instead of
 * sleeping for minutes: the next scheduled run picks it up.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Clock } from "@/application/ports/clock";
import { safeHttpUrl } from "@/domain/events/http-url";
import { UpstreamError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { isPublicAddress } from "./ip-guard";
import { parseRobots, type RobotsRules } from "./robots";

/**
 * Wikimedia's policy asks for a contact in the User-Agent (D-059). We use a dedicated app
 * mailbox from APP_CONTACT_EMAIL, never a personal address; without it we send no contact.
 */
const contact = process.env.APP_CONTACT_EMAIL?.trim();
export const USER_AGENT = contact
  ? `LineupMixes/0.1 (non-commercial; ${contact})`
  : "LineupMixes/0.1 (non-commercial)";
const ROBOTS_TOKEN = "lineupmixes";
const ROBOTS_TTL_MS = 86_400_000;
const MIN_INTERVAL_MS = 1000;
const TIMEOUT_MS = 10_000;
/** Longer waits than this end the source's run instead of sleeping. */
const MAX_WAIT_MS = 15_000;
const MAX_BYTES = 5_000_000;
const ROBOTS_MAX_BYTES = 500_000;

/** What the fetcher remembers between runs, per host. */
export interface HostLog {
  lastFetchAt(host: string): Promise<Date | null>;
  recordFetch(host: string, at: Date): Promise<void>;
  robots(host: string): Promise<{ text: string; fetchedAt: Date } | undefined>;
  saveRobots(host: string, value: { text: string; fetchedAt: Date }): Promise<void>;
}

export function createMemoryHostLog(): HostLog {
  const fetches = new Map<string, Date>();
  const robots = new Map<string, { text: string; fetchedAt: Date }>();
  return {
    lastFetchAt: async (host) => fetches.get(host) ?? null,
    recordFetch: async (host, at) => {
      fetches.set(host, at);
    },
    robots: async (host) => robots.get(host),
    saveRobots: async (host, value) => {
      robots.set(host, value);
    },
  };
}

export class CrawlDelayError extends UpstreamError {
  constructor(
    host: string,
    readonly readyAt: Date,
  ) {
    super(
      host,
      `${host} asks for a pause between requests; try again after ${readyAt.toISOString()}.`,
    );
  }
}

export class RobotsDisallowedError extends UpstreamError {
  constructor(host: string, path: string) {
    super(host, `${host} robots.txt does not allow ${path}.`);
  }
}

export class BlockedAddressError extends UpstreamError {
  constructor(host: string) {
    super(host, `${host} resolves to a private or reserved address; not fetched.`);
  }
}

/** All addresses a hostname resolves to. Injected so tests never touch real DNS. */
export type Resolve = (hostname: string) => Promise<string[]>;

export const systemResolve: Resolve = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((a) => a.address);

export type PoliteFetcherDeps = {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  clock: Clock;
  logger: Pick<Logger, "warn">;
  hostLog: HostLog;
  timeoutMs?: number;
  resolve?: Resolve;
};

export type GetOptions = {
  accept: string;
  /**
   * `api-etiquette`: a documented public API whose own usage policy governs automated access
   * (the MediaWiki API, whose /w/ path robots.txt keeps crawlers away from), so robots.txt
   * is not consulted. Pacing, User-Agent, timeouts and the SSRF guard still apply.
   */
  policy?: "robots" | "api-etiquette";
};

const MAX_REDIRECTS = 3;
/** Only documents we parse: HTML, XML/RSS/Atom and JSON (D-070). */
const ALLOWED_TYPES =
  /^(text\/html|application\/xhtml\+xml|text\/xml|application\/xml|application\/rss\+xml|application\/atom\+xml|application\/json|application\/[a-z0-9.+-]+\+(json|xml))\s*(;|$)/iu;

export class PoliteFetcher {
  /** Last request of any kind this run (robots.txt included), for the 1 req/s rule. */
  private readonly lastRequest = new Map<string, number>();
  private readonly rules = new Map<string, RobotsRules>();
  /** Hosts that answered 429 this run: no more requests to them until the next run. */
  private readonly backedOff = new Set<string>();

  constructor(private readonly deps: PoliteFetcherDeps) {}

  /**
   * The response body as text. Every hop (at most 3 redirects) is re-checked: http(s) only,
   * a public address after DNS, robots.txt and pacing. Throws `UpstreamError` (or a subclass).
   */
  async getText(rawUrl: string, opts: GetOptions): Promise<string> {
    const checked = safeHttpUrl(rawUrl);
    if (!checked) throw new UpstreamError("collector", "Only http and https URLs are fetched.");
    let url = new URL(checked);
    for (let hop = 0; ; hop++) {
      await this.prepare(url, opts);
      const res = await this.send(url, opts.accept);
      const location = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        if (hop >= MAX_REDIRECTS) {
          throw new UpstreamError(
            url.host,
            `${url.host} redirected more than ${MAX_REDIRECTS} times.`,
          );
        }
        const next = safeHttpUrl(new URL(location, url).href);
        if (!next) throw new UpstreamError(url.host, `${url.host} redirected to a non-http URL.`);
        url = new URL(next);
        continue;
      }
      return this.read(url, res);
    }
  }

  /** Per-hop checks before a request: back-off, robots.txt, crawl-delay, pacing, SSRF. */
  private async prepare(url: URL, opts: GetOptions): Promise<void> {
    const host = url.host;
    if (this.backedOff.has(host)) {
      throw new UpstreamError(host, `${host} asked us to slow down (HTTP 429); skipped this run.`);
    }
    await this.assertPublic(url);
    let crawlDelayMs = 0;
    if ((opts.policy ?? "robots") === "robots") {
      const rules = await this.robotsFor(url);
      if (!rules.allows(url.pathname + url.search)) {
        throw new RobotsDisallowedError(host, url.pathname);
      }
      crawlDelayMs = (rules.crawlDelaySeconds ?? 0) * 1000;
    }
    const last = await this.deps.hostLog.lastFetchAt(host);
    if (last !== null && crawlDelayMs > MIN_INTERVAL_MS) {
      const readyAt = last.getTime() + crawlDelayMs;
      const wait = readyAt - this.deps.clock.now().getTime();
      if (wait > MAX_WAIT_MS) throw new CrawlDelayError(host, new Date(readyAt));
      if (wait > 0) await this.deps.sleep(wait);
    }
    await this.pace(host);
    await this.deps.hostLog.recordFetch(host, this.deps.clock.now());
  }

  /** Every address the host resolves to must be public (no loopback, private, metadata…). */
  private async assertPublic(url: URL): Promise<void> {
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    let addresses: string[];
    if (isIP(hostname)) addresses = [hostname];
    else {
      try {
        addresses = await (this.deps.resolve ?? systemResolve)(hostname);
      } catch (e) {
        throw new UpstreamError(url.host, `${url.host} could not be resolved.`, { cause: e });
      }
    }
    if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
      throw new BlockedAddressError(url.host);
    }
  }

  private async send(url: URL, accept: string): Promise<Response> {
    try {
      return await this.deps.fetch(url, {
        headers: { "user-agent": USER_AGENT, accept },
        redirect: "manual",
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(url.host, `${url.host} could not be reached.`, { cause: e });
    }
  }

  /** Status and content-type checks, then the body read in chunks up to the byte cap. */
  private async read(url: URL, res: Response): Promise<string> {
    if (res.status === 429) this.backedOff.add(url.host);
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError(url.host, `${url.host} returned HTTP ${res.status}.`);
    }
    const type = res.headers.get("content-type") ?? "";
    if (!ALLOWED_TYPES.test(type)) {
      await res.body?.cancel();
      throw new UpstreamError(
        url.host,
        `${url.host} sent ${type || "no content type"}, not a document.`,
      );
    }
    return readCapped(res, url.host, MAX_BYTES);
  }

  private async pace(host: string): Promise<void> {
    const last = this.lastRequest.get(host);
    if (last !== undefined) {
      const wait = last + MIN_INTERVAL_MS - this.deps.clock.now().getTime();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.lastRequest.set(host, this.deps.clock.now().getTime());
  }

  private async request(url: URL, accept: string): Promise<string> {
    let res: Response;
    try {
      res = await this.deps.fetch(url, {
        headers: { "user-agent": USER_AGENT, accept },
        redirect: "follow",
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(url.host, `${url.host} could not be reached.`, { cause: e });
    }
    if (res.status === 429) this.backedOff.add(url.host);
    if (!res.ok) throw new UpstreamError(url.host, `${url.host} returned HTTP ${res.status}.`);
    if (safeHttpUrl(res.url || url.href) === undefined) {
      throw new UpstreamError(url.host, `${url.host} redirected to a non-http URL.`);
    }
    const text = await res.text();
    if (text.length > MAX_BYTES)
      throw new UpstreamError(url.host, `${url.host} sent too much data.`);
    return text;
  }

  private async robotsFor(url: URL): Promise<RobotsRules> {
    const host = url.host;
    const known = this.rules.get(host);
    if (known) return known;
    const now = this.deps.clock.now();
    let cached = await this.deps.hostLog.robots(host);
    if (!cached || now.getTime() - cached.fetchedAt.getTime() > ROBOTS_TTL_MS) {
      cached = { text: await this.fetchRobots(url), fetchedAt: now };
      await this.deps.hostLog.saveRobots(host, cached);
    }
    const rules = parseRobots(cached.text, ROBOTS_TOKEN);
    this.rules.set(host, rules);
    return rules;
  }

  /**
   * A missing robots.txt (4xx) allows everything; a server error or no answer means "not now".
   * A redirected robots.txt isn't followed: it's treated as missing.
   */
  private async fetchRobots(url: URL): Promise<string> {
    await this.pace(url.host);
    const robotsUrl = new URL("/robots.txt", url.origin);
    let res: Response;
    try {
      res = await this.deps.fetch(robotsUrl, {
        headers: { "user-agent": USER_AGENT, accept: "text/plain" },
        redirect: "manual",
        signal: AbortSignal.timeout(this.deps.timeoutMs ?? TIMEOUT_MS),
      });
    } catch (e) {
      throw new UpstreamError(url.host, `${url.host} robots.txt could not be reached.`, {
        cause: e,
      });
    }
    if (res.status >= 300 && res.status < 500) {
      await res.body?.cancel();
      return "";
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpstreamError(url.host, `${url.host} robots.txt returned ${res.status}.`);
    }
    return readCapped(res, url.host, ROBOTS_MAX_BYTES);
  }
}

/** Reads a body chunk by chunk and stops as soon as it exceeds `max` bytes. */
async function readCapped(res: Response, host: string, max: number): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      throw new UpstreamError(host, `${host} sent too much data.`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

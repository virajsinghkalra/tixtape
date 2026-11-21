/**
 * D-083: is a stored image link still served? Only a definite 404/410 counts as broken, so a
 * slow or rate-limited host never wipes a good picture. Redirects are not followed and every
 * host must resolve to public addresses (poster URLs come from third-party pages: SSRF guard).
 */
import { isIP } from "node:net";
import type { ImageLinkChecker } from "@/application/ports/images";
import { isPublicAddress } from "@/infrastructure/sources/ip-guard";
import { systemResolve, USER_AGENT, type Resolve } from "@/infrastructure/sources/polite-fetch";

const TIMEOUT_MS = 10_000;

export class HttpImageLinkChecker implements ImageLinkChecker {
  constructor(private readonly deps: { fetch: typeof fetch; resolve?: Resolve } = { fetch }) {}

  async isBroken(url: string): Promise<boolean> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return true;
    }
    if (parsed.protocol !== "https:") return true;
    if (!(await this.isPublic(parsed.hostname))) return false;
    try {
      const res = await this.deps.fetch(parsed, {
        method: "HEAD",
        headers: { "user-agent": USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      return res.status === 404 || res.status === 410;
    } catch {
      return false;
    }
  }

  private async isPublic(hostname: string): Promise<boolean> {
    const host = hostname.replace(/^\[|\]$/gu, "");
    if (isIP(host)) return isPublicAddress(host);
    try {
      const addresses = await (this.deps.resolve ?? systemResolve)(host);
      return addresses.length > 0 && addresses.every(isPublicAddress);
    } catch {
      return false;
    }
  }
}

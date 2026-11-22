import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, newNonce } from "./csp";

const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src "));

describe("contentSecurityPolicy", () => {
  it("with a nonce, trusts only nonce'd scripts and what they load", () => {
    const s = scriptSrc(contentSecurityPolicy({ nonce: "abc", dev: false }));
    expect(s).toContain("'nonce-abc' 'strict-dynamic'");
    expect(s).not.toContain("unsafe-eval");
  });
  it("without a nonce keeps the static policy", () =>
    expect(scriptSrc(contentSecurityPolicy({ dev: false }))).toBe(
      "script-src 'self' 'unsafe-inline'",
    ));
  it("allows eval and HMR sockets in dev only", () => {
    expect(contentSecurityPolicy({ dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ dev: true })).toContain("connect-src 'self' ws: wss:");
    expect(contentSecurityPolicy({ dev: false })).not.toMatch(/unsafe-eval|ws:/);
  });
  it("keeps framing, plugins and base URI locked down", () => {
    const csp = contentSecurityPolicy({ nonce: "x", dev: false });
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"]) {
      expect(csp).toContain(d);
    }
  });
});

describe("newNonce", () => {
  it("is 128 bits of base64 and differs every time", () => {
    const a = newNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(newNonce()).not.toBe(a);
  });
});

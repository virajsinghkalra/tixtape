/**
 * Security & Reliability review PoCs (pre-launch). Each `PoC:` test asserts the CURRENT
 * (weak) behaviour so the suite stays green; when the fix lands the PoC fails and should be
 * flipped into a regression test. `guard:` tests assert behaviour that is already correct.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowedDomain } from "@/domain/events/extract/allow-list";

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return routeFiles(p);
    return name === "route.ts" ? [p] : [];
  });
}

describe("guard: admin API", () => {
  it("every exported handler under src/app/api/admin calls requireAdmin first", () => {
    const files = routeFiles(join(process.cwd(), "src/app/api/admin"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      const handlers = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = route\(/gu)];
      expect(handlers.length, file).toBeGreaterThan(0);
      const bodies = src.split(/export const (?:GET|POST|PUT|PATCH|DELETE) = route\(/u).slice(1);
      for (const body of bodies) expect(body, file).toMatch(/^[^]*?await requireAdmin\(req\)/u);
    }
  });
});

// Removed by Lead: fixed in D-070 (see src/infrastructure/sources/security.test.ts, grounding.test.ts).

// Removed by Lead: fixed in D-070 (see src/infrastructure/sources/security.test.ts, grounding.test.ts).

describe("guard: allow-list host matching", () => {
  it("rejects look-alike hosts and non-http schemes", () => {
    expect(allowedDomain("https://evilsunburn.in/x")).toBeNull();
    expect(allowedDomain("https://sunburn.in.evil.com/x")).toBeNull();
    expect(allowedDomain("file:///etc/passwd")).toBeNull();
    expect(allowedDomain("https://www.instagram.com/sunburn.in")).toBeNull();
  });
});

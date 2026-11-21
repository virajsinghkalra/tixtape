import { describe, expect, it } from "vitest";
import { serverTimingHeader, spanStart, timed, withServerTiming } from "./server-timing";

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("server timing (D-086)", () => {
  it("is a no-op outside a timed request", () => {
    expect(() => spanStart("db")()).not.toThrow();
    expect(serverTimingHeader()).toBeNull();
    const res = withServerTiming(new Response("x"));
    expect(res.headers.get("Server-Timing")).toBeNull();
  });

  it("counts overlapping spans once as wall time, with a count and a total", async () => {
    const header = await timed(async () => {
      const a = spanStart("db");
      const b = spanStart("db");
      await tick(20);
      a();
      b();
      return serverTimingHeader();
    });
    const m = /^db;dur=([\d.]+);desc="2x", total;dur=([\d.]+)$/u.exec(header ?? "");
    expect(m).not.toBeNull();
    const [db, total] = [Number(m?.[1]), Number(m?.[2])];
    expect(db).toBeGreaterThanOrEqual(15);
    expect(db).toBeLessThan(40); // not 2 × 20
    expect(total).toBeGreaterThanOrEqual(db);
  });

  it("keeps concurrent requests apart", async () => {
    const run = (name: string) =>
      timed(async () => {
        const end = spanStart(name);
        await tick(5);
        end();
        return serverTimingHeader();
      });
    const [x, y] = await Promise.all([run("db"), run("db-connect")]);
    expect(x).toMatch(/^db;/u);
    expect(x).not.toContain("db-connect");
    expect(y).toMatch(/^db-connect;/u);
  });

  it("sets the header on a response, and leaves immutable headers alone", async () => {
    await timed(async () => {
      expect(withServerTiming(new Response("x")).headers.get("Server-Timing")).toMatch(
        /^total;dur=/u,
      );
      const redirect = Response.redirect("https://example.com/", 302);
      expect(withServerTiming(redirect).status).toBe(302);
    });
  });
});

describe("server timing: open spans (D-086)", () => {
  it("counts a span that is still open when the header is written", async () => {
    const header = await timed(async () => {
      spanStart("db-connect"); // never ended within the request
      await tick(10);
      return serverTimingHeader();
    });
    const dur = Number(/db-connect;dur=([\d.]+)/u.exec(header ?? "")?.[1]);
    expect(dur).toBeGreaterThanOrEqual(5);
  });
});

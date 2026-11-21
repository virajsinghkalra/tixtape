import { describe, expect, it } from "vitest";
import type { EventSummary } from "@/application/ports/events";
import type { EventId } from "@/domain/shared/ids";
import { localSections, weekendRange } from "./local-sections";

const ev = (id: string, iso: string): EventSummary => ({
  id: id as EventId,
  title: id,
  type: "concert",
  status: "announced",
  startsAt: new Date(iso),
  endsAt: null,
  genre: null,
  imageUrl: null,
  venue: null,
  artistCount: 1,
});

describe("weekendRange", () => {
  it("on a Wednesday, is the coming Friday to Sunday in IST", () => {
    const { from, to } = weekendRange(new Date("2026-11-25T10:00:00+05:30"));
    expect(from.toISOString()).toBe(new Date("2026-11-27T00:00:00+05:30").toISOString());
    expect(to.toISOString()).toBe(new Date("2026-11-29T23:59:59.999+05:30").toISOString());
  });

  it("on a Saturday, is the current weekend", () => {
    const { from } = weekendRange(new Date("2026-11-21T10:00:00+05:30"));
    expect(from.toISOString()).toBe(new Date("2026-11-20T00:00:00+05:30").toISOString());
  });
});

describe("localSections", () => {
  it("puts weekend events in This weekend and the rest in Up next, each once", () => {
    const sections = localSections(
      [ev("sat-gig", "2026-11-21T19:00:00+05:30"), ev("dec-fest", "2026-12-12T14:00:00+05:30")],
      new Date("2026-11-21T10:00:00+05:30"),
    );
    expect(sections.map((s) => [s.id, s.items?.map((i) => i.id)])).toEqual([
      ["this_weekend", ["sat-gig"]],
      ["up_next", ["dec-fest"]],
    ]);
  });

  it("is empty with nothing upcoming", () => {
    expect(localSections([], new Date())).toEqual([]);
  });
});

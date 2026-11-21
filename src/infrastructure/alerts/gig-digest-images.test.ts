import { describe, expect, it } from "vitest";
import { formatGigDigest } from "./gig-digest";

const empty = { published: [], heldOrRejected: [], reverified: [], newLeads: [] };
const since = new Date("2026-11-21T00:00:00Z");
const now = new Date("2026-11-22T00:00:00Z");

describe("gig digest: published without a picture (D-091)", () => {
  it("lists them, and they alone are reason enough to send", () => {
    const digest = formatGigDigest(
      { ...empty, needsImage: [{ title: "Bare Night", night: "2026-12-12" }] },
      since,
      now,
    );
    expect(digest?.subject).toContain("1 need a picture");
    expect(digest?.body).toContain(
      "PUBLISHED WITHOUT A PICTURE: add a poster or a headliner photo (1):",
    );
    expect(digest?.body).toContain("- Bare Night | 2026-12-12");
  });

  it("stays silent when nothing needs a picture", () => {
    expect(formatGigDigest({ ...empty, needsImage: [] }, since, now)).toBeNull();
  });
});

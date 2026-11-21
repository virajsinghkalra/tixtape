import { describe, expect, it } from "vitest";
import { formatGigDigest, type GigActivity } from "./gig-digest";

const since = new Date("2026-11-20T02:41:00Z");
const now = new Date("2026-11-21T02:41:00Z");
const empty: GigActivity = { published: [], heldOrRejected: [], reverified: [], newLeads: [] };

describe("formatGigDigest", () => {
  it("sends nothing when there's nothing to report", () => {
    expect(formatGigDigest(empty, since, now)).toBeNull();
  });

  it("lists published events with sources, held nights with reasons, changes and leads", () => {
    const digest = formatGigDigest(
      {
        published: [
          {
            title: "Ritviz Live",
            night: "2026-12-05",
            city: "Pune",
            sources: [{ url: "https://ritviz.com/tour", domain: "ritviz.com" }],
          },
        ],
        heldOrRejected: [
          {
            title: "Some Night",
            night: "2026-12-06",
            city: "Mumbai",
            sources: [],
            decision: "hold",
            reasons: ["sources: only one independent source", "city: disagree"],
          },
        ],
        reverified: [
          {
            title: "Ritviz Live",
            action: "updated",
            reasons: [],
            changes: { venue: { from: "Hall A", to: "Hall B" } },
          },
        ],
        newLeads: [
          {
            artist: "Ritviz",
            domain: "insider.in",
            url: "https://insider.in/x",
            reason: "denied_domain",
          },
        ],
      },
      since,
      now,
    );
    expect(digest).not.toBeNull();
    expect(digest!.key).toBe("gig-digest");
    expect(digest!.subject).toBe(
      "Daily gig digest: 1 published, 1 held/rejected, 1 re-verified, 1 leads",
    );
    expect(digest!.body).toContain("- Ritviz Live | 2026-12-05 | Pune");
    expect(digest!.body).toContain("ritviz.com <https://ritviz.com/tour>");
    expect(digest!.body).toContain("[hold] Some Night");
    expect(digest!.body).toContain("why: sources: only one independent source; city: disagree");
    expect(digest!.body).toContain("venue: Hall A -> Hall B");
    expect(digest!.body).toContain("Ritviz: insider.in (denied_domain)");
  });

  it("omits empty sections", () => {
    const digest = formatGigDigest(
      { ...empty, newLeads: [{ artist: "A", domain: "d.com", url: "https://d.com", reason: "x" }] },
      since,
      now,
    );
    expect(digest!.body).not.toContain("AUTO-PUBLISHED");
    expect(digest!.body).toContain("NEW LEADS");
  });
});

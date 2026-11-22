import { describe, expect, it } from "vitest";
import { SavedShowSchema } from "../device/device-lists";
import { toSavedShowInput } from "./save-show";

describe("toSavedShowInput", () => {
  it("serialises a Date and takes the venue city", () => {
    const out = toSavedShowInput({
      id: "e1",
      title: "Gig",
      startsAt: new Date("2026-12-01T13:30:00Z"),
      venue: { city: "Mumbai" },
    });
    expect(out).toEqual({
      id: "e1",
      title: "Gig",
      startsAt: "2026-12-01T13:30:00.000Z",
      city: "Mumbai",
    });
    expect(SavedShowSchema.safeParse({ ...out, savedAt: "x" }).success).toBe(true);
  });
  it("keeps an ISO string and nulls a missing venue", () => {
    expect(
      toSavedShowInput({ id: "e2", title: "T", startsAt: "2026-12-01T00:00:00Z", venue: null })
        .city,
    ).toBeNull();
  });
});

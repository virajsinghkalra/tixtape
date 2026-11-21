import { describe, expect, it } from "vitest";
import { BLOCK_TONES } from "./ui/tone";
import { eventTone, toneSequence } from "./event-color";

describe("eventTone", () => {
  it("is stable per event and always a block tone", () => {
    const id = "10df2960-f16e-4bf5-9a89-b731434d88b7";
    expect(eventTone(id)).toBe(eventTone(id));
    expect(BLOCK_TONES).toContain(eventTone(id));
  });
});

describe("toneSequence", () => {
  it("starts with the event's colour and never repeats back to back", () => {
    const seq = toneSequence("abc", 6);
    expect(seq[0]).toBe(eventTone("abc"));
    for (let i = 1; i < seq.length; i++) expect(seq[i]).not.toBe(seq[i - 1]);
  });
});

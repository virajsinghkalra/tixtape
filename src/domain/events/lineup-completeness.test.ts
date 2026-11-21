import { describe, expect, it } from "vitest";
import { lineupCompleteness } from "./lineup-completeness";

describe("lineupCompleteness (D-091)", () => {
  it.each<
    [string, Parameters<typeof lineupCompleteness>[0], "complete" | "incomplete", string | null]
  >([
    [
      "Lollapalooza with headliners only",
      { type: "festival", stored: 4 },
      "incomplete",
      "a festival with only 4 act(s) stored (fewer than 8)",
    ],
    [
      "a source lists more acts than stored",
      { type: "festival", stored: 12, announced: 45, source: "livenation" },
      "incomplete",
      "livenation lists 45 acts; 12 stored",
    ],
    [
      "a concert whose source lists an opener we don't have",
      { type: "concert", stored: 1, announced: 2, source: "ticketmaster" },
      "incomplete",
      "ticketmaster lists 2 acts; 1 stored",
    ],
    ["a full festival bill", { type: "festival", stored: 45, announced: 45 }, "complete", null],
    ["a festival with 8 acts and no count", { type: "festival", stored: 8 }, "complete", null],
    ["a one-act concert", { type: "concert", stored: 1 }, "complete", null],
    [
      "we store more than announced (extra sources)",
      { type: "festival", stored: 30, announced: 20 },
      "complete",
      null,
    ],
  ])("%s → %s", (_label, input, status, reason) => {
    expect(lineupCompleteness(input)).toMatchObject({ status, reason });
  });
});

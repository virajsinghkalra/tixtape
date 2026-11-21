import { describe, expect, it } from "vitest";
import { httpUrl, safeHttpUrl } from "./http-url";

describe("httpUrl", () => {
  it.each([
    ["https://www.ticketmaster.com/event/Z7r9", true],
    ["http://insider.in/lolla", true],
    ["javascript:alert(document.cookie)", false],
    ["JavaScript:alert(1)", false],
    ["data:text/html,<script>alert(1)</script>", false],
    ["ftp://example.com/a", false],
    ["//example.com/a", false],
    ["not a url", false],
    [`https://example.com/${"a".repeat(2000)}`, false],
  ])("%s → %s", (url, ok) => {
    expect(httpUrl().safeParse(url).success).toBe(ok);
    expect(safeHttpUrl(url)).toBe(ok ? url : undefined);
  });

  it("safeHttpUrl passes undefined through", () => {
    expect(safeHttpUrl(undefined)).toBeUndefined();
  });
});

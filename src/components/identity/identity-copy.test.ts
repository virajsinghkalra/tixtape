import { describe, expect, it } from "vitest";
import { CONSENT_TEXT } from "@/domain/analytics/identity";
import { hey, ID_COPY } from "./identity-copy";

const words = (s: string) => s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));

describe("identity copy (D-082, D-090)", () => {
  it.each(Object.entries(ID_COPY).filter(([k]) => k !== "nicknameTitle"))(
    "%s is at most 4 words: %s",
    (_k, text) => {
      expect(words(text).length).toBeGreaterThanOrEqual(1);
      expect(words(text).length).toBeLessThanOrEqual(4);
    },
  );

  it("keeps the owner's nickname question as given", () => {
    expect(ID_COPY.nicknameTitle).toBe("What should we call you? 👋");
  });

  it("never promises an email right away", () => {
    for (const text of [...Object.values(ID_COPY), CONSENT_TEXT]) {
      expect(text).not.toMatch(/\bsoon\b|today|instant|right away|check your|on its way/i);
    }
  });

  it("consent is explicit and mentions unsubscribing", () => {
    expect(CONSENT_TEXT).toBe("Email me about gigs. Unsubscribe anytime.");
  });

  it("greets with the nickname", () => {
    expect(hey("Vee")).toBe("Hey Vee 👋");
  });
});

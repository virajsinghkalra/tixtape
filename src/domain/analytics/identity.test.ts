import { describe, expect, it } from "vitest";
import { EmailSchema, NicknameSchema, normaliseEmail, PersonNameSchema } from "./identity";

describe("identity rules (D-090)", () => {
  it("normalises emails", () => {
    expect(normaliseEmail("  Viraj.K+gigs@GMail.com ")).toBe("viraj.k+gigs@gmail.com");
    expect(EmailSchema.parse(" A@Example.IN ")).toBe("a@example.in");
  });

  it.each(["", "nope", "a@", "@b.co", "a b@c.co", `${"x".repeat(250)}@b.co`])(
    "rejects email %s",
    (raw) => {
      expect(EmailSchema.safeParse(raw).success).toBe(false);
    },
  );

  it.each(["Viraj", "  ishaan  k ", "Ananya ✨", "श्रेया", "DJ_Vee-2"])(
    "accepts nickname %s",
    (n) => {
      expect(NicknameSchema.safeParse(n).success).toBe(true);
    },
  );

  it("trims and collapses spaces", () => {
    expect(NicknameSchema.parse("  ishaan   k ")).toBe("ishaan k");
  });

  it.each([
    "",
    "   ",
    "<b>hi</b>",
    "visit www.spam.example",
    "https://x",
    "a".repeat(31),
    "spam.com",
  ])("rejects nickname %s", (n) => {
    expect(NicknameSchema.safeParse(n).success).toBe(false);
  });

  it("allows longer full names", () => {
    expect(PersonNameSchema.safeParse("Viraj Singh Kalra").success).toBe(true);
    expect(PersonNameSchema.safeParse("a".repeat(61)).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { err, ok } from "./result";

describe("Result", () => {
  it("wraps values and errors with a discriminant", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("nope")).toEqual({ ok: false, error: "nope" });
  });
});

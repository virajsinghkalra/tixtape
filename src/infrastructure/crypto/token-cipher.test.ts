import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TokenCipher, TokenDecryptError } from "./token-cipher";

const key1 = randomBytes(32).toString("base64");
const key2 = randomBytes(32).toString("base64");
const cipher = new TokenCipher({ 1: key1 }, 1);

describe("TokenCipher", () => {
  it("round-trips and records the key version", () => {
    const enc = cipher.encrypt("BQD-secret-token", "user-1:access");
    expect(enc.keyVersion).toBe(1);
    expect(enc.ciphertext.toString("utf8")).not.toContain("BQD-secret-token");
    expect(cipher.decrypt(enc, "user-1:access")).toBe("BQD-secret-token");
  });

  it("uses a random IV, so equal plaintexts encrypt differently", () => {
    const a = cipher.encrypt("same", "aad");
    const b = cipher.encrypt("same", "aad");
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it.each([
    ["iv", 0],
    ["auth tag", 12],
    ["ciphertext", 28],
  ])("fails when the %s is tampered with", (_part, offset) => {
    const enc = cipher.encrypt("token", "aad");
    const tampered = Buffer.from(enc.ciphertext);
    tampered[offset] = (tampered[offset] ?? 0) ^ 0xff;
    expect(() => cipher.decrypt({ ...enc, ciphertext: tampered }, "aad")).toThrow(
      TokenDecryptError,
    );
  });

  it("fails with different associated data (ciphertext moved to another user)", () => {
    const enc = cipher.encrypt("token", "user-1:access");
    expect(() => cipher.decrypt(enc, "user-2:access")).toThrow(TokenDecryptError);
  });

  it("fails on truncated input or an unknown key version", () => {
    const enc = cipher.encrypt("token", "aad");
    expect(() =>
      cipher.decrypt({ ...enc, ciphertext: enc.ciphertext.subarray(0, 20) }, "aad"),
    ).toThrow(TokenDecryptError);
    expect(() => cipher.decrypt({ ...enc, keyVersion: 9 }, "aad")).toThrow(TokenDecryptError);
  });

  it("decrypts old tokens after a key rotation and encrypts with the new key", () => {
    const old = cipher.encrypt("token", "aad");
    const rotated = new TokenCipher({ 1: key1, 2: key2 }, 2);
    expect(rotated.decrypt(old, "aad")).toBe("token");
    expect(rotated.encrypt("token", "aad").keyVersion).toBe(2);
  });

  it("rejects keys that aren't 32 bytes, or a missing current key", () => {
    expect(() => new TokenCipher({ 1: randomBytes(16).toString("base64") }, 1)).toThrow();
    expect(() => new TokenCipher({ 1: key1 }, 2)).toThrow();
  });
});

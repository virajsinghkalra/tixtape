import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TokenCipher,
  TokenDecryptError,
  type EncryptedToken,
} from "@/infrastructure/crypto/token-cipher";

const k1 = randomBytes(32).toString("base64");
const k2 = randomBytes(32).toString("base64");
const AAD = "spotify_tokens:00000000-0000-4000-8000-000000000001:access_token";
const SECRET = "BQD-qa-access-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function flip(t: EncryptedToken, i: number): EncryptedToken {
  const c = Buffer.from(t.ciphertext);
  const idx = ((i % c.length) + c.length) % c.length;
  c[idx] = c[idx]! ^ 0x01;
  return { ciphertext: c, keyVersion: t.keyVersion };
}

describe("QA TokenCipher (LLD §12, D-021)", () => {
  const cipher = new TokenCipher({ 1: k1 }, 1);

  it.each(["", "a", SECRET, "üñîçødé 🎵 टोकन", "x".repeat(10_000)])("round-trips %#", (p) => {
    expect(cipher.decrypt(cipher.encrypt(p, AAD), AAD)).toBe(p);
  });

  it("ciphertext does not contain the plaintext and uses a fresh IV each time", () => {
    const a = cipher.encrypt(SECRET, AAD);
    const b = cipher.encrypt(SECRET, AAD);
    expect(a.ciphertext.includes(Buffer.from(SECRET))).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.keyVersion).toBe(1);
  });

  it("every single-bit flip anywhere (IV, body, tag) fails with TokenDecryptError", () => {
    const t = cipher.encrypt(SECRET, AAD);
    for (let i = 0; i < t.ciphertext.length; i++) {
      expect(() => cipher.decrypt(flip(t, i), AAD)).toThrow(TokenDecryptError);
    }
  });

  it.each([0, 1, 5, 12, 16, 27, 28])(
    "truncated to %i bytes fails with TokenDecryptError (not RangeError)",
    (n) => {
      const t = cipher.encrypt(SECRET, AAD);
      expect(() =>
        cipher.decrypt({ ciphertext: t.ciphertext.subarray(0, n), keyVersion: 1 }, AAD),
      ).toThrow(TokenDecryptError);
    },
  );

  it("appended bytes fail", () => {
    const t = cipher.encrypt(SECRET, AAD);
    expect(() =>
      cipher.decrypt(
        { ciphertext: Buffer.concat([t.ciphertext, Buffer.from([0])]), keyVersion: 1 },
        AAD,
      ),
    ).toThrow(TokenDecryptError);
  });

  it("AAD binds to user: moved to another user fails", () => {
    const t = cipher.encrypt(SECRET, AAD);
    expect(() =>
      cipher.decrypt(t, "spotify_tokens:00000000-0000-4000-8000-000000000002:access_token"),
    ).toThrow(TokenDecryptError);
  });

  it("AAD binds to column: access ↔ refresh swap fails", () => {
    const t = cipher.encrypt(SECRET, AAD);
    expect(() => cipher.decrypt(t, AAD.replace("access_token", "refresh_token"))).toThrow(
      TokenDecryptError,
    );
  });

  it("empty AAD does not decrypt a token bound to a row", () => {
    const t = cipher.encrypt(SECRET, AAD);
    expect(() => cipher.decrypt(t, "")).toThrow(TokenDecryptError);
  });

  it("unknown key version fails with TokenDecryptError", () => {
    const t = cipher.encrypt(SECRET, AAD);
    expect(() => cipher.decrypt({ ...t, keyVersion: 2 }, AAD)).toThrow(TokenDecryptError);
    expect(() => cipher.decrypt({ ...t, keyVersion: 0 }, AAD)).toThrow(TokenDecryptError);
    expect(() => cipher.decrypt({ ...t, keyVersion: Number.NaN }, AAD)).toThrow(TokenDecryptError);
  });

  it("a wrong key under the right version fails", () => {
    const t = cipher.encrypt(SECRET, AAD);
    const other = new TokenCipher({ 1: k2 }, 1);
    expect(() => other.decrypt(t, AAD)).toThrow(TokenDecryptError);
  });

  it("rotation: new key encrypts with v2, old v1 tokens still decrypt", () => {
    const old = cipher.encrypt(SECRET, AAD);
    const rotated = new TokenCipher({ 1: k1, 2: k2 }, 2);
    expect(rotated.decrypt(old, AAD)).toBe(SECRET);
    const fresh = rotated.encrypt(SECRET, AAD);
    expect(fresh.keyVersion).toBe(2);
    expect(() => cipher.decrypt(fresh, AAD)).toThrow(TokenDecryptError);
  });

  it("decrypt errors never contain the key or plaintext", () => {
    const t = cipher.encrypt(SECRET, AAD);
    try {
      cipher.decrypt(flip(t, -1), AAD);
    } catch (e) {
      const s = `${(e as Error).message} ${(e as Error).stack ?? ""} ${JSON.stringify(e)}`;
      expect(s).not.toContain(SECRET);
      expect(s).not.toContain(k1);
    }
  });

  it.each([
    ["31-byte key", { 1: randomBytes(31).toString("base64") }, 1],
    ["33-byte key", { 1: randomBytes(33).toString("base64") }, 1],
    ["empty key", { 1: "" }, 1],
    ["current version missing", { 1: k1 }, 2],
  ])("rejects bad config at construction: %s", (_n, keys, v) => {
    expect(() => new TokenCipher(keys, v)).toThrow();
  });
});

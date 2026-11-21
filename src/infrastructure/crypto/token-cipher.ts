/**
 * AES-256-GCM for Spotify tokens at rest (ENGINEERING.md §7, LLD §12).
 * Layout: iv (12 bytes) | auth tag (16 bytes) | ciphertext. The key version is stored next to
 * the ciphertext (`spotify_tokens.key_version`) so keys can rotate.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError } from "@/lib/errors";

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type EncryptedToken = { ciphertext: Buffer; keyVersion: number };

export class TokenDecryptError extends AppError {
  readonly code = "token_decrypt_failed";
}

export class TokenCipher {
  private readonly keys: ReadonlyMap<number, Buffer>;

  /**
   * @param keysBase64 every key that may still decrypt stored tokens, by version (base64, 32 bytes).
   * @param currentVersion the version used for new encryptions.
   */
  constructor(
    keysBase64: Readonly<Record<number, string>>,
    private readonly currentVersion: number,
  ) {
    const keys = new Map<number, Buffer>();
    for (const [version, b64] of Object.entries(keysBase64)) {
      const key = Buffer.from(b64, "base64");
      if (key.length !== KEY_BYTES) {
        throw new Error(`Token encryption key v${version} must be ${KEY_BYTES} bytes (base64).`);
      }
      keys.set(Number(version), key);
    }
    if (!keys.has(currentVersion)) {
      throw new Error(`No token encryption key for current version ${currentVersion}.`);
    }
    this.keys = keys;
  }

  /** `aad` binds the ciphertext to its context (e.g. user + field), so rows can't be swapped. */
  encrypt(plaintext: string, aad: string): EncryptedToken {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.key(this.currentVersion), iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      ciphertext: Buffer.concat([iv, cipher.getAuthTag(), body]),
      keyVersion: this.currentVersion,
    };
  }

  decrypt(token: EncryptedToken, aad: string): string {
    const { ciphertext } = token;
    if (ciphertext.length < IV_BYTES + TAG_BYTES) {
      throw new TokenDecryptError("Stored token is malformed.");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key(token.keyVersion),
        ciphertext.subarray(0, IV_BYTES),
      );
      decipher.setAAD(Buffer.from(aad, "utf8"));
      decipher.setAuthTag(ciphertext.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
      const body = ciphertext.subarray(IV_BYTES + TAG_BYTES);
      return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    } catch (e) {
      if (e instanceof TokenDecryptError) throw e;
      throw new TokenDecryptError("Stored token failed authentication.", { cause: e });
    }
  }

  private key(version: number): Buffer {
    const key = this.keys.get(version);
    if (!key) throw new TokenDecryptError(`No token encryption key for version ${version}.`);
    return key;
  }
}

import { createHash, randomBytes } from "node:crypto";

/** 256 random bits, URL-safe (43 chars). Sent to the browser once; only its hash is stored. */
export function newSessionId(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionId(sessionId: string): string {
  return createHash("sha256").update(sessionId, "utf8").digest("hex");
}

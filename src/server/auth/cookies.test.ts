import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";
import {
  clearOauthCookies,
  clearSessionCookie,
  oauthCookies,
  readCookie,
  serializeCookie,
  sessionCookie,
  shouldUseSecureCookies,
} from "./cookies";

const withCookie = (cookie: string) => new Request("http://127.0.0.1/", { headers: { cookie } });

describe("cookies", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "postgres://unused");
    vi.stubEnv("APP_URL", "https://concerts.example");
    vi.stubEnv("NODE_ENV", "production");
    resetEnvForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvForTests();
  });

  it("serializes httpOnly, SameSite=Lax cookies, Secure when asked", () => {
    expect(serializeCookie("a", "x y", { maxAgeSeconds: 60, path: "/", secure: true })).toBe(
      "a=x%20y; Path=/; Max-Age=60; HttpOnly; SameSite=Lax; Secure",
    );
    expect(serializeCookie("a", "", { maxAgeSeconds: -5, path: "/", secure: false })).toBe(
      "a=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax",
    );
  });

  it("reads a named cookie and ignores look-alikes and bad encodings", () => {
    expect(readCookie(withCookie("xsession=1; session=abc%20d; other=2"), "session")).toBe("abc d");
    expect(readCookie(withCookie("other=2"), "session")).toBeNull();
    expect(readCookie(new Request("http://127.0.0.1/"), "session")).toBeNull();
    expect(readCookie(withCookie("session=%E0%A4%A"), "session")).toBeNull();
  });

  it.each([
    ["http://127.0.0.1:3000", "development", false],
    ["http://127.0.0.1:3000", "production", true],
    ["http://localhost:3000", "development", true],
    ["https://concerts.example", "production", true],
  ])("Secure for %s in %s: %s", (url, nodeEnv, expected) => {
    expect(shouldUseSecureCookies(url, nodeEnv)).toBe(expected);
  });

  it("sets a session cookie that lives until the session expires", () => {
    const now = new Date(0);
    const cookie = sessionCookie("sid", new Date(30 * 24 * 3600 * 1000), now);
    expect(cookie).toBe("session=sid; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Secure");
    expect(clearSessionCookie()).toContain("session=; Path=/; Max-Age=0");
  });

  it("scopes the OAuth cookies to the Spotify auth path for 10 minutes", () => {
    expect(oauthCookies("st", "ver")).toEqual([
      "spotify_oauth_state=st; Path=/api/auth/spotify; Max-Age=600; HttpOnly; SameSite=Lax; Secure",
      "spotify_oauth_verifier=ver; Path=/api/auth/spotify; Max-Age=600; HttpOnly; SameSite=Lax; Secure",
    ]);
    expect(clearOauthCookies().every((c) => c.includes("Max-Age=0"))).toBe(true);
  });
});

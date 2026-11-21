import { describe, expect, it, vi } from "vitest";
import { asUserId, type UserId } from "@/domain/shared/ids";
import { UnauthorizedError } from "@/lib/errors";
import type { AuthUser, SessionRepository, SpotifyTokenRepository, UserRepository } from "./ports";
import { SESSION_IDLE_TTL_MS, SESSION_TTL_MS, SpotifyAuthService } from "./spotify-auth-service";

const DAY = 24 * 3600 * 1000;

const NOW = Date.UTC(2026, 10, 21);
const tokenSet = {
  accessToken: "at",
  refreshToken: "rt",
  scope: "playlist-modify-private",
  expiresAt: new Date(NOW + 3_600_000),
};

function setup(admins: string[] = ["admin-spotify"]) {
  const usersById = new Map<UserId, AuthUser>();
  const users: UserRepository = {
    upsertBySpotifyId: vi.fn(async (input) => {
      const user: AuthUser = { id: asUserId(`id-${input.spotifyUserId}`), market: "IN", ...input };
      usersById.set(user.id, user);
      return user;
    }),
    findById: vi.fn(async (id) => usersById.get(id) ?? null),
    delete: vi.fn(async (id) => void usersById.delete(id)),
  };
  const sessionRows = new Map<string, { userId: UserId; expiresAt: Date; createdAt: Date }>();
  const find = async (id: string, now: Date) => {
    const row = sessionRows.get(id);
    return row && row.expiresAt > now ? row : null;
  };
  const sessions: SessionRepository = {
    create: vi.fn(async (id, userId, expiresAt, createdAt = new Date(0)) => {
      sessionRows.set(id, { userId, expiresAt, createdAt });
    }),
    findUserId: vi.fn(async (id, now) => (await find(id, now))?.userId ?? null),
    find: vi.fn(find),
    extend: vi.fn(async (id, expiresAt) => {
      const row = sessionRows.get(id);
      if (row) sessionRows.set(id, { ...row, expiresAt });
    }),
    delete: vi.fn(async (id) => void sessionRows.delete(id)),
    deleteExpired: vi.fn(async (now) => {
      const expired = [...sessionRows].filter(([, r]) => r.expiresAt <= now);
      for (const [id] of expired) sessionRows.delete(id);
      return expired.length;
    }),
  };
  const tokens = { save: vi.fn(async () => {}) } as unknown as SpotifyTokenRepository;
  const oauth = {
    beginAuthorization: vi.fn(() => ({
      url: new URL("https://accounts.spotify.com/authorize"),
      state: "s",
      codeVerifier: "v",
    })),
    exchangeCode: vi.fn(async () => tokenSet),
    refresh: vi.fn(),
  };
  const profiles = {
    getCurrentUser: vi.fn(async () => ({ spotifyUserId: "admin-spotify", displayName: "Ada" })),
  };
  const clock = {
    ms: NOW,
    now() {
      return new Date(this.ms);
    },
  };
  const service = new SpotifyAuthService({
    oauth,
    profiles,
    users,
    sessions,
    tokens,
    clock,
    newSessionId: () => "session-123",
    adminSpotifyUserIds: admins,
  });
  return { service, oauth, profiles, users, sessions, tokens, clock, usersById };
}

const login = { code: "code", state: "s", expectedState: "s", codeVerifier: "v" };

describe("SpotifyAuthService", () => {
  it("starts login with the OAuth provider", () => {
    const { service } = setup();
    expect(service.startLogin()).toMatchObject({ state: "s", codeVerifier: "v" });
  });

  it.each([
    { expectedState: null },
    { codeVerifier: null },
    { state: "other" },
    { state: "", expectedState: "" },
  ])("rejects a callback with %j before exchanging the code", async (override) => {
    const { service, oauth } = setup();
    await expect(service.completeLogin({ ...login, ...override })).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
    expect(oauth.exchangeCode).not.toHaveBeenCalled();
  });

  it("completes login: upserts the user, stores tokens, opens a session", async () => {
    const { service, oauth, users, tokens, sessions } = setup();
    const result = await service.completeLogin(login);
    expect(oauth.exchangeCode).toHaveBeenCalledWith("code", "v");
    expect(users.upsertBySpotifyId).toHaveBeenCalledWith({
      spotifyUserId: "admin-spotify",
      displayName: "Ada",
      role: "admin",
    });
    expect(tokens.save).toHaveBeenCalledWith("id-admin-spotify", tokenSet);
    // Server-side expiry is the 14-day idle deadline; the cookie lives for the 30-day maximum.
    expect(sessions.create).toHaveBeenCalledWith(
      "session-123",
      "id-admin-spotify",
      new Date(NOW + SESSION_IDLE_TTL_MS),
      new Date(NOW),
    );
    expect(result).toMatchObject({
      sessionId: "session-123",
      expiresAt: new Date(NOW + SESSION_TTL_MS),
    });
    expect(SESSION_TTL_MS).toBe(30 * DAY);
    expect(SESSION_IDLE_TTL_MS).toBe(14 * DAY);
  });

  it("gives the user role to anyone not in ADMIN_SPOTIFY_USER_IDS", async () => {
    const { service, users } = setup([" ", "someone"]);
    await service.completeLogin(login);
    expect(users.upsertBySpotifyId).toHaveBeenCalledWith(expect.objectContaining({ role: "user" }));
  });

  it("ends a session after 14 idle days", async () => {
    const { service, clock } = setup();
    await service.completeLogin(login);
    await expect(service.getSessionUser("session-123")).resolves.toMatchObject({
      spotifyUserId: "admin-spotify",
      role: "admin",
    });
    clock.ms = NOW + SESSION_IDLE_TTL_MS;
    await expect(service.getSessionUser("session-123")).resolves.toBeNull();
  });

  it("slides the idle expiry on use, at most once a day", async () => {
    const { service, clock, sessions } = setup();
    await service.completeLogin(login);
    clock.ms = NOW + DAY - 1;
    await service.getSessionUser("session-123");
    expect(sessions.extend).not.toHaveBeenCalled();
    clock.ms = NOW + DAY;
    await service.getSessionUser("session-123");
    expect(sessions.extend).toHaveBeenCalledWith(
      "session-123",
      new Date(NOW + DAY + SESSION_IDLE_TTL_MS),
    );
    await service.getSessionUser("session-123");
    expect(sessions.extend).toHaveBeenCalledTimes(1);
  });

  it("never extends past the 30-day absolute lifetime, even with daily use", async () => {
    const { service, clock } = setup();
    await service.completeLogin(login);
    for (let day = 1; day < 30; day++) {
      clock.ms = NOW + day * DAY;
      await expect(service.getSessionUser("session-123")).resolves.not.toBeNull();
    }
    clock.ms = NOW + SESSION_TTL_MS;
    await expect(service.getSessionUser("session-123")).resolves.toBeNull();
  });

  it("deletes the account, which ends its sessions", async () => {
    const { service, users } = setup();
    await service.completeLogin(login);
    await service.deleteAccount(asUserId("id-admin-spotify"));
    expect(users.delete).toHaveBeenCalledWith("id-admin-spotify");
    await expect(service.getSessionUser("session-123")).resolves.toBeNull();
  });

  it("deletes expired sessions for the sweep", async () => {
    const { service, clock } = setup();
    await service.completeLogin(login);
    await expect(service.deleteExpiredSessions()).resolves.toBe(0);
    clock.ms = NOW + SESSION_IDLE_TTL_MS;
    await expect(service.deleteExpiredSessions()).resolves.toBe(1);
  });

  it("derives the role from the current admin list, not the stored row", async () => {
    const { service, usersById } = setup([]);
    await service.completeLogin(login);
    const stored = usersById.get(asUserId("id-admin-spotify"))!;
    usersById.set(stored.id, { ...stored, role: "admin" });
    await expect(service.getSessionUser("session-123")).resolves.toMatchObject({ role: "user" });
  });

  it("returns null for unknown, empty or oversized session ids", async () => {
    const { service, sessions } = setup();
    await expect(service.getSessionUser("nope")).resolves.toBeNull();
    await expect(service.getSessionUser("")).resolves.toBeNull();
    await expect(service.getSessionUser("x".repeat(129))).resolves.toBeNull();
    expect(sessions.find).toHaveBeenCalledTimes(1);
  });

  it("logs out by deleting the session", async () => {
    const { service } = setup();
    await service.completeLogin(login);
    await service.logout("session-123");
    await expect(service.getSessionUser("session-123")).resolves.toBeNull();
  });
});

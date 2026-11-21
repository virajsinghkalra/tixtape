import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvForTests } from "@/lib/env";

const rememberNickname = vi.fn();
const rememberContact = vi.fn();
const forgetDevice = vi.fn();
vi.mock("@/server/analytics", () => ({
  rememberNickname: (...a: unknown[]) => rememberNickname(...a),
  rememberContact: (...a: unknown[]) => rememberContact(...a),
  forgetDevice: (...a: unknown[]) => forgetDevice(...a),
}));
const { POST } = await import("./route");
const { DELETE } = await import("../data/route");

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgres://unused");
  resetEnvForTests();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvForTests();
});
beforeEach(() => {
  rememberNickname.mockReset();
  rememberContact.mockReset();
  forgetDevice.mockReset();
});

const DID = "0b0f6a52-8d1e-4a1f-9a77-1d1b7d7e2c11";
const call = (handler: typeof POST, method: string, body: unknown) =>
  handler(
    new Request("https://tixtape.example/api/me/x", { method, body: JSON.stringify(body) }),
    {},
  );

describe("POST /api/me/identity (D-090)", () => {
  it("saves a nickname, trimmed, and echoes nothing", async () => {
    const res = await call(POST, "POST", { did: DID, nickname: "  Vee  " });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(rememberNickname).toHaveBeenCalledWith(expect.any(Request), DID, "Vee");
  });

  it("saves a normalised email only with consent ticked", async () => {
    const res = await call(POST, "POST", {
      did: DID,
      name: "Viraj",
      email: " Viraj@Example.com ",
      consent: true,
      source: "ping_me",
    });
    expect(res.status).toBe(204);
    expect(rememberContact).toHaveBeenCalledWith(expect.any(Request), DID, {
      email: "viraj@example.com",
      personName: "Viraj",
      source: "ping_me",
    });
  });

  it.each([
    ["consent unticked", { did: DID, email: "a@b.co", consent: false, source: "remind" }],
    ["consent missing", { did: DID, email: "a@b.co", source: "remind" }],
    ["bad email", { did: DID, email: "nope", consent: true, source: "remind" }],
    ["unknown source", { did: DID, email: "a@b.co", consent: true, source: "popup" }],
    ["extra key", { did: DID, nickname: "Vee", admin: true }],
    ["link nickname", { did: DID, nickname: "www.spam.example" }],
    ["bad device id", { did: "x", nickname: "Vee" }],
  ])("rejects %s", async (_label, body) => {
    expect((await call(POST, "POST", body)).status).toBe(400);
    expect(rememberNickname).not.toHaveBeenCalled();
    expect(rememberContact).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/data (D-090)", () => {
  it("deletes by device ID and answers 204", async () => {
    expect((await call(DELETE, "DELETE", { did: DID })).status).toBe(204);
    expect(forgetDevice).toHaveBeenCalledWith(expect.any(Request), DID);
  });

  it("rejects anything but a device ID", async () => {
    expect((await call(DELETE, "DELETE", { did: DID, all: true })).status).toBe(400);
    expect((await call(DELETE, "DELETE", { email: "a@b.co" })).status).toBe(400);
    expect(forgetDevice).not.toHaveBeenCalled();
  });
});

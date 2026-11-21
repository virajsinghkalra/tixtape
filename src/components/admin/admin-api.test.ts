import { afterEach, describe, expect, it, vi } from "vitest";
import { adminRequest, failureMessage } from "./admin-api";

describe("failureMessage", () => {
  it("lists validation issues with their fields", () => {
    const body = {
      error: {
        code: "validation_failed",
        message: "Request is invalid.",
        issues: [
          { path: "venue.country", message: "Use a two-letter country code, e.g. IN." },
          { path: "", message: "Billing ranks must be unique." },
        ],
      },
    };
    expect(failureMessage(400, body)).toBe(
      "Check the form. venue.country: Use a two-letter country code, e.g. IN.; Billing ranks must be unique..",
    );
  });

  it("uses the server's message for other client errors", () => {
    expect(failureMessage(409, { error: { message: "That job already finished." } })).toBe(
      "That job already finished.",
    );
  });

  it("never echoes raw or server-side details", () => {
    expect(failureMessage(500, { error: { message: "relation x does not exist" } })).toBe(
      "Something went wrong on our side. Try again in a moment.",
    );
    expect(failureMessage(404, "<html>")).toBe("That item no longer exists. Refresh the page.");
    expect(failureMessage(400, null)).toBe("Check the form and try again.");
    expect(failureMessage(401, { error: { message: "Sign in with Spotify to continue." } })).toBe(
      "Your sign-in has expired. Sign in with Spotify again, then retry.",
    );
  });
});

describe("adminRequest", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("returns the parsed body on success", async () => {
    const fetchMock = vi.fn(async () => Response.json({ jobId: "j" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(adminRequest("/api/x", "POST", {})).resolves.toEqual({
      ok: true,
      data: { jobId: "j" },
    });
    expect(fetchMock).toHaveBeenCalledWith("/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  });

  it("turns network failures and non-JSON errors into sentences", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    await expect(adminRequest("/api/x", "PATCH", {})).resolves.toEqual({
      ok: false,
      message: "Couldn't reach the server. Check your connection and retry.",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Bad gateway", { status: 502 })),
    );
    await expect(adminRequest("/api/x", "PATCH", {})).resolves.toEqual({
      ok: false,
      message: "Something went wrong on our side. Try again in a moment.",
    });
  });
});

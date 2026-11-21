import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminConsole } from "@/application/admin";
import { ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from "@/lib/errors";

const guard = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const wired = vi.hoisted(() => ({ cancelJob: vi.fn() }));
vi.mock("@/server/auth/guards", () => guard);
vi.mock("@/server/admin-console", () => ({
  adminConsole: () => ({ cancelJob: wired.cancelJob }) as Partial<AdminConsole>,
}));

const { POST } = await import("./route");

const JOB_ID = "6f1c2c1e-6a0e-4d1b-9a43-1c7a7c4c1d10";
const ctx = (id = JOB_ID) => ({ params: Promise.resolve({ id }) });
const post = (body: string | undefined) =>
  new Request(`http://127.0.0.1/api/admin/playlist-jobs/${JOB_ID}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

beforeEach(() => {
  guard.requireAdmin.mockReset().mockResolvedValue({ id: "admin", role: "admin" });
  wired.cancelJob.mockReset().mockImplementation(async (jobId: string) => ({
    jobId,
    status: "failed",
    error: "This playlist build was stopped by the team. Try again in a few minutes.",
  }));
});

describe("POST /api/admin/playlist-jobs/:id/cancel", () => {
  it("cancels with an empty object or a reason", async () => {
    const res = await POST(post("{}"), ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      jobId: JOB_ID,
      status: "failed",
      error: "This playlist build was stopped by the team. Try again in a few minutes.",
    });
    expect(wired.cancelJob).toHaveBeenCalledWith(JOB_ID, {});

    await POST(post(JSON.stringify({ reason: "  Lineup changed.  " })), ctx());
    expect(wired.cancelJob).toHaveBeenLastCalledWith(JOB_ID, { reason: "Lineup changed." });
  });

  it("requires an admin before reading anything", async () => {
    guard.requireAdmin.mockRejectedValueOnce(new UnauthorizedError("Sign in."));
    expect((await POST(post("{}"), ctx())).status).toBe(401);
    guard.requireAdmin.mockRejectedValueOnce(new ForbiddenError("Admins only."));
    expect((await POST(post("{}"), ctx())).status).toBe(403);
    expect(wired.cancelJob).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "nope"],
    ["no body", undefined],
    ["unknown field", JSON.stringify({ status: "succeeded" })],
    ["blank reason", JSON.stringify({ reason: "   " })],
    ["long reason", JSON.stringify({ reason: "x".repeat(201) })],
    ["array", "[]"],
  ])("rejects %s with 400", async (_label, body) => {
    const res = await POST(post(body), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_failed");
    expect(wired.cancelJob).not.toHaveBeenCalled();
  });

  it("is a 404 for a malformed ID, without calling the use case", async () => {
    const res = await POST(post("{}"), ctx("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(wired.cancelJob).not.toHaveBeenCalled();
  });

  it("maps a missing job to 404 and a finished job to 409", async () => {
    wired.cancelJob.mockRejectedValueOnce(new NotFoundError("That playlist job doesn't exist."));
    expect((await POST(post("{}"), ctx())).status).toBe(404);
    wired.cancelJob.mockRejectedValueOnce(new ConflictError("That job already finished."));
    const res = await POST(post("{}"), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toEqual({
      code: "conflict",
      message: "That job already finished.",
    });
  });
});

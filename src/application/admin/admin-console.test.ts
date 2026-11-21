import { describe, expect, it, vi } from "vitest";
import { asEventId, asPlaylistJobId } from "@/domain/shared/ids";
import { ConflictError, NotFoundError } from "@/lib/errors";
import { CancelJobInputSchema, createAdminConsole, type AdminConsoleStore } from "./index";
import { readVerification } from "./verification";

const JOB = asPlaylistJobId("6f1c2c1e-6a0e-4d1b-9a43-1c7a7c4c1d10");

function store(overrides: Partial<AdminConsoleStore> = {}): AdminConsoleStore {
  return {
    countEventsByVisibility: vi.fn(async () => ({ held: 2, published: 5, archived: 1 })),
    countArtistsNeedingReview: vi.fn(async () => 3),
    countJobsByStatus: vi.fn(async () => ({
      queued: 1,
      running: 0,
      paused: 0,
      succeeded: 4,
      partial: 0,
      failed: 1,
    })),
    latestIngestRuns: vi.fn(async () => []),
    listJobs: vi.fn(async () => []),
    findEventVerification: vi.fn(async () => undefined),
    failActiveJob: vi.fn(async () => "cancelled" as const),
    ...overrides,
  };
}

const verification = {
  checkedAt: "2026-11-21T10:00:00.000Z",
  fields: Object.fromEntries(
    ["date", "city", "venue"].map((k) => [
      k,
      { value: "x", status: "verified", agreeing: [], independent: 2, disagreeing: [] },
    ]),
  ),
  checks: [{ layer: 1, name: "explicit year", ok: true, detail: "2026" }],
  flags: [],
  independentSources: 2,
  confidence: 0.92,
  passes: true,
};
(verification.fields as Record<string, unknown>).headliners = {
  value: "DJ Snake",
  status: "official",
  agreeing: [{ source: "sunburn", url: "https://sunburn.in/", trust: "official", official: true }],
  independent: 1,
  disagreeing: [],
  artists: [{ name: "DJ Snake", confirmed: true, sources: 1, official: true, identity: "active" }],
};

describe("createAdminConsole", () => {
  it("gathers the dashboard counts", async () => {
    await expect(createAdminConsole(store()).dashboard()).resolves.toEqual({
      events: { held: 2, published: 5, archived: 1 },
      artistsNeedingReview: 3,
      jobs: { queued: 1, running: 0, paused: 0, succeeded: 4, partial: 0, failed: 1 },
      ingestRuns: [],
    });
  });

  it("maps job filters to statuses", async () => {
    const s = store();
    const admin = createAdminConsole(s);
    await admin.listJobs("active", 50);
    await admin.listJobs("failed", 10);
    await admin.listJobs("all", 5);
    expect(vi.mocked(s.listJobs).mock.calls).toEqual([
      [{ statuses: ["queued", "running", "paused"], limit: 50 }],
      [{ statuses: ["failed", "partial"], limit: 10 }],
      [{ statuses: null, limit: 5 }],
    ]);
  });

  it("reads stored verification: missing event, never verified, valid, broken", async () => {
    const id = asEventId("e");
    const read = (raw: unknown) =>
      createAdminConsole(store({ findEventVerification: async () => raw })).eventVerification(id);
    await expect(read(undefined)).resolves.toBeUndefined();
    await expect(read(null)).resolves.toEqual({ state: "none" });
    await expect(read(verification)).resolves.toMatchObject({
      state: "verified",
      verification: { confidence: 0.92, passes: true },
    });
    await expect(read({ checkedAt: 1 })).resolves.toEqual({ state: "unreadable" });
  });

  it("keeps verification readable when it carries extra fields", () => {
    expect(readVerification({ ...verification, hours: [8, 8] }).state).toBe("verified");
  });
});

describe("cancelJob", () => {
  it("fails an active job with a user-readable message", async () => {
    const s = store();
    const result = await createAdminConsole(s).cancelJob(JOB, { reason: "Lineup is changing." });
    const error = "This playlist build was stopped by the team. Lineup is changing.";
    expect(result).toEqual({ jobId: JOB, status: "failed", error });
    expect(s.failActiveJob).toHaveBeenCalledWith(JOB, error);
  });

  it("uses a default reason", async () => {
    const result = await createAdminConsole(store()).cancelJob(JOB, {});
    expect(result.error).toBe(
      "This playlist build was stopped by the team. Try again in a few minutes.",
    );
  });

  it("is a NotFoundError for an unknown job and a ConflictError for a finished one", async () => {
    const missing = createAdminConsole(store({ failActiveJob: async () => "not_found" }));
    await expect(missing.cancelJob(JOB, {})).rejects.toBeInstanceOf(NotFoundError);
    const done = createAdminConsole(store({ failActiveJob: async () => "not_active" }));
    await expect(done.cancelJob(JOB, {})).rejects.toBeInstanceOf(ConflictError);
  });

  it("validates the body strictly", () => {
    expect(CancelJobInputSchema.safeParse({}).success).toBe(true);
    expect(CancelJobInputSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(CancelJobInputSchema.safeParse({ reason: "x".repeat(201) }).success).toBe(false);
    expect(CancelJobInputSchema.safeParse({ reason: "ok", status: "succeeded" }).success).toBe(
      false,
    );
  });
});

import { describe, expect, it } from "vitest";
import { clampActionTime, planSync } from "./sync";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const at = (h: number) => new Date(Date.UTC(2026, 10, 20, h)).toISOString();

describe("planSync (D-092)", () => {
  it("unions both sides and pushes what the server lacks", () => {
    const plan = planSync({ saves: [{ id: A, savedAt: at(1) }], removes: [] }, [
      { eventId: B, savedAt: at(2), removedAt: null },
    ]);
    expect(plan.addLocally).toEqual([B]);
    expect(plan.pushSaves).toEqual([{ eventId: A, at: at(1) }]);
    expect(plan.removeLocally).toEqual([]);
    expect(plan.pushRemoves).toEqual([]);
  });

  it("a later unsave on the server wins over an older local save", () => {
    const plan = planSync({ saves: [{ id: A, savedAt: at(1) }], removes: [] }, [
      { eventId: A, savedAt: at(1), removedAt: at(3) },
    ]);
    expect(plan.removeLocally).toEqual([{ eventId: A, removedAt: at(3) }]);
    expect(plan.pushSaves).toEqual([]);
  });

  it("a later local save wins over an older server unsave, and is pushed", () => {
    const plan = planSync({ saves: [{ id: A, savedAt: at(5) }], removes: [] }, [
      { eventId: A, savedAt: at(1), removedAt: at(3) },
    ]);
    expect(plan.removeLocally).toEqual([]);
    expect(plan.pushSaves).toEqual([{ eventId: A, at: at(5) }]);
  });

  it("a later local unsave wins over a server save, and is pushed", () => {
    const plan = planSync({ saves: [], removes: [{ id: C, removedAt: at(4) }] }, [
      { eventId: C, savedAt: at(2), removedAt: null },
    ]);
    expect(plan.addLocally).toEqual([]);
    expect(plan.pushRemoves).toEqual([{ eventId: C, at: at(4) }]);
  });

  it("is a no-op when both sides agree", () => {
    const plan = planSync({ saves: [{ id: A, savedAt: at(1) }], removes: [] }, [
      { eventId: A, savedAt: at(1), removedAt: null },
    ]);
    expect(plan).toEqual({ addLocally: [], removeLocally: [], pushSaves: [], pushRemoves: [] });
  });

  it("clamps client times", () => {
    const now = new Date(at(12));
    expect(clampActionTime(new Date("2099-01-01"), now).getTime()).toBe(now.getTime() + 300_000);
    expect(clampActionTime(new Date(at(11)), now).toISOString()).toBe(at(11));
  });
});

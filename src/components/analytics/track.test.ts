import { describe, expect, it } from "vitest";
import { currentEventId, landingSource, trackingAllowed } from "./track";
import { deviceId, forgetDeviceId, readDeviceId } from "./device-id";

describe("trackingAllowed (D-090)", () => {
  it("tracks a normal browser", () => {
    expect(trackingAllowed({ doNotTrack: null, globalPrivacyControl: false })).toBe(true);
  });

  it.each([
    [{ doNotTrack: "1" }],
    [{ doNotTrack: "yes" }],
    [{ windowDoNotTrack: "1" }],
    [{ globalPrivacyControl: true }],
    [{ webdriver: true }],
  ])("skips tracking entirely for %o", (signals) => {
    expect(trackingAllowed(signals)).toBe(false);
  });
});

describe("landingSource (D-090)", () => {
  it("keeps UTM tags and our share tag", () => {
    expect(
      landingSource(
        "https://tixtape.vercel.app/events/x?utm_source=insta&utm_medium=story&utm_campaign=lolla&via=wa",
        "",
      ),
    ).toEqual({ us: "insta", um: "story", uc: "lolla", via: "wa" });
  });

  it("keeps only the referrer's host, never its path or query", () => {
    const src = landingSource(
      "https://tixtape.vercel.app/",
      "https://www.google.com/search?q=my+name+and+phone",
    );
    expect(src).toEqual({ ref: "www.google.com" });
  });

  it("reads Android app referrers, ignores our own host and junk", () => {
    expect(landingSource("https://tixtape.vercel.app/", "android-app://com.whatsapp/")).toEqual({
      ref: "com.whatsapp",
    });
    expect(
      landingSource("https://tixtape.vercel.app/", "https://tixtape.vercel.app/search"),
    ).toEqual({});
    expect(landingSource("https://tixtape.vercel.app/", "not a url")).toEqual({});
  });
});

describe("device ID (D-090)", () => {
  const memory = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
  };
  const ID = "0b0f6a52-8d1e-4a1f-9a77-1d1b7d7e2c11";

  it("creates one random ID and keeps it", () => {
    const s = memory();
    expect(deviceId(s, () => ID)).toBe(ID);
    expect(deviceId(s, () => "other")).toBe(ID);
    forgetDeviceId(s);
    expect(readDeviceId(s)).toBeNull();
  });

  it("replaces a tampered value and survives blocked storage", () => {
    const s = memory();
    s.setItem("tixtape.did", "not-a-uuid");
    expect(deviceId(s, () => ID)).toBe(ID);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {},
    };
    expect(deviceId(blocked, () => ID)).toBeNull();
    expect(deviceId(undefined)).toBeNull();
  });
});

describe("currentEventId", () => {
  it("reads event pages only", () => {
    expect(currentEventId("/events/c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3")).toBe(
      "c411ec28-12e3-4fc4-ba5a-7f55fb4ecab3",
    );
    expect(currentEventId("/search")).toBeUndefined();
  });
});

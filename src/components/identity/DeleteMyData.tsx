"use client";

import { useState } from "react";
import { forgetDeviceId, readDeviceId } from "../analytics/device-id";
import { Button } from "../ui/Button";
import { ID_COPY } from "./identity-copy";
import { PROMPT_STATE_KEY } from "./prompt-rules";

type Phase = "idle" | "confirm" | "busy" | "done" | "failed";

/**
 * D-090: "Delete my data". Two taps (no dialog), then `DELETE /api/me/data` with this device's
 * ID. On success the device ID and prompt memory are cleared, so this browser starts fresh.
 */
export function DeleteMyData() {
  const [phase, setPhase] = useState<Phase>("idle");

  async function run() {
    if (phase !== "confirm") return setPhase("confirm");
    setPhase("busy");
    const did = readDeviceId();
    try {
      if (did) {
        const res = await fetch("/api/me/data", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ did }),
        });
        if (!res.ok) throw new Error(String(res.status));
      }
      forgetDeviceId();
      try {
        localStorage.removeItem(PROMPT_STATE_KEY);
      } catch {
        // Nothing stored.
      }
      setPhase("done");
    } catch {
      setPhase("failed");
    }
  }

  const label =
    phase === "confirm"
      ? ID_COPY.deleteSure
      : phase === "failed"
        ? ID_COPY.deleteFailed
        : ID_COPY.deleteData;
  return (
    <div role="status" aria-live="polite">
      {phase === "done" ? (
        <p className="font-display text-xl font-extrabold">{ID_COPY.deleted}</p>
      ) : (
        <Button
          variant={phase === "confirm" ? "night" : "secondary"}
          onClick={run}
          disabled={phase === "busy"}
        >
          <span aria-hidden>🗑️</span> {label}
        </Button>
      )}
    </div>
  );
}

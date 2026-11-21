"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { EVENT_VISIBILITIES, type EventVisibility } from "@/domain/events/visibility";
import { adminRequest } from "./admin-api";
import { VISIBILITY_ACTION, VISIBILITY_LABEL } from "./admin-format";
import { ConfirmPanel } from "./ConfirmPanel";

type Props = {
  eventId: string;
  title: string;
  visibility: EventVisibility;
  /** Null: never verified by the collector. */
  passes: boolean | null;
  flags: string[];
};

/** Publish, hold or archive one event through `PATCH /api/admin/events/:id` (D-056). */
export function VisibilityActions({ eventId, title, visibility, passes, flags }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<EventVisibility | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setTarget(null);
    setError(null);
  };

  async function confirm(next: EventVisibility) {
    setBusy(true);
    setError(null);
    const result = await adminRequest(`/api/admin/events/${eventId}`, "PATCH", {
      visibility: next,
    });
    setBusy(false);
    if (!result.ok) return setError(result.message);
    toast.show(`${VISIBILITY_LABEL[next]}: “${title}”.`);
    close();
    router.refresh();
  }

  const warnPublish = target === "published" && passes !== true;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {EVENT_VISIBILITIES.filter((v) => v !== visibility).map((v) => (
          <Button
            key={v}
            variant={v === "published" ? "primary" : "secondary"}
            onClick={() => {
              setError(null);
              setTarget(v);
            }}
            aria-expanded={target === v}
          >
            {VISIBILITY_ACTION[v].verb}
          </Button>
        ))}
      </div>
      {target && (
        <ConfirmPanel
          key={target}
          title={`${VISIBILITY_ACTION[target].verb} “${title}”?`}
          confirmLabel={`Yes, ${VISIBILITY_ACTION[target].verb.toLowerCase()}`}
          busy={busy}
          error={error}
          danger={target !== "published" || warnPublish}
          onConfirm={() => void confirm(target)}
          onCancel={close}
        >
          <p>{VISIBILITY_ACTION[target].effect}</p>
          {warnPublish && (
            <p className="mt-2 font-semibold text-ink">
              {passes === null
                ? "Warning: this event was never verified by the collector (D-056)."
                : `Warning: verification doesn't pass${flags.length ? ` (${flags.join(", ")})` : ""}. Check the table below first.`}
            </p>
          )}
        </ConfirmPanel>
      )}
    </div>
  );
}

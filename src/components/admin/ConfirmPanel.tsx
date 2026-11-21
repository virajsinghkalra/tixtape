"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

type Props = {
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  /** Red-flag styling for actions that hide or stop something. */
  danger?: boolean;
};

/**
 * The in-page confirm step for every admin action (no `window.confirm`). Takes focus when it
 * opens so keyboard and screen-reader users land on the question; Escape cancels.
 */
export function ConfirmPanel({
  title,
  children,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
  danger = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) onCancel();
      }}
      className={cx(
        "mt-3 rounded-card border-2 p-4 outline-none",
        danger ? "border-pink bg-surface" : "border-ink bg-surface",
      )}
    >
      <p id={titleId} className="font-semibold">
        {title}
      </p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-field bg-pink px-3 py-2 text-sm font-semibold text-on-block"
        >
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? "Working…" : confirmLabel}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

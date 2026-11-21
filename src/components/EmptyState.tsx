import type { ReactNode } from "react";

/** A friendly placeholder where content would be. */
export function EmptyState({
  emoji = "🫥",
  title,
  children,
}: {
  emoji?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-card border-2 border-dashed border-line px-6 py-12 text-center">
      <p aria-hidden className="text-4xl">
        {emoji}
      </p>
      <p className="mt-2 font-display text-2xl font-extrabold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-md text-muted">{children}</div>}
    </div>
  );
}

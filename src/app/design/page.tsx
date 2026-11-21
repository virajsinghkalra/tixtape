import type { Metadata } from "next";
import { DesignShowcase } from "@/components/DesignShowcase";

export const metadata: Metadata = { title: "Design system", robots: { index: false } };

/** Hidden page (not linked): every UI primitive and variant, in light and dark side by side. */
export default function DesignPage() {
  const now = new Date().toISOString();
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display text-huge font-extrabold">Design system</h1>
      <p className="mt-2 text-muted">
        Tokens live in <code>globals.css</code>; primitives in <code>src/components/ui</code>.
      </p>
      <div className="mt-8 grid gap-6 xl:grid-cols-2">
        {(["light", "dark"] as const).map((theme) => (
          <div
            key={theme}
            className={`theme-${theme} min-w-0 rounded-tile border border-line bg-bg p-5 text-ink sm:p-7`}
          >
            <h2 className="font-display text-big font-extrabold capitalize">{theme}</h2>
            <DesignShowcase now={now} theme={theme} />
          </div>
        ))}
      </div>
    </div>
  );
}

import type { StoredFieldVerification, VerificationView } from "@/application/admin";
import { Chip } from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import { safeHttpUrl } from "@/domain/events/http-url";
import { formatAgo, formatConfidence, formatIst } from "./admin-format";

const FIELDS = [
  ["date", "Date"],
  ["city", "City"],
  ["venue", "Venue"],
  ["headliners", "Headliners"],
] as const;

const STATUS: Record<StoredFieldVerification["status"], { label: string; tone: string }> = {
  verified: { label: "✓ Verified", tone: "bg-lime text-on-block border-transparent" },
  official: { label: "✓ Official", tone: "bg-lime text-on-block border-transparent" },
  single: { label: "One source", tone: "bg-orange text-on-block border-transparent" },
  conflict: { label: "✗ Conflict", tone: "bg-pink text-on-block border-transparent" },
  missing: { label: "Missing", tone: "bg-surface-2 text-muted" },
};

const CELL = "px-3 py-2 text-left align-top";

/** A link only when the stored URL is plain http(s); anything else is shown as text. */
function SourceLink({ source, url, official }: { source: string; url: string; official: boolean }) {
  const safe = safeHttpUrl(url);
  const label = `${source}${official ? " (official)" : ""}`;
  if (!safe) return <span>{label}</span>;
  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2"
    >
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function FieldNotes({ field }: { field: StoredFieldVerification }) {
  return (
    <>
      <p>{field.independent} independent</p>
      {field.disagreeing.map((d, i) => (
        <p key={i} className="text-ink">
          Says “{d.value}”: <SourceLink {...d} />
        </p>
      ))}
    </>
  );
}

/** The per-field verification table from `events.verification` (D-056), for the admin. */
export function VerificationTable({ view, now }: { view: VerificationView; now: Date }) {
  if (view.state === "none") {
    return (
      <p className="text-sm text-muted">
        Not checked by the collector yet (for example, entered by an admin). There is no per-field
        verification to show.
      </p>
    );
  }
  if (view.state === "unreadable") {
    return (
      <p className="text-sm text-muted">
        The stored verification is in an older format and can&apos;t be shown. The next collector
        run re-checks it.
      </p>
    );
  }
  const v = view.verification;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Chip className={v.passes ? "bg-lime text-on-block" : "bg-pink text-on-block"}>
          {v.passes ? "Passes layers 1–4" : "Doesn't pass"}
        </Chip>
        <Chip>Confidence {formatConfidence(v.confidence)}</Chip>
        <Chip>{v.independentSources} independent sources</Chip>
        <span className="text-muted">
          Checked {formatAgo(v.checkedAt, now)} ({formatIst(v.checkedAt)})
        </span>
      </div>
      {v.flags.length > 0 && (
        <ul aria-label="Flags" className="flex flex-wrap gap-2">
          {v.flags.map((f) => (
            <li key={f}>
              <Chip className="border-pink">{f}</Chip>
            </li>
          ))}
        </ul>
      )}

      <div
        className="overflow-x-auto rounded-card border border-line"
        tabIndex={0}
        role="region"
        aria-label="Per-field verification"
      >
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
            <tr>
              <th scope="col" className={CELL}>
                Field
              </th>
              <th scope="col" className={CELL}>
                Value
              </th>
              <th scope="col" className={CELL}>
                Status
              </th>
              <th scope="col" className={CELL}>
                Sources
              </th>
              <th scope="col" className={CELL}>
                Notes
              </th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map(([key, label]) => {
              const field = v.fields[key];
              return (
                <tr key={key} className="border-t border-line">
                  <th scope="row" className={CELL}>
                    {label}
                  </th>
                  <td className={CELL}>{field.value ?? "—"}</td>
                  <td className={CELL}>
                    <Chip className={STATUS[field.status].tone}>{STATUS[field.status].label}</Chip>
                  </td>
                  <td className={CELL}>
                    {field.agreeing.length === 0 ? (
                      "—"
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {field.agreeing.map((s, i) => (
                          <li key={i}>
                            <SourceLink {...s} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={cx(CELL, "text-muted")}>
                    <FieldNotes field={field} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {v.fields.headliners.artists.length > 0 && (
        <div>
          <h3 className="font-semibold">Headliner checks</h3>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {v.fields.headliners.artists.map((a) => (
              <li key={a.name}>
                <span className="font-semibold">{a.name}</span>{" "}
                <span className="text-muted">
                  · {a.confirmed ? "confirmed" : "not confirmed"} · {a.sources} sources
                  {a.official ? " · official" : ""} · identity {a.identity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {v.checks.length > 0 && (
        <div
          className="overflow-x-auto rounded-card border border-line"
          tabIndex={0}
          role="region"
          aria-label="Checks"
        >
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className={CELL}>
                  Layer
                </th>
                <th scope="col" className={CELL}>
                  Check
                </th>
                <th scope="col" className={CELL}>
                  Result
                </th>
                <th scope="col" className={CELL}>
                  Detail
                </th>
              </tr>
            </thead>
            <tbody>
              {v.checks.map((c, i) => (
                <tr key={i} className="border-t border-line">
                  <td className={CELL}>{c.layer}</td>
                  <th scope="row" className={CELL}>
                    {c.name}
                  </th>
                  <td className={CELL}>
                    {c.ok === null ? "Not checked" : c.ok ? "✓ Pass" : "✗ Fail"}
                  </td>
                  <td className={cx(CELL, "text-muted")}>{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { TIER_LABEL } from "@/components/lineup-view";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { BILLING_TIERS, type BillingTier } from "@/domain/shared/lineup";
import { adminRequest } from "./admin-api";
import { ConfirmPanel } from "./ConfirmPanel";
import { buildEventPatch, isTier, moveRow, type EventForm, type LineupRow } from "./event-edit";

const FIELD =
  "min-h-11 w-full rounded-field border-2 border-line bg-surface px-3 text-sm text-ink focus:border-ink";

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm font-semibold">
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted">{hint}</span>}
    </label>
  );
}

function TierSelect({
  value,
  onChange,
  label,
}: {
  value: BillingTier;
  onChange: (t: BillingTier) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => isTier(e.target.value) && onChange(e.target.value)}
      className={`${FIELD} sm:w-44`}
    >
      {BILLING_TIERS.map((t) => (
        <option key={t} value={t}>
          {TIER_LABEL[t]}
        </option>
      ))}
    </select>
  );
}

/**
 * Edits dates, venue, link and lineup through `PATCH /api/admin/events/:id`. Only changed
 * fields are sent; a changed lineup replaces the whole lineup, in the order shown.
 */
export function EventEditor({ eventId, initial }: { eventId: string; initial: EventForm }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState<EventForm>(initial);
  const [newName, setNewName] = useState("");
  const [newTier, setNewTier] = useState<BillingTier>("support");
  const [review, setReview] = useState<{
    patch: Record<string, unknown>;
    changes: string[];
  } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const nextKey = useRef(0);

  const set = (patch: Partial<EventForm>) => {
    setReview(null);
    setForm((f) => ({ ...f, ...patch }));
  };
  const setVenue = (k: keyof EventForm["venue"], v: string) =>
    set({ venue: { ...form.venue, [k]: v } });
  const setRow = (i: number, patch: Partial<LineupRow>) =>
    set({ lineup: form.lineup.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  function addArtist() {
    if (!newName.trim()) return setErrors(["Type the artist's name before adding."]);
    nextKey.current += 1;
    const row = {
      key: `new-${nextKey.current}`,
      name: newName.trim(),
      tier: newTier,
      day: null,
      stage: null,
    };
    set({ lineup: [...form.lineup, row] });
    setNewName("");
    setErrors([]);
  }

  function startReview() {
    const result = buildEventPatch(initial, form);
    if (!result.ok) {
      setReview(null);
      return setErrors(result.errors);
    }
    setErrors([]);
    setSaveError(null);
    setReview({ patch: result.patch, changes: result.changes });
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setSaveError(null);
    const result = await adminRequest(`/api/admin/events/${eventId}`, "PATCH", patch);
    setBusy(false);
    if (!result.ok) return setSaveError(result.message);
    toast.show("Saved. The event now carries your edits.");
    setReview(null);
    router.refresh();
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        startReview();
      }}
      className="flex flex-col gap-6"
    >
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-display text-lg font-bold">Dates (IST)</legend>
        <Field label="Starts">
          <input
            type="datetime-local"
            className={FIELD}
            value={form.startsAt}
            onChange={(e) => set({ startsAt: e.target.value })}
            required
          />
        </Field>
        <Field label="Ends" hint="Leave empty if unknown.">
          <input
            type="datetime-local"
            className={FIELD}
            value={form.endsAt}
            onChange={(e) => set({ endsAt: e.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 font-display text-lg font-bold">Venue</legend>
        <Field label="Name">
          <input
            className={FIELD}
            value={form.venue.name}
            onChange={(e) => setVenue("name", e.target.value)}
          />
        </Field>
        <Field label="City">
          <input
            className={FIELD}
            value={form.venue.city}
            onChange={(e) => setVenue("city", e.target.value)}
          />
        </Field>
        <Field label="State" hint="Optional.">
          <input
            className={FIELD}
            value={form.venue.state}
            onChange={(e) => setVenue("state", e.target.value)}
          />
        </Field>
        <Field label="Country code" hint="Two letters, e.g. IN.">
          <input
            className={FIELD}
            value={form.venue.country}
            maxLength={2}
            autoCapitalize="characters"
            onChange={(e) => setVenue("country", e.target.value)}
          />
        </Field>
      </fieldset>

      <Field
        label="Official event link"
        hint="Where “Buy tickets” goes. http(s) only; empty removes it."
      >
        <input
          type="url"
          inputMode="url"
          className={FIELD}
          value={form.url}
          onChange={(e) => set({ url: e.target.value })}
        />
      </Field>

      <fieldset>
        <legend className="mb-2 font-display text-lg font-bold">
          Lineup{" "}
          <span className="font-sans text-sm font-normal text-muted">
            (billing order, top first)
          </span>
        </legend>
        <ol className="flex flex-col gap-2">
          {form.lineup.map((row, i) => (
            <li
              key={row.key}
              className="flex flex-col gap-2 rounded-field border border-line p-2 sm:flex-row sm:items-center"
            >
              <span className="w-8 font-mono text-xs text-muted tabular-nums">{i + 1}.</span>
              <input
                aria-label={`Artist ${i + 1} name`}
                className={`${FIELD} sm:flex-1`}
                value={row.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
              />
              <TierSelect
                label={`Artist ${i + 1} tier`}
                value={row.tier}
                onChange={(tier) => setRow(i, { tier })}
              />
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  aria-label={`Move ${row.name || `artist ${i + 1}`} up`}
                  disabled={i === 0}
                  onClick={() => set({ lineup: moveRow(form.lineup, i, -1) })}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${row.name || `artist ${i + 1}`} down`}
                  disabled={i === form.lineup.length - 1}
                  onClick={() => set({ lineup: moveRow(form.lineup, i, 1) })}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Remove ${row.name || `artist ${i + 1}`}`}
                  onClick={() => set({ lineup: form.lineup.filter((_, j) => j !== i) })}
                >
                  ✕
                </Button>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <Field label="Add an artist">
            <input
              className={FIELD}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addArtist();
                }
              }}
            />
          </Field>
          <TierSelect label="New artist tier" value={newTier} onChange={setNewTier} />
          <Button variant="secondary" onClick={addArtist}>
            Add
          </Button>
        </div>
      </fieldset>

      {errors.length > 0 && (
        <ul
          role="alert"
          className="rounded-field bg-pink px-4 py-3 text-sm font-semibold text-on-block"
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <div>
        <Button type="submit">Review changes</Button>
        {review && (
          <ConfirmPanel
            title="Save these changes?"
            confirmLabel="Save changes"
            busy={busy}
            error={saveError}
            onConfirm={() => void save(review.patch)}
            onCancel={() => setReview(null)}
          >
            <ul className="list-disc pl-5">
              {review.changes.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p className="mt-2">
              Admin edits win over every feed and aren&apos;t overwritten by later runs (D-026).
            </p>
          </ConfirmPanel>
        )}
      </div>
    </form>
  );
}

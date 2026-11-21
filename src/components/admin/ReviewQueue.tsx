"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { spotifyArtistUrl } from "@/components/links";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { useToast } from "@/components/ui/Toast";
import type { SpotifyArtistId } from "@/domain/shared/ids";
import { adminRequest } from "./admin-api";
import { ConfirmPanel } from "./ConfirmPanel";
import {
  parseSpotifyArtistRef,
  spotifyEmbedUrl,
  type ReviewArtistView,
  type ReviewCandidateView,
} from "./review-queue";

type Decision = { kind: "approve"; spotifyArtistId: string; label: string } | { kind: "not_found" };

const FIELD =
  "min-h-11 w-full rounded-field border-2 border-line bg-surface px-3 text-sm text-ink focus:border-ink";

function decide(artistId: string, d: Decision) {
  const body =
    d.kind === "approve"
      ? { action: "approve", spotifyArtistId: d.spotifyArtistId }
      : { action: "not_found" };
  return adminRequest(`/api/admin/artists/${artistId}`, "PATCH", body);
}

const link = (id: string) => spotifyArtistUrl(id as SpotifyArtistId);

function CandidateRow({
  c,
  strong,
  onApprove,
}: {
  c: ReviewCandidateView;
  strong: boolean;
  onApprove: () => void;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-field border border-line p-3 sm:flex-row">
      {c.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- Spotify CDN image, small
        <img
          src={c.imageUrl}
          alt=""
          width={64}
          height={64}
          loading="lazy"
          className="size-16 rounded-field object-cover"
        />
      ) : (
        <span
          aria-hidden
          className="grid size-16 place-items-center rounded-field bg-surface-2 text-xs text-muted"
        >
          No image
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {c.name}
          {strong && <Chip className="bg-lime text-on-block">Strong match</Chip>}
          <Chip>Score {c.score}</Chip>
        </p>
        <a
          href={link(c.spotifyArtistId)}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm underline underline-offset-2"
        >
          Open {c.name} on Spotify<span className="sr-only"> (opens in a new tab)</span>
        </a>
        <p className="mt-1 text-xs text-muted">
          Name match: {c.nameMatchKind.replace(/_/gu, " ")}
          {c.genres.length > 0 && ` · ${c.genres.slice(0, 3).join(", ")}`}
        </p>
        {c.points.length > 0 && (
          <ul aria-label="Score breakdown" className="mt-2 flex flex-wrap gap-1">
            {c.points.map((p) => (
              <li key={p.label}>
                <Chip className="px-2 py-0.5">
                  {p.label} {p.value > 0 ? `+${p.value}` : p.value}
                </Chip>
              </li>
            ))}
          </ul>
        )}
        {c.evidence.length > 0 && (
          <ul aria-label="Evidence" className="mt-2 list-disc pl-5 text-xs text-muted">
            {c.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="sm:self-center">
        <Button variant="secondary" onClick={onApprove}>
          Approve this one
        </Button>
      </div>
    </li>
  );
}

function ArtistCard({ item, onDone }: { item: ReviewArtistView; onDone: (msg: string) => void }) {
  const [pending, setPending] = useState<Decision | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  const ask = (d: Decision) => {
    setError(null);
    setPending(d);
  };

  async function confirm(d: Decision) {
    setBusy(true);
    const result = await decide(item.id, d);
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setPending(null);
    onDone(
      d.kind === "approve"
        ? `Matched “${item.name}” to ${d.label}.`
        : `Marked “${item.name}” as not on Spotify.`,
    );
  }

  function check() {
    const ref = parseSpotifyArtistRef(pasted);
    setPreview(ref.ok ? ref.id : null);
    setPasteError(ref.ok ? null : ref.message);
  }

  const headingId = `artist-${item.id}`;
  return (
    <Card className="p-4" aria-labelledby={headingId} role="group">
      <h2 id={headingId} className="font-display text-xl font-bold">
        {item.name}
      </h2>
      {item.candidates.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Spotify returned no candidates for this name.</p>
      ) : (
        <ol aria-label={`Top candidates for ${item.name}`} className="mt-3 flex flex-col gap-2">
          {item.candidates.map((c) => (
            <CandidateRow
              key={c.spotifyArtistId}
              c={c}
              strong={c.spotifyArtistId === item.strongId}
              onApprove={() =>
                ask({ kind: "approve", spotifyArtistId: c.spotifyArtistId, label: c.name })
              }
            />
          ))}
        </ol>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <label htmlFor={`paste-${item.id}`} className="text-sm font-semibold">
          Or paste a Spotify artist link or ID
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={`paste-${item.id}`}
            className={FIELD}
            value={pasted}
            placeholder="https://open.spotify.com/artist/…"
            onChange={(e) => {
              setPasted(e.target.value);
              setPreview(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                check();
              }
            }}
          />
          <Button variant="secondary" onClick={check}>
            Preview
          </Button>
        </div>
        {pasteError && (
          <p role="alert" className="text-sm font-semibold text-ink">
            {pasteError}
          </p>
        )}
        {preview && (
          <div className="flex flex-col gap-2">
            <iframe
              title={`Spotify preview of artist ${preview}`}
              src={spotifyEmbedUrl(preview)}
              height={152}
              loading="lazy"
              allow="encrypted-media"
              sandbox="allow-scripts allow-same-origin allow-popups"
              className="w-full rounded-field border-0"
            />
            <p className="text-xs text-muted">
              Check the preview shows the right artist. A wrong or unknown ID shows Spotify&apos;s
              error page.
            </p>
            <div>
              <Button
                onClick={() =>
                  ask({ kind: "approve", spotifyArtistId: preview, label: `Spotify ID ${preview}` })
                }
              >
                Approve this artist
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 border-t border-line pt-4">
        <Button variant="ghost" onClick={() => ask({ kind: "not_found" })}>
          Not on Spotify
        </Button>
      </div>

      {pending && (
        <ConfirmPanel
          key={pending.kind === "approve" ? pending.spotifyArtistId : "nf"}
          title={
            pending.kind === "approve"
              ? `Match “${item.name}” to ${pending.label}?`
              : `Mark “${item.name}” as not on Spotify?`
          }
          confirmLabel={pending.kind === "approve" ? "Approve" : "Mark not on Spotify"}
          busy={busy}
          error={error}
          danger={pending.kind === "not_found"}
          onConfirm={() => void confirm(pending)}
          onCancel={() => setPending(null)}
        >
          Admin choices are never changed by automatic re-checks (D-026).
        </ConfirmPanel>
      )}
    </Card>
  );
}

/** The artist review queue with bulk-approve for strong matches only (D-066). */
export function ReviewQueue({ items }: { items: ReviewArtistView[] }) {
  const router = useRouter();
  const toast = useToast();
  const strong = items.filter((i) => i.strongId !== null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  async function bulkApprove() {
    setBulkBusy(true);
    setBulkError(null);
    const failed: string[] = [];
    for (const item of strong) {
      const result = await decide(item.id, {
        kind: "approve",
        spotifyArtistId: item.strongId!,
        label: item.name,
      });
      if (!result.ok) failed.push(item.name);
    }
    setBulkBusy(false);
    const done = strong.length - failed.length;
    if (failed.length > 0) {
      setBulkError(`Approved ${done}. These failed, try them one by one: ${failed.join(", ")}.`);
    } else {
      setBulkOpen(false);
      toast.show(`Approved ${done} strong matches.`);
    }
    router.refresh();
  }

  const onDone = (msg: string) => {
    toast.show(msg);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-4">
      {strong.length > 0 && (
        <div>
          <Button onClick={() => setBulkOpen(true)} aria-expanded={bulkOpen}>
            Approve {strong.length} strong {strong.length === 1 ? "match" : "matches"}
          </Button>
          {bulkOpen && (
            <ConfirmPanel
              title={`Approve ${strong.length} strong ${strong.length === 1 ? "match" : "matches"}?`}
              confirmLabel="Approve all"
              busy={bulkBusy}
              error={bulkError}
              onConfirm={() => void bulkApprove()}
              onCancel={() => setBulkOpen(false)}
            >
              <ul className="list-disc pl-5">
                {strong.map((i) => (
                  <li key={i.id}>
                    {i.name} →{" "}
                    {i.candidates.find((c) => c.spotifyArtistId === i.strongId)?.name ?? i.strongId}
                  </li>
                ))}
              </ul>
            </ConfirmPanel>
          )}
        </div>
      )}
      {items.map((item) => (
        <ArtistCard key={item.id} item={item} onDone={onDone} />
      ))}
    </div>
  );
}

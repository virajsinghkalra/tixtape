"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { adminRequest } from "./admin-api";
import { ConfirmPanel } from "./ConfirmPanel";

/** Makes the signed-in admin's Spotify account the shared-playlist publisher (D-036). */
export function PublisherConnect() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setBusy(true);
    setError(null);
    const result = await adminRequest("/api/admin/publisher", "POST", {});
    setBusy(false);
    if (!result.ok) return setError(result.message);
    setOpen(false);
    toast.show("Your Spotify account now publishes shared playlists.");
    router.refresh();
  }

  return (
    <div>
      <Button variant="secondary" onClick={() => setOpen(true)} aria-expanded={open}>
        Use my Spotify account
      </Button>
      {open && (
        <ConfirmPanel
          title="Publish shared playlists from your Spotify account?"
          confirmLabel="Yes, use my account"
          busy={busy}
          error={error}
          onConfirm={() => void connect()}
          onCancel={() => setOpen(false)}
        >
          New and updated shared playlists will be created on the account you&apos;re signed in
          with. If Spotify says your sign-in needs renewing, sign out and in again first.
        </ConfirmPanel>
      )}
    </div>
  );
}

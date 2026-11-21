"use client";

import { useState } from "react";
import { Button } from "./ui/Button";
import { useToast } from "./ui/Toast";

/** POSTs to /api/auth/logout (which answers JSON), then reloads; the user never sees JSON. */
export function LogoutButton() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function logout() {
    setBusy(true);
    try {
      const res = await fetch("/api/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error(`Logout failed with ${res.status}`);
      window.location.assign("/");
    } catch (err) {
      console.error(err);
      toast.show("Couldn't log you out. Check your connection and try again.", "error");
      setBusy(false);
    }
  }

  return (
    <Button variant="ghost" onClick={logout} aria-disabled={busy} disabled={busy}>
      Log out
    </Button>
  );
}

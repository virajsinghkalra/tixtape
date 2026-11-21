"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "./ui/Toast";

const MESSAGES: Record<string, string> = {
  spotify_denied: "Spotify sign-in was cancelled. No worries: playlists work without logging in.",
};
const FALLBACK = "Spotify sign-in didn't work this time. Playlists still work without logging in.";

/** Turns `?auth_error=…` from the Spotify callback into a friendly toast, then tidies the URL. */
export function AuthNotice({ code }: { code: string }) {
  const toast = useToast();
  const router = useRouter();
  useEffect(() => {
    toast.show(MESSAGES[code] ?? FALLBACK, "error");
    router.replace("/", { scroll: false });
  }, [code, toast, router]);
  return null;
}

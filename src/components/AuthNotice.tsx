"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useToast } from "./ui/Toast";

const MESSAGES: Record<string, string> = {
  spotify_denied: "Sign-in cancelled",
};
const FALLBACK = "Sign-in failed";

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

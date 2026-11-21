"use client";

import { currentEventId, track } from "./analytics/track";
import { Button, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { useToast } from "./ui/Toast";
import { copyText } from "./ui/copy-text";
import { haptic } from "./ui/feedback";

type Props = {
  title: string;
  text: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** What to share. Defaults to this page. */
  url?: string;
};

/** Native share sheet where there is one, else copy the link. */
export function ShareButton({
  title,
  text,
  variant = "secondary",
  size,
  className,
  url: target,
}: Props) {
  const toast = useToast();

  async function share() {
    const channel = "share" in navigator ? "native" : "copy";
    // D-090: `?via=` lets an arrival from a shared link count as "share" (or the app's name).
    const url = withVia(target ?? window.location.href.split("#")[0]!, channel);
    track("share", { channel, eventId: currentEventId() });
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        haptic("success");
        return;
      }
      // Optimistic (D-084): confirm at once; the copy almost never fails, and if it does the
      // error toast follows.
      haptic("success");
      toast.show("Link copied 🔗");
      if (!(await copyText(url))) toast.show("Couldn't copy. Use the URL.", "error");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return; // user closed the sheet
      toast.show("Couldn't share. Copy the URL.", "error");
    }
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={share}
      className={className}
      aria-label={`Share ${title}`}
    >
      <span aria-hidden>↗</span> Share
    </Button>
  );
}

function withVia(raw: string, via: string): string {
  try {
    const url = new URL(raw, window.location.href);
    url.searchParams.set("via", via);
    return url.toString();
  } catch {
    return raw;
  }
}

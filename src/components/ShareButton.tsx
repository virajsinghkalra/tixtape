"use client";

import { Button, type ButtonSize, type ButtonVariant } from "./ui/Button";
import { useToast } from "./ui/Toast";

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
    const url = target ?? window.location.href.split("#")[0]!;
    try {
      if (navigator.share) {
        await navigator.share({ title, text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.show("Link copied 🔗");
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

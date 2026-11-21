"use client";

import { ARTISTS, artistKey } from "./device/device-lists";
import { useDeviceList } from "./device/use-device-list";
import { ChipButton } from "./ui/Chip";
import { buttonClass } from "./ui/Button";
import { haptic } from "./ui/feedback";
import { useToast } from "./ui/Toast";
import { COPY } from "./ux-copy";

type Props = {
  artist: string;
  /**
   * `ping`: the zero-result "🔔 Ping me" button. `follow`: a small "+ Follow" chip for lineups.
   * Both write the one followed-artists list on this device (D-088).
   */
  kind?: "ping" | "follow";
  /** Keeps focus in the search box when used inside the type-ahead panel. */
  keepFocus?: boolean;
};

/** Follow an artist on this device; a later visit shows "🎉 {artist} just landed" (UX #7, #12). */
export function WatchArtistButton({ artist, kind = "ping", keepFocus = false }: Props) {
  const list = useDeviceList(ARTISTS);
  const on = list.ready && list.has(artistKey(artist));
  const toast = useToast();

  function toggle() {
    if (on) {
      list.remove(artistKey(artist));
      haptic("tap");
      return;
    }
    list.add({ name: artist.trim(), followedAt: new Date().toISOString() });
    haptic("success");
    if (kind === "ping") toast.show(COPY.pingToast);
  }

  const common = {
    onClick: toggle,
    "aria-pressed": on,
    onMouseDown: keepFocus ? (e: { preventDefault: () => void }) => e.preventDefault() : undefined,
  };
  if (kind === "follow") {
    return (
      <ChipButton
        {...common}
        selected={on}
        aria-label={`${on ? COPY.following : COPY.follow} ${artist}`}
      >
        <span aria-hidden>{on ? "✓" : "+"}</span> {on ? COPY.following : COPY.follow}
      </ChipButton>
    );
  }
  return (
    <button
      type="button"
      {...common}
      aria-label={`${on ? COPY.pinged : COPY.pingMe}: ${artist}`}
      className={buttonClass(on ? "secondary" : "primary", "md")}
    >
      <span aria-hidden>🔔</span> {on ? COPY.pinged : COPY.pingMe}
    </button>
  );
}

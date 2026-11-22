"use client";

import { useCallback } from "react";
import { track } from "../analytics/track";
import { SAVED, type SavedShow } from "../device/device-lists";
import { useDeviceList } from "../device/use-device-list";
import { haptic } from "../ui/feedback";
import { useToast } from "../ui/Toast";
import { SAVE_COPY } from "./save-copy";
import { noteSave, noteUnsave } from "./saved-sync";

type Options = {
  /** Called after a save (the event page shows its richer feedback here). */
  onSaved?: () => void;
  /** Called after an unsave. */
  onRemoved?: () => void;
  /** Toast "Saved ♡" after a save (cards); the event page has its own feedback. */
  toastOnSave?: boolean;
};

/**
 * One save/unsave behaviour for every heart (D-092): device list, server sync for opted-in
 * people, analytics, haptics and the "Removed" toast.
 */
export function useSaveToggle(show: Omit<SavedShow, "savedAt">, opts: Options = {}) {
  const saved = useDeviceList(SAVED);
  const toast = useToast();
  const on = saved.ready && saved.has(show.id);
  const { onSaved, onRemoved, toastOnSave } = opts;

  const toggle = useCallback(() => {
    const at = new Date().toISOString();
    if (on) {
      saved.remove(show.id);
      noteUnsave(show.id, at);
      haptic("tap");
      toast.show(SAVE_COPY.removed);
      onRemoved?.();
      return;
    }
    saved.add({ ...show, savedAt: at });
    noteSave(show.id, at);
    track("save", { eventId: show.id });
    haptic("success");
    if (toastOnSave) toast.show(SAVE_COPY.savedToast);
    onSaved?.();
  }, [on, saved, show, toast, onSaved, onRemoved, toastOnSave]);

  return { on, toggle };
}

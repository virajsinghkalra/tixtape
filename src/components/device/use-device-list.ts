"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
  hasItem,
  parseList,
  readList,
  withItem,
  withoutItem,
  writeList,
  type DeviceStorage,
  type ListSpec,
} from "./device-lists";

/** Same-tab updates; the `storage` event covers other tabs. */
const CHANGE_EVENT = "tixtape:device-list";

function storage(): DeviceStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The raw string is the snapshot: stable between changes, so React doesn't loop. */
function rawSnapshot(key: string): string {
  try {
    return storage()?.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export type DeviceList<T> = {
  items: T[];
  /** False during server render and hydration: render nothing device-specific until then. */
  ready: boolean;
  has: (id: string) => boolean;
  add: (item: T) => void;
  remove: (id: string) => void;
};

/** A localStorage list shared live by every component that reads it (UX #12). */
export function useDeviceList<T>(spec: ListSpec<T>): DeviceList<T> {
  const raw = useSyncExternalStore(
    subscribe,
    () => rawSnapshot(spec.key),
    () => null,
  );
  const items = useMemo(() => (raw === null ? [] : parseList(spec, raw || null)), [raw, spec]);
  const update = useCallback(
    (next: (current: T[]) => T[]) => {
      writeList(spec, next(readList(spec, storage())), storage());
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [spec],
  );
  return {
    items,
    ready: raw !== null,
    has: (id) => hasItem(spec, items, id),
    add: (item) => update((list) => withItem(spec, list, item)),
    remove: (id) => update((list) => withoutItem(spec, list, id)),
  };
}

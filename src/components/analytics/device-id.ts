/**
 * D-090: this browser's device ID, a random UUID in localStorage. Never derived from the device
 * (no fingerprinting): clearing site data gives a new one. Null when storage is blocked.
 */
export const DEVICE_ID_KEY = "tixtape.did";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const local = (): Store | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

export function readDeviceId(storage: Store | undefined = local()): string | null {
  try {
    const id = storage?.getItem(DEVICE_ID_KEY) ?? null;
    return id && UUID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export function deviceId(
  storage: Store | undefined = local(),
  newId: () => string = () => crypto.randomUUID(),
): string | null {
  const existing = readDeviceId(storage);
  if (existing) return existing;
  try {
    if (!storage) return null;
    const id = newId();
    storage.setItem(DEVICE_ID_KEY, id);
    return storage.getItem(DEVICE_ID_KEY) === id ? id : null;
  } catch {
    return null;
  }
}

export function forgetDeviceId(storage: Store | undefined = local()): void {
  try {
    storage?.removeItem(DEVICE_ID_KEY);
  } catch {
    // Blocked storage holds nothing to forget.
  }
}

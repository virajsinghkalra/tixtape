/**
 * D-084 (UX plan #3): pure rules for instant navigation feedback and intent prefetch.
 * The DOM wiring lives in `NavShell.tsx`.
 */

const EVENT_PATH = /^\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The event id when `href` is an in-app event page link, else null. Hash-only links don't count. */
export function eventIdFromHref(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  return EVENT_PATH.exec(url.pathname)?.[1] ?? null;
}

export type ClickInfo = {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  /** The link's `target` attribute. */
  target: string | null;
  download: boolean;
};

/** A plain left click that the app router will handle in this tab. */
export function isPlainClick(c: ClickInfo): boolean {
  return (
    c.button === 0 &&
    !c.metaKey &&
    !c.ctrlKey &&
    !c.shiftKey &&
    !c.altKey &&
    !c.download &&
    (c.target === null || c.target === "" || c.target === "_self")
  );
}

/** The shell is for a new page only: not the page we're on (same path, maybe another hash). */
export function isNewPage(href: string, current: { origin: string; pathname: string }): boolean {
  try {
    return new URL(href, current.origin).pathname !== current.pathname;
  } catch {
    return false;
  }
}

export type ConnectionInfo = { saveData?: boolean; effectiveType?: string } | undefined;

/** Don't spend a visitor's data or a slow link on guesses. */
export function canPrefetch(connection: ConnectionInfo): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== "2g" && connection.effectiveType !== "slow-2g";
}

/** The card's visible title for the shell: its heading, else the link text, trimmed. */
export function shellTitle(heading: string | null | undefined, text: string | null | undefined) {
  const raw = (heading?.trim() || text?.trim() || "").replace(/\s+/g, " ");
  return raw.length > 80 ? `${raw.slice(0, 79)}…` : raw;
}

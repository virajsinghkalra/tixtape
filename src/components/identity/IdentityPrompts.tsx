"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { CONSENT_TEXT, type ContactSource } from "@/domain/analytics/identity";
import { deviceId } from "../analytics/device-id";
import { Button } from "../ui/Button";
import { cx } from "../ui/cx";
import { haptic } from "../ui/feedback";
import { SPRING } from "../ui/motion";
import { useToast } from "../ui/Toast";
import { hey, ID_COPY } from "./identity-copy";
import {
  emailAsked,
  noteLoad,
  parsePromptState,
  PROMPT_STATE_KEY,
  shouldAskEmail,
  shouldAskNickname,
  type PromptState,
} from "./prompt-rules";
import { VALUE_EVENT } from "./value-moment";

const SESSION_KEY = "tixtape.id.session";
/** The nickname sheet waits for the visitor to settle in; it never greets them at the door. */
const NICKNAME_DWELL_MS = 4_000;
/** Lets the action that earned the ask finish first, incl. its 2.4 s toast (no overlap). */
const EMAIL_DELAY_MS = 2_800;
const FIELD =
  "min-h-11 w-full rounded-field border-2 border-line bg-surface px-3 text-base text-ink focus:border-ink";

function read(): PromptState {
  try {
    return parsePromptState(localStorage.getItem(PROMPT_STATE_KEY));
  } catch {
    return parsePromptState(null);
  }
}

function write(state: PromptState): void {
  try {
    localStorage.setItem(PROMPT_STATE_KEY, JSON.stringify(state));
  } catch {
    // Blocked storage: the prompts just never show.
  }
}

function update(change: (s: PromptState) => PromptState): PromptState {
  const next = change(read());
  write(next);
  return next;
}

async function postIdentity(body: Record<string, unknown>): Promise<boolean> {
  const did = deviceId();
  if (!did) return false;
  try {
    const res = await fetch("/api/me/identity", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ did, ...body }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type Open = { kind: "nickname" } | { kind: "email"; source: ContactSource } | null;

/**
 * D-090: the two opt-in identity sheets, mounted once in the layout. Never on the first visit,
 * never modal and never blocking: a small card at the bottom that the page keeps working
 * behind. See `prompt-rules.ts` for exactly when each may show.
 */
export function IdentityPrompts() {
  const pathname = usePathname();
  const [open, setOpen] = useState<Open>(null);
  const openRef = useRef<Open>(null);
  openRef.current = open;
  const quiet = pathname?.startsWith("/admin") || pathname === "/privacy";
  const quietRef = useRef(quiet);
  quietRef.current = quiet;

  // A page load: count the visit; on a later visit, offer the nickname once, after a dwell.
  useEffect(() => {
    let newSession = false;
    try {
      newSession = !sessionStorage.getItem(SESSION_KEY);
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      return;
    }
    const state = update((s) => noteLoad(s, Date.now(), newSession));
    if (!shouldAskNickname(state)) return;
    const timer = setTimeout(() => {
      if (openRef.current || quietRef.current || !shouldAskNickname(read())) return;
      update((s) => ({ ...s, nickname: "shown" }));
      setOpen({ kind: "nickname" });
    }, NICKNAME_DWELL_MS);
    return () => clearTimeout(timer);
  }, []);

  // A moment of value: maybe "Email me too? ✉️".
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onValue = (e: Event) => {
      const source = (e as CustomEvent<ContactSource>).detail;
      if (openRef.current || !shouldAskEmail(read(), Date.now())) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (openRef.current || !shouldAskEmail(read(), Date.now())) return;
        update((s) => emailAsked(s, Date.now()));
        setOpen({ kind: "email", source });
      }, EMAIL_DELAY_MS);
    };
    window.addEventListener(VALUE_EVENT, onValue);
    return () => {
      window.removeEventListener(VALUE_EVENT, onValue);
      clearTimeout(timer);
    };
  }, []);

  const close = useCallback(() => setOpen(null), []);

  return (
    <AnimatePresence>
      {open?.kind === "nickname" && <NicknameSheet key="nickname" onDone={close} />}
      {open?.kind === "email" && <EmailSheet key="email" source={open.source} onDone={close} />}
    </AnimatePresence>
  );
}

function SheetCard({
  titleId,
  title,
  onDismiss,
  children,
}: {
  titleId: string;
  title: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);
  return (
    <motion.div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-testid="identity-sheet"
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 40 }}
      transition={reduceMotion ? { duration: 0.15 } : SPRING}
      className={cx(
        "fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[65] mx-auto max-w-md",
        "rounded-card border-2 border-night bg-surface p-4 shadow-[4px_5px_0_0_var(--color-night)]",
        "dark:border-line dark:shadow-[4px_5px_0_0_var(--color-violet)]",
      )}
    >
      <h2 id={titleId} className="font-display text-lg font-extrabold">
        {title}
      </h2>
      {children}
    </motion.div>
  );
}

function NicknameSheet({ onDone }: { onDone: () => void }) {
  const titleId = useId();
  const toast = useToast();
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);

  const skip = useCallback(() => {
    update((s) => ({ ...s, nickname: "skipped" }));
    onDone();
  }, [onDone]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const name = nickname.trim();
    if (!name || busy) return;
    setBusy(true);
    if (await postIdentity({ nickname: name })) {
      update((s) => ({ ...s, nickname: "saved" }));
      haptic("success");
      toast.show(hey(name));
      onDone();
    } else {
      setBusy(false);
      toast.show(ID_COPY.failed, "error");
    }
  }

  return (
    <SheetCard titleId={titleId} title={ID_COPY.nicknameTitle} onDismiss={skip}>
      <form onSubmit={save} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor={`${titleId}-nick`}>
          {ID_COPY.nicknameLabel}
        </label>
        <input
          id={`${titleId}-nick`}
          className={FIELD}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder={ID_COPY.nicknameLabel}
          maxLength={30}
          autoComplete="nickname"
          enterKeyHint="done"
        />
        <Button type="submit" disabled={!nickname.trim() || busy}>
          {ID_COPY.save}
        </Button>
      </form>
      <div className="mt-2 flex justify-end">
        <Button variant="ghost" onClick={skip}>
          {ID_COPY.skip}
        </Button>
      </div>
    </SheetCard>
  );
}

function EmailSheet({ source, onDone }: { source: ContactSource; onDone: () => void }) {
  const titleId = useId();
  const toast = useToast();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = consent && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    const body: Record<string, unknown> = { email: email.trim(), consent: true, source };
    if (name.trim()) body.name = name.trim();
    if (await postIdentity(body)) {
      update((s) => ({ ...s, emailSaved: true }));
      haptic("success");
      toast.show(ID_COPY.saved);
      onDone();
    } else {
      setBusy(false);
      toast.show(ID_COPY.failed, "error");
    }
  }

  return (
    <SheetCard titleId={titleId} title={ID_COPY.emailTitle} onDismiss={onDone}>
      <form onSubmit={save} className="mt-3 flex flex-col gap-2">
        <label className="sr-only" htmlFor={`${titleId}-name`}>
          {ID_COPY.nameLabel}
        </label>
        <input
          id={`${titleId}-name`}
          className={FIELD}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={ID_COPY.nameLabel}
          maxLength={60}
          autoComplete="name"
        />
        <label className="sr-only" htmlFor={`${titleId}-email`}>
          {ID_COPY.emailLabel}
        </label>
        <input
          id={`${titleId}-email`}
          type="email"
          inputMode="email"
          className={FIELD}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={ID_COPY.emailLabel}
          maxLength={254}
          autoComplete="email"
          required
        />
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-semibold">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="size-5 shrink-0 accent-[var(--color-violet)]"
          />
          {CONSENT_TEXT}
        </label>
        <div className="mt-1 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onDone}>
            {ID_COPY.notNow}
          </Button>
          <Button type="submit" disabled={!valid || busy}>
            {ID_COPY.save}
          </Button>
        </div>
      </form>
    </SheetCard>
  );
}

/**
 * D-090: when the identity prompts may show. Pure, so the rules are tested without a browser.
 *
 * - **After 2 minutes on the app.** The nickname sheet shows at most once, once the visitor has
 *   been around for 2 minutes since their first visit (owner's call, 2026-11-22). Skip dismisses
 *   it forever; saving a nickname offers the email sheet straight after.
 * - **"Email me too? ✉️"** only right after a moment of value (Ping me, Follow, Remind me, a
 *   playlist landing), never once an email is saved, at most twice ever and 7 days apart.
 */
import { z } from "zod";

export const PROMPT_STATE_KEY = "tixtape.id.v1";
const MIN = 60_000;
const DAY = 86_400_000;
export const VISIT_GAP_MS = 30 * MIN;
/** Time on the app before the nickname sheet may show. */
export const NICKNAME_AFTER_MS = 2 * MIN;
export const EMAIL_COOLDOWN_MS = 7 * DAY;
export const EMAIL_MAX_ASKS = 2;

const PromptStateSchema = z.object({
  firstVisitAt: z.number().nullable(),
  lastSeenAt: z.number().nullable(),
  returning: z.boolean(),
  nickname: z.enum(["shown", "saved", "skipped"]).nullable(),
  emailSaved: z.boolean(),
  emailAsks: z.number().int().min(0),
  emailAskedAt: z.number().nullable(),
});
export type PromptState = z.infer<typeof PromptStateSchema>;

export const FRESH: PromptState = {
  firstVisitAt: null,
  lastSeenAt: null,
  returning: false,
  nickname: null,
  emailSaved: false,
  emailAsks: 0,
  emailAskedAt: null,
};

export function parsePromptState(raw: string | null): PromptState {
  if (!raw) return FRESH;
  try {
    const r = PromptStateSchema.safeParse(JSON.parse(raw));
    return r.success ? r.data : FRESH;
  } catch {
    return FRESH;
  }
}

const istDay = (ms: number) => Math.floor((ms + 330 * MIN) / DAY);

/**
 * Records a page load. `newSession` is true on the first load of a tab session. A load counts
 * as a new visit when it starts a session or comes after 30 min without one.
 */
export function noteLoad(state: PromptState, now: number, newSession: boolean): PromptState {
  if (state.firstVisitAt === null) return { ...state, firstVisitAt: now, lastSeenAt: now };
  const newVisit = newSession || state.lastSeenAt === null || now - state.lastSeenAt > VISIT_GAP_MS;
  const later =
    istDay(now) !== istDay(state.firstVisitAt) || now - state.firstVisitAt > VISIT_GAP_MS;
  return { ...state, lastSeenAt: now, returning: state.returning || (newVisit && later) };
}

export function shouldAskNickname(state: PromptState, now: number): boolean {
  return (
    state.firstVisitAt !== null &&
    now - state.firstVisitAt >= NICKNAME_AFTER_MS &&
    state.nickname === null &&
    !state.emailSaved
  );
}

/** How long to wait from now before the nickname sheet may show (0 once 2 minutes are up). */
export function nicknameWaitMs(state: PromptState, now: number): number {
  return state.firstVisitAt === null
    ? NICKNAME_AFTER_MS
    : Math.max(0, state.firstVisitAt + NICKNAME_AFTER_MS - now);
}

export function shouldAskEmail(state: PromptState, now: number): boolean {
  if (state.emailSaved || state.emailAsks >= EMAIL_MAX_ASKS) return false;
  return state.emailAskedAt === null || now - state.emailAskedAt >= EMAIL_COOLDOWN_MS;
}

/** Showing the email sheet uses one of its asks (closing it without saving is a "not now"). */
export function emailAsked(state: PromptState, now: number): PromptState {
  return { ...state, emailAsks: state.emailAsks + 1, emailAskedAt: now };
}

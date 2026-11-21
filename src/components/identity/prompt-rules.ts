/**
 * D-090: when the identity prompts may show. Pure, so the rules are tested without a browser.
 *
 * - **Never on the first visit.** The nickname sheet shows at most once, on a later visit: a
 *   new visit (a new tab session, or back after 30 min idle) that starts on a different IST day
 *   or more than 30 min after the first one. Skip dismisses it forever.
 * - **"Email me too? ✉️"** only right after a moment of value (Ping me, Follow, Remind me, a
 *   playlist landing), never once an email is saved, at most twice ever and 7 days apart.
 */
import { z } from "zod";

export const PROMPT_STATE_KEY = "tixtape.id.v1";
const MIN = 60_000;
const DAY = 86_400_000;
export const VISIT_GAP_MS = 30 * MIN;
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

export function shouldAskNickname(state: PromptState): boolean {
  return state.returning && state.nickname === null && !state.emailSaved;
}

export function shouldAskEmail(state: PromptState, now: number): boolean {
  if (state.emailSaved || state.emailAsks >= EMAIL_MAX_ASKS) return false;
  return state.emailAskedAt === null || now - state.emailAskedAt >= EMAIL_COOLDOWN_MS;
}

/** Showing the email sheet uses one of its asks (closing it without saving is a "not now"). */
export function emailAsked(state: PromptState, now: number): PromptState {
  return { ...state, emailAsks: state.emailAsks + 1, emailAskedAt: now };
}

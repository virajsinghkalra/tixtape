/**
 * D-090: the opt-in identity layer. A nickname (asked once, after 2 minutes on the app) and, at moments
 * of value, an email with explicit consent. Both are personal data (DPDP Act 2023): they are
 * validated here, stored on `people`, never logged and never returned by a public API.
 */
import { z } from "zod";

/** Shown next to the unticked checkbox. Changing the words means a new version. */
export const CONSENT_TEXT = "Email me about gigs. Unsubscribe anytime.";
export const CONSENT_VERSION = "2026-11-22.v1";

/** Where the email ask was shown. */
export const CONTACT_SOURCES = ["ping_me", "follow", "remind", "playlist", "welcome"] as const;
export type ContactSource = (typeof CONTACT_SOURCES)[number];

/** Lower-cased and trimmed. Gmail dots and plus-tags are kept: they're the person's choice. */
export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Letters, marks, numbers, emoji, spaces and . ' _ - only; no links, no markup. */
const NAME_CHARS = /^[\p{L}\p{M}\p{N}\p{Extended_Pictographic}‍️ .'_-]+$/u;

const displayName = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(1)
        .max(max)
        .regex(NAME_CHARS)
        .refine((s) => !/(https?:|www\.|\.(com|in|net|org)\b)/i.test(s), "no links"),
    );

export const NicknameSchema = displayName(30);
export const PersonNameSchema = displayName(60);

export const EmailSchema = z.string().max(254).transform(normaliseEmail).pipe(z.email());

export type Contact = {
  email: string;
  personName: string | null;
  source: ContactSource;
  consentVersion: string;
};

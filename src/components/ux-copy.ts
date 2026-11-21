/**
 * Copy for the Features surfaces (UX #2, #7, #10, #11, #12; D-082, D-088): tiny, 2–4 words, no
 * counts or durations, never "no login". Names (artists, cities) are data, not copy.
 */
export const COPY = {
  remind: "Remind me",
  reminded: "Reminded",
  remindAdded: "Added? Nice 🗓️",
  calendarApple: "Apple / Outlook",
  calendarGoogle: "Google Calendar",
  save: "Save",
  saved: "Saved",
  savedToast: "Saved 💾",
  follow: "Follow",
  following: "Following",
  yourGigs: "Your gigs",
  notInIndia: "Not in India yet 🫠",
  checking: "Checking…",
  foundIt: "Found it 🎉",
  pingMe: "Ping me",
  pinged: "On it",
  pingToast: "We'll ping you 🔔",
  soundsLike: "Sounds like this",
  upNext: "Up next",
  openInSpotify: "Open in Spotify",
  openInBrowser: "⋯ → Open in browser",
  recent: "Recent",
  clear: "Clear",
  tonight: "Tonight",
  thisWeekend: "This weekend",
  thisMonth: "This month",
  dismiss: "Dismiss",
} as const;

/** "🎉 Coldplay just landed" (the name is data). */
export const justLanded = (artist: string) => `${artist} just landed`;
/** "In Mumbai". */
export const inCity = (city: string) => `In ${city}`;
/** The typo chip: "Diljit?". */
export const typoChip = (suggestion: string) => `${suggestion}?`;

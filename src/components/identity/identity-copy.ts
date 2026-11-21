/**
 * D-090 copy for the identity prompts and privacy (D-082: tiny, 2–4 words where possible). The
 * nickname title is the owner's exact wording. The consent line is `CONSENT_TEXT`, versioned in
 * the domain, and is not copy to tweak here. Nothing promises an email right away: sending
 * isn't built yet, and the consent covers future updates.
 */
export const ID_COPY = {
  nicknameTitle: "What should we call you? 👋",
  nicknameLabel: "Nickname",
  emailTitle: "Email me too? ✉️",
  nameLabel: "Name",
  emailLabel: "Email",
  save: "Save",
  skip: "Skip",
  notNow: "Not now",
  saved: "Saved ✉️",
  failed: "Couldn't save. Retry?",
  privacy: "Privacy",
  deleteData: "Delete my data",
  deleteSure: "Sure? Tap again",
  deleted: "Deleted 🧹",
  deleteFailed: "Didn't work. Retry?",
} as const;

/** "Hey Vee 👋" (the nickname is data). */
export const hey = (nickname: string) => `Hey ${nickname} 👋`;

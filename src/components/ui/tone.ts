/** The loud block colours. Each pairs a background with a text colour that passes AA. */
export const TONES = ["lime", "pink", "violet", "orange", "sky", "night", "surface"] as const;
export type Tone = (typeof TONES)[number];

export const TONE_CLASS: Record<Tone, string> = {
  lime: "bg-lime text-on-block",
  pink: "bg-pink text-on-block",
  violet: "bg-violet text-white",
  orange: "bg-orange text-on-block",
  sky: "bg-sky text-on-block",
  night: "bg-night text-white",
  surface: "bg-surface text-ink",
};

/** Block tones only (no neutrals): what events and story slides are painted with. */
export const BLOCK_TONES = ["lime", "pink", "violet", "orange", "sky"] as const satisfies Tone[];
export type BlockTone = (typeof BLOCK_TONES)[number];

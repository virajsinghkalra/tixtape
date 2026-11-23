/**
 * Copy that matches the music (user feedback, 23 Nov: "everywhere it says all night"). Each show
 * gets a vibe from its genre, and each line is picked from that vibe's pool by the event id, so
 * the same show always reads the same (server and client agree) while different shows vary.
 *
 * Voice: short, confident Gen Z English. No Hinglish (user feedback, 23 Nov). A tagline is never
 * glued onto an artist's name: it renders as its own element (a chip or a line of its own).
 */
export type Vibe =
  | "edm"
  | "bollywood"
  | "punjabi"
  | "sufi"
  | "indie"
  | "rock"
  | "hiphop"
  | "pop"
  | "kpop"
  | "fusion"
  | "festival"
  | "default";

/** Most specific first: "punjabi sufi" is sufi, "bollywood, punjabi, edm" (a fest) is festival. */
const RULES: [RegExp, Vibe][] = [
  [/k-?pop/u, "kpop"],
  [/sufi|qawwali/u, "sufi"],
  [/punjabi|bhangra/u, "punjabi"],
  [/hip ?hop|rap/u, "hiphop"],
  [/edm|electronic|techno|house|dance/u, "edm"],
  [/bollywood|filmi/u, "bollywood"],
  [/rock|metal/u, "rock"],
  [/indie/u, "indie"],
  [/fusion|world|jazz|classical/u, "fusion"],
  [/pop|r&b/u, "pop"],
];

export function vibeOf(genre: string | null | undefined, type?: string | null): Vibe {
  if (type === "festival") return "festival";
  const g = (genre ?? "").toLowerCase();
  return RULES.find(([re]) => re.test(g))?.[1] ?? "default";
}

/** A stable pick: the same seed and salt always land on the same line. */
export function pick<T>(pool: readonly T[], seed: string, salt = ""): T {
  let h = 2166136261;
  for (const ch of seed + salt) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return pool[(h >>> 0) % pool.length]!;
}

type VibeCopy = {
  emoji: string;
  /** The genre chip ("⚡ EDM"); null shows no chip. */
  label: string | null;
  /** A solo show's tagline, shown on its own line under the name. */
  tagline: readonly string[];
  /** The story's last slide for a multi-act show. */
  headline: readonly string[];
  /** The ready playlist's status line. */
  live: string;
  /** Above the "Listen now" links while the playlist is being made. */
  cooking: readonly string[];
  /** The back-from-Spotify share card. Titles stay one line at 360px (≤ 30 chars). */
  shareTitle: readonly string[];
  shareText: readonly string[];
};

const COPY: Record<Vibe, VibeCopy> = {
  edm: {
    emoji: "⚡",
    label: "EDM",
    tagline: ["Know every drop first", "Bass you'll feel", "Peak-time energy", "Lights. Bass. Go."],
    headline: [
      "Every drop. One playlist.",
      "Learn the drops. Own the night.",
      "Bass loaded. Hit play.",
    ],
    live: "Drops are live ⚡",
    cooking: ["Drops loading ⚡ till then 👇", "Bass warming up 🔊 till then 👇"],
    shareTitle: ["Your squad needs these drops", "Send the drops to the squad ⚡"],
    shareText: ["pre-game with this ⚡", "learn the drops before we go 🔊"],
  },
  bollywood: {
    emoji: "🎤",
    label: "Bollywood",
    tagline: [
      "Every hit, word for word",
      "Goosebumps guaranteed",
      "The hits you grew up on",
      "Sing louder than the crowd",
    ],
    headline: ["Every hit. One playlist.", "Learn every word. Sing louder."],
    live: "Hits are live 🎤",
    cooking: ["Hits loading 🎤 till then 👇", "Sing-along loading 🎶 till then 👇"],
    shareTitle: ["Tag your sing-along squad 🎤", "Send it to your karaoke crew"],
    shareText: ["learn every word before the show 🎤", "sing-along prep 🎶"],
  },
  punjabi: {
    emoji: "🥁",
    label: "Punjabi",
    tagline: [
      "Pure Punjabi energy",
      "Turn it all the way up",
      "Dance-floor ready",
      "Hit after hit",
    ],
    headline: ["Every banger. One playlist.", "Turn it up. Hit play."],
    live: "Bangers are live 🥁",
    cooking: ["Bangers loading 🥁 till then 👇", "Beat drops soon 🥁 till then 👇"],
    shareTitle: ["Your dance crew needs this 🥁", "Send it to the dance crew"],
    shareText: ["warm up with this 🥁", "full Punjabi energy 🥁"],
  },
  sufi: {
    emoji: "🕊️",
    label: "Sufi",
    tagline: ["Soul-deep, live", "Music that stays with you", "Close your eyes. Feel it."],
    headline: ["Soul-deep. One playlist.", "Feel it first. Hit play."],
    live: "Soul mode is live 🕊️",
    cooking: ["Soul mode loading 🕊️ till then 👇"],
    shareTitle: ["Share the calm 🕊️", "Someone needs this calm"],
    shareText: ["soul-deep playlist 🕊️", "feel this before the show 🕊️"],
  },
  indie: {
    emoji: "🎸",
    label: "Indie",
    tagline: ["Up close", "Small-room magic", "Know every lyric", "Songs that hit different"],
    headline: ["Every song. One playlist.", "Know the words. Be front row."],
    live: "Setlist's live 🎸",
    cooking: ["Tuning up 🎸 till then 👇", "Strings on 🎸 till then 👇"],
    shareTitle: ["Send it to your gig buddy 🎸", "Your indie friend needs this"],
    shareText: ["learn the words first 🎸", "gig prep 🎸"],
  },
  rock: {
    emoji: "🤘",
    label: "Rock",
    tagline: ["Loud and live", "Riffs on riffs", "Mosh-ready", "Turn it up"],
    headline: ["Every riff. One playlist.", "Turn it up. Hit play."],
    live: "Amps on, it's live 🤘",
    cooking: ["Amps warming up 🤘 till then 👇"],
    shareTitle: ["Mosh crew needs this 🤘", "Send it to the rock crew"],
    shareText: ["turn it up 🤘", "gig prep, loud 🤘"],
  },
  hiphop: {
    emoji: "🔥",
    label: "Hip hop",
    tagline: ["Bars on bars", "All bangers", "Know every verse", "Turn up, live"],
    headline: ["Every banger. One playlist.", "Bars loaded. Hit play."],
    live: "Bars are live 🔥",
    cooking: ["Beat's cooking 🔥 till then 👇", "Bars loading 🎤 till then 👇"],
    shareTitle: ["Crew needs these bars 🔥", "Send it to the crew"],
    shareText: ["bars before the show 🔥", "bangers only 🔥"],
  },
  pop: {
    emoji: "💖",
    label: "Pop",
    tagline: ["Every chorus, live", "Sing it back", "Hits only", "Main-character night"],
    headline: ["Every chorus. One playlist.", "Hits only. Hit play."],
    live: "Choruses are live 💖",
    cooking: ["Chorus loading 💖 till then 👇"],
    shareTitle: ["Group chat needs this 💖", "Send it to your bestie"],
    shareText: ["learn every chorus 💖", "hits before the show 💖"],
  },
  kpop: {
    emoji: "💜",
    label: "K-pop",
    tagline: ["Lightsticks up", "Fanchant ready", "Every era, live"],
    headline: ["Every era. One playlist.", "Lightsticks up. Hit play."],
    live: "The era is live 💜",
    cooking: ["Lightsticks charging 💜 till then 👇"],
    shareTitle: ["Send it to your bias crew 💜", "The fandom needs this 💜"],
    shareText: ["fanchant prep 💜", "lightsticks up 💜"],
  },
  fusion: {
    emoji: "🌍",
    label: "World fusion",
    tagline: ["Worlds collide, live", "Rare and live", "Sounds from everywhere"],
    headline: ["Every sound. One playlist.", "Worlds collide. Hit play."],
    live: "Live on Spotify 🌍",
    cooking: ["Tuning up 🌍 till then 👇"],
    shareTitle: ["Send it to the music nerds 🌍", "Share this rare one"],
    shareText: ["rare live one 🌍", "listen before you go 🌍"],
  },
  festival: {
    emoji: "🎪",
    // The card already wears a "🎪 Festival" sticker: no second chip.
    label: null,
    tagline: ["Fest mode on", "All day, all vibes"],
    headline: ["Every act. One playlist.", "The whole lineup, one tap.", "Fest mode: on."],
    live: "Lineup's live 🎪",
    cooking: ["Lineup loading 🎪 till then 👇", "Fest mix cooking 🍳 till then 👇"],
    shareTitle: ["Fest squad needs this 🎪", "Send it to the fest squad"],
    shareText: ["fest prep playlist 🎪", "the whole lineup 🎪"],
  },
  default: {
    emoji: "🎧",
    label: null,
    tagline: ["One night only", "Front-row energy", "Be there"],
    headline: ["Every act. One playlist.", "Hit play before the show."],
    live: "Live on Spotify 🎉",
    cooking: ["Playlist's cooking 🍳 till then 👇"],
    shareTitle: ["Send it to the squad 🎧"],
    shareText: ["found this gig's playlist 🎧"],
  },
};

export function vibeEmoji(vibe: Vibe): string {
  return COPY[vibe].emoji;
}

/** "⚡ EDM" for the genre chip, or null (no chip). */
export function vibeTag(vibe: Vibe): { emoji: string; label: string } | null {
  const { emoji, label } = COPY[vibe];
  return label ? { emoji, label } : null;
}

/** A solo show's tagline, rendered on its own (never appended to the name). */
export function tagline(vibe: Vibe, seed: string): string {
  return pick(COPY[vibe].tagline, seed, "tagline");
}

export function vibeHeadline(vibe: Vibe, seed: string): string {
  return pick(COPY[vibe].headline, seed, "headline");
}

export function liveLine(vibe: Vibe): string {
  return COPY[vibe].live;
}

export function cookingLine(vibe: Vibe, seed: string): string {
  return pick(COPY[vibe].cooking, seed, "cooking");
}

export function shareCopy(vibe: Vibe, seed: string): { title: string; text: string } {
  return {
    title: pick(COPY[vibe].shareTitle, seed, "share"),
    text: pick(COPY[vibe].shareText, seed, "share"),
  };
}

export const VIBES = Object.keys(COPY) as Vibe[];

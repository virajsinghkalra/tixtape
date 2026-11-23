/**
 * Copy that matches the music (user feedback, 23 Nov: "everywhere it says all night"). Each show
 * gets a vibe from its genre, and each line is picked from that vibe's pool by the event id, so
 * the same show always reads the same (server and client agree) while different shows vary.
 * Tiny Gen Z copy only (D-082).
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
  /** The ready playlist's status line. */
  live: string;
  emoji: string;
  /** After a solo artist's name: "Martin Garrix, drop after drop". */
  solo: readonly string[];
  /** The story's last slide for a multi-act show. */
  headline: readonly string[];
  /** Above the "Listen now" links while the playlist is being made. */
  cooking: readonly string[];
  /** The back-from-Spotify share card. */
  shareTitle: readonly string[];
  shareText: readonly string[];
};

const COPY: Record<Vibe, VibeCopy> = {
  edm: {
    live: "Drops are live ⚡",
    emoji: "⚡",
    solo: ["drop after drop", "bass till late", "hands in the air", "lights, bass, go"],
    headline: ["Every drop. One playlist.", "Pre-game the drops.", "Bass loaded. Hit play."],
    cooking: ["Drops loading ⚡ till then 👇", "Bass warming up 🔊 till then 👇"],
    shareTitle: ["Squad needs these drops ⚡", "Send the drops to the gang"],
    shareText: ["pre-game playlist ⚡", "drops before the drop 🔊"],
  },
  bollywood: {
    live: "Gaane are live 🎤",
    emoji: "🎤",
    solo: ["every feel, live", "full sing-along", "goosebumps live", "dil se, live"],
    headline: ["Every hit. One playlist.", "Sing-along mode: on.", "Gaane ready hai 🎤"],
    cooking: ["Gaane loading 🎤 till then 👇", "Sing-along loading 🎶 till then 👇"],
    shareTitle: ["Tag your sing-along gang 🎤", "Send it to the gaana gang"],
    shareText: ["sing-along prep 🎤", "gaane ready hai, sun 🎶"],
  },
  punjabi: {
    live: "Dhol's live 🥁",
    emoji: "🥁",
    solo: ["full bhangra mode", "dhol on, live", "Punjabi vibes only"],
    headline: ["Every banger. One playlist.", "Bhangra mode: on.", "Dhol ready? Hit play."],
    cooking: ["Dhol warming up 🥁 till then 👇", "Bhangra loading 🥁 till then 👇"],
    shareTitle: ["Bhangra crew needs this 🥁", "Send it to the dhol gang"],
    shareText: ["full Punjabi vibe 🥁", "bhangra prep, sun le 🥁"],
  },
  sufi: {
    live: "Sukoon's live 🕊️",
    emoji: "🕊️",
    solo: ["pure sukoon, live", "soul on, live", "rooh tak, live"],
    headline: ["Pure sukoon. One playlist.", "Rooh ready? Hit play."],
    cooking: ["Sukoon loading 🕊️ till then 👇"],
    shareTitle: ["Share the sukoon 🕊️", "Send some sukoon over"],
    shareText: ["pure sukoon 🕊️", "rooh wala playlist 🕊️"],
  },
  indie: {
    live: "Setlist's live 🎸",
    emoji: "🎸",
    solo: ["up close", "small-room magic", "every lyric, live", "songs you feel"],
    headline: ["Every song. One playlist.", "Learn the words first."],
    cooking: ["Tuning up 🎸 till then 👇", "Strings on 🎸 till then 👇"],
    shareTitle: ["Send it to your gig buddy 🎸", "Your indie friend needs this"],
    shareText: ["learn the words first 🎸", "gig prep 🎸"],
  },
  rock: {
    live: "Amps on, it's live 🤘",
    emoji: "🤘",
    solo: ["loud and live", "riffs on riffs", "mosh ready", "turn it up"],
    headline: ["Every riff. One playlist.", "Turn it up. Hit play."],
    cooking: ["Amps warming up 🤘 till then 👇"],
    shareTitle: ["Mosh crew needs this 🤘", "Send it to the rock gang"],
    shareText: ["turn it up 🤘", "gig prep, loud 🤘"],
  },
  hiphop: {
    live: "Bars are live 🔥",
    emoji: "🔥",
    solo: ["bars on bars", "beats, live", "all bangers", "turn up, live"],
    headline: ["Every banger. One playlist.", "Bars loaded. Hit play."],
    cooking: ["Beat's cooking 🔥 till then 👇", "Bars loading 🎤 till then 👇"],
    shareTitle: ["Crew needs these bars 🔥", "Send it to the cypher"],
    shareText: ["bars before the show 🔥", "bangers only 🔥"],
  },
  pop: {
    live: "Hits are live 💖",
    emoji: "💖",
    solo: ["every chorus, live", "sing it back", "hits only", "main-character night"],
    headline: ["Every chorus. One playlist.", "Hits only. Hit play."],
    cooking: ["Chorus loading 💖 till then 👇"],
    shareTitle: ["Group chat needs this 💖", "Send it to your bestie"],
    shareText: ["learn every chorus 💖", "hits before the show 💖"],
  },
  kpop: {
    live: "Era's live 💜",
    emoji: "💜",
    solo: ["lightsticks up", "fanchant ready", "bias, live"],
    headline: ["Every era. One playlist.", "Lightsticks up. Hit play."],
    cooking: ["Lightsticks charging 💜 till then 👇"],
    shareTitle: ["Send it to your bias crew 💜", "Fandom needs this 💜"],
    shareText: ["fanchant prep 💜", "lightsticks up 💜"],
  },
  fusion: {
    live: "Live on Spotify 🌍",
    emoji: "🌍",
    solo: ["worlds collide, live", "live and rare", "sounds from everywhere"],
    headline: ["Every sound. One playlist.", "Worlds collide. Hit play."],
    cooking: ["Tuning up 🌍 till then 👇"],
    shareTitle: ["Send it to the music nerds 🌍", "Share this rare one"],
    shareText: ["rare live one 🌍", "listen before you go 🌍"],
  },
  festival: {
    live: "Lineup's live 🎪",
    emoji: "🎪",
    solo: ["fest mode", "all day, all vibes"],
    headline: ["Every act. One playlist.", "The whole lineup, one tap.", "Fest mode: on."],
    cooking: ["Lineup loading 🎪 till then 👇", "Fest mix cooking 🍳 till then 👇"],
    shareTitle: ["Fest squad needs this 🎪", "Send it to the fest gang"],
    shareText: ["fest prep playlist 🎪", "the whole lineup 🎪"],
  },
  default: {
    live: "Live on Spotify 🎉",
    emoji: "🎧",
    solo: ["all night", "live", "one night only", "front row energy"],
    headline: ["Every act. One playlist.", "Hit play before the show."],
    cooking: ["Playlist's cooking 🍳 till then 👇"],
    shareTitle: ["Send it to the gang 🎧"],
    shareText: ["found this gig's playlist 🎧"],
  },
};

export function liveLine(vibe: Vibe): string {
  return COPY[vibe].live;
}

export function vibeEmoji(vibe: Vibe): string {
  return COPY[vibe].emoji;
}

/** "Martin Garrix, drop after drop". */
export function soloLine(name: string, vibe: Vibe, seed: string): string {
  return `${name}, ${pick(COPY[vibe].solo, seed, "solo")}`;
}

export function vibeHeadline(vibe: Vibe, seed: string): string {
  return pick(COPY[vibe].headline, seed, "headline");
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

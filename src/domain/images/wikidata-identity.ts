/**
 * Which Wikidata entity (if any) is this artist? (D-083). Pure. A wrong photo is worse than none,
 * so every rule here refuses rather than guesses.
 */
import { DEFAULT_MATCH_POLICY } from "@/domain/matching/decide";
import { nameVariants } from "@/domain/matching/variants";
import { normalizeArtistName } from "@/domain/shared/normalize";

/** The parts of a Wikidata item the rules read. */
export type WikidataArtist = {
  id: string;
  /** English label first, then aliases. */
  names: readonly string[];
  /** P31 instance of. */
  instanceOf: readonly string[];
  /** P106 occupation. */
  occupations: readonly string[];
  /** P136 genre. */
  genres: readonly string[];
  /** P18 image file name on Commons. */
  image: string | null;
  /** P1902 Spotify artist ID. */
  spotifyIds: readonly string[];
  /** P434 MusicBrainz artist ID. */
  mbids: readonly string[];
  enwikiTitle: string | null;
};

const HUMAN = "Q5";
/** Musical group types (verified labels on Wikidata, 2026-11-22). */
const MUSICAL_GROUPS = new Set([
  "Q215380", // musical group
  "Q5741069", // rock band
  "Q9212979", // musical duo
  "Q281643", // musical trio
  "Q2088357", // musical ensemble
  "Q56816954", // heavy metal band
]);
/** Music occupations (verified labels). "Performing artist" is left out: it covers actors. */
const MUSIC_OCCUPATIONS = new Set([
  "Q177220", // singer
  "Q2643890", // vocalist
  "Q639669", // musician
  "Q55960555", // recording artist
  "Q130857", // disc jockey
  "Q2252262", // rapper
  "Q36834", // composer
  "Q1415090", // film score composer
  "Q183945", // record producer
  "Q753110", // songwriter
  "Q488205", // singer-songwriter
  "Q855091", // guitarist
  "Q6168364", // jazz guitarist
  "Q386854", // drummer
  "Q4351403", // percussionist
  "Q486748", // pianist
  "Q1075651", // keyboardist
  "Q584301", // bassist
  "Q12800682", // saxophonist
  "Q1259917", // violinist
  "Q9648008", // banjoist
  "Q1327329", // multi-instrumentalist
  "Q15981151", // jazz musician
  "Q806349", // bandleader
  "Q158852", // conductor
  "Q1198887", // music director
  "Q1643514", // music arranger
]);

export type ArtistIdentity = { entity: WikidataArtist; confidence: number; evidence: string[] };

export type IdentitySubject = { name: string; spotifyId: string | null; mbid: string | null };

function isMusicAct(e: WikidataArtist): boolean {
  if (e.instanceOf.some((t) => MUSICAL_GROUPS.has(t))) return true;
  return e.instanceOf.includes(HUMAN) && e.occupations.some((o) => MUSIC_OCCUPATIONS.has(o));
}

function nameKeys(name: string): Set<string> {
  const keys = nameVariants(name)
    .filter((v) => v.kind !== "collab_part")
    .map((v) => normalizeArtistName(v.name));
  return new Set(keys.filter((k) => k !== ""));
}

/** "Salim & Sulaiman", "Salim-Sulaiman" and "Salim and Sulaiman" are one duo name. */
const withoutJoiners = (key: string) => key.replace(/ and /gu, " ");

function namesMatch(e: WikidataArtist, keys: ReadonlySet<string>): boolean {
  const names = e.names.map(normalizeArtistName);
  if (names.some((n) => keys.has(n))) return true;
  // Joiner-insensitive only for groups: a person's name never loses a word this way.
  if (!e.instanceOf.some((t) => MUSICAL_GROUPS.has(t))) return false;
  const loose = new Set([...keys].map(withoutJoiners));
  return names.some((n) => loose.has(withoutJoiners(n)));
}

function isAmbiguous(name: string): boolean {
  const key = normalizeArtistName(name);
  if ([...key.replace(/ /gu, "")].length <= DEFAULT_MATCH_POLICY.shortNameMaxLength) return true;
  return DEFAULT_MATCH_POLICY.ambiguousNames.some((n) => normalizeArtistName(n) === key);
}

/** An entity linked to a different Spotify or MusicBrainz artist is someone else. */
function contradicts(e: WikidataArtist, s: IdentitySubject): string | null {
  if (s.spotifyId && e.spotifyIds.length > 0 && !e.spotifyIds.includes(s.spotifyId)) {
    return "linked to a different Spotify artist";
  }
  if (s.mbid && e.mbids.length > 0 && !e.mbids.includes(s.mbid)) {
    return "linked to a different MusicBrainz artist";
  }
  return null;
}

/**
 * The entity for this artist, or null.
 * 1. An entity whose P1902 equals our Spotify ID (or P434 our MBID) is the artist: confidence 1.
 * 2. Otherwise exactly one music act whose label or alias matches the name, and which isn't
 *    linked to a different Spotify/MusicBrainz artist: confidence 0.8. Two or more: ambiguous.
 * 3. Short or common names ("Felix", "Mali") need rule 1.
 */
export function identifyArtist(
  subject: IdentitySubject,
  entities: readonly WikidataArtist[],
): ArtistIdentity | null {
  const linked = entities.find(
    (e) =>
      (subject.spotifyId !== null && e.spotifyIds.includes(subject.spotifyId)) ||
      (subject.mbid !== null && e.mbids.includes(subject.mbid)),
  );
  if (linked) {
    const via =
      subject.spotifyId && linked.spotifyIds.includes(subject.spotifyId)
        ? "P1902 Spotify ID"
        : "P434 MusicBrainz ID";
    return { entity: linked, confidence: 1, evidence: [`${linked.id}: ${via} matches`] };
  }
  if (isAmbiguous(subject.name)) return null;
  const keys = nameKeys(subject.name);
  const acts = entities.filter(
    (e) => isMusicAct(e) && namesMatch(e, keys) && contradicts(e, subject) === null,
  );
  if (acts.length !== 1 || !acts[0]) return null;
  const entity = acts[0];
  return {
    entity,
    confidence: 0.8,
    evidence: [`${entity.id}: the only music act named "${subject.name}"`],
  };
}

import { BLOCK_TONES, type BlockTone } from "./ui/tone";

/** A stable FNV-1a hash, so an event always gets the same colour on its card and page. */
function hash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Events rarely have images, so each one owns a loud block colour instead. */
export function eventTone(id: string): BlockTone {
  return BLOCK_TONES[hash(id) % BLOCK_TONES.length]!;
}

/** Story slides cycle through the other tones, starting after the event's own colour. */
export function toneSequence(id: string, count: number): BlockTone[] {
  const start = BLOCK_TONES.indexOf(eventTone(id));
  return Array.from({ length: count }, (_, i) => BLOCK_TONES[(start + i) % BLOCK_TONES.length]!);
}

// The one place L3 turns ids into numbers (NFR26, FR65). A draw is a pure
// function of an id and named salts: integer arithmetic only, no clock, no
// `Math.random`. Two clients given the same inputs draw the same value.

/** One salt per feature, so no two features share a stream. The gait phase is
 * the unsalted base stream. */
export const SALTS = {
  flavour: 1,
  flavourStart: 2,
  flavourOffset: 3,
  glanceFacing: 4,
  idlePhase: 5,
} as const;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function avalanche(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A u32 from an id (FNV-1a, then an avalanche so one differing character
 * lands far apart) and any number of integer salts, each folded in and
 * avalanched in turn. */
export function seedOf(id: string, ...salts: number[]): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  h = avalanche(h);
  for (const salt of salts) {
    h = avalanche(Math.imul(h ^ (salt >>> 0), FNV_PRIME) >>> 0);
  }
  return h;
}

/** `seedOf` as a value in [0, 1). */
export function unitOf(id: string, ...salts: number[]): number {
  return seedOf(id, ...salts) / 0x1_0000_0000;
}

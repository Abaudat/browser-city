// Appearance tuples picked deterministically from the committed `Defs`:
// the local player's own look, and the one picker (`tupleFor`) every
// harness body is dressed with. Every field comes from each part's own
// `civilian` pool, matching the one constraint `sim::appearance::generate`
// itself enforces (a `role_only` or `costume` part can never reach an
// ordinary citizen). Each field is picked by hashing `(index, a
// field-specific salt)` through a small deterministic mix, never `Math.
// random`: no two fields cycle in lockstep and no field repeats on a
// visible period. `accessory_none_chance` and `hair_rare_chance`
// (`defs/balance/citizen.toml`) are applied the way `generate()` applies
// them, so the rates match what the real generator would produce; the
// generator's exact distribution is pinned by `appearance_v2.golden`.

import type { Defs, Family, HairstyleDef } from "../../defs/types";
import type { AppearanceTuple } from "./composite";

/** The index the local player's own tuple is picked at: a row no harness
 * crowd uses, so the player never shares a texture with a body beside it. */
export const PLAYER_LOOK_INDEX = 42;

// A small, fixed integer hash (a splitmix32 finalizer).
function hash32(seed: number): number {
  let z = (seed + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  return (z ^ (z >>> 15)) >>> 0;
}

/** A reproducible float in `[0, 1)` for `(index, salt)`. */
function hashUnit(index: number, salt: number): number {
  return hash32(index * 2654435761 + salt) / 0x1_0000_0000;
}

/** Picks one element of `list` for `(index, salt)`, or `undefined` for an
 * empty list. */
function pickByHash<T>(list: readonly T[], index: number, salt: number): T | undefined {
  if (list.length === 0) return undefined;
  return list[hash32(index * 2654435761 + salt) % list.length];
}

const SALT_BODY = 0x1000;
const SALT_EYES = 0x2000;
const SALT_OUTFIT = 0x3000;
const SALT_HAIR_RARE_ROLL = 0x4000;
const SALT_HAIR_PICK = 0x5000;
const SALT_ACCESSORY_NONE_ROLL = 0x6000;
const SALT_ACCESSORY_PICK = 0x7000;

function civilianOf<T extends { readonly family: Family; readonly pool: string }>(
  defs: readonly T[],
  family: Family,
): readonly T[] {
  return defs.filter((d) => d.family === family && d.pool === "civilian");
}

function balanceValue(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`player-look: no balance entry for '${key}'`);
  return entry.value;
}

/** Mirrors `sim::appearance::pick_hairstyle`'s own rule: a
 * `hairRareChancePercent` chance of drawing from the family's `rare`
 * pool instead of its natural one, falling back to whichever pool is
 * non-empty if the family has none of the wanted kind. */
function pickHairstyleId(
  defs: Defs,
  family: Family,
  index: number,
  hairRareChancePercent: number,
): number {
  const rare: HairstyleDef[] = [];
  const common: HairstyleDef[] = [];
  for (const h of defs.hairstyles) {
    if (h.family !== family) continue;
    (h.rare ? rare : common).push(h);
  }
  const wantRare = hashUnit(index, SALT_HAIR_RARE_ROLL) * 100 < hairRareChancePercent;
  const pool = wantRare && rare.length > 0 ? rare : common.length > 0 ? common : rare;
  return pickByHash(pool, index, SALT_HAIR_PICK)?.id ?? 0;
}

/** Mirrors `sim::appearance::pick_accessory`'s own rule: kids never carry
 * one, and an adult has `accessoryNoneChancePercent` chance of carrying
 * none either. */
function pickAccessoryId(
  defs: Defs,
  family: Family,
  index: number,
  accessoryNoneChancePercent: number,
): number {
  if (family === "kid") return 0;
  if (hashUnit(index, SALT_ACCESSORY_NONE_ROLL) * 100 < accessoryNoneChancePercent) return 0;
  return pickByHash(civilianOf(defs.accessories, family), index, SALT_ACCESSORY_PICK)?.id ?? 0;
}

/** A tuple for `index` within its own family. */
export function tupleFor(defs: Defs, family: Family, index: number): AppearanceTuple {
  const bodies = civilianOf(defs.bodies, family);
  const eyes = civilianOf(defs.eyes, family);
  const outfits = civilianOf(defs.outfits, family);
  if (bodies.length === 0 || eyes.length === 0 || outfits.length === 0) {
    throw new Error(`player-look: no civilian ${family} body/eyes/outfit in the committed defs`);
  }
  const hairRareChance = balanceValue(defs, "citizen.appearance.hair_rare_chance");
  const accessoryNoneChance = balanceValue(defs, "citizen.appearance.accessory_none_chance");
  return {
    body: pickByHash(bodies, index, SALT_BODY)?.id ?? 0,
    eyes: pickByHash(eyes, index, SALT_EYES)?.id ?? 0,
    outfit: pickByHash(outfits, index, SALT_OUTFIT)?.id ?? 0,
    hairstyle: pickHairstyleId(defs, family, index, hairRareChance),
    accessory: pickAccessoryId(defs, family, index, accessoryNoneChance),
  };
}

/** The local player's own appearance: a real generated tuple through the
 * same pipeline every other body uses. */
export function buildPlayerAppearanceTuple(defs: Defs): AppearanceTuple {
  return tupleFor(defs, "adult", PLAYER_LOOK_INDEX);
}

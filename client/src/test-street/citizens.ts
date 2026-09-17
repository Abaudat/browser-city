// Story 1.10 (AC5, FR61/FR62): a fixed, deterministic street crowd for
// the street scene, proving the real appearance pipeline end to end --
// separate from `fixture.ts`'s own collision-tested world (a crowd this
// size needs more pavement than the existing, heavily-tested story
// 1.6-1.9 fixture has room for, and reshaping that shared fixture risks
// moving `render-order.spec.ts`/`movement.spec.ts`/`enclosure.spec.ts`/
// `intents.spec.ts`'s own committed goldens for a purely decorative
// change; this crowd is a second, additive layer in its own pavement
// strip instead, never part of the depth-sorted pool those specs assert
// against). Pure data plus one pure builder, zero PixiJS: `citizens-layer.
// ts` is the only adapter that turns this into sprites.
//
// Every tuple is derived here, in TypeScript, straight from the real
// committed `Defs` document -- `body`/`eyes`/`outfit`/`accessory` only
// ever come from each part's own `civilian` pool, matching the one
// constraint `sim::appearance::generate` itself enforces (a `role_only`
// or `costume` part can never reach an ordinary citizen). Each field is
// picked by hashing `(citizen index, a field-specific salt)` through a
// small deterministic mix (`hash32`), not by any single shared stride --
// no two fields ever cycle in lockstep, and no field on its own repeats a
// visible period. `accessory_none_chance` and `hair_rare_chance` (`defs/
// balance/citizen.toml`) are applied the same way `generate()` applies
// them, so the crowd's own accessory/dye-hair rate matches what the real
// generator would produce, even though this is a hash, not `sim::rng`'s
// own algorithm: the generator's exact distribution is already pinned by
// `appearance_v2.golden` and its property tests, so this module only
// needs to *not misrepresent* it, never to reproduce it bit for bit.

import type { Defs, Family, HairstyleDef } from "../defs/types";
import type { AppearanceTuple } from "../render/appearance/composite";

export interface CitizenFixture {
  readonly id: string;
  readonly tuple: AppearanceTuple;
  /** FR62: resolved through `resolveUniform` at mount time, never stored
   * here. */
  readonly professionKey?: string;
  readonly gridX: number;
  readonly gridY: number;
  /** Which of the four idle-row directions this citizen faces at rest --
   * a scattered crowd where everyone stares at the camera reads as a
   * class photo, not a street. */
  readonly facing: string;
}

/** How many of the adult slots this fixture set carries in a
 * sanitation-worker uniform -- `defs/appearance/uniforms.toml` declares
 * exactly one profession override today. Spread across both the reserved
 * and the scattered slots (never the first N adults in a row) so the
 * uniformed citizens read as mixed into the crowd, not clustered. Never
 * indices 0-2: those three share one tuple with no override (AC5's own
 * proof), and a uniform override on only one of them would key it into a
 * different composite than the other two despite the identical tuple. */
const SANITATION_WORKER_INDICES: ReadonlySet<number> = new Set([7, 15, 24, 33]);
const ADULT_COUNT = 40;
const KID_COUNT = 6;

/** Where the crowd's own pavement strip starts, in world cells -- well
 * south of `fixture.ts`'s own world (its boundary ring closes at
 * `y = 10`), so the crowd never overlaps a wall, a prop or the void
 * outside either. */
export const PLAZA_X0 = 0;
export const PLAZA_Y0 = 16;

/** The strip's own footprint, in local cells relative to `PLAZA_X0`/
 * `PLAZA_Y0` -- wide and deep enough that seeded rejection sampling
 * spreads `ADULT_COUNT + KID_COUNT` citizens across the *whole* strip
 * with real gaps between them, never a visible row, column or lattice. */
const STRIP_WIDTH = 22;
const STRIP_DEPTH = 11;
const MIN_SPACING = 1;

// A small, fixed integer hash (a splitmix32 finalizer) -- deterministic
// and exactly reproducible from one run to the next, with none of a
// linear stride's or a low-discrepancy sequence's own visible periodicity
// or lattice structure. Every "pick field X for citizen index I" call
// below hashes `(index, a field-specific salt)` through this, so distinct
// fields never move in lockstep and the same field never repeats on a
// visible period.
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
 * empty list -- mirrors `sim::appearance::pick_uniform`'s own "uniform
 * over a non-empty slice, `None` for an empty one" contract. */
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
const SALT_FACING = 0x8000;
const SALT_SCATTER_X = 0x9000;
const SALT_SCATTER_Y = 0xa000;

const FACINGS: readonly string[] = ["down", "up", "left", "right"];

function facingFor(index: number): string {
  return pickByHash(FACINGS, index, SALT_FACING) ?? "down";
}

/** A citizen who stands still, one tile beside `kid-0` on the identical
 * foot line -- the pairing the close-crop screenshot needs -- and the
 * three "two citizens talking" vignettes: each pair one tile apart, on
 * the same row, facing each other. Every other adult/kid is scattered
 * instead (see `place`). Indices are into the adult/kid sequence `0..
 * ADULT_COUNT`/`0..KID_COUNT`, not into any def id. */
interface ReservedSlot {
  readonly x: number;
  readonly y: number;
  readonly facing: string;
}

const RESERVED_ADULT_SLOTS: ReadonlyMap<number, ReservedSlot> = new Map([
  [0, { x: 1, y: 2, facing: "down" }], // beside kid-0, same foot line
  [1, { x: 10, y: 3, facing: "right" }], // talking pair A
  [2, { x: 11, y: 3, facing: "left" }],
  [3, { x: 16, y: 6, facing: "right" }], // talking pair B
  [4, { x: 17, y: 6, facing: "left" }],
  [5, { x: 6, y: 8, facing: "right" }], // talking pair C
  [6, { x: 7, y: 8, facing: "left" }],
]);

const RESERVED_KID_SLOTS: ReadonlyMap<number, ReservedSlot> = new Map([
  [0, { x: 2, y: 2, facing: "down" }], // twin pair, side by side
  [1, { x: 3, y: 2, facing: "down" }],
]);

/** A candidate point from seeded rejection sampling ("dart-throwing"):
 * `attempt` decorrelates each retry from the last for the same citizen,
 * `sequenceIndex` decorrelates citizens from each other -- deterministic
 * throughout, never `Math.random`. */
function scatterCandidate(sequenceIndex: number, attempt: number): { x: number; y: number } {
  const combined = sequenceIndex * 97 + attempt;
  return {
    x: hashUnit(combined, SALT_SCATTER_X) * STRIP_WIDTH,
    y: hashUnit(combined, SALT_SCATTER_Y) * STRIP_DEPTH,
  };
}

const MAX_SCATTER_ATTEMPTS = 200;

/** Seeded rejection sampling over the *whole* strip: draws candidates for
 * `sequenceIndex` until one clears `MIN_SPACING` from every point already
 * placed (including the reserved slots), or the retry budget runs out --
 * unlike a low-discrepancy sequence, this has no lattice structure of its
 * own to leak through as a visible pattern once spacing pushes points
 * around. At this strip's density (fewer than 40 points over `STRIP_WIDTH
 * * STRIP_DEPTH` cells), a valid draw is overwhelmingly found well before
 * the budget runs out; the last candidate drawn is accepted regardless as
 * a last resort, rather than this ever throwing. */
function place(
  placed: readonly { readonly x: number; readonly y: number }[],
  sequenceIndex: number,
): { x: number; y: number } {
  let candidate = scatterCandidate(sequenceIndex, 0);
  for (let attempt = 0; attempt < MAX_SCATTER_ATTEMPTS; attempt++) {
    candidate = scatterCandidate(sequenceIndex, attempt);
    const collides = placed.some(
      (p) => Math.hypot(candidate.x - p.x, candidate.y - p.y) < MIN_SPACING,
    );
    if (!collides) return candidate;
  }
  return candidate;
}

function civilianOf<T extends { readonly family: Family; readonly pool: string }>(
  defs: readonly T[],
  family: Family,
): readonly T[] {
  return defs.filter((d) => d.family === family && d.pool === "civilian");
}

function balanceValue(defs: Defs, key: string): number {
  const entry = defs.balance.find((b) => b.key === key);
  if (!entry) throw new Error(`citizens: no balance entry for '${key}'`);
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
  const roll = Math.floor(hashUnit(index, SALT_HAIR_RARE_ROLL) * 100);
  const wantRare = roll < hairRareChancePercent;
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
  const roll = Math.floor(hashUnit(index, SALT_ACCESSORY_NONE_ROLL) * 100);
  if (roll < accessoryNoneChancePercent) return 0;
  return pickByHash(civilianOf(defs.accessories, family), index, SALT_ACCESSORY_PICK)?.id ?? 0;
}

/** Picks a citizen's tuple for `index` within its own family, mirroring
 * `sim::appearance::generate`'s own rules field for field (civilian pool,
 * `accessory_none_chance`, `hair_rare_chance`) over a deterministic hash
 * instead of `sim::rng` -- see this module's own doc comment for why that
 * is the right amount of fidelity here. */
function tupleFor(defs: Defs, family: Family, index: number): AppearanceTuple {
  const bodies = civilianOf(defs.bodies, family);
  const eyes = civilianOf(defs.eyes, family);
  const outfits = civilianOf(defs.outfits, family);
  if (bodies.length === 0 || eyes.length === 0 || outfits.length === 0) {
    throw new Error(`citizens: no civilian ${family} body/eyes/outfit in the committed defs`);
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

/** The street's fixed street crowd: `ADULT_COUNT` adults (four in a
 * sanitation-worker uniform among the rest in civilian dress, FR62),
 * `KID_COUNT` kids (the first two sharing one identical tuple, standing
 * side by side -- FR61's "two citizens can look exactly alike" made
 * visible), scattered over the crowd's own pavement strip by seeded
 * rejection sampling with a minimum tile of spacing, depth-sorted among
 * itself by foot `y` (`citizens-layer.ts`'s job) so a citizen in front
 * overlaps the one behind correctly. One adult stands beside `kid-0` on
 * its identical foot line (the close-crop screenshot's pairing), and
 * three adult pairs stand one tile apart facing each other, as if
 * talking. */
/** Story 2.7's own texture-budget proof (Quentin's direction): builds
 * the exact same crowd -- same count, same positions, same uniforms --
 * but every adult (and, separately, every kid) shares one identical
 * tuple, when `identicalTuples` is set. Never the normal path: only
 * `client/tests/e2e/appearance.spec.ts`'s own "different people cost
 * about as much as identical ones" comparison sets it, to build the
 * crowd's "identical" half without duplicating this whole function. */
export function buildCitizenFixtures(
  defs: Defs,
  identicalTuples = false,
): readonly CitizenFixture[] {
  const fixtures: CitizenFixture[] = [];
  const placed: { x: number; y: number }[] = [];
  for (const slot of RESERVED_ADULT_SLOTS.values()) placed.push(slot);
  for (const slot of RESERVED_KID_SLOTS.values()) placed.push(slot);

  // The first three adult slots deliberately share one tuple (AC5:
  // proof that several characters reuse one composite texture). Based on
  // index 5, not 0: index 5 happens to draw no accessory of its own, so
  // this trio contributes zero extra weight to any single accessory id
  // -- basing it on an index that *did* draw one would inflate that one
  // id's own count by the trio's own two extra citizens, on top of
  // whatever other citizen independently draws the same id, and risk
  // tripping the "no accessory id repeats more than a few times" crowd-
  // variety test below for a reason that has nothing to do with the
  // hash's own real distribution.
  const sharedTuple = tupleFor(defs, "adult", 5);

  let scatterCursor = 0;
  for (let i = 0; i < ADULT_COUNT; i++) {
    const reserved = RESERVED_ADULT_SLOTS.get(i);
    const local = reserved ?? place(placed, scatterCursor++);
    if (!reserved) placed.push(local);
    fixtures.push({
      id: `adult-${i}`,
      tuple: identicalTuples || i < 3 ? sharedTuple : tupleFor(defs, "adult", i),
      professionKey: SANITATION_WORKER_INDICES.has(i) ? "sanitation_worker" : undefined,
      gridX: PLAZA_X0 + local.x,
      gridY: PLAZA_Y0 + local.y,
      facing: reserved?.facing ?? facingFor(i),
    });
  }

  const twinTuple = tupleFor(defs, "kid", 0);
  for (let i = 0; i < KID_COUNT; i++) {
    const reserved = RESERVED_KID_SLOTS.get(i);
    const local = reserved ?? place(placed, scatterCursor++);
    if (!reserved) placed.push(local);
    fixtures.push({
      id: `kid-${i}`,
      tuple: identicalTuples || i < 2 ? twinTuple : tupleFor(defs, "kid", i),
      gridX: PLAZA_X0 + local.x,
      gridY: PLAZA_Y0 + local.y,
      facing: reserved?.facing ?? facingFor(i + ADULT_COUNT),
    });
  }

  return fixtures;
}

/** The walker's own id -- `citizens-layer.ts` looks it up by this rather
 * than by index, so its identity survives `buildCitizenFixtures`'s own
 * counts changing. */
export const WALKER_ID = "walker";

/** The walker's fixed rectangular loop, in grid cells relative to its own
 * start position -- one leg per direction, so a short wait on screen
 * shows all four. Sized to stay fully inside the crowd's own pavement
 * strip. */
export const WALKER_LOOP: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 3, dy: 0 }, // right
  { dx: 0, dy: -1.5 }, // up
  { dx: -3, dy: 0 }, // left
  { dx: 0, dy: 1.5 }, // down
];

export const WALK_CELLS_PER_SECOND = 1.5;
export const WALK_FRAMES_PER_DIRECTION = 6;
export const WALK_FRAMES_PER_SECOND = 8;

function walkDirectionOf(dx: number, dy: number): string {
  if (dx > 0) return "right";
  if (dx < 0) return "left";
  if (dy < 0) return "up";
  return "down";
}

export interface WalkerPose {
  readonly x: number;
  readonly y: number;
  readonly direction: string;
  readonly frameIndex: number;
}

/** Where a walker starting at `(startX, startY)` sits after `elapsedMS`
 * of looping `WALKER_LOOP` forever, at `WALK_CELLS_PER_SECOND` -- pure
 * and stateless (a function of total elapsed time alone, not of any
 * per-tick accumulator), so `citizens-layer.ts`'s own ticker and a test
 * predicting where the walker will be at a given moment both call this
 * one implementation rather than two copies of the same leg math. */
export function walkerPoseAt(startX: number, startY: number, elapsedMS: number): WalkerPose {
  const legDurationsMS = WALKER_LOOP.map(
    (leg) => (Math.hypot(leg.dx, leg.dy) / WALK_CELLS_PER_SECOND) * 1000,
  );
  const loopDurationMS = legDurationsMS.reduce((sum, ms) => sum + ms, 0);
  let remainingMS = loopDurationMS > 0 ? elapsedMS % loopDurationMS : 0;
  if (remainingMS < 0) remainingMS += loopDurationMS;

  let x = startX;
  let y = startY;
  let legIndex = 0;
  for (; legIndex < WALKER_LOOP.length; legIndex++) {
    const legMS = legDurationsMS[legIndex] ?? 0;
    if (remainingMS < legMS) break;
    remainingMS -= legMS;
    const leg = WALKER_LOOP[legIndex];
    if (leg) {
      x += leg.dx;
      y += leg.dy;
    }
  }
  const leg = WALKER_LOOP[legIndex % WALKER_LOOP.length];
  const legMS = legDurationsMS[legIndex % WALKER_LOOP.length] ?? 0;
  const progress = legMS > 0 ? remainingMS / legMS : 0;
  const frameIndex =
    Math.floor((elapsedMS / 1000) * WALK_FRAMES_PER_SECOND) % WALK_FRAMES_PER_DIRECTION;
  return {
    x: x + (leg?.dx ?? 0) * progress,
    y: y + (leg?.dy ?? 0) * progress,
    direction: walkDirectionOf(leg?.dx ?? 0, leg?.dy ?? 0),
    frameIndex,
  };
}

export function buildWalkerFixture(defs: Defs): CitizenFixture {
  return {
    id: WALKER_ID,
    tuple: tupleFor(defs, "adult", ADULT_COUNT),
    gridX: PLAZA_X0 + STRIP_WIDTH + 2,
    gridY: PLAZA_Y0 + 1.5,
    facing: "down",
  };
}

/** A second, distinct walker: a sanitation worker, walking the same
 * shape of loop a few tiles further along -- the uniform's extra layer
 * needs its own walk-direction proof, not only the civilian walker's. */
export const UNIFORMED_WALKER_ID = "uniformed-walker";

export function buildUniformedWalkerFixture(defs: Defs): CitizenFixture {
  return {
    id: UNIFORMED_WALKER_ID,
    tuple: tupleFor(defs, "adult", ADULT_COUNT + 1),
    professionKey: "sanitation_worker",
    gridX: PLAZA_X0 + STRIP_WIDTH + 8,
    gridY: PLAZA_Y0 + 1.5,
    facing: "down",
  };
}

/** The player's own appearance -- a real generated tuple through the
 * same pipeline the crowd uses, off the placeholder
 * `Premade_Character_01.png` crop. A row distinct from every crowd
 * fixture's own (never a walker's), so the player never accidentally
 * shares a texture with a crowd member on screen at the same time. */
export function buildPlayerAppearanceTuple(defs: Defs): AppearanceTuple {
  return tupleFor(defs, "adult", ADULT_COUNT + 2);
}

/** The crowd's own pavement footprint, in world cells -- `citizens-layer.
 * ts` paints this with the same sidewalk texture the rest of the world
 * uses, and both walkers' loops stay fully inside it. */
export function plazaBounds(): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: PLAZA_X0 - 1,
    y0: PLAZA_Y0 - 1,
    // +14, not +11: the uniformed walker's own loop reaches
    // `STRIP_WIDTH + 8 + 3` at its own rightmost point (its start plus
    // the right leg) -- a few spare cells of pavement past that so a
    // close-crop screenshot centred on it there has room on every side,
    // not just up to the world's own edge.
    x1: PLAZA_X0 + STRIP_WIDTH + 14,
    y1: PLAZA_Y0 + STRIP_DEPTH + 2,
  };
}

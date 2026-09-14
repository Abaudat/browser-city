// Story 1.10 (AC5, FR61/FR62): a fixed, deterministic street crowd for
// the demo scene, proving the real appearance pipeline end to end --
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
// or `costume` part can never reach an ordinary citizen). This is a
// deterministic index walk, not `generate()`'s own weighted RNG: the
// generator's own correctness is already pinned by `appearance_v2.golden`
// and its property tests, so this module only needs *valid*, *varied*
// tuples, never `generate`'s exact distribution.

import type { Defs, Family } from "../defs/types";
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
 * `PLAZA_Y0` -- wide and deep enough that `scatterPosition`'s low-
 * discrepancy sequence spreads `ADULT_COUNT + KID_COUNT` citizens with
 * real gaps between them, never a visible row or column. */
const STRIP_WIDTH = 22;
const STRIP_DEPTH = 11;
const MIN_SPACING = 1;

const FACINGS: readonly string[] = ["down", "up", "left", "right"];

function facingFor(index: number): string {
  const facing = FACINGS[(index * 7) % FACINGS.length];
  return facing ?? "down";
}

/** A citizen who stands still, one tile beside `kid-0` on the identical
 * foot line -- the pairing the close-crop screenshot needs -- and the
 * three "two citizens talking" vignettes: each pair one tile apart,
 * facing each other. Every other adult/kid is scattered instead (see
 * `scatterPosition`). Indices are into the adult/kid sequence `0..
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

// A Weyl (additive-recurrence) low-discrepancy sequence: deterministic
// and exactly reproducible from one run to the next, like every other
// value in this module, but with none of a `% columns` grid's visible
// rows or columns -- the two constants are the golden ratio's conjugate
// and a second irrational decorrelated from it, so the two axes never
// beat against each other into a hidden lattice.
const GOLDEN_CONJUGATE = 0.6180339887498949;
const SECOND_IRRATIONAL = 0.7548776662466927;

function scatterPosition(sequenceIndex: number): { x: number; y: number } {
  const fx = (sequenceIndex * GOLDEN_CONJUGATE) % 1;
  const fy = (sequenceIndex * SECOND_IRRATIONAL) % 1;
  return { x: fx * STRIP_WIDTH, y: fy * STRIP_DEPTH };
}

/** Nudges `candidate` away from every point already placed until it
 * clears `MIN_SPACING`, or a fixed retry budget runs out -- a citizen
 * standing shoulder-to-shoulder inside another is the one placement bug
 * a low-discrepancy sequence alone does not rule out. Deterministic: the
 * nudge direction is exactly the vector away from the point it collided
 * with, never a random retry. */
function settle(
  placed: readonly { readonly x: number; readonly y: number }[],
  candidate: { x: number; y: number },
): { x: number; y: number } {
  let point = candidate;
  for (let attempt = 0; attempt < 8; attempt++) {
    const collision = placed.find((p) => Math.hypot(point.x - p.x, point.y - p.y) < MIN_SPACING);
    if (!collision) break;
    const dx = point.x - collision.x;
    const dy = point.y - collision.y;
    const distance = Math.hypot(dx, dy) || 0.001;
    const push = MIN_SPACING - distance + 0.05;
    point = { x: point.x + (dx / distance) * push, y: point.y + (dy / distance) * push };
  }
  return point;
}

function civilianOf<T extends { readonly family: Family; readonly pool: string }>(
  defs: readonly T[],
  family: Family,
): readonly T[] {
  return defs.filter((d) => d.family === family && d.pool === "civilian");
}

function familyOf<T extends { readonly family: Family }>(
  defs: readonly T[],
  family: Family,
): readonly T[] {
  return defs.filter((d) => d.family === family);
}

/** Picks a citizen's tuple for `index` within its own family -- a
 * deterministic index walk over each part's own civilian-pool list, with
 * a different, decorrelated stride per field so the parts do not all
 * cycle in lockstep (which is exactly what made the earlier lockstep
 * walk read as a fixed, repeating pattern rather than a varied crowd).
 * `0` (no accessory) is folded into the accessory cycle as one more
 * choice, the same "legal absence" `resolveLayers` already treats `0`
 * as -- never an id this module invents. */
function tupleFor(defs: Defs, family: Family, index: number): AppearanceTuple {
  const bodies = civilianOf(defs.bodies, family);
  const eyes = civilianOf(defs.eyes, family);
  const outfits = civilianOf(defs.outfits, family);
  const accessories = civilianOf(defs.accessories, family);
  const hairstyles = familyOf(defs.hairstyles, family);
  if (bodies.length === 0 || eyes.length === 0 || outfits.length === 0) {
    throw new Error(`citizens: no civilian ${family} body/eyes/outfit in the committed defs`);
  }
  const hairstyle = hairstyles.length > 0 ? hairstyles[(index * 5) % hairstyles.length] : undefined;
  // Accessory `0` (none) is one more slot in the cycle, not a special
  // case -- roughly one in `accessories.length + 1` citizens goes without.
  const accessoryChoice = index * 11;
  const accessoryId =
    accessories.length > 0 && accessoryChoice % (accessories.length + 1) !== 0
      ? (accessories[accessoryChoice % accessories.length]?.id ?? 0)
      : 0;
  return {
    body: bodies[index % bodies.length]?.id ?? 0,
    eyes: eyes[(index * 3) % eyes.length]?.id ?? 0,
    outfit: outfits[(index * 7) % outfits.length]?.id ?? 0,
    hairstyle: hairstyle?.id ?? 0,
    accessory: accessoryId,
  };
}

/** The demo's fixed street crowd: `ADULT_COUNT` adults (four in a
 * sanitation-worker uniform among the rest in civilian dress, FR62),
 * `KID_COUNT` kids (the first two sharing one identical tuple, standing
 * side by side -- FR61's "two citizens can look exactly alike" made
 * visible), scattered over the crowd's own pavement strip by a
 * deterministic low-discrepancy sequence with a minimum tile of spacing,
 * depth-sorted among itself by foot `y` (`citizens-layer.ts`'s job) so a
 * citizen in front overlaps the one behind correctly. One adult stands
 * beside `kid-0` on its identical foot line (the close-crop screenshot's
 * pairing), and three adult pairs stand one tile apart facing each
 * other, as if talking. */
export function buildCitizenFixtures(defs: Defs): readonly CitizenFixture[] {
  const fixtures: CitizenFixture[] = [];
  const placed: { x: number; y: number }[] = [];
  for (const slot of RESERVED_ADULT_SLOTS.values()) placed.push(slot);
  for (const slot of RESERVED_KID_SLOTS.values()) placed.push(slot);

  // The first three adult slots deliberately share one tuple (AC5:
  // proof that several characters reuse one composite texture).
  const sharedTuple = tupleFor(defs, "adult", 0);

  let scatterCursor = 0;
  for (let i = 0; i < ADULT_COUNT; i++) {
    const reserved = RESERVED_ADULT_SLOTS.get(i);
    const local = reserved ?? settle(placed, scatterPosition(scatterCursor++));
    if (!reserved) placed.push(local);
    fixtures.push({
      id: `adult-${i}`,
      tuple: i < 3 ? sharedTuple : tupleFor(defs, "adult", i),
      professionKey: SANITATION_WORKER_INDICES.has(i) ? "sanitation_worker" : undefined,
      gridX: PLAZA_X0 + local.x,
      gridY: PLAZA_Y0 + local.y,
      facing: reserved?.facing ?? facingFor(i),
    });
  }

  const twinTuple = tupleFor(defs, "kid", 0);
  for (let i = 0; i < KID_COUNT; i++) {
    const reserved = RESERVED_KID_SLOTS.get(i);
    const local = reserved ?? settle(placed, scatterPosition(scatterCursor++));
    if (!reserved) placed.push(local);
    fixtures.push({
      id: `kid-${i}`,
      tuple: i < 2 ? twinTuple : tupleFor(defs, "kid", i),
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
 * shape of loop a few tiles further along -- Artie's direction that the
 * uniform's extra layer needs its own walk-direction proof, not only the
 * civilian walker's. */
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

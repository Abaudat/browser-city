// Story 1.10 (AC5, FR61/FR62): a fixed, deterministic street crowd for
// the demo scene, proving the real appearance pipeline end to end --
// separate from `fixture.ts`'s own collision-tested world (Crew's own
// scope call: a crowd this size needs more pavement than the existing,
// heavily-tested story 1.6-1.9 fixture has room for, and reshaping that
// shared fixture risks moving `render-order.spec.ts`/`movement.spec.ts`/
// `enclosure.spec.ts`/`intents.spec.ts`'s own committed goldens for a
// purely decorative change; this crowd is a second, additive layer in
// its own screen area instead, never part of the depth-sorted pool those
// specs assert against). Pure data plus one pure builder, zero PixiJS:
// `citizens-layer.ts` is the only adapter that turns this into sprites.
//
// Every tuple is derived from the committed `Defs` alone, by plain
// arithmetic over each part kind's own id list -- deterministic and
// reproducible from one run to the next (never `Math.random`), but never
// a hand-typed id either, so a defs/ addition can never silently break
// this by shifting an id this file assumed.

import type { Defs } from "../defs/types";
import type { AppearanceTuple } from "../render/appearance/composite";

export interface CitizenFixture {
  readonly id: string;
  readonly tuple: AppearanceTuple;
  /** FR62: resolved through `resolveUniform` at mount time, never stored
   * here. */
  readonly professionKey?: string;
  readonly gridX: number;
  readonly gridY: number;
}

/** How many of the four sanitation-worker slots this fixture set carries
 * (Artie's direction: "show 4, since only one real uniform exists" --
 * `defs/appearance/uniforms.toml` declares exactly one profession
 * override today). */
const SANITATION_WORKER_COUNT = 4;
const ADULT_COUNT = 42;
const KID_COUNT = 6;
const COLUMNS = 10;
const COLUMN_SPACING = 2;
const ROW_SPACING = 3;

function idsOf(defs: Defs, family: "adult" | "kid", kind: "bodies" | "eyes"): readonly number[] {
  const list = kind === "bodies" ? defs.bodies : defs.eyes;
  return list.filter((d) => d.family === family).map((d) => d.id);
}

function civilianOutfitIds(defs: Defs, family: "adult" | "kid"): readonly number[] {
  return defs.outfits.filter((o) => o.family === family && o.pool === "civilian").map((o) => o.id);
}

function hairstyleIds(defs: Defs, family: "adult" | "kid"): readonly number[] {
  return defs.hairstyles.filter((h) => h.family === family).map((h) => h.id);
}

function civilianAccessoryIds(defs: Defs, family: "adult" | "kid"): readonly number[] {
  return defs.accessories
    .filter((a) => a.family === family && a.pool === "civilian")
    .map((a) => a.id);
}

function pick(ids: readonly number[], index: number): number {
  if (ids.length === 0) throw new Error("citizens: an appearance part list is empty");
  const id = ids[index % ids.length];
  if (id === undefined) throw new Error("citizens: pick index out of range");
  return id;
}

function tupleAt(defs: Defs, family: "adult" | "kid", index: number): AppearanceTuple {
  const bodies = idsOf(defs, family, "bodies");
  const eyes = idsOf(defs, family, "eyes");
  const outfits = civilianOutfitIds(defs, family);
  const hairstyles = hairstyleIds(defs, family);
  const accessories = civilianAccessoryIds(defs, family);
  return {
    body: pick(bodies, index),
    eyes: pick(eyes, index),
    outfit: pick(outfits, index),
    // Every fifth citizen is bald (`hairstyle: 0`) -- FR61's "0 is a
    // legal layer" case shown on screen, not only in a unit test.
    hairstyle: index % 5 === 0 ? 0 : pick(hairstyles, index),
    // Every third citizen carries no civilian accessory -- and every kid
    // does, always, since `defs/appearance/accessories.toml` declares no
    // kid-family entry at all (Artie's finding: kid sheets carry no
    // accessories to pick from).
    accessory: accessories.length === 0 || index % 3 === 0 ? 0 : pick(accessories, index),
  };
}

/** The demo's fixed street crowd: `ADULT_COUNT` adults (the first
 * `SANITATION_WORKER_COUNT` in a sanitation-worker uniform among the rest
 * in civilian dress, FR62), `KID_COUNT` kids (the first two sharing one
 * identical tuple, seated side by side -- FR61's "two citizens can look
 * exactly alike" made visible), plus one walker looping through all four
 * directions (`citizens-layer.ts` animates it; this module only starts it
 * at its own grid cell). Laid out in a fixed grid, in its own screen
 * area -- see the module doc comment for why this is not part of
 * `fixture.ts`'s own collision-tested world. */
export function buildCitizenFixtures(defs: Defs): readonly CitizenFixture[] {
  const fixtures: CitizenFixture[] = [];

  // The first three adults share one tuple (AC5, Tim's direction: proof
  // that several characters reuse one composite texture), and the first
  // two of those sit side by side (Artie's "identical citizen ids side by
  // side").
  const sharedTuple = tupleAt(defs, "adult", 0);
  for (let i = 0; i < ADULT_COUNT; i++) {
    const isSanitationWorker = i < SANITATION_WORKER_COUNT;
    fixtures.push({
      id: `adult-${i}`,
      tuple: i < 3 ? sharedTuple : tupleAt(defs, "adult", i),
      professionKey: isSanitationWorker ? "sanitation_worker" : undefined,
      gridX: (i % COLUMNS) * COLUMN_SPACING,
      gridY: Math.floor(i / COLUMNS) * ROW_SPACING,
    });
  }

  const adultRows = Math.ceil(ADULT_COUNT / COLUMNS);
  const kidTuple = tupleAt(defs, "kid", 0);
  for (let i = 0; i < KID_COUNT; i++) {
    fixtures.push({
      id: `kid-${i}`,
      tuple: i < 2 ? kidTuple : tupleAt(defs, "kid", i),
      gridX: (i % COLUMNS) * COLUMN_SPACING,
      gridY: (adultRows + Math.floor(i / COLUMNS)) * ROW_SPACING,
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
 * shows all four (Artie's "one frame per walk direction"). */
export const WALKER_LOOP: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 4, dy: 0 }, // right
  { dx: 0, dy: -3 }, // up
  { dx: -4, dy: 0 }, // left
  { dx: 0, dy: 3 }, // down
];

export function buildWalkerFixture(defs: Defs): CitizenFixture {
  return {
    id: WALKER_ID,
    tuple: tupleAt(defs, "adult", ADULT_COUNT + 1),
    gridX: 0,
    gridY: -ROW_SPACING,
  };
}

/** Artie's direction: the player itself moves off the placeholder
 * `Premade_Character_01.png` crop onto a real generated tuple, through
 * the same pipeline the crowd uses -- an index distinct from every crowd
 * fixture's own (never the walker's), so the player never accidentally
 * shares a texture with a crowd member on screen at the same time. */
export function buildPlayerAppearanceTuple(defs: Defs): AppearanceTuple {
  return tupleAt(defs, "adult", ADULT_COUNT + 2);
}

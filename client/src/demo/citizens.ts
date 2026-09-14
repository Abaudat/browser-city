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
// Every tuple comes from `demo-citizens.json` -- `tools/demo-citizens-
// build/tests/demo_citizens_fixture.rs`'s own committed output of the
// real `sim::appearance::generate`, never a hand-rolled index walk over
// each part list. This module only decides *where* each row stands and
// *which* profession override it wears; it never invents an id.

import type { AppearanceTuple } from "../render/appearance/composite";

export interface DemoCitizenRow {
  readonly id: number;
  readonly family: "adult" | "kid";
  readonly tuple: AppearanceTuple;
}

export interface DemoCitizensFixture {
  readonly rows: readonly DemoCitizenRow[];
}

/** Parses `demo-citizens.json`'s own committed shape -- thrown, naming
 * what is wrong, on anything else: a stale or hand-edited fixture is a
 * build problem, never a silently-empty crowd. */
export function parseDemoCitizens(data: unknown): DemoCitizensFixture {
  if (typeof data !== "object" || data === null || !("rows" in data)) {
    throw new Error("demo-citizens.json: expected an object with a 'rows' array");
  }
  const rows = (data as { rows: unknown }).rows;
  if (!Array.isArray(rows)) {
    throw new Error("demo-citizens.json: 'rows' is not an array");
  }
  return {
    rows: rows.map((r, i) => {
      if (typeof r !== "object" || r === null) {
        throw new Error(`demo-citizens.json: rows[${i}] is not an object`);
      }
      const row = r as Record<string, unknown>;
      const family = row.family;
      if (family !== "adult" && family !== "kid") {
        throw new Error(`demo-citizens.json: rows[${i}].family is not 'adult' or 'kid'`);
      }
      for (const key of ["id", "body", "eyes", "outfit", "hairstyle", "accessory"]) {
        if (typeof row[key] !== "number") {
          throw new Error(`demo-citizens.json: rows[${i}].${key} is not a number`);
        }
      }
      return {
        id: row.id as number,
        family,
        tuple: {
          body: row.body as number,
          eyes: row.eyes as number,
          outfit: row.outfit as number,
          hairstyle: row.hairstyle as number,
          accessory: row.accessory as number,
        },
      };
    }),
  };
}

export interface CitizenFixture {
  readonly id: string;
  readonly tuple: AppearanceTuple;
  /** FR62: resolved through `resolveUniform` at mount time, never stored
   * here. */
  readonly professionKey?: string;
  readonly gridX: number;
  readonly gridY: number;
}

/** How many of the adult slots this fixture set carries in a
 * sanitation-worker uniform -- `defs/appearance/uniforms.toml` declares
 * exactly one profession override today. */
const SANITATION_WORKER_COUNT = 4;
const ADULT_COUNT = 40;
const KID_COUNT = 6;
const COLUMNS = 8;
const COLUMN_SPACING = 2;
const ROW_SPACING = 2;
/** Where the crowd's own pavement strip starts, in world cells -- well
 * south of `fixture.ts`'s own world (its boundary ring closes at
 * `y = 10`), so the crowd never overlaps a wall, a prop or the void
 * outside either. */
export const PLAZA_X0 = 0;
export const PLAZA_Y0 = 16;
/** A small, fixed set of per-slot offsets (in fractional cells) -- a
 * loose, jittered crowd that is still exactly reproducible from one run
 * to the next, never `Math.random`. */
const JITTER: readonly { readonly dx: number; readonly dy: number }[] = [
  { dx: 0.3, dy: -0.2 },
  { dx: -0.25, dy: 0.15 },
  { dx: 0.15, dy: 0.3 },
  { dx: -0.3, dy: -0.15 },
  { dx: 0.2, dy: 0.25 },
  { dx: -0.15, dy: -0.3 },
  { dx: 0.35, dy: 0.1 },
  { dx: -0.2, dy: -0.25 },
];

function jitterFor(index: number): { dx: number; dy: number } {
  const j = JITTER[index % JITTER.length];
  return j ?? { dx: 0, dy: 0 };
}

function rowsOf(fixture: DemoCitizensFixture, family: "adult" | "kid"): readonly DemoCitizenRow[] {
  return fixture.rows.filter((r) => r.family === family);
}

/** The demo's fixed street crowd: `ADULT_COUNT` adults (the first
 * `SANITATION_WORKER_COUNT` in a sanitation-worker uniform among the rest
 * in civilian dress, FR62), `KID_COUNT` kids (the first two sharing one
 * identical tuple, standing side by side -- FR61's "two citizens can look
 * exactly alike" made visible), laid out on a loose, jittered grid on the
 * crowd's own pavement strip, depth-sorted among itself by foot `y`
 * (`citizens-layer.ts`'s job) so a citizen in front overlaps the one
 * behind correctly. The kid row extends the *last* adult row rightward,
 * at the same `gridY`, rather than sitting in a row of its own below --
 * the last adult and the first kid stand on the identical foot line, one
 * `COLUMN_SPACING` apart (the same gap every other neighbour in that row
 * carries), so the close-crop screenshot can compare them directly. */
export function buildCitizenFixtures(fixture: DemoCitizensFixture): readonly CitizenFixture[] {
  const fixtures: CitizenFixture[] = [];
  const adultRows = rowsOf(fixture, "adult");
  const kidRows = rowsOf(fixture, "kid");
  if (adultRows.length < ADULT_COUNT) {
    throw new Error(`citizens: demo-citizens.json has only ${adultRows.length} adult rows`);
  }
  if (kidRows.length < KID_COUNT) {
    throw new Error(`citizens: demo-citizens.json has only ${kidRows.length} kid rows`);
  }

  // The first three adult slots deliberately share one tuple (AC5:
  // proof that several characters reuse one composite texture), and the
  // first two of those sit side by side (two citizens that look exactly
  // alike, standing together).
  const sharedTuple = adultRows[0]?.tuple;
  if (!sharedTuple) throw new Error("citizens: no adult rows in demo-citizens.json");

  const adultRowCount = Math.ceil(ADULT_COUNT / COLUMNS);
  // The whole kid row shares one jitter offset (rather than each kid's
  // own), and so does the very last adult -- the two foot lines must be
  // exactly equal, not merely close, for the "kid stands beside an adult"
  // comparison to hold.
  const kidRowJitter = jitterFor(ADULT_COUNT);
  const kidRowY = PLAZA_Y0 + (adultRowCount - 1) * ROW_SPACING + kidRowJitter.dy;

  for (let i = 0; i < ADULT_COUNT; i++) {
    const row = adultRows[i];
    if (!row) throw new Error(`citizens: missing adult row at index ${i}`);
    const isSanitationWorker = i < SANITATION_WORKER_COUNT;
    const isLastAdult = i === ADULT_COUNT - 1;
    const jitter = jitterFor(i);
    fixtures.push({
      id: `adult-${i}`,
      tuple: i < 3 ? sharedTuple : row.tuple,
      professionKey: isSanitationWorker ? "sanitation_worker" : undefined,
      gridX: PLAZA_X0 + (i % COLUMNS) * COLUMN_SPACING + jitter.dx,
      gridY: isLastAdult ? kidRowY : PLAZA_Y0 + Math.floor(i / COLUMNS) * ROW_SPACING + jitter.dy,
    });
  }

  const twinTuple = kidRows[0]?.tuple;
  if (!twinTuple) throw new Error("citizens: no kid rows in demo-citizens.json");

  for (let i = 0; i < KID_COUNT; i++) {
    const row = kidRows[i];
    if (!row) throw new Error(`citizens: missing kid row at index ${i}`);
    fixtures.push({
      id: `kid-${i}`,
      tuple: i < 2 ? twinTuple : row.tuple,
      gridX: PLAZA_X0 + (COLUMNS + i) * COLUMN_SPACING + kidRowJitter.dx,
      gridY: kidRowY,
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

export function buildWalkerFixture(fixture: DemoCitizensFixture): CitizenFixture {
  const adultRows = rowsOf(fixture, "adult");
  const row = adultRows[ADULT_COUNT];
  if (!row) throw new Error("citizens: no spare adult row in demo-citizens.json for the walker");
  return {
    id: WALKER_ID,
    tuple: row.tuple,
    gridX: PLAZA_X0 + COLUMNS * COLUMN_SPACING + 2,
    gridY: PLAZA_Y0 + 1.5,
  };
}

/** The player's own appearance -- a real generated tuple through the
 * same pipeline the crowd uses, off the placeholder
 * `Premade_Character_01.png` crop. A row distinct from every crowd
 * fixture's own (never the walker's), so the player never accidentally
 * shares a texture with a crowd member on screen at the same time. */
export function buildPlayerAppearanceTuple(fixture: DemoCitizensFixture): AppearanceTuple {
  const adultRows = rowsOf(fixture, "adult");
  const row = adultRows[ADULT_COUNT + 1];
  if (!row) throw new Error("citizens: no spare adult row in demo-citizens.json for the player");
  return row.tuple;
}

/** The crowd's own pavement footprint, in world cells -- `citizens-layer.
 * ts` paints this with the same sidewalk texture the rest of the world
 * uses, and the walker's loop stays fully inside it. Wide enough to cover
 * the kid row's own rightward extension past the last adult column. */
export function plazaBounds(): { x0: number; y0: number; x1: number; y1: number } {
  const adultRowCount = Math.ceil(ADULT_COUNT / COLUMNS);
  return {
    x0: PLAZA_X0 - 1,
    y0: PLAZA_Y0 - 1,
    x1: PLAZA_X0 + (COLUMNS + KID_COUNT) * COLUMN_SPACING + 2,
    y1: PLAZA_Y0 + adultRowCount * ROW_SPACING + 2,
  };
}

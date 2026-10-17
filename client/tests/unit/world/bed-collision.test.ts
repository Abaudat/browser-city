// Story 4.27 (FR126, FR128): a player walking into a bed from the south, the
// east or the west stops at its drawn outline. Built from the committed
// defs through the real collision grid `world/movement.ts` reads -- the
// collider is never written by hand here, so shortening a bed's collider or
// footprint in `defs/` turns this red.
import { describe, expect, it } from "vitest";
import { chunkKey } from "../../../src/world/chunk";
import { footprintOrigin } from "../../../src/world/footprint";
import { bodyRect, MAX_DELTA_MS, step } from "../../../src/world/movement";
import { isCellStandable } from "../../../src/world/standable";
import { WorldIndex } from "../../../src/world/world-index";
import {
  BED_SINGLE_BLUE_DEF_ID,
  FLAT_BED_ANCHOR,
  FLAT_NORTH_WALL_ROW,
  HOME_FLAT_SPAWN,
} from "../../fixture-block/fixture";
import { streetMovementConfig, streetWorldIndex } from "../fixture-block/street-world";
import {
  committedDefs,
  committedMovementConfig,
  committedObjectSources,
} from "../support/committed-defs";

const config = committedMovementConfig();
const SUB = config.subcellsPerCell;
const ANCHOR = { x: 60, y: 60 };

/** The bed tag's id, read from the committed tag table. */
function bedTagId(): number {
  const tag = committedDefs().tags.find((t) => t.key === "bed");
  if (!tag) throw new Error("no bed tag");
  return tag.id;
}

function beds() {
  const tag = bedTagId();
  const found = committedDefs().objects.filter((o) => o.tags.includes(tag));
  expect(found.length).toBeGreaterThan(0);
  return found;
}

function worldWith(defId: number): WorldIndex {
  const world = new WorldIndex(SUB, committedObjectSources());
  world.insert({
    objectId: 1n,
    defId,
    x: ANCHOR.x,
    y: ANCHOR.y,
    floor: 0,
    layer: committedDefs().objects.find((o) => o.id === defId)?.layer ?? 0,
    orientation: 0,
    chunkKey: chunkKey(ANCHOR.x, ANCHOR.y, 0),
  });
  return world;
}

function walk(
  world: WorldIndex,
  from: { x: number; y: number },
  dir: { x: number; y: number },
): { x: number; y: number } {
  let pos = from;
  for (let i = 0; i < 300; i++) pos = step(pos, dir, MAX_DELTA_MS, world, 0, config, 1);
  return pos;
}

describe("walking into every bed stops at its drawn outline", () => {
  for (const bed of beds()) {
    const collider = bed.collider;
    if (!collider) throw new Error(`${bed.key} has no collider`);
    const origin = footprintOrigin(ANCHOR.x, ANCHOR.y, bed);
    // The collider's absolute sub-cell faces.
    const faces = {
      x0: origin.x * SUB + collider.x0,
      y0: origin.y * SUB + collider.y0,
      x1: origin.x * SUB + collider.x1,
      y1: origin.y * SUB + collider.y1,
    };
    const midY = (faces.y0 + faces.y1) / 2 / SUB;
    const midX = (faces.x0 + faces.x1) / 2 / SUB;

    it(`${bed.key}: from the south the body's top edge rests on the drawn foot`, () => {
      const world = worldWith(bed.id);
      const rest = walk(world, { x: midX, y: ANCHOR.y + 1.7 }, { x: 0, y: -1 });
      expect(bodyRect(rest, config).y0).toBe(faces.y1);
      // The drawn foot is the footprint's south edge: no strip of floor south of it.
      expect(faces.y1).toBe((ANCHOR.y + 1) * SUB);
    });

    it(`${bed.key}: from the east the body rests on the collider's east face`, () => {
      const world = worldWith(bed.id);
      const rest = walk(world, { x: ANCHOR.x + 2.5, y: midY + 0.5 }, { x: -1, y: 0 });
      expect(bodyRect(rest, config).x0).toBe(faces.x1);
    });

    it(`${bed.key}: from the west the body rests on the collider's west face`, () => {
      const world = worldWith(bed.id);
      const rest = walk(world, { x: ANCHOR.x - 1.5, y: midY + 0.5 }, { x: 1, y: 0 });
      expect(bodyRect(rest, config).x1).toBe(faces.x0);
    });
  }
});

describe("the fixture flat's bed backs onto the north wall", () => {
  const world = streetWorldIndex();
  const bed = committedDefs().objects.find((o) => o.id === BED_SINGLE_BLUE_DEF_ID);
  if (!bed) throw new Error("no fixture bed def");

  it("draws its headboard over the north wall row, not over floor", () => {
    const overhangRow = FLAT_BED_ANCHOR.y - bed.height;
    expect(overhangRow).toBe(FLAT_NORTH_WALL_ROW);
    expect(isCellStandable(world, streetMovementConfig(), FLAT_BED_ANCHOR.x, overhangRow, 0)).toBe(
      false,
    );
  });

  it("leaves the new character's spawn standable", () => {
    expect(
      isCellStandable(
        world,
        streetMovementConfig(),
        Math.floor(HOME_FLAT_SPAWN.x),
        Math.floor(HOME_FLAT_SPAWN.y),
        0,
      ),
    ).toBe(true);
  });
});

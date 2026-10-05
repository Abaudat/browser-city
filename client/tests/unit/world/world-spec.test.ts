// The client mirror of `sim::world::WorldSpec::build`'s refusals (Tim's
// direction, story 1.13): hand-laid world data must fail a fast check in
// CI rather than only failing when somebody walks it. Each case here is
// one refusal the Rust oracle also makes -- see
// `server/sim/src/world/collision.rs`'s `WorldSpec::build`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDefs } from "../../../src/defs/parse";
import { CHUNK_SIZE, chunkKey } from "../../../src/world/chunk";
import type { OwnershipArea } from "../../../src/world/ownership";
import type { TransitionSpec } from "../../../src/world/transitions";
import { checkWorldSpec, rectIsWithinOneChunk } from "../../../src/world/world-spec";

const defs = parseDefs(
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../public/defs/defs.json", import.meta.url)),
      "utf-8",
    ),
  ),
);
/** The declared floor range, from the generated defs -- never a literal. */
const FLOOR_RANGE = { minFloor: defs.minFloor, maxFloor: defs.maxFloor };

const area = (
  ownerId: bigint,
  floor: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): OwnershipArea => ({ ownerId, floor, rect: { x0, y0, x1, y1 } });

const transition = (
  x: number,
  y: number,
  floor: number,
  targetX: number,
  targetY: number,
  targetFloor: number,
): TransitionSpec => ({ x, y, floor, targetX, targetY, targetFloor });

/** Standable everywhere -- the cases below that are not about
 * standability use it so exactly one rule is under test at a time. */
const everywhereStandable = () => true;

describe("rectIsWithinOneChunk", () => {
  it("accepts a rect inside one chunk and refuses one that crosses a chunk edge", () => {
    expect(rectIsWithinOneChunk({ x0: 0, y0: 0, x1: CHUNK_SIZE, y1: CHUNK_SIZE }, 0)).toBe(true);
    expect(rectIsWithinOneChunk({ x0: 0, y0: 0, x1: CHUNK_SIZE + 1, y1: 1 }, 0)).toBe(false);
    expect(rectIsWithinOneChunk({ x0: 0, y0: 0, x1: 1, y1: CHUNK_SIZE + 1 }, 0)).toBe(false);
  });

  it("refuses an invalid (empty or inverted) rect", () => {
    expect(rectIsWithinOneChunk({ x0: 2, y0: 0, x1: 2, y1: 1 }, 0)).toBe(false);
    expect(rectIsWithinOneChunk({ x0: 2, y0: 0, x1: 1, y1: 1 }, 0)).toBe(false);
  });
});

describe("checkWorldSpec", () => {
  it("refuses an area or a transition on a floor one below or one above the declared range", () => {
    const { minFloor, maxFloor } = FLOOR_RANGE;
    const base = { isStandable: everywhereStandable, floorRange: FLOOR_RANGE };
    for (const floor of [minFloor - 1, maxFloor + 1]) {
      const building = checkWorldSpec({
        ...base,
        buildingAreas: [area(1n, floor, 1, 1, 4, 4)],
        roomAreas: [],
        transitions: [],
      });
      expect(building.join("\n")).toContain(`building_area floor ${floor} is outside`);
      const room = checkWorldSpec({
        ...base,
        buildingAreas: [],
        roomAreas: [area(1n, floor, 1, 1, 4, 4)],
        transitions: [],
      });
      expect(room.join("\n")).toContain(`room_area floor ${floor} is outside`);
      const anchor = checkWorldSpec({
        ...base,
        buildingAreas: [],
        roomAreas: [],
        transitions: [transition(5, 5, floor, 5, 5, 0)],
      });
      expect(anchor.join("\n")).toContain(`transition anchor floor ${floor} is outside`);
      const target = checkWorldSpec({
        ...base,
        buildingAreas: [],
        roomAreas: [],
        transitions: [transition(5, 5, 0, 5, 5, floor)],
      });
      expect(target.join("\n")).toContain(`transition target floor ${floor} is outside`);
    }
  });

  it("accepts the two edge floors of the declared range", () => {
    const { minFloor, maxFloor } = FLOOR_RANGE;
    expect(
      checkWorldSpec({
        buildingAreas: [area(1n, minFloor, 1, 1, 4, 4), area(2n, maxFloor, 1, 1, 4, 4)],
        roomAreas: [],
        transitions: [transition(5, 5, minFloor, 5, 5, maxFloor)],
        isStandable: everywhereStandable,
        floorRange: FLOOR_RANGE,
      }),
    ).toEqual([]);
  });

  it("accepts a world whose areas, transitions and rects are all legal", () => {
    expect(
      checkWorldSpec({
        buildingAreas: [area(1n, 0, 1, 1, 4, 4), area(2n, 0, 4, 1, 6, 4)],
        roomAreas: [area(3n, 0, 2, 2, 3, 3)],
        transitions: [transition(5, 5, 0, 5, 5, -1)],
        isStandable: everywhereStandable,
        floorRange: FLOOR_RANGE,
      }),
    ).toEqual([]);
  });

  it("refuses two same-kind areas on the same floor whose rects overlap", () => {
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 1, 1, 4, 4), area(2n, 0, 3, 3, 6, 6)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
      floorRange: FLOOR_RANGE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("overlaps");
  });

  it("allows same-kind areas on different floors to share an (x, y) rect", () => {
    expect(
      checkWorldSpec({
        buildingAreas: [area(1n, 0, 1, 1, 4, 4), area(2n, 1, 1, 1, 4, 4)],
        roomAreas: [],
        transitions: [],
        isStandable: everywhereStandable,
        floorRange: FLOOR_RANGE,
      }),
    ).toEqual([]);
  });

  it("allows a room area to overlap a building area -- they are different kinds", () => {
    expect(
      checkWorldSpec({
        buildingAreas: [area(1n, 0, 1, 1, 4, 4)],
        roomAreas: [area(2n, 0, 1, 1, 4, 4)],
        transitions: [],
        isStandable: everywhereStandable,
        floorRange: FLOOR_RANGE,
      }),
    ).toEqual([]);
  });

  it("refuses an area rect that spans more than one chunk", () => {
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 0, 0, CHUNK_SIZE + 1, 1)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
      floorRange: FLOOR_RANGE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("chunk");
  });

  it("buckets an area under the chunk key of its own anchor corner", () => {
    // The same rule the Rust side checks a declared `chunk_key` column
    // against: a row's key is always `chunk_key(rect.x0, rect.y0, floor)`.
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, CHUNK_SIZE, CHUNK_SIZE, CHUNK_SIZE + 2, CHUNK_SIZE + 2)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
      floorRange: FLOOR_RANGE,
      chunkKeyOf: (a) => chunkKey(a.rect.x0, a.rect.y0, a.floor),
    });
    expect(problems).toEqual([]);
  });

  it("refuses an area whose declared chunk_key disagrees with its own rect's real key", () => {
    // The mirror must never accept what the oracle refuses (Tim's
    // direction, cycle 1): a streamed row's own declared `chunk_key`
    // column is checked against the real key its rect anchors in, never
    // trusted on its own -- a wrong declared key would otherwise bucket
    // the area somewhere a query for its real chunk would never look.
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 1, 1, 4, 4)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
      floorRange: FLOOR_RANGE,
      chunkKeyOf: () => chunkKey(CHUNK_SIZE, CHUNK_SIZE, 0),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("declares chunk_key");
  });

  it("refuses an invalid (empty or inverted) area rect", () => {
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 4, 1, 4, 4)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
      floorRange: FLOOR_RANGE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("invalid");
  });

  it("refuses a transition whose anchor cell is not standable", () => {
    const problems = checkWorldSpec({
      buildingAreas: [],
      roomAreas: [],
      transitions: [transition(5, 5, 0, 9, 9, 1)],
      isStandable: (x, y) => !(x === 5 && y === 5),
      floorRange: FLOOR_RANGE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("anchor");
  });

  it("refuses a transition whose target cell is not standable", () => {
    const problems = checkWorldSpec({
      buildingAreas: [],
      roomAreas: [],
      transitions: [transition(5, 5, 0, 9, 9, 1)],
      isStandable: (x, y, floor) => !(x === 9 && y === 9 && floor === 1),
      floorRange: FLOOR_RANGE,
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("target");
  });

  it("reports every problem it finds, not only the first", () => {
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 1, 1, 4, 4), area(2n, 0, 3, 3, 6, 6)],
      roomAreas: [],
      transitions: [transition(5, 5, 0, 9, 9, 1)],
      isStandable: () => false,
      floorRange: FLOOR_RANGE,
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

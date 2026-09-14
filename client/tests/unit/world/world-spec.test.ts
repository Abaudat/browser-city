// The client mirror of `sim::world::WorldSpec::build`'s refusals (Tim's
// direction, story 1.13): hand-laid world data must fail a fast check in
// CI rather than only failing when somebody walks it. Each case here is
// one refusal the Rust oracle also makes -- see
// `server/sim/src/world/collision.rs`'s `WorldSpec::build`.
import { describe, expect, it } from "vitest";
import { CHUNK_SIZE, chunkKey } from "../../../src/world/chunk";
import type { OwnershipArea } from "../../../src/world/ownership";
import type { TransitionSpec } from "../../../src/world/transitions";
import { checkWorldSpec, rectIsWithinOneChunk } from "../../../src/world/world-spec";

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
  it("accepts a world whose areas, transitions and rects are all legal", () => {
    expect(
      checkWorldSpec({
        buildingAreas: [area(1n, 0, 1, 1, 4, 4), area(2n, 0, 4, 1, 6, 4)],
        roomAreas: [area(3n, 0, 2, 2, 3, 3)],
        transitions: [transition(5, 5, 0, 5, 5, -1)],
        isStandable: everywhereStandable,
      }),
    ).toEqual([]);
  });

  it("refuses two same-kind areas on the same floor whose rects overlap", () => {
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 1, 1, 4, 4), area(2n, 0, 3, 3, 6, 6)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
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
      }),
    ).toEqual([]);
  });

  it("refuses an area rect that spans more than one chunk", () => {
    const problems = checkWorldSpec({
      buildingAreas: [area(1n, 0, 0, 0, CHUNK_SIZE + 1, 1)],
      roomAreas: [],
      transitions: [],
      isStandable: everywhereStandable,
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
      chunkKeyOf: (a) => chunkKey(a.rect.x0, a.rect.y0, a.floor),
    });
    expect(problems).toEqual([]);
  });

  it("refuses a transition whose anchor cell is not standable", () => {
    const problems = checkWorldSpec({
      buildingAreas: [],
      roomAreas: [],
      transitions: [transition(5, 5, 0, 9, 9, 1)],
      isStandable: (x, y) => !(x === 5 && y === 5),
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
    });
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

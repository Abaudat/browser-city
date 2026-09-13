// `world/ownership.ts`'s own unit tests (Tim/Quentin's direction, story
// 1.7). The shared conformance fixture is checked in
// `conformance.test.ts`, alongside chunk addressing and collision; this
// file covers the port's own shape: the chunk-scoped scan cost
// (`server/sim/tests/world_perf.rs`'s TS mirror) and the
// `Math.floor`-not-truncation cell conversion.
import { describe, expect, it } from "vitest";
import { cellOf, NO_OWNER, type OwnershipArea, OwnershipIndex } from "../../../src/world/ownership";

describe("OwnershipIndex", () => {
  it("returns NO_OWNER for a cell no area covers", () => {
    const index = new OwnershipIndex([], []);
    const ownership = index.ownershipAt(5, 5, 0);
    expect(ownership.buildingId).toBe(NO_OWNER);
    expect(ownership.roomId).toBe(NO_OWNER);
  });

  it("buildingAreasInChunkOf is 0 for a chunk with no declared area", () => {
    const index = new OwnershipIndex([], []);
    expect(index.buildingAreasInChunkOf(5, 5, 0)).toBe(0);
  });

  it("resolves the building and room ids for a cell inside both", () => {
    const buildingAreas: OwnershipArea[] = [
      { ownerId: 1n, floor: 0, rect: { x0: 0, y0: 0, x1: 10, y1: 10 } },
    ];
    const roomAreas: OwnershipArea[] = [
      { ownerId: 2n, floor: 0, rect: { x0: 2, y0: 2, x1: 8, y1: 8 } },
    ];
    const index = new OwnershipIndex(buildingAreas, roomAreas);
    expect(index.ownershipAt(5, 5, 0)).toEqual({ buildingId: 1n, roomId: 2n });
    // Inside the building but outside the room (a corridor).
    expect(index.ownershipAt(1, 1, 0)).toEqual({ buildingId: 1n, roomId: NO_OWNER });
  });

  it("never returns an owner from another floor at the identical (x, y)", () => {
    const buildingAreas: OwnershipArea[] = [
      { ownerId: 1n, floor: 0, rect: { x0: 0, y0: 0, x1: 5, y1: 5 } },
      { ownerId: 2n, floor: -1, rect: { x0: 0, y0: 0, x1: 5, y1: 5 } },
    ];
    const index = new OwnershipIndex(buildingAreas, []);
    expect(index.ownershipAt(2, 2, 0).buildingId).toBe(1n);
    expect(index.ownershipAt(2, 2, -1).buildingId).toBe(2n);
  });

  it("scans only the queried chunk's areas, never every area declared (mirrors world_perf.rs)", () => {
    // 5,000 sparse building areas, one per chunk (64 tiles apart, always
    // two chunks apart).
    const buildingAreas: OwnershipArea[] = [];
    const SPARSE_COUNT = 5_000;
    for (let i = 0; i < SPARSE_COUNT; i++) {
      const x = i * 64;
      buildingAreas.push({
        ownerId: BigInt(i + 1),
        floor: 0,
        rect: { x0: x, y0: 0, x1: x + 1, y1: 1 },
      });
    }
    // A separate, crowded chunk far away: 20 non-overlapping areas sharing
    // one chunk.
    const CROWDED_X0 = 1_000_000;
    const CROWDED_COUNT = 20;
    for (let i = 0; i < CROWDED_COUNT; i++) {
      buildingAreas.push({
        ownerId: BigInt(SPARSE_COUNT + i + 1),
        floor: 0,
        rect: { x0: CROWDED_X0 + i, y0: 0, x1: CROWDED_X0 + i + 1, y1: 1 },
      });
    }

    const index = new OwnershipIndex(buildingAreas, []);
    // The crowded chunk holds exactly its own 20 areas -- never all 5,020.
    expect(index.buildingAreasInChunkOf(CROWDED_X0, 0, 0)).toBe(CROWDED_COUNT);
    // A sparse chunk holds exactly its own one area.
    expect(index.buildingAreasInChunkOf(0, 0, 0)).toBe(1);
    // The query itself still resolves the right owner in the crowded chunk.
    expect(index.ownershipAt(CROWDED_X0 + 5, 0, 0).buildingId).toBe(BigInt(SPARSE_COUNT + 5 + 1));
  });
});

describe("cellOf", () => {
  it("floors a continuous position to its cell, never truncates", () => {
    // The exact bug Quentin's direction calls out: Math.trunc(-0.5) is 0,
    // which would silently put a player standing just west of the origin
    // into cell 0's ownership instead of cell -1's.
    expect(cellOf(-0.5)).toBe(-1);
    expect(cellOf(-0.001)).toBe(-1);
    expect(cellOf(0)).toBe(0);
    expect(cellOf(0.999)).toBe(0);
    expect(cellOf(5.5)).toBe(5);
  });

  it("a player position of x = -0.5 resolves ownership against cell -1, not cell 0", () => {
    const buildingAreas: OwnershipArea[] = [
      { ownerId: 1n, floor: 0, rect: { x0: -1, y0: 0, x1: 0, y1: 1 } },
    ];
    const index = new OwnershipIndex(buildingAreas, []);
    const x = -0.5;
    expect(index.ownershipAt(cellOf(x), cellOf(0.2), 0).buildingId).toBe(1n);
  });
});

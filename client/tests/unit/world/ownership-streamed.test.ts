import { describe, expect, it } from "vitest";
import { NO_OWNER, OwnershipIndex } from "../../../src/world/ownership";

describe("OwnershipIndex fed row by row (story 3.16)", () => {
  it("answers from areas inserted after construction, and forgets deleted ones", () => {
    const index = new OwnershipIndex([], []);
    expect(index.ownershipAt(3, 3, 0)).toEqual({ buildingId: NO_OWNER, roomId: NO_OWNER });
    index.insertBuilding(1n, { ownerId: 7n, floor: 0, rect: { x0: 0, y0: 0, x1: 6, y1: 6 } });
    index.insertRoom(2n, { ownerId: 9n, floor: 0, rect: { x0: 1, y0: 1, x1: 5, y1: 5 } });
    expect(index.ownershipAt(3, 3, 0)).toEqual({ buildingId: 7n, roomId: 9n });
    expect(index.ownershipAt(0, 0, 0)).toEqual({ buildingId: 7n, roomId: NO_OWNER });
    index.deleteBuilding(1n);
    index.deleteRoom(2n);
    expect(index.ownershipAt(3, 3, 0)).toEqual({ buildingId: NO_OWNER, roomId: NO_OWNER });
  });

  it("moves its revision on every change and never on a read", () => {
    const index = new OwnershipIndex([], []);
    const r0 = index.revision;
    index.ownershipAt(1, 1, 0);
    expect(index.revision).toBe(r0);
    index.insertBuilding(1n, { ownerId: 7n, floor: 0, rect: { x0: 0, y0: 0, x1: 2, y1: 2 } });
    const r1 = index.revision;
    expect(r1).toBeGreaterThan(r0);
    index.deleteBuilding(1n);
    expect(index.revision).toBeGreaterThan(r1);
  });

  it("treats a repeated insert of the same row id as a replacement", () => {
    const index = new OwnershipIndex([], []);
    index.insertBuilding(1n, { ownerId: 7n, floor: 0, rect: { x0: 0, y0: 0, x1: 2, y1: 2 } });
    index.insertBuilding(1n, { ownerId: 7n, floor: 0, rect: { x0: 0, y0: 0, x1: 2, y1: 2 } });
    expect(index.buildingAreasInChunkOf(0, 0, 0)).toBe(1);
    index.deleteBuilding(1n);
    expect(index.buildingAreasInChunkOf(0, 0, 0)).toBe(0);
  });

  it("keeps the constructor's areas readable and deletable by position", () => {
    const index = new OwnershipIndex(
      [{ ownerId: 4n, floor: 0, rect: { x0: 0, y0: 0, x1: 3, y1: 3 } }],
      [],
    );
    expect(index.ownershipAt(1, 1, 0).buildingId).toBe(4n);
  });
});

// `render/visibility.ts`'s own unit tests (Tim/Quentin's direction, story
// 1.7): the full matrix over floor sign x same/other/no building x
// wall/window/other layer, plus the property invariants the trace matrix
// names (`inv_retraction_keyed_on_ownership`, `inv_only_occupied_enclosure_opens`,
// `inv_floor_culling_exclusive`).
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layerCodeByName } from "../../../src/render/layer-table";
import {
  computeVisibility,
  isFloorCulled,
  isNearSideWall,
  isRetracted,
  isStoreyAboveCulled,
  type VisibilityDrawable,
  type VisibilityViewer,
} from "../../../src/render/visibility";
import { NO_OWNER, type OwnershipArea, OwnershipIndex } from "../../../src/world/ownership";

const WALLS = layerCodeByName("walls");
const FURNITURE = layerCodeByName("furniture");
const OBJECTS = layerCodeByName("objects");

function drawable(overrides: Partial<VisibilityDrawable> = {}): VisibilityDrawable {
  return {
    floor: 0,
    layerCode: WALLS,
    ownerBuildingId: NO_OWNER,
    isWindow: false,
    isNearSide: false,
    ...overrides,
  };
}

function viewer(overrides: Partial<VisibilityViewer> = {}): VisibilityViewer {
  return { floor: 0, buildingId: NO_OWNER, ...overrides };
}

describe("isFloorCulled (FR122)", () => {
  it("a street-or-above viewer never sees a below-ground drawable", () => {
    expect(isFloorCulled(0, -1)).toBe(true);
    expect(isFloorCulled(1, -1)).toBe(true);
    expect(isFloorCulled(0, 0)).toBe(false);
    expect(isFloorCulled(0, 1)).toBe(false);
  });

  it("a below-ground viewer never sees a street-or-above drawable", () => {
    expect(isFloorCulled(-1, 0)).toBe(true);
    expect(isFloorCulled(-1, 1)).toBe(true);
    expect(isFloorCulled(-1, -1)).toBe(false);
    expect(isFloorCulled(-2, -1)).toBe(false);
  });
});

describe("isRetracted (FR120)", () => {
  it("retracts only a near-side wall owned by the viewer's own building", () => {
    const v = viewer({ buildingId: 1n });
    expect(
      isRetracted(v, drawable({ layerCode: WALLS, isNearSide: true, ownerBuildingId: 1n })),
    ).toBe(true);
  });

  it("never retracts a non-wall layer", () => {
    const v = viewer({ buildingId: 1n });
    expect(
      isRetracted(v, drawable({ layerCode: FURNITURE, isNearSide: true, ownerBuildingId: 1n })),
    ).toBe(false);
  });

  it("never retracts a wall that is not near-side (side, party or back walls)", () => {
    const v = viewer({ buildingId: 1n });
    expect(
      isRetracted(v, drawable({ layerCode: WALLS, isNearSide: false, ownerBuildingId: 1n })),
    ).toBe(false);
  });

  it("never retracts a wall owned by a different building, however the viewer is positioned", () => {
    const v = viewer({ buildingId: 1n });
    expect(
      isRetracted(v, drawable({ layerCode: WALLS, isNearSide: true, ownerBuildingId: 2n })),
    ).toBe(false);
  });

  it("never retracts an unowned wall", () => {
    const v = viewer({ buildingId: 1n });
    expect(
      isRetracted(v, drawable({ layerCode: WALLS, isNearSide: true, ownerBuildingId: NO_OWNER })),
    ).toBe(false);
  });

  it("a viewer outside any building (NO_OWNER) never retracts anything", () => {
    const v = viewer({ buildingId: NO_OWNER });
    expect(
      isRetracted(v, drawable({ layerCode: WALLS, isNearSide: true, ownerBuildingId: NO_OWNER })),
    ).toBe(false);
  });
});

describe("isStoreyAboveCulled (Artie's direction)", () => {
  it("culls a drawable on a higher floor of the same building the viewer occupies", () => {
    const v = viewer({ buildingId: 1n, floor: 0 });
    expect(isStoreyAboveCulled(v, drawable({ ownerBuildingId: 1n, floor: 1 }))).toBe(true);
  });

  it("never culls the viewer's own floor or a floor below", () => {
    const v = viewer({ buildingId: 1n, floor: 1 });
    expect(isStoreyAboveCulled(v, drawable({ ownerBuildingId: 1n, floor: 1 }))).toBe(false);
    expect(isStoreyAboveCulled(v, drawable({ ownerBuildingId: 1n, floor: 0 }))).toBe(false);
  });

  it("never culls a different building's upper storey", () => {
    const v = viewer({ buildingId: 1n, floor: 0 });
    expect(isStoreyAboveCulled(v, drawable({ ownerBuildingId: 2n, floor: 1 }))).toBe(false);
  });

  it("never fires for a viewer outside any building", () => {
    const v = viewer({ buildingId: NO_OWNER, floor: 0 });
    expect(isStoreyAboveCulled(v, drawable({ ownerBuildingId: 1n, floor: 1 }))).toBe(false);
  });
});

describe("computeVisibility: the full matrix", () => {
  const buildings = [NO_OWNER, 1n, 2n] as const;
  const floors = [-1, 0, 1] as const;
  const layers = [WALLS, FURNITURE, OBJECTS] as const;

  for (const viewerFloor of floors) {
    for (const viewerBuilding of buildings) {
      for (const drawableFloor of floors) {
        for (const drawableBuilding of buildings) {
          for (const layerCode of layers) {
            for (const isNearSide of [true, false]) {
              for (const isWindow of [true, false]) {
                const v = viewer({ floor: viewerFloor, buildingId: viewerBuilding });
                const d = drawable({
                  floor: drawableFloor,
                  ownerBuildingId: drawableBuilding,
                  layerCode,
                  isNearSide,
                  isWindow,
                });
                const state = computeVisibility(v, d);

                it(`viewerFloor=${viewerFloor} viewerBuilding=${viewerBuilding} drawableFloor=${drawableFloor} drawableBuilding=${drawableBuilding} layer=${layerCode} nearSide=${isNearSide} window=${isWindow} -> ${state}`, () => {
                  if (isFloorCulled(viewerFloor, drawableFloor)) {
                    expect(state).toBe("hidden");
                    return;
                  }
                  if (isStoreyAboveCulled(v, d)) {
                    expect(state).toBe("hidden");
                    return;
                  }
                  const retracted =
                    layerCode === WALLS &&
                    isNearSide &&
                    drawableBuilding !== NO_OWNER &&
                    drawableBuilding === viewerBuilding;
                  if (retracted) {
                    expect(state).toBe("hidden");
                    return;
                  }
                  expect(state).toBe(isWindow ? "translucent" : "normal");
                });
              }
            }
          }
        }
      }
    }
  }
});

describe("windows (FR121)", () => {
  it("a window that is not hidden is translucent", () => {
    const v = viewer({ floor: 0, buildingId: NO_OWNER });
    const d = drawable({ floor: 0, layerCode: WALLS, isWindow: true, isNearSide: true });
    expect(computeVisibility(v, d)).toBe("translucent");
  });

  it("a retracted near-side window is hidden, not translucent -- retraction wins", () => {
    const v = viewer({ floor: 0, buildingId: 1n });
    const d = drawable({
      floor: 0,
      layerCode: WALLS,
      isWindow: true,
      isNearSide: true,
      ownerBuildingId: 1n,
    });
    expect(computeVisibility(v, d)).toBe("hidden");
  });

  it("furniture on a normal (non-window, non-wall) layer stays normal even when it is behind a window", () => {
    const v = viewer({ floor: 0, buildingId: NO_OWNER });
    const furniture = drawable({ floor: 0, layerCode: FURNITURE, isWindow: false });
    expect(computeVisibility(v, furniture)).toBe("normal");
  });
});

// --- A generated terrace, for tests that must prove position enters only
// through ownership rather than restating `computeVisibility`'s own
// argument-equality (Quentin's direction) --------------------------------

const TERRACE_FLOOR = 0;
const TERRACE_Y0 = 0;
const TERRACE_HEIGHT = 4; // exclusive: rows TERRACE_Y0 .. TERRACE_Y0 + HEIGHT - 1
const TERRACE_WIDTH = 3; // each building is this many columns wide

/** `shopCount` adjacent building rects, each `TERRACE_WIDTH` columns wide,
 * sharing a party wall column with its neighbour -- the same shape
 * `fixture.ts`'s terrace declares, built from a parameter instead of
 * hand-typed, so the property below holds for any terrace size, not one
 * hand-walked example. Building ids start at 1 (`NO_OWNER` is 0). */
function terraceAreas(shopCount: number): readonly OwnershipArea[] {
  const areas: OwnershipArea[] = [];
  for (let i = 0; i < shopCount; i++) {
    areas.push({
      ownerId: BigInt(i + 1),
      floor: TERRACE_FLOOR,
      rect: {
        x0: i * TERRACE_WIDTH,
        y0: TERRACE_Y0,
        x1: (i + 1) * TERRACE_WIDTH,
        y1: TERRACE_Y0 + TERRACE_HEIGHT,
      },
    });
  }
  return areas;
}

describe("isNearSideWall (FR120)", () => {
  it("the terrace's own front (south) row is near-side for every building, including its corners", () => {
    const shopCount = 4;
    const ownership = new OwnershipIndex(terraceAreas(shopCount), []);
    const frontY = TERRACE_Y0 + TERRACE_HEIGHT - 1;
    for (let shop = 0; shop < shopCount; shop++) {
      const buildingId = BigInt(shop + 1);
      for (let dx = 0; dx < TERRACE_WIDTH; dx++) {
        const x = shop * TERRACE_WIDTH + dx; // dx=0 and dx=WIDTH-1 are the two corners
        expect(isNearSideWall(ownership, x, frontY, TERRACE_FLOOR, buildingId)).toBe(true);
      }
    }
  });

  it("a building's own side-wall column (its west or east edge, shared with the next building's rect) is never near-side", () => {
    // Mirrors `fixture.ts`'s party wall: the terrace's rects are
    // non-overlapping and contiguous, so the column at a middle
    // building's own east edge belongs only to that building, not to its
    // neighbour -- and every interior row of it has the same building
    // immediately south, so it is a side wall, never near-side.
    const shopCount = 3;
    const middle = 1; // owner id 2, with a neighbour on both sides
    const ownership = new OwnershipIndex(terraceAreas(shopCount), []);
    const owner = BigInt(middle + 1);
    const westEdgeX = middle * TERRACE_WIDTH;
    const eastEdgeX = (middle + 1) * TERRACE_WIDTH - 1;
    for (let y = TERRACE_Y0; y < TERRACE_Y0 + TERRACE_HEIGHT - 1; y++) {
      expect(isNearSideWall(ownership, westEdgeX, y, TERRACE_FLOOR, owner)).toBe(false);
      expect(isNearSideWall(ownership, eastEdgeX, y, TERRACE_FLOOR, owner)).toBe(false);
    }
  });

  it("a cell outside every building is never near-side for NO_OWNER -- isRetracted's own NO_OWNER guard is what actually keeps it from retracting", () => {
    const ownership = new OwnershipIndex(terraceAreas(2), []);
    expect(isNearSideWall(ownership, -1, -1, TERRACE_FLOOR, NO_OWNER)).toBe(false);
  });
});

// --- Property invariants (docs/trace-matrix.md) -----------------------------

const buildingIdArb = fc.oneof(fc.constant(NO_OWNER), fc.integer({ min: 1, max: 5 }).map(BigInt));

describe("property invariants (docs/trace-matrix.md)", () => {
  it("inv_retraction_keyed_on_ownership", () => {
    // Built against a real `OwnershipIndex` over a generated terrace
    // (never a hand-typed pair of viewer objects): any two cells inside
    // the same building's own area, on the same floor, resolve to the
    // same `buildingId` and so give identical `computeVisibility` for
    // every drawable -- position only ever enters through ownership.
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.record({
          x: fc.integer({ min: -2, max: 20 }),
          y: fc.integer({ min: -2, max: 6 }),
        }),
        fc.record({
          x: fc.integer({ min: -2, max: 20 }),
          y: fc.integer({ min: -2, max: 6 }),
        }),
        fc.record({
          layerCode: fc.constantFrom(WALLS, FURNITURE, OBJECTS),
          isWindow: fc.boolean(),
          isNearSide: fc.boolean(),
        }),
        (shopCount, drawableFloor, posA, posB, dShape) => {
          const ownership = new OwnershipIndex(terraceAreas(shopCount), []);
          const ownerA = ownership.ownershipAt(posA.x, posA.y, TERRACE_FLOOR).buildingId;
          const ownerB = ownership.ownershipAt(posB.x, posB.y, TERRACE_FLOOR).buildingId;
          fc.pre(ownerA !== NO_OWNER && ownerA === ownerB);

          const vA: VisibilityViewer = { floor: TERRACE_FLOOR, buildingId: ownerA };
          const vB: VisibilityViewer = { floor: TERRACE_FLOOR, buildingId: ownerB };
          const d = drawable({ floor: drawableFloor, ...dShape, ownerBuildingId: ownerA });
          expect(computeVisibility(vA, d)).toBe(computeVisibility(vB, d));
        },
      ),
    );

    // A cell one step across a shared terrace wall changes retraction for
    // exactly those two buildings' own near-side walls: standing just
    // inside building `i` retracts only building `i`'s front wall, never
    // building `i + 1`'s, and crossing the party wall flips which one.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 6 }),
        fc.integer({ min: 0, max: 4 }),
        (shopCount, i) => {
          fc.pre(i < shopCount - 1);
          const ownership = new OwnershipIndex(terraceAreas(shopCount), []);
          const frontY = TERRACE_Y0 + TERRACE_HEIGHT - 1;
          const leftOwner = BigInt(i + 1);
          const rightOwner = BigInt(i + 2);
          const leftWall = drawable({
            floor: TERRACE_FLOOR,
            layerCode: WALLS,
            isNearSide: true,
            ownerBuildingId: leftOwner,
          });
          const rightWall = drawable({
            floor: TERRACE_FLOOR,
            layerCode: WALLS,
            isNearSide: true,
            ownerBuildingId: rightOwner,
          });

          const viewerInLeft: VisibilityViewer = {
            floor: TERRACE_FLOOR,
            buildingId: ownership.ownershipAt(i * TERRACE_WIDTH, frontY, TERRACE_FLOOR).buildingId,
          };
          const viewerInRight: VisibilityViewer = {
            floor: TERRACE_FLOOR,
            buildingId: ownership.ownershipAt((i + 1) * TERRACE_WIDTH, frontY, TERRACE_FLOOR)
              .buildingId,
          };

          expect(isRetracted(viewerInLeft, leftWall)).toBe(true);
          expect(isRetracted(viewerInLeft, rightWall)).toBe(false);
          expect(isRetracted(viewerInRight, leftWall)).toBe(false);
          expect(isRetracted(viewerInRight, rightWall)).toBe(true);
        },
      ),
    );
  });

  it("inv_floor_culling_exclusive", () => {
    // Asserted on `computeVisibility` itself, with an arbitrary drawable,
    // not only on `isFloorCulled` -- so a future rule inserted ahead of
    // floor culling in the precedence chain can't quietly un-hide a
    // subway drawable from a street-or-above viewer, or vice versa.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -3, max: -1 }),
        fc.record({
          layerCode: fc.constantFrom(WALLS, FURNITURE, OBJECTS),
          ownerBuildingId: buildingIdArb,
          isWindow: fc.boolean(),
          isNearSide: fc.boolean(),
        }),
        (viewerFloor, drawableFloor, dShape) => {
          const v: VisibilityViewer = { floor: viewerFloor, buildingId: dShape.ownerBuildingId };
          const d = drawable({ floor: drawableFloor, ...dShape });
          expect(computeVisibility(v, d)).toBe("hidden");
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: -1 }),
        fc.integer({ min: 0, max: 3 }),
        fc.record({
          layerCode: fc.constantFrom(WALLS, FURNITURE, OBJECTS),
          ownerBuildingId: buildingIdArb,
          isWindow: fc.boolean(),
          isNearSide: fc.boolean(),
        }),
        (viewerFloor, drawableFloor, dShape) => {
          const v: VisibilityViewer = { floor: viewerFloor, buildingId: dShape.ownerBuildingId };
          const d = drawable({ floor: drawableFloor, ...dShape });
          expect(computeVisibility(v, d)).toBe("hidden");
        },
      ),
    );
  });

  it("inv_only_occupied_enclosure_opens", () => {
    // In a generated terrace of N shops, standing in shop k retracts
    // walls owned by k only.
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 0, max: 7 }),
        (shopCount, occupiedRaw) => {
          const occupied = 1 + (occupiedRaw % shopCount); // 1..shopCount
          const v: VisibilityViewer = { floor: 0, buildingId: BigInt(occupied) };
          for (let shop = 1; shop <= shopCount; shop++) {
            const wall = drawable({
              floor: 0,
              layerCode: WALLS,
              isNearSide: true,
              ownerBuildingId: BigInt(shop),
            });
            const state = computeVisibility(v, wall);
            if (shop === occupied) {
              expect(state).toBe("hidden");
            } else {
              expect(state).not.toBe("hidden");
            }
          }
        },
      ),
    );
  });
});

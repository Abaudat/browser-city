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
  isRetracted,
  isStoreyAboveCulled,
  NO_OWNER,
  type VisibilityDrawable,
  type VisibilityViewer,
} from "../../../src/render/visibility";

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

// --- Property invariants (docs/trace-matrix.md) -----------------------------

const buildingIdArb = fc.oneof(fc.constant(NO_OWNER), fc.integer({ min: 1, max: 5 }).map(BigInt));
const floorArb = fc.integer({ min: -2, max: 2 });

describe("property invariants (docs/trace-matrix.md)", () => {
  it("inv_retraction_keyed_on_ownership", () => {
    // Two viewer positions with the same (floor, buildingId) give
    // identical visibility for every drawable -- and a wall with a
    // different owner is never retracted, however close the viewer's own
    // building id is to it.
    fc.assert(
      fc.property(
        floorArb,
        buildingIdArb,
        fc.record({
          floor: floorArb,
          layerCode: fc.constantFrom(WALLS, FURNITURE, OBJECTS),
          ownerBuildingId: buildingIdArb,
          isWindow: fc.boolean(),
          isNearSide: fc.boolean(),
        }),
        (viewerFloor, viewerBuilding, d) => {
          const v1 = { floor: viewerFloor, buildingId: viewerBuilding };
          const v2 = { floor: viewerFloor, buildingId: viewerBuilding };
          expect(computeVisibility(v1, d)).toBe(computeVisibility(v2, d));
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 5 }).map(BigInt),
        fc.integer({ min: 1, max: 5 }).map(BigInt),
        floorArb,
        (viewerBuilding, wallOwner, floor) => {
          fc.pre(viewerBuilding !== wallOwner);
          const v = { floor, buildingId: viewerBuilding };
          const d = drawable({
            floor,
            layerCode: WALLS,
            isNearSide: true,
            ownerBuildingId: wallOwner,
          });
          expect(isRetracted(v, d)).toBe(false);
        },
      ),
    );
  });

  it("inv_floor_culling_exclusive", () => {
    // Player floor >= 0 means no floor -1-or-below drawable is ever
    // visible; player floor < 0 means no floor >= 0 drawable is ever
    // visible.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: -3, max: -1 }),
        (viewerFloor, drawableFloor) => {
          expect(isFloorCulled(viewerFloor, drawableFloor)).toBe(true);
        },
      ),
    );
    fc.assert(
      fc.property(
        fc.integer({ min: -3, max: -1 }),
        fc.integer({ min: 0, max: 3 }),
        (viewerFloor, drawableFloor) => {
          expect(isFloorCulled(viewerFloor, drawableFloor)).toBe(true);
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

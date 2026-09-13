// `render/pixi-visibility.ts`'s own unit tests (Tim's direction, story
// 1.7): the gate that skips re-applying visibility unless the viewer's own
// `(floor, buildingId)` actually changed -- proven with fake sprite-like
// objects whose setters are counted, never a real Pixi `Sprite`.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { layerCodeByName } from "../../../src/render/layer-table";
import { NO_OWNER } from "../../../src/render/visibility";
import { VisibilityApplier, type VisibilityMember } from "../../../src/render/pixi-visibility";

const FURNITURE = layerCodeByName("furniture");

const WALLS = layerCodeByName("walls");

/** A fake sprite that counts every write to `visible`/`alpha`, so a test
 * can assert "no state writes happened", not merely "the state is still
 * correct" (which would pass even if the adapter wrote the same value
 * every frame). */
function fakeSprite() {
  let visible = true;
  let alpha = 1;
  let writes = 0;
  return {
    get visible() {
      return visible;
    },
    set visible(v: boolean) {
      visible = v;
      writes++;
    },
    get alpha() {
      return alpha;
    },
    set alpha(a: number) {
      alpha = a;
      writes++;
    },
    get writeCount() {
      return writes;
    },
  };
}

function member(overrides: Partial<VisibilityMember["drawable"]> = {}): VisibilityMember {
  return {
    drawable: {
      floor: 0,
      layerCode: WALLS,
      ownerBuildingId: NO_OWNER,
      isWindow: false,
      isNearSide: false,
      ...overrides,
    },
    view: fakeSprite(),
  };
}

describe("VisibilityApplier", () => {
  it("applies on the first call even though there is no 'previous' viewer yet", () => {
    const applier = new VisibilityApplier();
    const wallMember = member({ layerCode: WALLS, isNearSide: true, ownerBuildingId: 1n });
    const applied = applier.apply([wallMember], { floor: 0, buildingId: 1n }, 0.5);
    expect(applied).toBe(true);
    expect(wallMember.view.visible).toBe(false); // retracted
  });

  it("does not write to any sprite across a stream of frames with an unchanged viewer, after the first", () => {
    const applier = new VisibilityApplier();
    const members = [
      member({ layerCode: WALLS, isNearSide: true, ownerBuildingId: 1n }),
      member({ isWindow: true }),
      member({ floor: -1 }),
    ];
    const viewer = { floor: 0, buildingId: 1n };

    applier.apply(members, viewer, 0.5);
    const writeCountsAfterFirst = (members as unknown as { view: { writeCount: number } }[]).map(
      (m) => m.view.writeCount,
    );
    expect(writeCountsAfterFirst.some((c) => c > 0)).toBe(true);

    for (let frame = 0; frame < 50; frame++) {
      const applied = applier.apply(members, { floor: 0, buildingId: 1n }, 0.5);
      expect(applied).toBe(false);
    }

    const writeCountsAfterMany = (members as unknown as { view: { writeCount: number } }[]).map(
      (m) => m.view.writeCount,
    );
    expect(writeCountsAfterMany).toEqual(writeCountsAfterFirst);
  });

  it("re-applies the moment the viewer's floor or buildingId actually changes", () => {
    const applier = new VisibilityApplier();
    const wallMember = member({ layerCode: WALLS, isNearSide: true, ownerBuildingId: 1n });

    applier.apply([wallMember], { floor: 0, buildingId: 1n }, 0.5);
    expect(wallMember.view.visible).toBe(false);

    const appliedAfterMove = applier.apply([wallMember], { floor: 0, buildingId: 2n }, 0.5);
    expect(appliedAfterMove).toBe(true);
    expect(wallMember.view.visible).toBe(true); // no longer retracted
  });

  it("sets alpha to the resolved window balance value only for translucent members, 1 otherwise", () => {
    const applier = new VisibilityApplier();
    const windowMember = member({ isWindow: true });
    const normalMember = member({});
    applier.apply([windowMember, normalMember], { floor: 0, buildingId: NO_OWNER }, 0.42);
    expect(windowMember.view.alpha).toBe(0.42);
    expect(normalMember.view.alpha).toBe(1);
  });

  it("inv_visibility_never_reorders_pool", () => {
    // Visibility is applied after the sort and never adds or removes pool
    // members: hidden sprites get `visible = false`, but the ordered
    // `stableId` list is exactly the same whether or not visibility has
    // been applied -- this is what keeps story 1.6's goldens and the
    // permutation invariant valid once retraction/culling exist.
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            stableId: fc.integer({ min: 1, max: 50 }).map(BigInt),
            floor: fc.integer({ min: -2, max: 2 }),
            layerCode: fc.constantFrom(WALLS, FURNITURE),
            ownerBuildingId: fc.oneof(fc.constant(NO_OWNER), fc.integer({ min: 1, max: 3 }).map(BigInt)),
            isWindow: fc.boolean(),
            isNearSide: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.record({
          floor: fc.integer({ min: -2, max: 2 }),
          buildingId: fc.oneof(fc.constant(NO_OWNER), fc.integer({ min: 1, max: 3 }).map(BigInt)),
        }),
        (drawables, viewer) => {
          const members = drawables.map((drawable) => ({
            drawable,
            view: { visible: true, alpha: 1 },
          }));
          const idsBefore = members.map((m) => m.drawable.stableId);

          const applier = new VisibilityApplier();
          applier.applyForce(members, viewer, 0.5);

          const idsAfter = members.map((m) => m.drawable.stableId);
          expect(idsAfter).toEqual(idsBefore); // same order, same membership
          expect(members).toHaveLength(drawables.length); // never added to or removed from
        },
      ),
    );
  });
});

// `render/pixi-visibility.ts`'s own unit tests (Tim's direction, story
// 1.7): the gate that skips re-applying visibility unless the viewer's own
// `(floor, buildingId)` actually changed -- proven with fake sprite-like
// objects whose setters are counted, never a real Pixi `Sprite`.
import fc from "fast-check";
import { Container, Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { layerCodeByName } from "../../../src/render/layer-table";
import { applyDepthOrder, type OrderedMember } from "../../../src/render/pixi-order";
import { VisibilityApplier, type VisibilityMember } from "../../../src/render/pixi-visibility";
import type { Drawable } from "../../../src/render/sort-key";
import type { VisibilityDrawable } from "../../../src/render/visibility";
import { NO_OWNER } from "../../../src/world/ownership";

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
    // The real sequence `scene.ts` runs every frame: order, apply
    // visibility, order again -- against a real `Container` and the real
    // `applyDepthOrder` (not a bare array `VisibilityApplier` never
    // touches, which cannot fail this invariant by construction). Hidden
    // members get `visible = false` but stay in the container, at their
    // sorted position, exactly like every other member.
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 50 }), { minLength: 1, maxLength: 20 }),
        fc.array(
          fc.record({
            y: fc.integer({ min: -20, max: 20 }),
            rank: fc.integer({ min: 0, max: 5 }),
            floor: fc.integer({ min: -2, max: 2 }),
            layerCode: fc.constantFrom(WALLS, FURNITURE),
            ownerBuildingId: fc.oneof(
              fc.constant(NO_OWNER),
              fc.integer({ min: 1, max: 3 }).map(BigInt),
            ),
            isWindow: fc.boolean(),
            isNearSide: fc.boolean(),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.record({
          floor: fc.integer({ min: -2, max: 2 }),
          buildingId: fc.oneof(fc.constant(NO_OWNER), fc.integer({ min: 1, max: 3 }).map(BigInt)),
        }),
        (ids, specs, viewer) => {
          const n = Math.min(ids.length, specs.length);
          const members: (OrderedMember & VisibilityMember<Drawable & VisibilityDrawable>)[] = [];
          for (let i = 0; i < n; i++) {
            const id = ids[i];
            const spec = specs[i];
            if (id === undefined || spec === undefined) throw new Error("unreachable");
            const drawable: Drawable & VisibilityDrawable = {
              x: 0,
              y: spec.y,
              rank: spec.rank,
              stableId: BigInt(id),
              floor: spec.floor,
              layerCode: spec.layerCode,
              ownerBuildingId: spec.ownerBuildingId,
              isWindow: spec.isWindow,
              isNearSide: spec.isNearSide,
            };
            members.push({ drawable, view: new Sprite(Texture.EMPTY) });
          }

          const container = new Container();
          for (const m of members) container.addChild(m.view);
          const order: bigint[] = [];
          applyDepthOrder(container, members, order);
          const childrenBefore = [...container.children];
          const idsBefore = [...order];

          const applier = new VisibilityApplier();
          applier.applyForce(members, viewer, 0.5);

          applyDepthOrder(container, members, order);

          expect(order).toEqual(idsBefore); // same order
          expect(container.children).toEqual(childrenBefore); // same membership, same sequence
          expect(container.children).toHaveLength(members.length); // never added to or removed from
        },
      ),
    );
  });
});

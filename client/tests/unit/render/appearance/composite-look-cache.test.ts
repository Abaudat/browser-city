// Story 2.7 (Quentin/Tim's direction, cycle 1): the slot-claiming side of
// the composite-look lifecycle, pure -- no pixi.js, no canvas. Covers the
// cases both leads asked for: an entry released while its own build is
// still in flight is detectably stale, never corrupting the slot's next
// occupant; exhaustion rejects by name; a cell-geometry mismatch (not
// merely a pixel-size mismatch) is rejected by name too.
import { describe, expect, it } from "vitest";
import type { AppearanceLayoutDef } from "../../../../src/defs/types";
import {
  cellGeometryOf,
  SlotClaimAllocator,
} from "../../../../src/render/appearance/composite-look-cache";

const LAYOUT: AppearanceLayoutDef = {
  id: 1,
  key: "adult",
  family: "adult",
  cellWidth: 16,
  cellHeight: 32,
  directions: ["down"],
  rows: [{ animation: "idle", row: 0, framesPerDirection: 1 }],
  acceptedSizes: [{ width: 16, height: 32 }],
};

// One row, one direction, one frame, a deliberately huge cell: 1010x2046
// -> a 1012x2048 gutter-padded slot -> exactly
// `floor(2048/1012) * floor(2048/2048)` = 2 x 1 = 2 slots on one page --
// small and exactly known, so exhaustion is reachable without acquiring
// thousands of claims.
function twoSlotLayout(): AppearanceLayoutDef {
  return {
    ...LAYOUT,
    cellWidth: 1010,
    cellHeight: 2046,
  };
}

describe("SlotClaimAllocator", () => {
  it("claims a fresh slot per call, starting at index 0", () => {
    const allocator = new SlotClaimAllocator(1);
    const a = allocator.claim(LAYOUT);
    const b = allocator.claim(LAYOUT);
    expect(a.slotIndex).toBe(0);
    expect(b.slotIndex).toBe(1);
    expect(a.isStale()).toBe(false);
    expect(b.isStale()).toBe(false);
  });

  it("every claim carries the shared pool's own slot width/height", () => {
    const allocator = new SlotClaimAllocator(1);
    const a = allocator.claim(LAYOUT);
    // gutter-padded pitch: (16+2) x (32+2).
    expect(a.width).toBe(18);
    expect(a.height).toBe(34);
  });

  it("release frees a slot for immediate reuse, and marks the released claim stale", () => {
    const layout = twoSlotLayout();
    const allocator = new SlotClaimAllocator(1); // 2 slots total
    const a = allocator.claim(layout);
    allocator.release(a);
    expect(a.isStale()).toBe(true);

    const b = allocator.claim(layout);
    expect(b.slotIndex).toBe(a.slotIndex);
    expect(b.isStale()).toBe(false);
  });

  it("release is a no-op for an already-released claim -- never double-frees, never corrupts a later occupant", () => {
    const layout = twoSlotLayout(); // 2 slots total
    const allocator = new SlotClaimAllocator(1);
    const a = allocator.claim(layout);
    allocator.release(a);
    const b = allocator.claim(layout); // reuses a's own freed slot

    // A second, late release of "a" (e.g. a failed build's own cleanup
    // racing an eviction that already ran) must never invalidate "b",
    // which now legitimately owns that same slot index.
    allocator.release(a);
    expect(b.isStale()).toBe(false);
  });

  // Tim's direction, cycle 1: an entry evicted (or otherwise released)
  // while its own async build is still in flight must never let that
  // build draw into a slot handed to someone else in the meantime --
  // `isStale()` is the mechanism a caller (`appearance-texture.ts`)
  // checks right before drawing.
  it("a claim released mid-build is detectably stale even after its own slot is reused", () => {
    const layout = twoSlotLayout(); // 2 slots total
    const allocator = new SlotClaimAllocator(1);
    const a = allocator.claim(layout);
    allocator.release(a); // simulates an eviction while a's own build is still in flight

    const c = allocator.claim(layout); // reuses a's own freed slot

    expect(a.isStale()).toBe(true); // a's own build must abort before drawing
    expect(c.isStale()).toBe(false); // c's own claim is still current
    expect(c.slotIndex).toBe(a.slotIndex);
  });

  it("exhaustion (every slot claimed and never released) throws by name, and claims no third page", () => {
    const layout = twoSlotLayout(); // 2 slots total
    const allocator = new SlotClaimAllocator(1);
    allocator.claim(layout);
    allocator.claim(layout);
    expect(() => allocator.claim(layout)).toThrow(/every slot is in use/);
  });

  it("throws by name when a later layout's own cell geometry does not match the pool's own shape, even at the same pixel size", () => {
    const allocator = new SlotClaimAllocator(1);
    allocator.claim(LAYOUT);
    // Same cellWidth/cellHeight and one direction, but a different
    // animation name -- same *pixel* footprint, different geometry.
    const differentAnimation: AppearanceLayoutDef = {
      ...LAYOUT,
      key: "kid",
      rows: [{ animation: "walk", row: 0, framesPerDirection: 1 }],
    };
    expect(() => allocator.claim(differentAnimation)).toThrow(/kid/);
  });

  it("a second layout with the exact same cell geometry (even a different family/key) shares the pool without throwing", () => {
    const allocator = new SlotClaimAllocator(1);
    allocator.claim(LAYOUT);
    const sameGeometry: AppearanceLayoutDef = { ...LAYOUT, id: 2, key: "kid", family: "kid" };
    expect(() => allocator.claim(sameGeometry)).not.toThrow();
  });

  it("totalSlots is undefined before the first claim, then the real pool size", () => {
    const allocator = new SlotClaimAllocator(1);
    expect(allocator.totalSlots).toBeUndefined();
    allocator.claim(twoSlotLayout());
    expect(allocator.totalSlots).toBe(2);
  });
});

describe("cellGeometryOf", () => {
  it("carries cell size, directions and each row's own animation/frame count", () => {
    const layout: AppearanceLayoutDef = {
      id: 1,
      key: "adult",
      family: "adult",
      cellWidth: 16,
      cellHeight: 32,
      directions: ["right", "up", "left", "down"],
      rows: [
        { animation: "idle", row: 1, framesPerDirection: 6 },
        { animation: "walk", row: 2, framesPerDirection: 6 },
      ],
      acceptedSizes: [],
    };
    expect(cellGeometryOf(layout)).toEqual({
      cellWidth: 16,
      cellHeight: 32,
      directions: ["right", "up", "left", "down"],
      rows: [
        { animation: "idle", framesPerDirection: 6 },
        { animation: "walk", framesPerDirection: 6 },
      ],
    });
  });
});

// Story 2.7 (Tim's direction, AC3): the composite-page slot arithmetic,
// pure -- no pixi.js, no canvas.
import { describe, expect, it } from "vitest";
import type { AppearanceLayoutDef } from "../../../../src/defs/types";
import {
  COMPOSITE_PAGE_SIZE,
  computeSlotLayout,
  SlotAllocator,
  slotIndexToPosition,
} from "../../../../src/render/appearance/composite-slots";

const ADULT_LAYOUT: AppearanceLayoutDef = {
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
  acceptedSizes: [{ width: 896, height: 656 }],
};

describe("computeSlotLayout", () => {
  it("derives a slot's own size from the layout's compact strip plus a 1px gutter per cell", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 1);
    // 24 columns x 18px, 2 rows x 34px (frame-rect.test.ts's own numbers).
    expect(slots.slotWidth).toBe(24 * 18);
    expect(slots.slotHeight).toBe(2 * 34);
  });

  it("tiles slots row-major across the page, floor division, no partial slots", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 1);
    expect(slots.slotsPerRow).toBe(Math.floor(COMPOSITE_PAGE_SIZE / slots.slotWidth));
    expect(slots.slotsPerCol).toBe(Math.floor(COMPOSITE_PAGE_SIZE / slots.slotHeight));
    expect(slots.slotsPerPage).toBe(slots.slotsPerRow * slots.slotsPerCol);
    expect(slots.slotsPerPage).toBeGreaterThan(0);
  });

  it("multiplies capacity by pageCount", () => {
    const one = computeSlotLayout(ADULT_LAYOUT, 1);
    const two = computeSlotLayout(ADULT_LAYOUT, 2);
    expect(two.totalSlots).toBe(one.slotsPerPage * 2);
  });
});

describe("slotIndexToPosition", () => {
  it("fills page 0 before page 1", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 2);
    const lastOfPage0 = slotIndexToPosition(slots.slotsPerPage - 1, slots);
    const firstOfPage1 = slotIndexToPosition(slots.slotsPerPage, slots);
    expect(lastOfPage0.page).toBe(0);
    expect(firstOfPage1.page).toBe(1);
  });

  it("is row-major within a page: index 1 sits one slot to the right of index 0", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 1);
    const a = slotIndexToPosition(0, slots);
    const b = slotIndexToPosition(1, slots);
    expect(a).toEqual({ page: 0, x: 0, y: 0 });
    expect(b).toEqual({ page: 0, x: slots.slotWidth, y: 0 });
  });

  it("wraps to the next row once a page's own row is full", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 1);
    const firstOfRow2 = slotIndexToPosition(slots.slotsPerRow, slots);
    expect(firstOfRow2).toEqual({ page: 0, x: 0, y: slots.slotHeight });
  });

  it("no two distinct slot indices ever produce overlapping pixel footprints on the same page", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 2);
    const seen = new Map<number, { x0: number; y0: number; x1: number; y1: number }[]>();
    for (let i = 0; i < slots.totalSlots; i++) {
      const pos = slotIndexToPosition(i, slots);
      const box = {
        x0: pos.x,
        y0: pos.y,
        x1: pos.x + slots.slotWidth,
        y1: pos.y + slots.slotHeight,
      };
      const onThisPage = seen.get(pos.page) ?? [];
      for (const other of onThisPage) {
        const overlap =
          box.x0 < other.x1 && other.x0 < box.x1 && box.y0 < other.y1 && other.y0 < box.y1;
        expect(overlap).toBe(false);
      }
      onThisPage.push(box);
      seen.set(pos.page, onThisPage);
    }
  });

  it("throws, naming the index, for an index at or past totalSlots", () => {
    const slots = computeSlotLayout(ADULT_LAYOUT, 1);
    expect(() => slotIndexToPosition(slots.totalSlots, slots)).toThrow(String(slots.totalSlots));
    expect(() => slotIndexToPosition(-1, slots)).toThrow("-1");
  });

  it("throws when one slot cannot possibly fit a page (a pathological layout)", () => {
    const huge: AppearanceLayoutDef = {
      ...ADULT_LAYOUT,
      cellWidth: COMPOSITE_PAGE_SIZE,
      cellHeight: COMPOSITE_PAGE_SIZE,
      directions: ["down"],
      rows: [{ animation: "idle", row: 0, framesPerDirection: 1 }],
    };
    const slots = computeSlotLayout(huge, 1);
    expect(slots.slotsPerPage).toBe(0);
    expect(() => slotIndexToPosition(0, slots)).toThrow(/does not fit/);
  });
});

describe("SlotAllocator", () => {
  it("hands out fresh indices starting at 0", () => {
    const allocator = new SlotAllocator(3);
    expect(allocator.acquire()).toBe(0);
    expect(allocator.acquire()).toBe(1);
    expect(allocator.acquire()).toBe(2);
  });

  it("throws, naming the total, once every slot is in use", () => {
    const allocator = new SlotAllocator(1);
    allocator.acquire();
    expect(() => allocator.acquire()).toThrow("1");
  });

  it("reuses a released index before ever handing out a fresh one", () => {
    const allocator = new SlotAllocator(2);
    const a = allocator.acquire();
    const _b = allocator.acquire();
    allocator.release(a);
    expect(allocator.acquire()).toBe(a);
  });

  it("never hands out the same index twice while both are still held", () => {
    const allocator = new SlotAllocator(2);
    const a = allocator.acquire();
    const b = allocator.acquire();
    expect(a).not.toBe(b);
  });
});

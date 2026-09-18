// Story 2.7 (Tim's direction, AC3): pure slot arithmetic over
// `CHARACTER_COMPOSITE_PAGES` shared, canvas-backed composite pages --
// no `pixi.js`, no canvas. A "slot" is where one composited look's own
// frames live: `compositeStripSize(layout, COMPOSITE_CELL_GUTTER_PX)`'s
// own pixel footprint (a transparent gutter around every frame cell),
// tiled row-major across a fixed `COMPOSITE_PAGE_SIZE` page, page 0
// filled before page 1. Capacity is derived from this arithmetic, never
// a literal -- `APPEARANCE_TEXTURE_CACHE_CAPACITY` (the old
// one-texture-per-look cap) no longer exists.

import { compositeStripSize } from "../../defs/composite-strip";
import type { AppearanceLayoutDef } from "../../defs/types";

/** Every composite page is this many pixels square -- the same cap
 * `tools/defs-build`'s own atlas pages use (`ATLAS_PAGE_WIDTH`/
 * `ATLAS_PAGE_MAX_HEIGHT`), though composite pages are never packed by
 * that Rust packer: they are built, and only ever exist, client-side. */
export const COMPOSITE_PAGE_SIZE = 2048;

/** A transparent (never extruded) 1px gutter around every packed frame
 * cell inside a composite-page slot (Artie's direction): a character
 * frame sits on a transparent background, so stretched/extruded edges
 * would put coloured fringes around hats and hair -- simple transparency
 * is what stops bleed at a fractional camera position instead. */
export const COMPOSITE_CELL_GUTTER_PX = 1;

export interface SlotLayout {
  /** One slot's own pixel width/height, gutter included on every cell. */
  readonly slotWidth: number;
  readonly slotHeight: number;
  readonly slotsPerRow: number;
  readonly slotsPerCol: number;
  readonly slotsPerPage: number;
  /** `slotsPerPage * pageCount` -- the hard cap [`slotIndexToPosition`]
   * accepts; a caller past this must reject the acquire (Tim's
   * direction), never allocate a third page. */
  readonly totalSlots: number;
}

/** Derives one family layout's own slot capacity across `pageCount`
 * shared composite pages -- pure arithmetic, no allocation. */
export function computeSlotLayout(layout: AppearanceLayoutDef, pageCount: number): SlotLayout {
  const { width, height } = compositeStripSize(layout, COMPOSITE_CELL_GUTTER_PX);
  const slotsPerRow = width > 0 ? Math.floor(COMPOSITE_PAGE_SIZE / width) : 0;
  const slotsPerCol = height > 0 ? Math.floor(COMPOSITE_PAGE_SIZE / height) : 0;
  const slotsPerPage = slotsPerRow * slotsPerCol;
  return {
    slotWidth: width,
    slotHeight: height,
    slotsPerRow,
    slotsPerCol,
    slotsPerPage,
    totalSlots: slotsPerPage * pageCount,
  };
}

export interface SlotPosition {
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

/** Slot `index` (`0..totalSlots`) -> its own page and pixel origin --
 * page 0 fills before page 1 (Tim's direction: a normal street dirties
 * one page), row-major within a page. Throws, naming the index, on an
 * out-of-range slot or a layout too large to hold even one slot -- a
 * caller must check `index < totalSlots` itself before ever reaching
 * here (the same "reject the acquire" path a failed part fetch takes). */
export function slotIndexToPosition(index: number, layout: SlotLayout): SlotPosition {
  if (layout.slotsPerPage <= 0) {
    throw new Error(
      `composite-slots: one slot (${layout.slotWidth}x${layout.slotHeight}px) does not fit inside a ${COMPOSITE_PAGE_SIZE}x${COMPOSITE_PAGE_SIZE}px page`,
    );
  }
  if (index < 0 || index >= layout.totalSlots) {
    throw new Error(
      `composite-slots: slot index ${index} is out of range (0..${layout.totalSlots})`,
    );
  }
  const page = Math.floor(index / layout.slotsPerPage);
  const withinPage = index % layout.slotsPerPage;
  const col = withinPage % layout.slotsPerRow;
  const row = Math.floor(withinPage / layout.slotsPerRow);
  return { page, x: col * layout.slotWidth, y: row * layout.slotHeight };
}

/** Bookkeeping only -- which slot indices are free, which have never
 * been touched. Pure: no `pixi.js`, no canvas, so `appearance-cache.ts`'s
 * LRU/ref-count semantics (`AppearanceCache`) stay exactly as they are
 * (Tim's direction) -- this is only what `dispose` calls to free a slot
 * instead of destroying a texture, and what a cache miss calls to claim
 * one. A released slot is reused before ever handing out a fresh index,
 * so a slot's own frame `Texture`s (built once, lazily, the first time
 * its index is ever claimed) are reused indefinitely rather than left to
 * accumulate one set per index up to `totalSlots`. */
export class SlotAllocator {
  private readonly totalSlots: number;
  private nextUnused = 0;
  private readonly free: number[] = [];

  constructor(totalSlots: number) {
    this.totalSlots = totalSlots;
  }

  /** Claims a slot index, preferring a released one over a fresh one.
   * Throws, naming the total, once every slot is in use and none has
   * ever been released -- the caller (a failed `acquire`) rejects the
   * same way a failed part fetch does today, never falling back to a
   * third page or a standalone texture (Tim's direction). */
  acquire(): number {
    const released = this.free.pop();
    if (released !== undefined) return released;
    if (this.nextUnused >= this.totalSlots) {
      throw new Error(`composite-slots: every slot is in use (${this.totalSlots} total)`);
    }
    return this.nextUnused++;
  }

  release(index: number): void {
    this.free.push(index);
  }
}

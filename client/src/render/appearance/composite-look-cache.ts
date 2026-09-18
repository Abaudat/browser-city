// Story 2.7 (Quentin/Tim's direction, cycle 1): the slot side of the
// composite-look lifecycle -- which slot a claim owns, the cell-geometry
// guard that stops two families with a different animation/direction/
// frame shape from silently sharing one slot grid, and exhaustion --
// lives here, pure (no `pixi.js`, no canvas), so it is covered by the
// same unit-test bar every other pure module in this pipeline is.
//
// This module owns no key-level cache of its own (that stays
// `appearance-texture.ts`'s single `AppearanceCache<PendingLook>`, the
// same LRU/ref-count semantics every other cache in this pipeline uses):
// `claim` always allocates a *fresh* slot; the caller decides when a
// fresh claim is actually needed (a cache miss) versus reusing an
// existing one (a cache hit, ref-counted).
//
// Staleness: a claim can be released (via eviction, or a caller's own
// [`SlotClaimAllocator.release`]) *while its own async build is still in
// flight* -- another look reusing the same slot index a moment later
// must never have its own pixels overwritten by a build that started
// before it did. Every claim carries a generation token, bumped whenever
// its own slot index is handed to anyone (fresh or reused);
// `claim.isStale()` compares the token captured at claim time against the
// slot's own *current* token, so a caller that checks it immediately
// before drawing can never draw into a slot that has since been
// reassigned.

import type { AppearanceLayoutDef } from "../../defs/types";
import {
  computeSlotLayout,
  SlotAllocator,
  type SlotLayout,
  type SlotPosition,
  slotIndexToPosition,
} from "./composite-slots";

/** The shape a family's own layout imposes on the shared slot grid --
 * everything besides `key`/`family`/`id` that actually decides pixel
 * geometry. Two layouts sharing this exactly can share one slot pool;
 * two that differ in any of it cannot (Tim's direction, cycle 1: pixel
 * *size* alone is not enough -- two families could share a strip's total
 * width/height while disagreeing on how it is divided into frames). */
export interface CellGeometry {
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly directions: readonly string[];
  readonly rows: readonly { readonly animation: string; readonly framesPerDirection: number }[];
}

export function cellGeometryOf(layout: AppearanceLayoutDef): CellGeometry {
  return {
    cellWidth: layout.cellWidth,
    cellHeight: layout.cellHeight,
    directions: layout.directions,
    rows: layout.rows.map((r) => ({
      animation: r.animation,
      framesPerDirection: r.framesPerDirection,
    })),
  };
}

function geometryEqual(a: CellGeometry, b: CellGeometry): boolean {
  if (a.cellWidth !== b.cellWidth || a.cellHeight !== b.cellHeight) return false;
  if (a.directions.length !== b.directions.length) return false;
  for (let i = 0; i < a.directions.length; i++) {
    if (a.directions[i] !== b.directions[i]) return false;
  }
  if (a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++) {
    if (a.rows[i]?.animation !== b.rows[i]?.animation) return false;
    if (a.rows[i]?.framesPerDirection !== b.rows[i]?.framesPerDirection) return false;
  }
  return true;
}

export interface SlotClaim {
  readonly slotIndex: number;
  readonly position: SlotPosition;
  /** Every slot in the shared pool is this same pixel size -- carried on
   * the claim itself so a caller never has to reach back into this
   * module's own internal `SlotLayout` just to know how large a rect to
   * clear/draw. */
  readonly width: number;
  readonly height: number;
  /** True once this claim's own slot has been handed to a different
   * claim (this one was released, by eviction or explicitly, while still
   * in use) -- the caller must never draw into `position` once this is
   * true, and must treat its own build as aborted. */
  isStale(): boolean;
}

/** Claims and releases slots, synchronously -- the key-level cache
 * (which key owns which claim, LRU eviction, ref-counting) is deliberately
 * not this module's job; `appearance-texture.ts`'s own
 * `AppearanceCache<PendingLook>` is that, the same as every other cache
 * in this pipeline. This module only ever decides what a `claim`/
 * `release` pair does to the slot underneath. */
export class SlotClaimAllocator {
  private readonly pageCount: number;
  private allocator: SlotAllocator | null = null;
  private slotLayout: SlotLayout | null = null;
  private geometry: CellGeometry | null = null;
  private readonly tokens = new Map<number, number>();

  constructor(pageCount: number) {
    this.pageCount = pageCount;
  }

  /** The shared pool's own total slot count, once known (after the first
   * `claim`) -- `undefined` before then, since capacity depends on the
   * first family layout claimed. */
  get totalSlots(): number | undefined {
    return this.slotLayout?.totalSlots;
  }

  private bumpToken(slotIndex: number): number {
    const next = (this.tokens.get(slotIndex) ?? 0) + 1;
    this.tokens.set(slotIndex, next);
    return next;
  }

  /** The shared pool's own capacity is derived from the *first* family
   * layout this allocator ever claims a slot for -- every later layout's
   * own cell geometry must match it exactly (Tim's direction, cycle 1:
   * compared field for field, not just the strip's own pixel size), or
   * this throws by name rather than silently mis-packing a differently-
   * shaped family into the same slot grid. */
  private ensureLayout(layout: AppearanceLayoutDef): SlotAllocator {
    const geometry = cellGeometryOf(layout);
    if (!this.slotLayout || !this.allocator) {
      this.slotLayout = computeSlotLayout(layout, this.pageCount);
      this.allocator = new SlotAllocator(this.slotLayout.totalSlots);
      this.geometry = geometry;
      return this.allocator;
    }
    if (!this.geometry || !geometryEqual(this.geometry, geometry)) {
      throw new Error(
        `composite-look-cache: layout '${layout.key}' does not match the shared slot pool's own cell geometry -- every family sharing this pool must declare the same cell size, directions and animation rows`,
      );
    }
    return this.allocator;
  }

  /** Claims a fresh slot for `layout`, synchronously. Throws by name,
   * synchronously, on exhaustion (every slot still in use) or a
   * cell-geometry mismatch. */
  claim(layout: AppearanceLayoutDef): SlotClaim {
    const allocator = this.ensureLayout(layout);
    // Exhaustion: rejects synchronously here, never a third page, never
    // a fallback texture (Tim's direction).
    const slotIndex = allocator.acquire();
    const token = this.bumpToken(slotIndex);
    const layoutInfo = this.slotLayout as SlotLayout;
    const position = slotIndexToPosition(slotIndex, layoutInfo);
    return {
      slotIndex,
      position,
      width: layoutInfo.slotWidth,
      height: layoutInfo.slotHeight,
      isStale: () => this.tokens.get(slotIndex) !== token,
    };
  }

  /** Frees `claim`'s own slot for immediate reuse, and invalidates it
   * (`isStale()` becomes `true`) -- a no-op, never a double-free, if this
   * exact claim was already released (its own token no longer current). */
  release(claim: SlotClaim): void {
    if (claim.isStale()) return;
    this.bumpToken(claim.slotIndex);
    this.allocator?.release(claim.slotIndex);
  }
}

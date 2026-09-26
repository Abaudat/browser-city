// One four-pass stack per floor, drawn in ascending floor order (Tim's
// direction, story 1.13). This is the whole answer to two storeys whose
// screen rects overlap -- a bridge deck over the street it spans, an
// upper storey over the shop below it: a drawable on a higher floor is
// drawn after every drawable on a lower one, because its whole stack is.
//
// Floor is never a term in the FR123 sort key (`sort-key.ts`), and this
// module never reorders a pool's own members or reads a sort key: it
// decides between *stacks*, the comparator decides within one. A drawable
// still gets its FR124 screen offset from `screen-position.ts`; that
// offset moves it up the screen, it does not decide what covers what.
//
// One of the small, named set of files allowed to import `pixi.js`
// (`client/biome.json`): container wiring only, no ordering or
// positioning rule of its own.

import { Container } from "pixi.js";
import { FIRST_POOL_RANK } from "./layer-table";
import { type Drawable, sortByDrawable } from "./sort-key";

/** One floor's own passes, in the fixed FR123 order: three flat passes,
 * then the y-sorted pool. Declared even while empty. */
export interface FloorStack {
  readonly floor: number;
  /** The flat ground pass. */
  readonly ground: Container;
  /** The flat ground-decal pass. */
  readonly groundDecals: Container;
  /** The flat ground-object pass. */
  readonly groundObjects: Container;
  /** The y-sorted pool -- `sortableChildren` is `false`, because
   * `render/pixi-order.ts`'s `applyDepthOrder` is the sole ordering
   * authority within it. */
  readonly pool: Container;
  /** The container holding this floor's four passes, and the thing whose
   * position among its siblings is what "ascending floor order" means. */
  readonly root: Container;
}

function newStack(floor: number): FloorStack {
  const ground = new Container();
  const groundDecals = new Container();
  const groundObjects = new Container();
  const pool = new Container();
  pool.sortableChildren = false;
  const root = new Container();
  root.addChild(ground, groundDecals, groundObjects, pool);
  return { floor, ground, groundDecals, groundObjects, pool, root };
}

/**
 * The floor stacks under one parent container, created on demand and kept
 * in ascending floor order whatever order floors are first asked for.
 */
export class FloorStacks {
  private readonly parent: Container;
  private readonly byFloor = new Map<number, FloorStack>();

  constructor(parent: Container) {
    this.parent = parent;
  }

  /** This floor's stack, creating it (and re-inserting every stack in
   * ascending floor order) the first time a floor is seen. */
  stackFor(floor: number): FloorStack {
    const existing = this.byFloor.get(floor);
    if (existing) return existing;

    const stack = newStack(floor);
    this.byFloor.set(floor, stack);
    // Re-attach every root in ascending floor order. Floors are created
    // at mount, once per floor the world contains -- never per frame --
    // so the cost of re-attaching them here is irrelevant, and doing it
    // this way means no caller can ever create one out of order.
    for (const f of this.floors()) {
      const root = this.byFloor.get(f)?.root;
      if (root) this.parent.addChild(root);
    }
    return stack;
  }

  /** Every floor that has a stack, ascending -- the order they draw in. */
  floors(): number[] {
    return [...this.byFloor.keys()].sort((a, b) => a - b);
  }

  /** Every stack, ascending by floor. */
  stacks(): FloorStack[] {
    return this.floors().map((floor) => {
      const stack = this.byFloor.get(floor);
      if (!stack) throw new Error(`FloorStacks: no stack for floor ${floor}`);
      return stack;
    });
  }
}

/**
 * The order every drawable in a multi-floor scene is drawn in: grouped by
 * floor ascending; within a floor, every flat-layer drawable (rank below
 * `FIRST_POOL_RANK`) first in insertion order, then the pool ordered by the
 * FR123 comparator alone -- a flat drawable is never y-sorted. This
 * is the same order a real mounted scene produces by construction -- one
 * pool per floor ([`FloorStacks`]), each ordered by
 * `render/pixi-order.ts`'s `applyDepthOrder`, drawn in ascending floor
 * order -- expressed once as a pure function so a test can state it
 * without mounting Pixi.
 *
 * Returns a new array; the input is left alone. Only ever called at mount
 * or from a test, never per frame (a mounted scene re-sorts one floor's
 * own pool instead).
 */
export function sortAcrossFloors<T>(items: readonly T[], toDrawable: (item: T) => Drawable): T[] {
  const byFloor = new Map<number, T[]>();
  for (const item of items) {
    const floor = toDrawable(item).floor;
    const bucket = byFloor.get(floor);
    if (bucket) bucket.push(item);
    else byFloor.set(floor, [item]);
  }
  const ordered: T[] = [];
  for (const floor of [...byFloor.keys()].sort((a, b) => a - b)) {
    const bucket = byFloor.get(floor) ?? [];
    const flat = bucket.filter((item) => toDrawable(item).rank < FIRST_POOL_RANK);
    const pool = bucket.filter((item) => toDrawable(item).rank >= FIRST_POOL_RANK);
    sortByDrawable(pool, toDrawable);
    ordered.push(...flat, ...pool);
  }
  return ordered;
}

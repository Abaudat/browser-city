// FR123's depth sort, and nothing else (Tim/Quentin, story 1.6). Zero
// PixiJS and zero `net/bindings` imports: this module is pure arithmetic
// over plain records, provable in vitest's node environment without a
// canvas, a GPU or a live connection ever existing. `client/src/render/
// pixi-order.ts` is the only file allowed to hand this comparator's
// output to a real display list.
//
// `x`/`y` are world *position*, in FR123 sort units (`sort-units.ts`:
// `tile * SORT_SUBDIVISIONS`), never raw tile indices and never a
// screen-space or floor-adjusted value (FR124: floor is a vertical
// screen offset applied only when a drawable is positioned on screen --
// `screen-position.ts` -- and is carried on `Drawable.floor` for that
// purpose only; the comparator below never reads it). Every caller that
// builds a `Drawable` must convert through `toSortUnits` -- passing a raw
// tile coordinate mixes units with a continuous, moving character and
// silently produces the wrong order. `rank` is the FR123 tens rank the
// drawable's `layer` resolves to (`layer-ranks.ts`), read from
// `sim::codes::layer`'s data, never a literal here. `stableId` is a
// `bigint` and stays one end to end: narrowing it through `Number` would
// lose a low bit and turn a stable tiebreak into an unstable one, which is
// exactly the flicker FR123 exists to prevent.
//
// Two per-cell drawables of one multi-cell prop (`decompose.ts`) share
// `objectId` and `rank`; the tiebreak that keeps them from ever comparing
// equal is `x` (each cell has its own), never a composite of
// `stableId`/cell index. Characters and placed objects never collide on
// `stableId` either: the tiebreak is only ever reached once `rank`
// already matched, and characters only ever share a rank with other
// characters (see `layer-ranks.ts`'s `characters` rank) -- do not "fix"
// this with a composite namespaced key; it is not broken.

/** One thing the y-sorted pool orders (FR123). `floor` is carried for the
 * screen-offset calculation only (FR124) -- [`compareDrawables`] never
 * reads it. */
export interface Drawable {
  /** World position in FR123 sort units (`sort-units.ts`'s
   * `SORT_SUBDIVISIONS` per tile) -- never a raw tile index. */
  readonly x: number;
  /** World position in FR123 sort units -- never a raw tile index. */
  readonly y: number;
  readonly rank: number;
  readonly stableId: bigint;
  readonly floor: number;
}

/** The FR123 key: `(y, rank, x, stableId)`, most significant first. A
 * strict total order (`inv_depth_order_total_and_stable`,
 * `client/tests/unit/render/sort-key.test.ts`) -- never returns 0 for two
 * distinct drawables from the same frame's pool, because two per-cell
 * drawables of one multi-cell prop always differ in `x`. Allocates
 * nothing, so it costs nothing extra to run on every drawable, every
 * frame. */
export function compareDrawables(a: Drawable, b: Drawable): number {
  if (a.y !== b.y) return a.y - b.y;
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (a.x !== b.x) return a.x - b.x;
  if (a.stableId < b.stableId) return -1;
  if (a.stableId > b.stableId) return 1;
  return 0;
}

/** Sorts `pool` in place with [`compareDrawables`] -- the one and only
 * ordering authority (Tim's direction): nothing else in the render path
 * may reorder a pool container's children. Reuses `pool`'s own backing
 * array rather than allocating a new one, so a frame where nothing moved
 * costs nothing beyond the (already-sorted) comparator calls. */
export function sortDrawablesInPlace(pool: Drawable[]): void {
  pool.sort(compareDrawables);
}

/**
 * Overwrites `target`'s `x`/`y` in place -- both already in FR123 sort
 * units, the caller's job to produce (`sort-units.ts`'s `toSortUnits`),
 * never this function's. This is the one, documented place `Drawable`'s
 * own `readonly` is deliberately defeated, so that a render path
 * updating a moving character's position every frame it changes does not
 * allocate a whole new `Drawable` to do it (Quentin's direction) via an
 * ad-hoc cast at the call site (Tim's direction: the module that owns
 * `Drawable`'s shape is what should own this capability, not a cast
 * sneaking past it in demo code). Every other field is immutable by
 * construction -- there is no `setRank`/`setStableId`/`setFloor`,
 * because none of those should ever change after a `Drawable` is built.
 */
export function setDrawablePosition(target: Drawable, x: number, y: number): void {
  const mutable = target as { x: number; y: number };
  mutable.x = x;
  mutable.y = y;
}

/** [`sortDrawablesInPlace`] generalised to any item that carries a
 * `Drawable` rather than being one -- the one sort authority every real
 * caller goes through too, not a second, inline `items.sort((a, b) =>
 * compareDrawables(...))` next to it (Tim's direction: `pixi-order.ts`'s
 * `applyDepthOrder` calls this, it does not re-implement it). `toDrawable`
 * should be a stable, module-level function reference (never an inline
 * arrow at the call site) so calling this allocates nothing beyond the
 * one short-lived comparator closure `Array.prototype.sort` needs for
 * this call. */
export function sortByDrawable<T>(items: T[], toDrawable: (item: T) => Drawable): void {
  items.sort((a, b) => compareDrawables(toDrawable(a), toDrawable(b)));
}

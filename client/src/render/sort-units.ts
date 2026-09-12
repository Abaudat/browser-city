// FR123's sort-key unit, declared exactly once (the `CHUNK_SIZE` idiom --
// `sim::world`'s own doc comment names this pattern: one declaration, a
// literal anywhere else is a defect). `Drawable.x`/`Drawable.y`
// (`sort-key.ts`) are always expressed in this unit, never in tiles: a
// continuous, moving character needs sub-tile resolution to sort
// correctly against a static prop it is passing (Artie's direction --
// a character's sort anchor is its continuous feet position, not a
// snapped cell), and `compareDrawables` takes integers only (Tim's
// direction -- no floats anywhere in the key). Multiplying every world
// coordinate by this many units per tile before it reaches the
// comparator is how both hold at once. A future story that builds real
// drawables from `placed_object` rows must convert through
// [`toSortUnits`] too, or it will mix units with a moving character and
// get silently wrong ordering with every test still green.
export const SORT_SUBDIVISIONS = 4;

/** World-tile coordinate (integer or continuous) to FR123 sort units,
 * rounded to the nearest whole unit -- the only place this conversion
 * happens. */
export function toSortUnits(worldCoord: number): number {
  return Math.round(worldCoord * SORT_SUBDIVISIONS);
}

/** The inverse of [`toSortUnits`] -- sort units back to world tiles, for
 * positioning a drawable on screen (`screen-position.ts`) from the same
 * value the comparator sorted on. */
export function fromSortUnits(sortUnits: number): number {
  return sortUnits / SORT_SUBDIVISIONS;
}

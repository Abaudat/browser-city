// The one path from `defs/`'s parsed objects to what `CollisionGrid`
// needs: a `defId -> collider source` map, resolved once at startup and
// handed to the grid's constructor. Every collider that exists in `defs/`
// reaches the running client through here -- nothing hand-types a rect
// that `defs/objects` already declares.

import type { Defs } from "../defs/types";
import type { ColliderRectSubcells, ColliderSource } from "./collision-grid";

/** Everything the derived indexes and a pick need from one `defs/`
 * object, in one record: the footprint every object has, the collider
 * only some do (FR128), and the reach rect only interactable ones do
 * (FR148). Structurally satisfies `ColliderSource` (the collision grid),
 * `FootprintSource` (the footprint index) and `input/pick.ts`'s own
 * `PickObjectDef`, so one map feeds all three and they can never be built
 * from different data. */
export interface ObjectSource extends ColliderSource {
  readonly interactAt?: ColliderRectSubcells;
}

/** Keyed by `ObjectDef.id`, which is what a `placed_object` row's `defId`
 * column carries. An object with no `collider` is still present in the
 * map (its footprint is real); it simply contributes nothing to the grid,
 * which is FR128's rule, not a special case. An object with no
 * `interactAt` declares no interaction, which is FR148's rule in exactly
 * the same way. */
export function objectDefsById(defs: Defs): ReadonlyMap<number, ObjectSource> {
  return new Map(
    defs.objects.map((object) => [
      object.id,
      {
        width: object.width,
        height: object.height,
        ...(object.collider ? { collider: object.collider } : {}),
        ...(object.interactAt ? { interactAt: object.interactAt } : {}),
      },
    ]),
  );
}

/** Story 1.7 (FR121): the def ids `defs/` marks `window = true` -- the
 * single source of truth [`render/visibility.ts`]'s translucency rule
 * reads from, resolved once here rather than restated as a demo-only
 * literal. */
export function windowDefIds(defs: Defs): ReadonlySet<number> {
  return new Set(defs.objects.filter((o) => o.window).map((o) => o.id));
}

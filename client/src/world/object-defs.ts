// The one path from `defs/`'s parsed objects to what `CollisionGrid`
// needs: a `defId -> collider source` map, resolved once at startup and
// handed to the grid's constructor. Every collider that exists in `defs/`
// reaches the running client through here -- nothing hand-types a rect
// that `defs/objects` already declares.

import type { Defs } from "../defs/types";
import type { ColliderSource } from "./collision-grid";

/** Keyed by `ObjectDef.id`, which is what a `placed_object` row's `defId`
 * column carries. An object with no `collider` is still present in the
 * map (its footprint is real); it simply contributes nothing to the grid,
 * which is FR128's rule, not a special case. */
export function objectDefsById(defs: Defs): ReadonlyMap<number, ColliderSource> {
  return new Map(
    defs.objects.map((object) => [
      object.id,
      {
        width: object.width,
        height: object.height,
        ...(object.collider ? { collider: object.collider } : {}),
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

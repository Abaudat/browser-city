// Story 2.13: the one place `defId -> ObjectDef` resolution happens for a
// def-placed prop (Tim's direction, cycle 2: build the index once rather
// than a linear `find` per drawable, the same idiom `world/object-defs.ts`'s
// own `objectDefsById` already uses). `scene.ts` is the only caller. Never
// imports `pixi.js` -- the per-cell crop and its own cache now live on
// `AtlasPageLoader.objectCellTexture` (`atlas-pages.ts`), next to the
// per-object cache it already had; this module is pure data lookup.

import type { Defs, ObjectDef } from "../defs/types";

/** Every real `defs/objects` entry, keyed by its own `id` -- built once
 * per mount (`scene.ts`), never a fresh linear `Array.find` per drawable. */
export function buildObjectDefIndex(defs: Defs): ReadonlyMap<number, ObjectDef> {
  return new Map(defs.objects.map((object) => [object.id, object]));
}

/** Resolves the `ObjectDef` a `defId` names against an already-built
 * index, or throws naming the id -- the one place `scene.ts` looks a
 * `defId` up, so every caller gets the same, named failure rather than a
 * silent `undefined` read. */
export function objectDefById(index: ReadonlyMap<number, ObjectDef>, defId: number): ObjectDef {
  const object = index.get(defId);
  if (!object) {
    throw new Error(`def-texture: defs/ has no object with id ${defId}`);
  }
  return object;
}

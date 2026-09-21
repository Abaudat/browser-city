// Story 2.13: the texture-resolution step for a `defId`-placed prop,
// extracted out of `test-street/scene.ts` (Tim's direction) -- pure-ish
// (its only side effect is the one `Texture` allocation `cropped` already
// does, the same idiom `atlas-pages.ts` itself uses), sharing
// `atlas-frame.ts`'s own "no pixi.js import beyond `Texture`/`Rectangle`"
// discipline. `scene.ts` is the only caller; `AtlasPageLoader` is the only
// real implementation of `DefObjectTextureLoader`, kept as an interface
// here so a test can stub it the way `atlas-pages.test.ts` already does.

import { Rectangle, Texture } from "pixi.js";
import type { Defs, ObjectDef } from "../defs/types";

/** The one method this module needs from `AtlasPageLoader` -- narrowed to
 * an interface so a unit test can stub it with no real `pixi.js` decode
 * behind it, the same idiom `atlas-pages.test.ts` already uses for the
 * loader itself. */
export interface DefObjectTextureLoader {
  objectTexture(defs: Defs, object: ObjectDef): Promise<Texture>;
}

/** Resolves the `ObjectDef` a `defId` names, or throws naming the id --
 * the one place `scene.ts` looks a `defId` up against the fetched
 * document, so every caller gets the same, named failure rather than a
 * silent `undefined` read. */
export function objectDefById(defs: Defs, defId: number): ObjectDef {
  const object = defs.objects.find((candidate) => candidate.id === defId);
  if (!object) {
    throw new Error(`def-texture: defs/ has no object with id ${defId}`);
  }
  return object;
}

/**
 * One def-placed prop's own per-cell texture (Tim's direction): the def's
 * whole atlas-cropped sprite (`loader.objectTexture`), further cropped to
 * the exact `tileSizePx`-wide column `sourceCol` names. No "repeat"
 * branch: `tools/defs-build`'s own validator already fixes `object.atlas`'s
 * width to exactly `object.width * tile_size_px` (FR126), so a one-cell
 * def (`sourceCol` always 0) crops to its own whole extent by the same
 * arithmetic a wide def slices by -- two placements of the same def id
 * share the loader's own cached `Texture`, and so the same `TextureSource`,
 * without this function doing anything special for it.
 */
export async function defCellTexture(
  defs: Defs,
  object: ObjectDef,
  loader: DefObjectTextureLoader,
  sourceCol: number,
  tileSizePx: number,
): Promise<Texture> {
  const base = await loader.objectTexture(defs, object);
  const frame = new Rectangle(sourceCol * tileSizePx, 0, tileSizePx, base.height);
  return new Texture({ source: base.source, frame, dynamic: false });
}

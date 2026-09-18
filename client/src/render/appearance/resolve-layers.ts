// Resolves a citizen's `AppearanceTuple` (+ optional `UniformOverride`) to
// the concrete defs rows the composite actually needs: which
// `AppearanceLayoutDef` (by the tuple's own body's family), which
// `OutfitDef` (for `hidesHairstyle`), and each layer's own packed atlas
// *page* (Story 2.7: `defs.atlasPages[part.atlas.page].file`) plus that
// part's own `atlas` rect on that page -- never a `sheet` path (the Epic 1
// shortcut is gone; the client reads no vendor character sheet at
// runtime). Pure -- no `pixi.js`, no canvas, no `fetch` -- so
// `appearance-texture.ts` (the one impure adapter that turns these page
// references into loaded bitmaps and a drawn composite) stays a thin
// wrapper over this and `composite.ts`.

import type { AppearanceLayoutDef, AtlasRect, Defs, OutfitDef } from "../../defs/types";
import { type AppearanceTuple, effectiveLayers, type UniformOverride } from "./composite";

/** One layer's own packed location -- `AtlasRect` itself already carries
 * the page it lives on (`atlas.page`, resolved to a file url by the
 * caller via `defs.atlasPages`), so this is just that rect, never a
 * wrapper duplicating its own `page` field a second time. */
export type ResolvedPart = AtlasRect;

export interface ResolvedLayerParts {
  readonly body: ResolvedPart;
  readonly eyes: ResolvedPart | null;
  readonly outfit: ResolvedPart;
  readonly hairstyle: ResolvedPart | null;
  readonly accessory: ResolvedPart | null;
  readonly uniformAccessory: ResolvedPart | null;
}

export interface ResolvedLayers {
  readonly layout: AppearanceLayoutDef;
  readonly effectiveOutfit: Pick<OutfitDef, "hidesHairstyle">;
  readonly parts: ResolvedLayerParts;
}

function toPart(def: { atlas: AtlasRect } | undefined): ResolvedPart | null {
  return def ? def.atlas : null;
}

/** Throws, naming the missing id/family, rather than silently drawing a
 * blank layer -- a tuple referencing an id absent from `defs` (or a body
 * family with no declared `AppearanceLayoutDef`) is a defs/generator bug,
 * never a case to paper over at render time. */
export function resolveLayers(
  defs: Defs,
  tuple: AppearanceTuple,
  override: UniformOverride | null,
): ResolvedLayers {
  const body = defs.bodies.find((b) => b.id === tuple.body);
  if (!body) throw new Error(`resolve-layers: no body def with id ${tuple.body}`);

  const layout = defs.appearanceLayouts.find((l) => l.family === body.family);
  if (!layout) {
    throw new Error(`resolve-layers: no appearance layout declared for family '${body.family}'`);
  }

  const layers = effectiveLayers(tuple, override, defs.accessories);

  const eyes = tuple.eyes !== 0 ? defs.eyes.find((e) => e.id === tuple.eyes) : undefined;

  const outfit = defs.outfits.find((o) => o.id === layers.outfit);
  if (!outfit) throw new Error(`resolve-layers: no outfit def with id ${layers.outfit}`);

  const hairstyle =
    tuple.hairstyle !== 0 ? defs.hairstyles.find((h) => h.id === tuple.hairstyle) : undefined;
  const civilianAccessory =
    layers.civilianAccessory !== 0
      ? defs.accessories.find((a) => a.id === layers.civilianAccessory)
      : undefined;
  const uniformAccessory =
    layers.uniformAccessory !== 0
      ? defs.accessories.find((a) => a.id === layers.uniformAccessory)
      : undefined;

  return {
    layout,
    effectiveOutfit: outfit,
    parts: {
      body: body.atlas,
      eyes: toPart(eyes),
      outfit: outfit.atlas,
      hairstyle: toPart(hairstyle),
      accessory: toPart(civilianAccessory),
      uniformAccessory: toPart(uniformAccessory),
    },
  };
}

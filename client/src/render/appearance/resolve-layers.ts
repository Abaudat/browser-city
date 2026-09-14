// Resolves a citizen's `AppearanceTuple` (+ optional `UniformOverride`) to
// the concrete defs rows the composite actually needs: which
// `AppearanceLayoutDef` (by the tuple's own body's family), which
// `OutfitDef` (for `hidesHairstyle`), and each layer's own `sheet` path
// (or `null` for "no layer"). Pure -- no `pixi.js`, no canvas, no
// `fetch` -- so `appearance-texture.ts` (the one impure adapter that
// turns these paths into loaded images and a composited `Texture`) stays
// a thin wrapper over this and `composite.ts`.

import type { AppearanceLayoutDef, Defs, OutfitDef } from "../../defs/types";
import { type AppearanceTuple, effectiveLayers, type UniformOverride } from "./composite";

export interface ResolvedLayerSheets {
  readonly body: string;
  readonly eyes: string | null;
  readonly outfit: string;
  readonly hairstyle: string | null;
  readonly accessory: string | null;
  readonly uniformAccessory: string | null;
}

export interface ResolvedLayers {
  readonly layout: AppearanceLayoutDef;
  readonly effectiveOutfit: Pick<OutfitDef, "hidesHairstyle">;
  readonly sheets: ResolvedLayerSheets;
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
    sheets: {
      body: body.sheet,
      eyes: eyes?.sheet ?? null,
      outfit: outfit.sheet,
      hairstyle: hairstyle?.sheet ?? null,
      accessory: civilianAccessory?.sheet ?? null,
      uniformAccessory: uniformAccessory?.sheet ?? null,
    },
  };
}

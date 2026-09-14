// Story 1.10 (AC5): the runtime half of the composite pipeline proof
// `client/tests/e2e/appearance.spec.ts` needs -- that the real, mounted
// composite (`part-sheets.ts`'s real `fetch`, `composite-canvas.ts`'s
// real `OffscreenCanvas`) reads back byte-for-byte identical to an
// independent five/six-layer stack, drawn straight from the same vendor
// sheets via `sourceFrameRect`, never `composite.ts`'s own cell-packing
// math a second time. Plain `Canvas2D` throughout, deliberately not
// Pixi's own `renderer.extract`: a `Texture` frame-cropped from either an
// `ImageBitmap`-backed or a canvas-backed source read back wrong (fully
// transparent, or fully opaque garbage) through a real WebGPU renderer's
// extract path when tried here -- `Canvas2D.getImageData` over the exact
// same underlying canvas/bitmap resources is what the real composite
// (`composite-canvas.ts`) already trusts for identical work, and is what
// this file trusts too.
//
// Lives under `test-street/`, not `render/appearance/`: this is e2e test harness
// wired through the street scene, never part of the production render
// pipeline, so it belongs where the rest of the street-only code does
// (`client/vitest.config.ts`'s coverage gate already excludes `test-street/**`
// wholesale).

import type { Texture } from "pixi.js";
import type { Defs } from "../defs/types";
import type { AppearanceTuple, UniformOverride } from "../render/appearance/composite";
import { compositeCellRect, sourceFrameRect } from "../render/appearance/frame-rect";
import { fetchPartBitmap } from "../render/appearance/part-sheets";
import type { PixelSnapshot } from "../render/appearance/pixel-snapshot";
import { createRefCountedCache } from "../render/appearance/ref-counted-cache";
import { resolveLayers } from "../render/appearance/resolve-layers";

const STACK_LAYER_ORDER = [
  "body",
  "eyes",
  "outfit",
  "hairstyle",
  "accessory",
  "uniformAccessory",
] as const;

// This module's own cache, entirely separate from `part-sheets.ts`'s
// production one -- same `fetchPartBitmap` loader (the URL resolution is
// shared; the state is not), so this e2e harness never perturbs the
// production cache it is checking: the crowd's own real mount (through
// `citizens-layer.ts`) still exercises production's close-at-zero-
// references path for real, unaffected by whatever this module does with
// its own state. `appearance.spec.ts` calls `comparePipelineVsStack`
// dozens of times over for one fixed tuple (the full `(animation,
// direction, frame)` grid); this cache's own references are held for
// this module's whole lifetime, never released, so each of that fixed
// tuple's handful of sheets is decoded exactly once rather than on every
// call -- a Playwright test page's own sheet set is small and fixed, and
// the page (and this cache with it) is torn down between tests.
const stackImages = createRefCountedCache(fetchPartBitmap, (bitmap) => bitmap.close());

function readImageData(
  width: number,
  height: number,
  draw: (ctx: OffscreenCanvasRenderingContext2D) => void,
): PixelSnapshot {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("compare-pipeline-vs-stack: 2d context unavailable");
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data: Array.from(data) };
}

/** Renders `(animation, direction, frame)` two independent ways for the
 * same `tuple`+`override` and reads both back as raw pixels: the real
 * composite's own already-drawn canvas (cropped to that one cell,
 * straight `Canvas2D`, no GPU roundtrip), and a fresh five/six-layer
 * stack built directly from `resolveLayers`'s own sheet paths, cropped
 * per layer via `sourceFrameRect` and stacked in the same draw order
 * `composite.ts`'s `LAYER_ORDER` declares -- the `hidesHairstyle` skip
 * included, so a hood outfit is proven the same way as everything else. */
export async function comparePipelineVsStack(
  defs: Defs,
  compositeTexture: Texture,
  tuple: AppearanceTuple,
  override: UniformOverride | null,
  animation: string,
  direction: string,
  frame: number,
): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }> {
  const resolved = resolveLayers(defs, tuple, override);
  const cell = compositeCellRect(resolved.layout, animation, direction, frame);

  const compositeCanvas = compositeTexture.source.resource as OffscreenCanvas | HTMLCanvasElement;
  const pipeline = readImageData(cell.width, cell.height, (ctx) => {
    ctx.drawImage(
      compositeCanvas,
      cell.x,
      cell.y,
      cell.width,
      cell.height,
      0,
      0,
      cell.width,
      cell.height,
    );
  });

  const sheetByLayer: Readonly<Record<(typeof STACK_LAYER_ORDER)[number], string | null>> = {
    body: resolved.sheets.body,
    eyes: resolved.sheets.eyes,
    outfit: resolved.sheets.outfit,
    hairstyle: resolved.sheets.hairstyle,
    accessory: resolved.sheets.accessory,
    uniformAccessory: resolved.sheets.uniformAccessory,
  };
  const src = sourceFrameRect(resolved.layout, animation, direction, frame);
  const images: ImageBitmap[] = [];
  for (const layer of STACK_LAYER_ORDER) {
    if (layer === "hairstyle" && resolved.effectiveOutfit.hidesHairstyle) continue;
    const sheet = sheetByLayer[layer];
    if (!sheet) continue;
    images.push(await stackImages.acquire(sheet));
  }
  const stack = readImageData(cell.width, cell.height, (ctx) => {
    for (const image of images) {
      ctx.drawImage(image, src.x, src.y, src.width, src.height, 0, 0, src.width, src.height);
    }
  });

  return { pipeline, stack };
}

// Story 1.10/2.7 (AC5): the runtime half of the composite pipeline proof
// `client/tests/e2e/appearance.spec.ts` needs -- that the real, mounted
// composite (`character-part-pages.ts`'s real `fetch`, `composite-pages.ts`'s
// real `OffscreenCanvas`-backed shared page) reads back byte-for-byte
// identical to an independent five/six-layer stack, drawn straight from
// the same *packed atlas pages* via each part's own `atlas` rect, never
// `composite.ts`'s own layering code a second time (Quentin's direction,
// story 2.7: the packed-pixels-equal-vendor-pixels half of this proof
// already lives in `tools/defs-build`'s own Rust round-trip test; this
// file only proves what the renderer draws for a fixed tuple equals an
// independently-cropped stack of the very pages the renderer itself
// reads). Plain `Canvas2D` throughout, deliberately not Pixi's own
// `renderer.extract`: a `Texture` frame-cropped from either an
// `ImageBitmap`-backed or a canvas-backed source read back wrong (fully
// transparent, or fully opaque garbage) through a real WebGPU renderer's
// extract path when tried here -- `Canvas2D.getImageData` over the exact
// same underlying canvas/bitmap resources is what the real composite
// (`composite-pages.ts`) already trusts for identical work, and is what
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
import { compositeCellRect } from "../render/appearance/frame-rect";
import type { PixelSnapshot } from "../render/appearance/pixel-snapshot";
import { createRefCountedCache } from "../render/appearance/ref-counted-cache";
import { type ResolvedPart, resolveLayers } from "../render/appearance/resolve-layers";
import { atlasPageUrl } from "../render/atlas-url";

const STACK_LAYER_ORDER = [
  "body",
  "eyes",
  "outfit",
  "hairstyle",
  "accessory",
  "uniformAccessory",
] as const;

async function fetchPageBitmap(baseUrl: string, file: string): Promise<ImageBitmap> {
  const response = await fetch(atlasPageUrl(baseUrl, file));
  if (!response.ok) {
    throw new Error(
      `compare-pipeline-vs-stack: '${file}' fetch failed with ${response.status} ${response.statusText}`,
    );
  }
  const blob = await response.blob();
  return createImageBitmap(blob);
}

// This module's own cache, entirely separate from `character-part-pages.ts`'s
// production one -- same fetch, the state is not shared -- so this e2e
// harness never perturbs the production cache it is checking: the
// crowd's own real mount (through `citizens-layer.ts`) still exercises
// production's close-at-zero-references path for real, unaffected by
// whatever this module does with its own state. `appearance.spec.ts`
// calls `comparePipelineVsStack` dozens of times over for one fixed
// tuple (the full `(animation, direction, frame)` grid); a *module-level*
// singleton (never rebuilt per call, that was this file's own regression:
// building a fresh cache inside `comparePipelineVsStack` re-fetched and
// re-decoded every one of a handful of full-page PNGs on every one of
// the 48+ grid cells, which is exactly the "re-fetches and re-decodes
// the same PNGs from scratch" failure mode this module's own history
// already names) means each of that fixed tuple's handful of pages is
// decoded exactly once for the module's whole lifetime, never per call --
// a Playwright test page's own page set is small and fixed, and the page
// (and this cache with it) is torn down between tests. `atlasBaseUrl` is
// effectively constant for one page's whole lifetime, so only the first
// call's own value is ever used.
let stackPages: ReturnType<typeof createRefCountedCache<ImageBitmap>> | undefined;
function getStackPages(atlasBaseUrl: string) {
  if (!stackPages) {
    stackPages = createRefCountedCache<ImageBitmap>(
      (file) => fetchPageBitmap(atlasBaseUrl, file),
      (bitmap) => bitmap.close(),
    );
  }
  return stackPages;
}

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
 * composite's own already-drawn, already-cropped per-frame `Texture`
 * (`pipelineFrameTexture` -- the exact `Texture` a mounted citizen's own
 * sprite would show, straight `Canvas2D`, no GPU roundtrip), and a fresh
 * five/six-layer stack built directly from `resolveLayers`'s own packed-
 * page references, cropped per layer via each part's own `atlas` rect
 * plus the cell's local offset (`compositeCellRect`, gutter 0 -- the
 * packed atlas strip's own tight layout, never the composite page's
 * gutter-padded one) and stacked in the same draw order `composite.ts`'s
 * `LAYER_ORDER` declares -- the `hidesHairstyle` skip included, so a
 * hood outfit is proven the same way as everything else. */
export async function comparePipelineVsStack(
  defs: Defs,
  atlasBaseUrl: string,
  pipelineFrameTexture: Texture,
  tuple: AppearanceTuple,
  override: UniformOverride | null,
  animation: string,
  direction: string,
  frame: number,
): Promise<{ pipeline: PixelSnapshot; stack: PixelSnapshot }> {
  const resolved = resolveLayers(defs, tuple, override);
  const cell = compositeCellRect(resolved.layout, animation, direction, frame);

  const pipelineSource = pipelineFrameTexture.source.resource as
    | OffscreenCanvas
    | HTMLCanvasElement;
  const frameRect = pipelineFrameTexture.frame;
  const pipeline = readImageData(cell.width, cell.height, (ctx) => {
    ctx.drawImage(
      pipelineSource,
      frameRect.x,
      frameRect.y,
      frameRect.width,
      frameRect.height,
      0,
      0,
      cell.width,
      cell.height,
    );
  });

  // Never released (the module-level cache's own doc comment): a page
  // acquired once here stays decoded for this module's whole lifetime,
  // reused by every later cell/tuple that names it, exactly like the
  // pre-story-2.7 version of this file already did for individual vendor
  // sheets.
  const pages = getStackPages(atlasBaseUrl);
  const partByLayer: Readonly<Record<(typeof STACK_LAYER_ORDER)[number], ResolvedPart | null>> = {
    body: resolved.parts.body,
    eyes: resolved.parts.eyes,
    outfit: resolved.parts.outfit,
    hairstyle: resolved.parts.hairstyle,
    accessory: resolved.parts.accessory,
    uniformAccessory: resolved.parts.uniformAccessory,
  };
  const acquired: { bitmap: ImageBitmap; atlas: ResolvedPart }[] = [];
  for (const layer of STACK_LAYER_ORDER) {
    if (layer === "hairstyle" && resolved.effectiveOutfit.hidesHairstyle) continue;
    const part = partByLayer[layer];
    if (!part) continue;
    const page = defs.atlasPages[part.page];
    if (!page) throw new Error(`compare-pipeline-vs-stack: atlas page ${part.page} does not exist`);
    const bitmap = await pages.acquire(page.file);
    acquired.push({ bitmap, atlas: part });
  }
  const stack = readImageData(cell.width, cell.height, (ctx) => {
    for (const { bitmap, atlas } of acquired) {
      ctx.drawImage(
        bitmap,
        atlas.x + cell.x,
        atlas.y + cell.y,
        cell.width,
        cell.height,
        0,
        0,
        cell.width,
        cell.height,
      );
    }
  });
  return { pipeline, stack };
}

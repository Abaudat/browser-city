// Story 2.7 (Tim's direction, AC3): the one real-canvas/Pixi adapter
// over the pure slot arithmetic in `composite-slots.ts` -- excluded from
// the coverage gate (`client/vitest.config.ts`) because an
// `OffscreenCanvas` needs a browser, the same reasoning
// `composite-canvas.ts` carried before it. `CHARACTER_COMPOSITE_PAGES`
// (from `defs.characterCompositePages`, never a client literal) canvas-
// backed 2048x2048 textures, built once and reused for this session's
// whole lifetime -- `Texture.from` over a canvas source, never a GPU
// render-to-texture pass (still banned under `client/src/`, FR121).

import { Texture, type TextureSource } from "pixi.js";
import type { CanvasLike } from "./composite";
import { COMPOSITE_PAGE_SIZE } from "./composite-slots";

/** What `appearance-texture.ts` needs from `CompositePageSet` -- an
 * interface, not the class, so a unit test can inject a fake with no
 * real `OffscreenCanvas`/Pixi `Texture` (Quentin/Tim's direction, cycle
 * 1: the slot lifecycle this file composes stays testable even though
 * this real adapter itself is not). */
export interface CompositePageProvider {
  readonly pageCount: number;
  texture(pageIndex: number): Texture;
  pageSources(): ReadonlySet<TextureSource>;
  clearSlot(pageIndex: number, x: number, y: number, width: number, height: number): void;
  contextFor(pageIndex: number): CanvasLike;
  flush(): void;
}

interface CompositePage {
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly texture: Texture;
  dirty: boolean;
}

function buildPage(): CompositePage {
  const canvas = new OffscreenCanvas(COMPOSITE_PAGE_SIZE, COMPOSITE_PAGE_SIZE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("composite-pages: 2d context unavailable");
  const texture = Texture.from(canvas as unknown as HTMLCanvasElement);
  texture.source.scaleMode = "nearest";
  texture.source.autoGenerateMipmaps = false;
  return { canvas, ctx, texture, dirty: false };
}

/** The `pageCount` shared composite pages every character look draws
 * into -- owned for the app's whole lifetime, never destroyed per look
 * (a slot is cleared and redrawn instead, see `clearSlot`/`drawLayer`).
 * A page re-uploads (`source.update()`) at most once per frame: drawing
 * only marks the page dirty; `flush` (called once per ticker tick) is
 * what actually calls `update()`, and only for pages a draw actually
 * touched this tick. */
export class CompositePageSet implements CompositePageProvider {
  private readonly pages: readonly CompositePage[];

  constructor(pageCount: number) {
    this.pages = Array.from({ length: pageCount }, buildPage);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  private pageAt(pageIndex: number): CompositePage {
    const page = this.pages[pageIndex];
    if (!page) {
      throw new Error(
        `composite-pages: page ${pageIndex} does not exist (${this.pages.length} page(s))`,
      );
    }
    return page;
  }

  texture(pageIndex: number): Texture {
    return this.pageAt(pageIndex).texture;
  }

  /** Every composite page's own `TextureSource` -- `atlas-pages.ts`'s
   * `countBoundAtlasPages` reads this to fold composite pages into
   * NFR12's own bound-page count. */
  pageSources(): ReadonlySet<TextureSource> {
    return new Set(this.pages.map((p) => p.texture.source));
  }

  /** Clears one slot's own rect before a new occupant is drawn (Tim's
   * direction) -- never destroys or resizes the page. */
  clearSlot(pageIndex: number, x: number, y: number, width: number, height: number): void {
    const page = this.pageAt(pageIndex);
    page.ctx.clearRect(x, y, width, height);
    page.dirty = true;
  }

  /** A `CanvasLike` view over one page's own 2d context, for
   * `composite.ts`'s `drawComposite` to draw through -- marks the page
   * dirty on every draw, never uploads itself (`flush` does that once
   * per frame). */
  contextFor(pageIndex: number): CanvasLike {
    const page = this.pageAt(pageIndex);
    return {
      get imageSmoothingEnabled(): boolean {
        return page.ctx.imageSmoothingEnabled;
      },
      set imageSmoothingEnabled(value: boolean) {
        page.ctx.imageSmoothingEnabled = value;
      },
      drawImage(
        image: unknown,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        dx: number,
        dy: number,
        dw: number,
        dh: number,
      ): void {
        page.ctx.drawImage(image as CanvasImageSource, sx, sy, sw, sh, dx, dy, dw, dh);
        page.dirty = true;
      },
    };
  }

  /** One `source.update()` per dirty page, then clears the dirty flag --
   * never an update per composite draw. */
  flush(): void {
    for (const page of this.pages) {
      if (page.dirty) {
        page.texture.source.update();
        page.dirty = false;
      }
    }
  }
}

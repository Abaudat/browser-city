// The container view's Pixi half (Story 6.10, FR94). The only code that
// constructs the view's display objects; `world/container-view.ts` decides
// what to draw and when to close, this only draws it.
//
// The view is a piece of the world, not a window over it: world space, the
// same 3x integer scale as everything else, one grid cell exactly one world
// tile, parented to its object's own floor stack (`FloorStacks.
// attachTransient`) so it scrolls with the camera and is culled with its
// floor. There is no screen-space layer for it to be drawn in. Chrome is the
// inside of the container and nothing more: a flat backing, one-pixel cell
// separators and a one-pixel edge, all tones from
// `ModernTileset/moderninteriors-win/Palettes/palette_interiors.png`. No
// text, count, name, tooltip, close button or capacity readout -- a thing
// that does not fit is shown by not fitting.
//
// A view is built when a container opens and destroyed when it closes; the
// controller holds one slot, so opening another container replaces it, and
// nothing is allocated per frame while no view is open (the ticker is only
// subscribed while one is).

import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import type { GridDef } from "../defs/types";
import {
  type Bulk,
  type CellRect,
  type ContainerObject,
  type HeldRow,
  layoutRects,
  rectsInGrid,
  viewOriginPx,
} from "../world/container-view";
import type { FloorStacks } from "./floor-stacks";
import { floorOffsetPx } from "./screen-position";

// `palette_interiors.png`'s shadowed interior tones: the backing, one step
// lighter for the cell separators, one more for the edge.
const BACKING = 0x3a3a50;
const SEPARATOR = 0x46465e;
const EDGE = 0x565972;

export interface PixiContainerViewOptions {
  readonly stacks: FloorStacks;
  readonly objectId: bigint;
  readonly floor: number;
  readonly grid: GridDef;
  readonly tileSizePx: number;
  /** The view's north-west corner in world pixels (`viewOriginPx`). */
  readonly originPx: { readonly x: number; readonly y: number };
  /** The floor's own vertical offset (`render/screen-position.ts`). */
  readonly floorOffsetPx: number;
  /** An item def's texture, or `undefined` while it is not cropped yet. */
  readonly textureOf: (defId: number) => Texture | undefined;
}

/** One open container's display objects. */
export class PixiContainerView {
  readonly root = new Container();
  private readonly items = new Container();
  private readonly sprites: Sprite[] = [];
  private destroyed = false;

  constructor(private readonly options: PixiContainerViewOptions) {
    const { grid, tileSizePx: t } = options;
    const w = grid.width * t;
    const h = grid.height * t;
    const chrome = new Graphics();
    chrome.rect(0, 0, w, h).fill(EDGE);
    chrome.rect(1, 1, w - 2, h - 2).fill(BACKING);
    for (let x = 1; x < grid.width; x++) chrome.rect(x * t, 1, 1, h - 2).fill(SEPARATOR);
    for (let y = 1; y < grid.height; y++) chrome.rect(1, y * t, w - 2, 1).fill(SEPARATOR);
    this.root.addChild(chrome, this.items);
    this.root.x = options.originPx.x;
    this.root.y = options.originPx.y + options.floorOffsetPx;
    options.stacks.attachTransient(options.floor, this.root);
  }

  /** Redraws the items: one sprite per rect, a rotated one turned in
   * quarter turns about its own centre, never resized. */
  setRects(rects: readonly CellRect[]): void {
    if (this.destroyed) return;
    for (const s of this.sprites) s.destroy();
    this.sprites.length = 0;
    const t = this.options.tileSizePx;
    for (const r of rects) {
      const texture = this.options.textureOf(r.defId);
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0.5);
      sprite.x = (r.x + r.w / 2) * t;
      sprite.y = (r.y + r.h / 2) * t;
      sprite.rotation = (r.quarterTurns * Math.PI) / 2;
      this.items.addChild(sprite);
      this.sprites.push(sprite);
    }
  }

  /** The item sprites currently drawn. */
  itemSprites(): readonly Sprite[] {
    return this.sprites;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.options.stacks.detachTransient(this.root);
    this.root.destroy({ children: true });
    this.sprites.length = 0;
  }
}

/** What the controller needs of a ticker: structural over Pixi's own. */
export interface ContainerViewTicker {
  add(fn: () => void): void;
  remove(fn: () => void): void;
}

/** What a subscription hands back. */
export interface ContainerRelease {
  release(): void;
}

export interface ContainerViewControllerOptions {
  readonly stacks: FloorStacks;
  readonly ticker: ContainerViewTicker;
  readonly tileSizePx: number;
  readonly storeyHeightPx: number;
  readonly textureOf: (defId: number) => Texture | undefined;
  /** Crops the textures of `defIds` that are not cropped yet, when a view
   * has rows to draw: boot never pays for the item catalogue. An item
   * draws nothing until its crop resolves. */
  readonly prepare?: (defIds: readonly number[]) => Promise<void>;
  readonly bulkOf: (defId: number) => Bulk | undefined;
  /** Subscribes to one container's rows; `onRows` is called with the held
   * set whenever it changes, `onError` once if the subscription fails. */
  readonly watchRows: (
    containerId: bigint,
    onRows: (rows: readonly HeldRow[]) => void,
    onError: () => void,
  ) => ContainerRelease;
}

export interface OpenArgs {
  readonly object: ContainerObject;
  readonly grid: GridDef;
  /** True when the view must close this frame (`shouldClose`). */
  readonly closeWhen?: () => boolean;
}

/** The single slot: at most one view, bound to one object. */
export class ContainerViewController {
  private view: PixiContainerView | undefined;
  private release: ContainerRelease | undefined;
  private objectId: bigint | undefined;
  private rects: CellRect[] = [];
  private closeWhen: (() => boolean) | undefined;
  private readonly onTick = (): void => {
    if (this.closeWhen?.()) this.close();
  };

  constructor(private readonly options: ContainerViewControllerOptions) {}

  isOpen(): boolean {
    return this.view !== undefined;
  }

  /** The object the open view is bound to. */
  openObjectId(): bigint | undefined {
    return this.objectId;
  }

  /** The cell rects currently drawn (an e2e hook reads these, never
   * pixels). */
  drawnRects(): readonly CellRect[] {
    return this.rects;
  }

  /** Opens `args.object`'s view, replacing any open one. */
  open(args: OpenArgs): void {
    this.close();
    const { object, grid } = args;
    const { tileSizePx, storeyHeightPx } = this.options;
    const view = new PixiContainerView({
      stacks: this.options.stacks,
      objectId: object.objectId,
      floor: object.floor,
      grid,
      tileSizePx,
      originPx: viewOriginPx(object, grid, tileSizePx),
      floorOffsetPx: floorOffsetPx(object.floor, storeyHeightPx),
      textureOf: this.options.textureOf,
    });
    this.view = view;
    this.objectId = object.objectId;
    this.closeWhen = args.closeWhen;
    const redraw = (rows: readonly HeldRow[]): void => {
      if (this.view !== view) return;
      this.rects = rectsInGrid(layoutRects(rows, this.options.bulkOf), grid);
      view.setRects(this.rects);
    };
    this.release = this.options.watchRows(
      object.objectId,
      (rows) => {
        redraw(rows);
        const prepare = this.options.prepare;
        if (!prepare || this.view !== view) return;
        const ids = [...new Set(this.rects.map((r) => r.defId))];
        prepare(ids).then(
          () => redraw(rows),
          () => {},
        );
      },
      () => {
        if (this.view === view) this.close();
      },
    );
    this.options.ticker.add(this.onTick);
  }

  /** Closes the open view, if any: destroys its display objects, releases
   * its subscription and unsubscribes the ticker. Instant. */
  close(): void {
    const view = this.view;
    if (!view) return;
    this.options.ticker.remove(this.onTick);
    this.view = undefined;
    this.objectId = undefined;
    this.closeWhen = undefined;
    this.rects = [];
    const release = this.release;
    this.release = undefined;
    view.destroy();
    release?.release();
  }
}

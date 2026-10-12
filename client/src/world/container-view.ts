// The container view's pure half (Story 6.10, FR94): what a container's
// grid looks like as cell rects, where the view sits over its object, and
// when it closes. No `pixi.js`, no network -- `render/pixi-container-view.ts`
// only draws what these return, and `net/container-subscription.ts` only
// feeds rows in.
//
// A view is bound to one object: it is opened by an intent on that object
// and closed by the same reach rule that let it open (`isWithinReach`), the
// floor, the object, the body and the connection -- never a timer and never
// the pointer. Capacity is not a readout: nothing here returns a count.

import type { GridDef } from "../defs/types";
import type { Intent } from "../input/intent";
import { isWithinReach, type PickObjectDef } from "../input/pick";

/** One `item_held` row joined to its instance's item def, as plain data. */
export interface HeldRow {
  readonly instanceId: bigint;
  /** The item def id (`item_instance.def_id`). */
  readonly defId: number;
  readonly slotX: number;
  readonly slotY: number;
  /** `0..4`; odd orientations swap the footprint's width and height. */
  readonly orientation: number;
}

/** What a row does to the held set. */
export type RowChange =
  | { readonly kind: "insert"; readonly row: HeldRow }
  | { readonly kind: "update"; readonly row: HeldRow }
  | { readonly kind: "delete"; readonly row: HeldRow };

/** One held item's cells in grid space (whole cells, origin at the grid's
 * north-west cell). `quarterTurns` is the orientation modulo four: the
 * sprite is turned that many quarter turns, nearest-neighbour. */
export interface CellRect {
  readonly instanceId: bigint;
  readonly defId: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly quarterTurns: number;
}

/** An item's world footprint, in whole cells -- its `bulk`, unchanged. */
export interface Bulk {
  readonly width: number;
  readonly height: number;
}

/** The cells `bulk` covers at `orientation`: odd orientations swap. The
 * client half of `sim::container_grid::footprint`. */
export function footprintAt(bulk: Bulk, orientation: number): { w: number; h: number } {
  return orientation % 2 === 1
    ? { w: bulk.height, h: bulk.width }
    : { w: bulk.width, h: bulk.height };
}

/** Every held row as a cell rect, in instance order. A row whose item def
 * the client does not know is not drawn (a def newer than this client). */
export function layoutRects(
  rows: readonly HeldRow[],
  bulkOf: (defId: number) => Bulk | undefined,
): CellRect[] {
  const out: CellRect[] = [];
  for (const row of rows) {
    const bulk = bulkOf(row.defId);
    if (!bulk) continue;
    const { w, h } = footprintAt(bulk, row.orientation);
    out.push({
      instanceId: row.instanceId,
      defId: row.defId,
      x: row.slotX,
      y: row.slotY,
      w,
      h,
      quarterTurns: ((row.orientation % 4) + 4) % 4,
    });
  }
  out.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
  return out;
}

/** The held set after one row change; an update for a row never seen is an
 * insert, a delete for one is a no-op. */
export function rowsAfter(rows: readonly HeldRow[], change: RowChange): readonly HeldRow[] {
  const others = rows.filter((r) => r.instanceId !== change.row.instanceId);
  return change.kind === "delete" ? others : [...others, change.row];
}

/** The placed object a view hangs over. `anchorX`/`anchorY` is the
 * footprint's south-west cell (`world/footprint.ts`). */
export interface ContainerObject {
  readonly objectId: bigint;
  readonly defId: number;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly floor: number;
  readonly width: number;
  readonly height: number;
  /** The object's drawn sprite height in pixels (bottom-anchored). */
  readonly spriteHeightPx: number;
}

/** The view's north-west corner in world pixels (before the floor's own
 * offset): horizontally centred on the object's footprint, its bottom edge
 * one tile above the top of the object's sprite. One grid cell is one world
 * tile, so a grid is `grid.width * tile` pixels wide. */
export function viewOriginPx(
  object: ContainerObject,
  grid: GridDef,
  tileSizePx: number,
): { x: number; y: number } {
  const centreX = (object.anchorX + object.width / 2) * tileSizePx;
  const spriteTop = (object.anchorY + 1) * tileSizePx - object.spriteHeightPx;
  const bottom = spriteTop - tileSizePx;
  return {
    x: centreX - (grid.width * tileSizePx) / 2,
    y: bottom - grid.height * tileSizePx,
  };
}

/** What a view is bound to once opened. */
export interface OpenView {
  readonly objectId: bigint;
  readonly defId: number;
  readonly grid: GridDef;
}

/** An intent on a def that declares a grid opens a view; any other intent
 * opens nothing. Opening another container replaces this one -- there is a
 * single slot, so there is never a second panel. */
export function openView(
  intent: Intent,
  gridOf: (defId: number) => GridDef | undefined,
): OpenView | undefined {
  const grid = gridOf(intent.defId);
  if (!grid) return undefined;
  return { objectId: intent.objectId, defId: intent.defId, grid };
}

/** Everything the close rule reads. There is no pointer and no clock. */
export interface CloseInputs {
  readonly object: ContainerObject;
  readonly def: PickObjectDef;
  readonly subcellsPerCell: number;
  /** The player's feet, in world cells. */
  readonly player: { readonly x: number; readonly y: number; readonly floor: number };
  /** The object's `placed_object` row still exists. */
  readonly present: boolean;
  /** The object is currently visible (a retracted wall hides what is on it). */
  readonly visible: boolean;
  /** The player's body answers the player (`input/body-control.ts`). */
  readonly bodyOpen: boolean;
  readonly connected: boolean;
}

/** Whether the open view closes this frame: the feet left the object's
 * `interact_at` (the rule that let it open -- `isWithinReach`, integers and
 * half-open comparisons), the floor changed, the object is gone or hidden,
 * the body closed, or the connection was lost. */
export function shouldClose(inputs: CloseInputs): boolean {
  if (!inputs.present || !inputs.visible || !inputs.bodyOpen || !inputs.connected) return true;
  return !isWithinReach(
    inputs.object,
    inputs.def,
    inputs.player,
    inputs.object.floor,
    inputs.subcellsPerCell,
  );
}

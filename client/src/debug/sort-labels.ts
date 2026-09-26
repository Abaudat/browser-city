// The sort-order overlay's pure half (story 1.12, AC3): the FR123 sort
// key, made readable. No DOM, nothing drawn.
//
// Every value printed is the `Drawable`'s own field, never recomputed:
// the point of this overlay is that a *wrong* key shows up as a wrong
// readout, which it cannot do if the readout is derived a second,
// independent way. The resolved order index is likewise whatever the
// renderer actually applied (`DebugWorldView.orderOf`), so a wrong key
// and a wrong resolution are two separately readable failures.
//
// The printed key is lossless -- `parseSortLabel` reads it straight back
// into the four components `compareDrawables` compares
// (`inv_sort_overlay_labels_are_the_sort_key`), which is what makes "the
// label is the key" a checked claim rather than a comment.

import { screenPositionPx } from "../render/screen-position";
import type { Drawable } from "../render/sort-key";
import { fromSortUnits } from "../render/sort-units";
import { isEmptyCellBounds } from "../world/world-index";
import { DEBUG_STYLE } from "./debug-style";
import type { DebugWorldView } from "./world-view";

/**
 * How many baselines the readouts are staggered across (AC3: "when
 * objects overlap, each drawable's sort key is legible"). A tile is
 * `render.tile_size_px` wide and a key is ~20 monospace characters, so a
 * row of adjacent one-tile props would otherwise print every label on top
 * of its neighbours' -- the exact case the overlay is wanted for.
 *
 * The lane is keyed on the drawable's own *tile column*, never on its `x`
 * in sort units (Tim's direction, cycle 2): a sort-unit key only spreads
 * adjacent tiles across lanes while `SORT_SUBDIVISIONS` happens to be
 * coprime with this number, so moving that entirely unrelated constant to
 * 3, 6, 9 or 12 would collapse every tile-aligned prop into lane 0 and
 * take AC3's whole overlap guarantee with it, silently. A tile column is
 * what actually decides whether two labels collide, so it is what decides
 * the lane; it is also a pure function of the drawable's own position, so
 * a label never moves between frames or depends on iteration order.
 */
const STAGGER_LANES = 3;

/** One readout, in world pixels at the drawable's own anchor. */
export interface SortLabel {
  readonly stableId: bigint;
  /** `(y, rank, x, stableId)`, most significant first -- the FR123 key,
   * in sort units. */
  readonly label: string;
  /** The index this drawable came out at in the order the renderer
   * applied, or `[?]` when it is in no pool right now. */
  readonly orderLabel: string;
  readonly x: number;
  readonly y: number;
  readonly fill: string;
}

const LABEL_PATTERN = /^y(-?\d+) r(-?\d+) x(-?\d+) #(\d+)$/;

/** The FR123 key as one line, most significant component first. */
function formatKey(d: Drawable): string {
  return `y${d.y} r${d.rank} x${d.x} #${d.stableId.toString()}`;
}

/**
 * [`formatKey`]'s inverse: a label back into the key it printed, or
 * `undefined` for anything this module did not write. `floor` is always
 * `0` -- floor is never a term in the FR123 key (FR124), so it is not
 * printed, and a parsed key must compare exactly as the original did.
 */
export function parseSortLabel(label: string): Drawable | undefined {
  const match = LABEL_PATTERN.exec(label);
  if (!match) return undefined;
  // Every group in `LABEL_PATTERN` is mandatory and the pattern is
  // anchored, so a match has all four. Asserted rather than re-checked:
  // a defensive branch here could never be reached, and an unreachable
  // branch is an untested branch forever.
  return {
    y: Number(match[1]),
    rank: Number(match[2]),
    x: Number(match[3]),
    stableId: BigInt(match[4] as string),
    floor: 0,
  };
}

/**
 * A readout for every pool member on the viewer's own floor that is
 * currently on screen -- placed at each one's own anchor, the same
 * `screen-position.ts` projection the renderer positions its sprite with,
 * so a label sitting somewhere other than on its sprite is itself a
 * finding.
 */
export function buildSortLabels(view: DebugWorldView): SortLabel[] {
  const bounds = view.viewportCells();
  // A window containing no cell is checked explicitly: unlike the loops
  // in `collision-rects.ts`, this filters with `>=`/`<=`, which an
  // inverted window would not make empty on its own.
  if (isEmptyCellBounds(bounds)) return [];
  const floor = view.viewerFloor();
  const labels: SortLabel[] = [];

  for (const d of view.pool()) {
    if (d.floor !== floor) continue;
    const worldX = fromSortUnits(d.x);
    const worldY = fromSortUnits(d.y);
    if (worldX < bounds.cellX0 || worldX > bounds.cellX1 + 1) continue;
    if (worldY < bounds.cellY0 || worldY > bounds.cellY1 + 1) continue;
    const order = view.orderOf(d.stableId);
    const anchor = screenPositionPx(
      worldX,
      worldY,
      floor,
      view.tileSizePx,
      view.storeyHeightPx,
      view.zoom,
    );
    // Two adjacent props never share a baseline: without this, a row of
    // one-tile props prints every key over its neighbours'. Keyed on the
    // tile column (`worldX`, already computed above), never on `d.x` in
    // sort units -- see `STAGGER_LANES`.
    const column = Math.floor(worldX);
    const lane = ((column % STAGGER_LANES) + STAGGER_LANES) % STAGGER_LANES;
    labels.push({
      stableId: d.stableId,
      label: formatKey(d),
      orderLabel: order === undefined ? "[?]" : `[${order}]`,
      x: anchor.x,
      y: anchor.y - lane * DEBUG_STYLE.lineHeightPx * 2,
      fill: DEBUG_STYLE.palette.sortLabel,
    });
  }

  return labels;
}

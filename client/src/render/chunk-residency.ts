// Which streamed chunks are drawn (story 3.16): a pure rule over the keys
// the client holds and the viewport. Holding a chunk (its rows feed the
// collision and ownership indexes) is the region subscription's business;
// drawing it is this one's. A chunk is drawn once it comes within
// [`DRAW_MARGIN_CELLS`] of the viewport -- early enough that nothing pops
// in inside it -- and dropped only a whole chunk past that, so a player
// standing on a boundary never makes a chunk thrash.

import { CHUNK_SIZE, unpackChunkKey } from "../world/chunk";
import { REGION_BODY_MARGIN_CELLS } from "../world/region";

/** How far beyond the viewport a chunk is drawn: the region's own body
 * margin, so what the region holds ahead of the player is drawn ahead of
 * the player. */
export const DRAW_MARGIN_CELLS = REGION_BODY_MARGIN_CELLS;

export interface ViewCells {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface Residency {
  /** Chunks to draw now, nearest the viewport centre first. */
  readonly draw: bigint[];
  /** Drawn chunks to release. */
  readonly drop: bigint[];
}

/**
 * `held` is every chunk key with rows, `drawn` the ones currently drawn,
 * `view` the viewport in floor-0 cells. `floorShift` is the screen shift a
 * floor adds (a point on floor `f` is drawn `f` storeys north), in cells:
 * the chunk is judged on its own floor's shifted window.
 */
export function chunkResidency(
  held: Iterable<bigint>,
  drawn: Iterable<bigint>,
  view: ViewCells,
  floorShift: number,
  floorWanted: (floor: number) => boolean = () => true,
): Residency {
  const centreX = (view.x0 + view.x1) / 2;
  const centreY = (view.y0 + view.y1) / 2;
  const drawnSet = new Set(drawn);
  const draw: { key: bigint; d: number }[] = [];
  const drop: bigint[] = [];
  const consider = new Set<bigint>(held);
  for (const k of drawnSet) consider.add(k);
  for (const key of consider) {
    const { cx, cy, floor } = unpackChunkKey(key);
    const shift = floor * floorShift;
    const x0 = cx * CHUNK_SIZE;
    const y0 = cy * CHUNK_SIZE + shift;
    const x1 = x0 + CHUNK_SIZE;
    const y1 = y0 + CHUNK_SIZE;
    const reach = (margin: number): boolean =>
      x0 < view.x1 + margin &&
      x1 > view.x0 - margin &&
      y0 < view.y1 + margin &&
      y1 > view.y0 - margin;
    const wanted = floorWanted(floor) && reach(DRAW_MARGIN_CELLS);
    if (wanted) {
      const d = Math.hypot((x0 + x1) / 2 - centreX, (y0 + y1) / 2 - centreY);
      draw.push({ key, d });
    } else if (
      drawnSet.has(key) &&
      !(floorWanted(floor) && reach(DRAW_MARGIN_CELLS + CHUNK_SIZE))
    ) {
      drop.push(key);
    }
  }
  draw.sort((a, b) => a.d - b.d);
  return { draw: draw.map((e) => e.key), drop };
}

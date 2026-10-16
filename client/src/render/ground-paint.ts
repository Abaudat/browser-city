// What a chunk's ground is (story 3.16): a pure painter over the chunk's
// `ground_area` rects. Rows are painted in `areaId` order, a later one
// covering an earlier; a cell no rect covers is open ground (floor 0) or
// nothing (any other floor). Zero PixiJS: `world-scene.ts` turns the
// answer into tile sprites.

import { CHUNK_SIZE } from "../world/chunk";

/** The painter's answer for a cell no def covers. */
export const NO_GROUND = -1;

/** One ground rect, as the painter reads it. */
export interface GroundRect {
  readonly areaId: bigint;
  readonly defId: number;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** The def painted on each cell of chunk `(cx, cy)`, row-major from its
 * north-west cell, [`NO_GROUND`] where nothing is. `open` is the def an
 * unpainted cell is, or [`NO_GROUND`] on a floor with no open ground. */
export function paintChunkGround(
  rects: Iterable<GroundRect>,
  cx: number,
  cy: number,
  open: number,
): Int32Array {
  const cells = new Int32Array(CHUNK_SIZE * CHUNK_SIZE).fill(open);
  const x0 = cx * CHUNK_SIZE;
  const y0 = cy * CHUNK_SIZE;
  const ordered = [...rects].sort((a, b) =>
    a.areaId < b.areaId ? -1 : a.areaId > b.areaId ? 1 : 0,
  );
  for (const r of ordered) {
    const xa = Math.max(r.x0, x0);
    const xb = Math.min(r.x1, x0 + CHUNK_SIZE);
    const ya = Math.max(r.y0, y0);
    const yb = Math.min(r.y1, y0 + CHUNK_SIZE);
    for (let y = ya; y < yb; y++) {
      const row = (y - y0) * CHUNK_SIZE;
      for (let x = xa; x < xb; x++) cells[row + (x - x0)] = r.defId;
    }
  }
  return cells;
}

/** The open-ground def: of the objects carrying the open-ground role tag
 * (`city.ground.open_tag_id`), the one with the fewest other tags -- the
 * plain tile, never a yard or a roof that carries more. Ties go to the
 * lowest id. `undefined` when no object carries the tag. */
export function openGroundDefId(
  objects: readonly { readonly id: number; readonly tags: readonly number[] }[],
  openTag: number,
): number | undefined {
  let best: { id: number; n: number } | undefined;
  for (const o of objects) {
    if (!o.tags.includes(openTag)) continue;
    if (!best || o.tags.length < best.n || (o.tags.length === best.n && o.id < best.id)) {
      best = { id: o.id, n: o.tags.length };
    }
  }
  return best?.id;
}

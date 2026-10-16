// The client's own mirror of `sim::world::chunk_key` (NFR30 forbids
// sharing the code, so this is a deliberate, independent re-implementation
// of the exact same bit layout): `[63:56] reserved=0 | [55:32] chunk_x
// (24-bit two's complement) | [31:8] chunk_y (24-bit two's complement) |
// [7:0] floor (8-bit two's complement)`. `bigint` throughout, matching the
// generated `PlacedObject.chunkKey`/`u64` binding type.

/** Tiles per chunk edge, on a single floor -- declared exactly once, here.
 * A literal 32 anywhere else in `world/` is a defect. */
export const CHUNK_SIZE = 32;

const CHUNK_X_BITS = 24n;
const CHUNK_Y_BITS = 24n;
const FLOOR_BITS = 8n;
const CHUNK_X_MASK = (1n << CHUNK_X_BITS) - 1n;
const CHUNK_Y_MASK = (1n << CHUNK_Y_BITS) - 1n;
const FLOOR_MASK = (1n << FLOOR_BITS) - 1n;

/** The chunk coordinate `x` (or `y`) falls in -- floor division, not
 * truncation, so a negative coordinate chunks the same way a positive one
 * does (`-1` is in chunk `-1`, not chunk `0`). */
function chunkCoord(v: number): number {
  return Math.floor(v / CHUNK_SIZE);
}

/** The chunk key for world cell `(x, y, floor)` (FR145) -- the unit of
 * subscription and therefore of cost, mirrored here so the client's own
 * `CollisionGrid` buckets exactly the way the server's spatially addressed
 * tables do. */
export function chunkKey(x: number, y: number, floor: number): bigint {
  const cx = BigInt(chunkCoord(x)) & CHUNK_X_MASK;
  const cy = BigInt(chunkCoord(y)) & CHUNK_Y_MASK;
  const f = BigInt(Math.trunc(floor)) & FLOOR_MASK;
  return (cx << (CHUNK_Y_BITS + FLOOR_BITS)) | (cy << FLOOR_BITS) | f;
}

/** A small integer naming chunk `(cx, cy, floor)`: a cache key for hot
 * lookups, where the `bigint` of [`chunkKey`] would allocate per call. It
 * stays a small integer (a double key would box per call), so it covers
 * `cx`/`cy` in [-512, 512) and `floor` in [-8, 8); `-1` outside, which a
 * caller treats as "do not cache". */
/** The keys of the floor-`floor` chunks the cell rect `[x0, x1] x [y0, y1]`
 * touches (bounds inclusive, fractional cells allowed). */
export function chunkKeysCovering(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  floor: number,
): bigint[] {
  const out: bigint[] = [];
  for (let cy = Math.floor(y0 / CHUNK_SIZE); cy <= Math.floor(y1 / CHUNK_SIZE); cy++) {
    for (let cx = Math.floor(x0 / CHUNK_SIZE); cx <= Math.floor(x1 / CHUNK_SIZE); cx++) {
      out.push(chunkKey(cx * CHUNK_SIZE, cy * CHUNK_SIZE, floor));
    }
  }
  return out;
}

export function chunkSlot(cx: number, cy: number, floor: number): number {
  const x = cx + 512;
  const y = cy + 512;
  const f = floor + 8;
  if (x < 0 || x >= 1024 || y < 0 || y >= 1024 || f < 0 || f >= 16) return -1;
  return (f * 1024 + x) * 1024 + y;
}

/** The chunk coordinates and floor a chunk key names -- the inverse of
 * [`chunkKey`] on its three packed fields. */
export function unpackChunkKey(key: bigint): { cx: number; cy: number; floor: number } {
  const signed = (v: bigint, bits: bigint): number => {
    const sign = 1n << (bits - 1n);
    return Number(v >= sign ? v - (1n << bits) : v);
  };
  return {
    cx: signed((key >> (CHUNK_Y_BITS + FLOOR_BITS)) & CHUNK_X_MASK, CHUNK_X_BITS),
    cy: signed((key >> FLOOR_BITS) & CHUNK_Y_MASK, CHUNK_Y_BITS),
    floor: signed(key & FLOOR_MASK, FLOOR_BITS),
  };
}

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

//! Chunk keying: the unit of subscription (FR145's streaming) and
//! therefore the unit of cost. `CHUNK_SIZE` is declared exactly once, here
//! -- a magic 32 anywhere else, server or client, is a defect.

use super::collision::Rect;

/// Tiles per chunk edge, on a single floor. The one place this number is
/// allowed to appear as a literal.
pub const CHUNK_SIZE: i32 = 32;

/// Bit widths of `chunk_key`'s three packed fields. 24+24+8 = 56 of 64
/// bits; the remaining 8 are reserved and always zero.
const CHUNK_X_BITS: u32 = 24;
const CHUNK_Y_BITS: u32 = 24;
const FLOOR_BITS: u32 = 8;
const CHUNK_X_MASK: u64 = (1u64 << CHUNK_X_BITS) - 1;
const CHUNK_Y_MASK: u64 = (1u64 << CHUNK_Y_BITS) - 1;
const FLOOR_MASK: u64 = (1u64 << FLOOR_BITS) - 1;

/// The chunk coordinate `x` (or `y`) falls in -- floor division, not
/// truncation, so negative coordinates chunk the same way positive ones do
/// (`-1` is in chunk `-1`, not chunk `0`). `div_euclid` never overflows for
/// any `i32` dividend and this constant, positive divisor.
fn chunk_coord(v: i32) -> i32 {
    v.div_euclid(CHUNK_SIZE)
}

/// Packs a chunk coordinate and floor into `chunk_key`'s bit layout:
/// `[63:56] reserved=0 | [55:32] chunk_x (24-bit two's complement) |
/// [31:8] chunk_y (24-bit two's complement) | [7:0] floor (8-bit two's
/// complement)`. Pure bit masking -- never panics, regardless of input --
/// though a chunk coordinate outside the 24-bit range (currently
/// unreachable: see `chunk_key`'s doc comment) would silently truncate,
/// which is why that range is documented as a permanent ceiling.
fn pack(chunk_x: i32, chunk_y: i32, floor: i8) -> u64 {
    let cx = (chunk_x as i64 as u64) & CHUNK_X_MASK;
    let cy = (chunk_y as i64 as u64) & CHUNK_Y_MASK;
    let f = (floor as i64 as u64) & FLOOR_MASK;
    (cx << (CHUNK_Y_BITS + FLOOR_BITS)) | (cy << FLOOR_BITS) | f
}

/// Sign-extends the low `bits`-wide two's complement field in `value` to a
/// full `i32`.
fn sign_extend(value: u64, bits: u32) -> i32 {
    let shift = 64 - bits;
    ((value << shift) as i64 >> shift) as i32
}

/// The chunk key for world cell `(x, y, floor)` (FR145): every spatially
/// addressed table carries this as a plain indexed column, computed by
/// this one pure function everywhere. A chunk covers `CHUNK_SIZE` tiles
/// square on a single floor.
///
/// The 24-bit chunk range covers chunk coordinates in
/// `-8,388,608..=8,388,607`, i.e. world tile coordinates roughly
/// `+/-268,435,456` at `CHUNK_SIZE` 32 -- far past NFR14's 1024-tile
/// growth-target district, so truncation is unreachable at any world size
/// this game ever declares.
pub fn chunk_key(x: i32, y: i32, floor: i8) -> u64 {
    pack(chunk_coord(x), chunk_coord(y), floor)
}

/// Inverse of [`chunk_key`]'s packing: the chunk coordinates and floor it
/// encodes. Exists for the packing's own round-trip test; nothing in the
/// module needs to unpack a key it did not just pack itself.
pub fn unpack_chunk_key(key: u64) -> (i32, i32, i8) {
    let cx = sign_extend(
        (key >> (CHUNK_Y_BITS + FLOOR_BITS)) & CHUNK_X_MASK,
        CHUNK_X_BITS,
    );
    let cy = sign_extend((key >> FLOOR_BITS) & CHUNK_Y_MASK, CHUNK_Y_BITS);
    let floor = (key & FLOOR_MASK) as u8 as i8;
    (cx, cy, floor)
}

/// The chunk-aligned end (exclusive) of the chunk containing `v`, widened
/// to `i64` so the `+ CHUNK_SIZE` cannot overflow even when `v` is near
/// `i32::MAX`.
fn chunk_end(v: i32) -> i64 {
    let start = (v as i64).div_euclid(CHUNK_SIZE as i64) * CHUNK_SIZE as i64;
    start + CHUNK_SIZE as i64
}

/// Whether `rect` lies entirely inside the single chunk `chunk_key(rect.x0,
/// rect.y0, floor)` names -- the containment rule an ownership area must
/// satisfy (`docs/architecture.md`'s "World addressing" section).
/// `rect.x1 - 1`/`rect.y1 - 1` cannot underflow: `is_valid` guarantees
/// `x1 > x0 >= i32::MIN`, so `x1 >= i32::MIN + 1`.
pub fn rect_is_within_one_chunk(rect: Rect, floor: i8) -> bool {
    if !rect.is_valid() {
        return false;
    }
    let key = chunk_key(rect.x0, rect.y0, floor);
    chunk_key(rect.x1 - 1, rect.y0, floor) == key
        && chunk_key(rect.x0, rect.y1 - 1, floor) == key
        && chunk_key(rect.x1 - 1, rect.y1 - 1, floor) == key
}

/// Splits `rect` into pieces aligned to chunk boundaries on `floor`, each
/// paired with the chunk key that names it. The pieces partition `rect`
/// exactly -- their union is `rect`, cell for cell, and no two overlap
/// (`tests/world_chunk_clip.rs`). A generator producing a
/// `building_area`/`room_area` row confined to one chunk (the containment
/// rule `docs/architecture.md` states) builds each row from one of these
/// pieces rather than clipping by hand; `WorldSpec::build` is what
/// actually enforces the rule against whatever a generator hands it.
/// Returns an empty `Vec` for an invalid `rect`.
pub fn clip_rect_to_chunks(rect: Rect, floor: i8) -> Vec<(Rect, u64)> {
    if !rect.is_valid() {
        return Vec::new();
    }
    let mut pieces = Vec::new();
    let mut y = rect.y0;
    while y < rect.y1 {
        let y_end = chunk_end(y).min(rect.y1 as i64) as i32;
        let mut x = rect.x0;
        while x < rect.x1 {
            let x_end = chunk_end(x).min(rect.x1 as i64) as i32;
            let piece = Rect {
                x0: x,
                y0: y,
                x1: x_end,
                y1: y_end,
            };
            pieces.push((piece, chunk_key(x, y, floor)));
            x = x_end;
        }
        y = y_end;
    }
    pieces
}

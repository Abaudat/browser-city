//! Chunk keying: the unit of subscription (FR145's streaming) and
//! therefore the unit of cost. `CHUNK_SIZE` is declared exactly once, here
//! -- a magic 32 anywhere else, server or client, is a defect.

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

//! `sim::world::chunk_key`'s packing (FR145's streaming unit).

use proptest::prelude::*;
use sim::world::{CHUNK_SIZE, chunk_key, unpack_chunk_key};

#[test]
fn two_cells_in_the_same_chunk_pack_to_the_same_key() {
    let a = chunk_key(3, 5, 0);
    let b = chunk_key(31, 0, 0);
    assert_eq!(a, b);
}

#[test]
fn a_cell_one_chunk_over_packs_to_a_different_key() {
    let a = chunk_key(31, 0, 0);
    let b = chunk_key(32, 0, 0);
    assert_ne!(a, b);
}

#[test]
fn negative_coordinates_chunk_by_floor_division_not_truncation() {
    // -1 is in chunk -1, not chunk 0: truncating division would put it in
    // the same chunk as 0, which is wrong on either side of the origin.
    assert_eq!(chunk_key(-1, 0, 0), chunk_key(-CHUNK_SIZE, 0, 0));
    assert_ne!(chunk_key(-1, 0, 0), chunk_key(0, 0, 0));
}

#[test]
fn floor_is_part_of_the_key() {
    assert_ne!(chunk_key(0, 0, 0), chunk_key(0, 0, 1));
    assert_ne!(chunk_key(0, 0, 0), chunk_key(0, 0, -1));
}

proptest! {
    /// The chunk key's packing round-trips for any chunk coordinate that
    /// fits the documented 24-bit range (Tech Lead direction) -- far past
    /// any world size this game ever declares (NFR14).
    #[test]
    fn chunk_key_round_trips(
        chunk_x in -8_388_608i32..=8_388_607,
        chunk_y in -8_388_608i32..=8_388_607,
        floor in any::<i8>(),
    ) {
        let x = chunk_x * CHUNK_SIZE;
        let y = chunk_y * CHUNK_SIZE;
        let key = chunk_key(x, y, floor);
        let (out_x, out_y, out_floor) = unpack_chunk_key(key);
        prop_assert_eq!(out_x, chunk_x);
        prop_assert_eq!(out_y, chunk_y);
        prop_assert_eq!(out_floor, floor);
    }

    /// `chunk_key` never panics for any `i32` coordinate, including the
    /// extremes -- part of `inv_world_query_total`'s "never panic, never
    /// wrap [into a debug-assertion abort]" over arbitrary input.
    #[test]
    fn chunk_key_never_panics(x in any::<i32>(), y in any::<i32>(), floor in any::<i8>()) {
        let _ = chunk_key(x, y, floor);
    }
}

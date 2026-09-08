//! `sim::world::clip_rect_to_chunks`: the containment rule
//! (`docs/architecture.md`'s "World addressing" section) as a function a
//! generator can call, rather than a comment it can miss.

use std::collections::BTreeSet;

use proptest::prelude::*;
use sim::world::{Rect, clip_rect_to_chunks, rect_is_within_one_chunk};

proptest! {
    /// The clipped pieces partition the input rect exactly: every cell in
    /// `rect` belongs to exactly one piece, and no piece contains a cell
    /// outside `rect`. Small rects only (an exhaustive per-cell check), but
    /// the coordinates range well past a single chunk on both axes and
    /// past `i32` zero in both directions, so the partition is checked
    /// across a chunk boundary and across the origin, not just within one
    /// chunk.
    #[test]
    fn clip_rect_to_chunks_partitions_the_input_exactly(
        x0 in -80i32..80, y0 in -80i32..80, w in 1i32..70, h in 1i32..70, floor in any::<i8>(),
    ) {
        let rect = Rect { x0, y0, x1: x0 + w, y1: y0 + h };
        let pieces = clip_rect_to_chunks(rect, floor);

        let mut covered: BTreeSet<(i32, i32)> = BTreeSet::new();
        for (piece, _) in &pieces {
            for y in piece.y0..piece.y1 {
                for x in piece.x0..piece.x1 {
                    // No cell is covered by more than one piece.
                    prop_assert!(covered.insert((x, y)), "cell ({x}, {y}) covered by more than one piece");
                }
            }
        }

        let mut expected: BTreeSet<(i32, i32)> = BTreeSet::new();
        for y in rect.y0..rect.y1 {
            for x in rect.x0..rect.x1 {
                expected.insert((x, y));
            }
        }
        prop_assert_eq!(covered, expected);
    }

    /// Every piece lies entirely inside one chunk, and its paired key is
    /// that chunk's key.
    #[test]
    fn clip_rect_to_chunks_pieces_each_fit_one_chunk(
        x0 in -80i32..80, y0 in -80i32..80, w in 1i32..70, h in 1i32..70, floor in any::<i8>(),
    ) {
        let rect = Rect { x0, y0, x1: x0 + w, y1: y0 + h };
        for (piece, key) in clip_rect_to_chunks(rect, floor) {
            prop_assert!(rect_is_within_one_chunk(piece, floor));
            prop_assert_eq!(sim::world::chunk_key(piece.x0, piece.y0, floor), key);
        }
    }
}

#[test]
fn clip_rect_to_chunks_of_an_invalid_rect_is_empty() {
    let rect = Rect {
        x0: 5,
        y0: 5,
        x1: 5,
        y1: 5,
    };
    assert!(clip_rect_to_chunks(rect, 0).is_empty());
}

#[test]
fn clip_rect_to_chunks_of_a_rect_already_inside_one_chunk_is_one_piece() {
    let rect = Rect {
        x0: 1,
        y0: 1,
        x1: 5,
        y1: 5,
    };
    let pieces = clip_rect_to_chunks(rect, 0);
    assert_eq!(pieces.len(), 1);
    assert_eq!(pieces[0].0, rect);
}

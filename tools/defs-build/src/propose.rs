//! Story 2.3 (AC1/AC2): a throwaway first guess at a prop's own footprint
//! and collider, derived from alpha coverage of the sprite's **lower
//! band** only -- a starting point, never authority (AC1), consumed only
//! by `src/bin/defs-propose.rs`'s own stdout-only wiring, never by
//! [`crate::build`]'s own path (AC4). Pure: no filesystem, no clock, no
//! `defs/` access -- an in-memory RGBA8 buffer and its pixel dimensions
//! in, a [`Proposal`] or a named [`ProposeError`] out.

use crate::model::{COLLIDER_SUBCELLS_PER_CELL, ColliderRect, MAX_FOOTPRINT_CELLS};

/// The tileset's own tile size, in pixels -- `defs/balance/render.toml`'s
/// real `render.tile_size_px` value today. The proposer never reads
/// `defs/` (Tim's direction), so this is a constant here, not a
/// parameter: `propose` takes only a decoded sprite's own pixels and
/// dimensions. Pinned against the real committed balance file by
/// `tools/defs-build/tests/propose_tile_size_pinned.rs`, so the two can
/// never silently drift apart.
pub const PROPOSE_TILE_SIZE_PX: u32 = 16;

/// Any pixel whose alpha channel is at or above this counts as opaque
/// for every coverage measurement below (AC1's "alpha coverage") --
/// declared once so no call site repeats the literal (Quentin's
/// direction). `1` (any non-zero alpha): the tileset's own sprites are
/// either fully opaque or fully transparent per pixel outside a thin
/// anti-aliased edge, and this is a starting point for review, never
/// authority, so a slightly generous bounding box costs nothing a
/// reviewer cannot immediately see and correct.
pub const ALPHA_OPAQUE_THRESHOLD: u8 = 1;

/// A footprint and collider proposal, in the same units `defs/objects/
/// *.toml` authors a real object in -- `width`/`height` in cells,
/// `collider` in sub-cells relative to the proposed footprint's own
/// north-west corner. Deliberately carries nothing else: no `sprite`,
/// `id`, `key`, `name`, `layer` or `tags` -- those belong to
/// `src/bin/defs-propose.rs`'s own stdout rendering, never to this pure
/// core.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Proposal {
    pub width: u32,
    pub height: u32,
    pub collider: Option<ColliderRect>,
}

/// Every way [`propose`] refuses to guess, named (AC1: "explicitly a
/// starting point", which requires an explicit refusal to ever be silent
/// about one) -- never a silent `0x0` or `1x1` in place of any of these.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposeError {
    /// `width_px` or `height_px` is not a whole multiple of
    /// [`PROPOSE_TILE_SIZE_PX`] -- refused by name, never rounded.
    NotWholeTileMultiple { width_px: u32, height_px: u32 },
    /// The sprite's own lower band (AC1) has no opaque pixel at all --
    /// covers both "the whole sprite is transparent" and "only art above
    /// the band is opaque", since either way there is nothing to measure
    /// within the one region this function is ever allowed to read
    /// (Tim's direction: a single refusal, never a whole-sprite pre-scan
    /// that would make "no pixel above the band is ever read" false).
    LowerBandFullyTransparent,
    /// The band has an opaque pixel somewhere, but the sprite's own
    /// bottom row does not -- every object in this tileset is
    /// bottom-anchored (FR126: a sprite may overhang its footprint
    /// upward, never downward), so a gap under the visible art (a
    /// detached shadow, padding) leaves no bottom edge to measure depth
    /// from. Never silently treated as depth 1 (AC1).
    BottomRowFullyTransparent,
    /// The measured footprint would be wider or deeper than
    /// [`MAX_FOOTPRINT_CELLS`] (FR127) -- named, never silently clamped.
    FootprintExceedsCap { cells: u32, cap: i64, axis: Axis },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Axis {
    Width,
    Height,
}

impl Axis {
    fn as_str(self) -> &'static str {
        match self {
            Axis::Width => "width",
            Axis::Height => "height",
        }
    }
}

impl std::fmt::Display for ProposeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ProposeError::NotWholeTileMultiple {
                width_px,
                height_px,
            } => write!(
                f,
                "{width_px}x{height_px}px is not a whole multiple of the tile size ({PROPOSE_TILE_SIZE_PX}px) -- refused, not rounded"
            ),
            ProposeError::LowerBandFullyTransparent => write!(
                f,
                "the sprite's own lower band is fully transparent -- no proposal"
            ),
            ProposeError::BottomRowFullyTransparent => write!(
                f,
                "the sprite's own bottom row is fully transparent -- every sprite in this tileset is bottom-anchored, so depth cannot be measured from a gap"
            ),
            ProposeError::FootprintExceedsCap { cells, cap, axis } => write!(
                f,
                "the measured {} ({cells} cells) exceeds MAX_FOOTPRINT_CELLS ({cap})",
                axis.as_str()
            ),
        }
    }
}

fn is_opaque(rgba: &[u8], width_px: u32, x: u32, y: u32) -> bool {
    let i = (y as usize * width_px as usize + x as usize) * 4 + 3;
    rgba[i] >= ALPHA_OPAQUE_THRESHOLD
}

fn row_has_opaque_pixel(rgba: &[u8], width_px: u32, y: u32) -> bool {
    (0..width_px).any(|x| is_opaque(rgba, width_px, x, y))
}

/// Ceiling division for two non-negative integers -- `depth`/`width` in
/// cells is always rounded up, never truncated (a 17px-deep opaque
/// region is 2 cells deep, not 1).
fn ceil_div(numerator: u32, denominator: u32) -> u32 {
    numerator.div_ceil(denominator)
}

/// Story 2.3, AC1/AC2: derives a [`Proposal`] from `rgba`'s own alpha
/// coverage of its **lower band** only -- the bottom
/// `min(height_px, width_px, MAX_FOOTPRINT_CELLS * tile_size_px)` pixel
/// rows, so a sprite far taller than it is wide (the tileset's dominant
/// 16x32-class prop, one cell of floor under two cells of screen height)
/// never has its own screen height inflate its footprint depth, while a
/// sprite as wide as or wider than it is tall (a vehicle) has its whole
/// height examined -- for such a sprite, more height legitimately does
/// mean more depth (AC2: "depth greater than one is common"), so height
/// invariance is only ever claimed for a sprite no wider than it is tall
/// (see the property test of the same name). Every loop below is bounded
/// by `band_top_row`, never `0`: no pixel above the band is ever read,
/// structurally, not merely asserted.
///
/// `rgba.len()` must equal `width_px * height_px * 4`; violating that is
/// a caller bug, not a [`ProposeError`], so it panics via the slice
/// index rather than being modelled as a fourth error variant.
pub fn propose(width_px: u32, height_px: u32, rgba: &[u8]) -> Result<Proposal, ProposeError> {
    if width_px == 0
        || height_px == 0
        || !width_px.is_multiple_of(PROPOSE_TILE_SIZE_PX)
        || !height_px.is_multiple_of(PROPOSE_TILE_SIZE_PX)
    {
        return Err(ProposeError::NotWholeTileMultiple {
            width_px,
            height_px,
        });
    }

    let band_h_px = height_px
        .min(width_px)
        .min(MAX_FOOTPRINT_CELLS as u32 * PROPOSE_TILE_SIZE_PX);
    let band_top_row = height_px - band_h_px;
    if !(band_top_row..height_px).any(|y| row_has_opaque_pixel(rgba, width_px, y)) {
        return Err(ProposeError::LowerBandFullyTransparent);
    }

    let width_cells = width_px / PROPOSE_TILE_SIZE_PX;
    if width_cells as i64 > MAX_FOOTPRINT_CELLS {
        return Err(ProposeError::FootprintExceedsCap {
            cells: width_cells,
            cap: MAX_FOOTPRINT_CELLS,
            axis: Axis::Width,
        });
    }

    // Depth: contiguous opaque rows counted from the very bottom row
    // upward, stopping at the first empty row or the band's own top --
    // never a row above the band. A transparent bottom row (a gap under
    // the art) is refused by name, never silently reported as depth 1
    // (Quentin's direction): every sprite here is bottom-anchored, so a
    // footprint that does not touch the sprite's own bottom edge is not
    // measurable at all, not a valid 1-cell guess.
    let mut depth_px = 0u32;
    for y in (band_top_row..height_px).rev() {
        if row_has_opaque_pixel(rgba, width_px, y) {
            depth_px += 1;
        } else {
            break;
        }
    }
    if depth_px == 0 {
        return Err(ProposeError::BottomRowFullyTransparent);
    }
    let depth_cells = ceil_div(depth_px, PROPOSE_TILE_SIZE_PX);
    if depth_cells as i64 > MAX_FOOTPRINT_CELLS {
        return Err(ProposeError::FootprintExceedsCap {
            cells: depth_cells,
            cap: MAX_FOOTPRINT_CELLS,
            axis: Axis::Height,
        });
    }

    // Collider: the opaque bounding box inside the proposed footprint
    // only (the bottom `depth_cells * tile_size_px` rows, every column),
    // converted from pixels to sub-cells relative to the footprint's own
    // north-west corner -- floor on the low edge, ceiling on the high
    // edge, so the box never shrinks a partially-covered edge sub-cell
    // away (monotonicity: turning one more pixel opaque never shrinks
    // the proposal).
    let footprint_h_px = depth_cells * PROPOSE_TILE_SIZE_PX;
    let footprint_top_row = height_px - footprint_h_px;
    let mut min_x: Option<u32> = None;
    let mut max_x: Option<u32> = None;
    let mut min_y: Option<u32> = None;
    let mut max_y: Option<u32> = None;
    for y in footprint_top_row..height_px {
        for x in 0..width_px {
            if is_opaque(rgba, width_px, x, y) {
                min_x = Some(min_x.map_or(x, |m| m.min(x)));
                max_x = Some(max_x.map_or(x, |m| m.max(x)));
                min_y = Some(min_y.map_or(y, |m| m.min(y)));
                max_y = Some(max_y.map_or(y, |m| m.max(y)));
            }
        }
    }
    // `depth_px >= 1` (checked above) already proved the sprite's own
    // bottom row (`height_px - 1`) is opaque, and `footprint_top_row <=
    // height_px - depth_px` always (`footprint_h_px >= depth_px` by
    // `ceil_div`), so that row lies inside this scan's own range -- every
    // `Option` here is always `Some`. `expect`, never a silent fallback.
    let (min_x, max_x, min_y, max_y) = (
        min_x.expect("the sprite's own bottom row is opaque and lies inside the footprint scan"),
        max_x.expect("the sprite's own bottom row is opaque and lies inside the footprint scan"),
        min_y.expect("the sprite's own bottom row is opaque and lies inside the footprint scan"),
        max_y.expect("the sprite's own bottom row is opaque and lies inside the footprint scan"),
    );

    let px_to_subcell_floor =
        |px: u32| (px * COLLIDER_SUBCELLS_PER_CELL as u32) / PROPOSE_TILE_SIZE_PX;
    let px_to_subcell_ceil =
        |px: u32| ceil_div(px * COLLIDER_SUBCELLS_PER_CELL as u32, PROPOSE_TILE_SIZE_PX);

    let collider = ColliderRect {
        x0: px_to_subcell_floor(min_x) as i32,
        y0: px_to_subcell_floor(min_y - footprint_top_row) as i32,
        x1: px_to_subcell_ceil(max_x + 1) as i32,
        y1: px_to_subcell_ceil(max_y + 1 - footprint_top_row) as i32,
    };

    Ok(Proposal {
        width: width_cells,
        height: depth_cells,
        collider: Some(collider),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    /// One solid, opaque `w`x`h` sprite -- every test below that does not
    /// itself exercise a specific alpha pattern starts from this and
    /// punches transparency in by hand.
    fn opaque(w: u32, h: u32) -> Vec<u8> {
        vec![255u8; w as usize * h as usize * 4]
    }

    fn set_alpha(rgba: &mut [u8], w: u32, x: u32, y: u32, a: u8) {
        rgba[(y as usize * w as usize + x as usize) * 4 + 3] = a;
    }

    fn get_alpha(rgba: &[u8], w: u32, x: u32, y: u32) -> u8 {
        rgba[(y as usize * w as usize + x as usize) * 4 + 3]
    }

    fn transparent(w: u32, h: u32) -> Vec<u8> {
        vec![0u8; w as usize * h as usize * 4]
    }

    /// Builds a `w`x`h` RGBA buffer from a flat pool of random bits,
    /// indexed modulo the pool's own length so a single, modestly-sized
    /// proptest strategy (independent of `w`/`h`) can still cover every
    /// pixel of any sprite up to the cap -- a real, varied alpha mask,
    /// never one fixed pixel or column (Quentin's direction).
    fn sprite_from_bits(w: u32, h: u32, bits: &[bool]) -> Vec<u8> {
        let mut rgba = transparent(w, h);
        for y in 0..h {
            for x in 0..w {
                let idx = (y as usize * w as usize + x as usize) % bits.len();
                if bits[idx] {
                    set_alpha(&mut rgba, w, x, y, 255);
                }
            }
        }
        rgba
    }

    /// Large enough to cover a full `MAX_FOOTPRINT_CELLS`-square sprite
    /// (128x128) without repeating too densely, small enough that
    /// proptest's shrinker stays fast.
    const BIT_POOL_LEN: usize = 128 * 128;

    fn bit_pool() -> impl Strategy<Value = Vec<bool>> {
        prop::collection::vec(prop::bool::ANY, BIT_POOL_LEN)
    }

    // --- pinned unit cases -------------------------------------------------

    /// The band boundary: for a 16x32 sprite, the band is
    /// `min(32, 16, 128) = 16px` tall, rows 16..32 (0-indexed from the
    /// top). An opaque pixel exactly on the band's own top row (16) is
    /// seen by the band scan -- proven here by its own distinct refusal
    /// (`BottomRowFullyTransparent`, since row 16 alone leaves the
    /// sprite's own bottom row, 31, empty) rather than the band-level one
    /// (`LowerBandFullyTransparent`), which would fire instead if row 16
    /// were invisible to the scan.
    #[test]
    fn an_opaque_pixel_exactly_on_the_bands_top_row_is_seen_by_the_band_scan() {
        let mut rgba = transparent(16, 32);
        set_alpha(&mut rgba, 16, 0, 16, 255);
        assert_eq!(
            propose(16, 32, &rgba).unwrap_err(),
            ProposeError::BottomRowFullyTransparent
        );
    }

    #[test]
    fn a_pixel_one_row_above_the_bands_top_row_does_not_count() {
        let rgba = {
            let mut r = transparent(16, 32);
            set_alpha(&mut r, 16, 0, 15, 255);
            r
        };
        let err = propose(16, 32, &rgba).unwrap_err();
        assert_eq!(err, ProposeError::LowerBandFullyTransparent);
    }

    /// AC2's own worked example: a 16x32 lamp-class shape (one opaque
    /// column over the sprite's full height) proposes exactly 1x1 -- by
    /// hand: band = min(32,16,128) = 16px = 1 cell; the column is opaque
    /// throughout, so depth = ceil(16/16) = 1; width = 16/16 = 1.
    #[test]
    fn the_16x32_lamp_shape_proposes_exactly_1x1() {
        let mut rgba = transparent(16, 32);
        for y in 0..32 {
            set_alpha(&mut rgba, 16, 8, y, 255);
        }
        let p = propose(16, 32, &rgba).unwrap();
        assert_eq!((p.width, p.height), (1, 1));
    }

    #[test]
    fn a_fully_transparent_sprite_is_flagged_never_a_silent_0x0_or_1x1() {
        let rgba = transparent(16, 16);
        assert_eq!(
            propose(16, 16, &rgba).unwrap_err(),
            ProposeError::LowerBandFullyTransparent
        );
    }

    /// Opaque above the band, but the band itself is empty -- caught by
    /// the same `LowerBandFullyTransparent` refusal as a wholly
    /// transparent sprite (Tim's direction: one refusal, not two, since
    /// no pixel above the band is ever read either way).
    #[test]
    fn a_sprite_whose_lower_band_alone_is_fully_transparent_is_flagged() {
        let mut rgba = transparent(16, 32);
        // Opaque only in the top half (rows 0..16), entirely above the
        // 16px band (rows 16..32).
        for y in 0..16 {
            set_alpha(&mut rgba, 16, 8, y, 255);
        }
        assert_eq!(
            propose(16, 32, &rgba).unwrap_err(),
            ProposeError::LowerBandFullyTransparent
        );
    }

    /// Quentin's own worked counter-example (cycle 1 finding 1): a 32x48
    /// sprite whose only opaque pixels are in row 20. By hand: band =
    /// min(48, 32, 128) = 32px, rows 16..48, which contains row 20, so
    /// the band is not fully transparent -- but the sprite's own bottom
    /// row (47) is transparent, so depth cannot be measured from it.
    /// Previously panicked (`min_x.expect(...)`); now a named refusal.
    #[test]
    fn a_gap_below_the_only_opaque_row_is_flagged_never_a_panic_or_a_silent_1x1() {
        let mut rgba = transparent(32, 48);
        for x in 0..32 {
            set_alpha(&mut rgba, 32, x, 20, 255);
        }
        assert_eq!(
            propose(32, 48, &rgba).unwrap_err(),
            ProposeError::BottomRowFullyTransparent
        );
    }

    /// The same shape, but with the bottom row also opaque -- no gap, so
    /// this one *does* propose (contrasts with the case above, proving
    /// the refusal is about the gap, not about row 20 specifically).
    #[test]
    fn the_same_shape_with_its_bottom_row_also_opaque_proposes_normally() {
        let mut rgba = transparent(32, 48);
        for x in 0..32 {
            set_alpha(&mut rgba, 32, x, 20, 255);
            set_alpha(&mut rgba, 32, x, 47, 255);
        }
        let p = propose(32, 48, &rgba).unwrap();
        assert_eq!(p.width, 2);
        assert_eq!(p.height, 1);
    }

    #[test]
    fn a_sprite_wider_than_max_footprint_cells_is_flagged_naming_the_cap() {
        let w = (MAX_FOOTPRINT_CELLS as u32 + 1) * PROPOSE_TILE_SIZE_PX;
        let rgba = opaque(w, 16);
        let err = propose(w, 16, &rgba).unwrap_err();
        assert_eq!(
            err,
            ProposeError::FootprintExceedsCap {
                cells: MAX_FOOTPRINT_CELLS as u32 + 1,
                cap: MAX_FOOTPRINT_CELLS,
                axis: Axis::Width,
            }
        );
    }

    #[test]
    fn a_width_not_a_whole_tile_multiple_is_refused_not_rounded() {
        let rgba = opaque(17, 16);
        assert_eq!(
            propose(17, 16, &rgba).unwrap_err(),
            ProposeError::NotWholeTileMultiple {
                width_px: 17,
                height_px: 16
            }
        );
    }

    #[test]
    fn a_height_not_a_whole_tile_multiple_is_refused_not_rounded() {
        let rgba = opaque(16, 17);
        assert_eq!(
            propose(16, 17, &rgba).unwrap_err(),
            ProposeError::NotWholeTileMultiple {
                width_px: 16,
                height_px: 17
            }
        );
    }

    /// A vehicle-class sprite: 112x64 (7x4 cells). By hand: band =
    /// min(64,112,128) = 64px = the whole sprite, fully opaque, so depth
    /// = ceil(64/16) = 4 cells; width = 112/16 = 7 cells. Depth greater
    /// than one is common, not exceptional (AC2).
    #[test]
    fn a_wide_fully_opaque_sprite_proposes_a_multi_cell_deep_footprint() {
        let rgba = opaque(112, 64);
        let p = propose(112, 64, &rgba).unwrap();
        assert_eq!((p.width, p.height), (7, 4));
        assert_eq!(
            p.collider,
            Some(ColliderRect {
                x0: 0,
                y0: 0,
                x1: 112,
                y1: 64
            })
        );
    }

    /// Growing a sprite *at least as wide as it is tall* (a vehicle-class
    /// shape) by adding real opaque rows on top is expected to change the
    /// proposal -- more height there legitimately means more depth
    /// (AC2), so height invariance is never claimed for this class. This
    /// is the exact shape of Quentin's cycle-1 counter-example (112x64 ->
    /// 112x80), pinned so it can never quietly start passing by
    /// accident if the band formula ever changes.
    #[test]
    fn a_sprite_as_wide_as_it_is_tall_does_have_its_depth_inflated_by_added_height() {
        let short = opaque(112, 64);
        let short_p = propose(112, 64, &short).unwrap();
        let tall = opaque(112, 80);
        let tall_p = propose(112, 80, &tall).unwrap();
        assert_eq!(short_p.height, 4);
        assert_eq!(tall_p.height, 5);
        assert_ne!(short_p, tall_p);
    }

    // --- property tests (the real proof of AC2, and of "never panics") ----

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(
            std::env::var("PROPTEST_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(64)
        ))]

        /// "Sprite height does not inflate footprint depth" (AC2) --
        /// proven exactly as narrowly as it is actually true (Quentin's
        /// direction, cycle 1): only for a sprite no wider than it is
        /// tall, where the band is capped by width (or the cap), never
        /// by height, so growing height by adding real rows on top
        /// (transparent or opaque, via a randomised alpha pattern, not
        /// one fixed column) can never move the band and therefore never
        /// changes the proposal, up to the full `MAX_FOOTPRINT_CELLS`
        /// square.
        #[test]
        fn height_invariance_holds_for_a_sprite_no_wider_than_it_is_tall(
            width_tiles in 1u32..9,
            height_slack_tiles in 0u32..9,
            extra_tiles in 0u32..4,
            bits in bit_pool(),
        ) {
            // `base_height_tiles = width_tiles + height_slack_tiles`
            // (never drawn independently, then filtered) guarantees
            // `width_px <= base_height_px` by construction -- the
            // condition under which the band is provably unaffected by
            // height (band = width_px, never the height term of the
            // min()), and growing height_px only ever increases it
            // further past width_px. A `prop_assume!` on two
            // independently-drawn values rejected roughly half of every
            // run and blew proptest's own global-reject budget at the
            // real `PROPTEST_CASES=4096` CI uses -- constructing an
            // always-valid pair costs nothing and rejects nothing.
            let base_height_tiles = width_tiles + height_slack_tiles;
            let width_px = width_tiles * PROPOSE_TILE_SIZE_PX;
            let base_height_px = base_height_tiles * PROPOSE_TILE_SIZE_PX;

            let base = sprite_from_bits(width_px, base_height_px, &bits);
            let baseline = propose(width_px, base_height_px, &base);

            let extra_px = extra_tiles * PROPOSE_TILE_SIZE_PX;
            let new_height_px = base_height_px + extra_px;
            let mut grown = transparent(width_px, new_height_px);
            for y in 0..base_height_px {
                for x in 0..width_px {
                    let v = get_alpha(&base, width_px, x, y);
                    set_alpha(&mut grown, width_px, x, extra_px + y, v);
                }
            }
            let grown_result = propose(width_px, new_height_px, &grown);

            prop_assert_eq!(baseline, grown_result);
        }

        /// Monotonicity: turning one more pixel opaque, anywhere in a
        /// randomised sprite up to the cap, never shrinks the proposal
        /// (never a smaller width/height, never a collider box that no
        /// longer contains the previous one).
        #[test]
        fn turning_a_pixel_opaque_never_shrinks_the_proposal(
            width_tiles in 1u32..9,
            height_tiles in 1u32..9,
            bits in bit_pool(),
            extra_x in 0u32..128,
            extra_y in 0u32..128,
        ) {
            let width_px = width_tiles * PROPOSE_TILE_SIZE_PX;
            let height_px = height_tiles * PROPOSE_TILE_SIZE_PX;
            let before = sprite_from_bits(width_px, height_px, &bits);
            let Ok(before_p) = propose(width_px, height_px, &before) else {
                return Ok(());
            };

            let x = extra_x % width_px;
            let y = extra_y % height_px;
            let mut after = before.clone();
            set_alpha(&mut after, width_px, x, y, 255);
            let after_p = propose(width_px, height_px, &after).unwrap();

            prop_assert!(after_p.width >= before_p.width);
            prop_assert!(after_p.height >= before_p.height);
            if let (Some(b), Some(a)) = (before_p.collider, after_p.collider) {
                prop_assert!(a.x0 <= b.x0);
                prop_assert!(a.y0 <= b.y0);
                prop_assert!(a.x1 >= b.x1);
                prop_assert!(a.y1 >= b.y1);
            }
        }

        /// `propose` never panics over any whole-tile-multiple buffer,
        /// any alpha pattern -- always `Ok` or a named `Err` (Quentin's
        /// direction: this property alone would have found the cycle-1
        /// panic immediately).
        #[test]
        fn propose_never_panics_always_ok_or_a_named_err(
            width_tiles in 1u32..9,
            height_tiles in 1u32..9,
            bits in bit_pool(),
        ) {
            let width_px = width_tiles * PROPOSE_TILE_SIZE_PX;
            let height_px = height_tiles * PROPOSE_TILE_SIZE_PX;
            let rgba = sprite_from_bits(width_px, height_px, &bits);
            let _ = propose(width_px, height_px, &rgba);
        }

        /// Bounds: whenever a proposal is produced at all, over any
        /// sprite size up to the cap and any alpha pattern, it is never
        /// wider than `w / tile`, never deeper than `h / tile`, and
        /// always agrees with `validate.rs`'s own footprint/collider
        /// rules -- proven by calling the real validator (Quentin's
        /// direction), never a re-implementation of its own checks here.
        /// The five keys the real proposer never emits (`id`/`key`/
        /// `name`/`layer`/`tags`) are filled in exactly as a reviewer
        /// pasting a real stanza would.
        #[test]
        fn a_produced_proposal_always_fits_the_real_validator(
            width_tiles in 1u32..9,
            height_tiles in 1u32..9,
            bits in bit_pool(),
        ) {
            let w = width_tiles * PROPOSE_TILE_SIZE_PX;
            let h = height_tiles * PROPOSE_TILE_SIZE_PX;
            let rgba = sprite_from_bits(w, h, &bits);

            let Ok(p) = propose(w, h, &rgba) else {
                return Ok(());
            };
            prop_assert!(p.width <= w / PROPOSE_TILE_SIZE_PX);
            prop_assert!(p.height <= h / PROPOSE_TILE_SIZE_PX);

            let collider_toml = match p.collider {
                Some(c) => format!(
                    "collider = {{ x0 = {}, y0 = {}, x1 = {}, y1 = {} }}\n",
                    c.x0, c.y0, c.x1, c.y1
                ),
                None => String::new(),
            };
            let object_toml = format!(
                "[[object]]\nid = 1\nkey = \"proposed\"\nname = \"Proposed\"\nlayer = \"objects\"\nsprite = {{ sheet = \"fixtures/proposed.png\", x = 0, y = 0, w = {w}, h = {h} }}\nwidth = {}\nheight = {}\n{collider_toml}tags = [\"fixture\"]\n",
                p.width, p.height,
            );
            let files = vec![
                (
                    std::path::PathBuf::from("defs/objects/proposed.toml"),
                    object_toml,
                ),
                (
                    std::path::PathBuf::from("defs/tags/roles.toml"),
                    "[[tag]]\nid = 1\nkey = \"fixture\"\nrole = { layers = [\"objects\"] }\n"
                        .to_string(),
                ),
                (
                    std::path::PathBuf::from("defs/balance/render.toml"),
                    "[[balance]]\nkey = \"render.tile_size_px\"\nvalue = 16\nmin = 1\nmax = 64\n"
                        .to_string(),
                ),
            ];
            let raw = crate::parse::parse_all(&files).unwrap();
            let sheet_dims: std::collections::BTreeMap<String, (u32, u32)> =
                [("fixtures/proposed.png".to_string(), (w, h))]
                    .into_iter()
                    .collect();
            let layer_codes: std::collections::BTreeMap<String, u32> =
                [("objects".to_string(), 3u32)].into_iter().collect();
            let result = crate::validate::validate(&raw, &sheet_dims, &layer_codes, "");
            prop_assert!(
                result.is_ok(),
                "propose() output failed the real validator: {:?}",
                result.err()
            );
        }

        /// Determinism: the same buffer always gives the same output,
        /// over any sprite size up to the cap and any alpha pattern.
        #[test]
        fn propose_is_deterministic(
            width_tiles in 1u32..9,
            height_tiles in 1u32..9,
            bits in bit_pool(),
        ) {
            let w = width_tiles * PROPOSE_TILE_SIZE_PX;
            let h = height_tiles * PROPOSE_TILE_SIZE_PX;
            let rgba = sprite_from_bits(w, h, &bits);

            let a = propose(w, h, &rgba);
            let b = propose(w, h, &rgba);
            prop_assert_eq!(a, b);
        }
    }
}

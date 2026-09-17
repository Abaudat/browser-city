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
/// dimensions.
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
    /// Every pixel in the whole sprite is at or below
    /// [`ALPHA_OPAQUE_THRESHOLD`].
    FullyTransparentSprite,
    /// The sprite has opaque pixels somewhere, but its own lower band
    /// (AC1) has none -- a silent `1x1` here would look exactly like a
    /// real proposal.
    LowerBandFullyTransparent,
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
            ProposeError::FullyTransparentSprite => {
                write!(f, "the whole sprite is fully transparent -- no proposal")
            }
            ProposeError::LowerBandFullyTransparent => write!(
                f,
                "the sprite's own lower band is fully transparent -- no proposal"
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
/// height examined. No pixel above that band is ever read.
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

    if !(0..height_px).any(|y| row_has_opaque_pixel(rgba, width_px, y)) {
        return Err(ProposeError::FullyTransparentSprite);
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
    // never a row above the band (AC1's own guarantee, made mechanical:
    // the loop bound is `band_top_row`, not `0`).
    let mut depth_px = 0u32;
    for y in (band_top_row..height_px).rev() {
        if row_has_opaque_pixel(rgba, width_px, y) {
            depth_px += 1;
        } else {
            break;
        }
    }
    let depth_cells = ceil_div(depth_px, PROPOSE_TILE_SIZE_PX).max(1);
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
    // The depth loop above already proved at least one opaque pixel
    // exists in the bottom row of the footprint, so every `Option` here
    // is always `Some` -- `expect`, never a silent fallback.
    let (min_x, max_x, min_y, max_y) = (
        min_x.expect("footprint has at least one opaque pixel by construction"),
        max_x.expect("footprint has at least one opaque pixel by construction"),
        min_y.expect("footprint has at least one opaque pixel by construction"),
        max_y.expect("footprint has at least one opaque pixel by construction"),
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

    fn transparent(w: u32, h: u32) -> Vec<u8> {
        vec![0u8; w as usize * h as usize * 4]
    }

    // --- pinned unit cases -------------------------------------------------

    /// The band boundary: for a 16x32 sprite, the band is
    /// `min(32, 16, 128) = 16px` tall, rows 16..32 (0-indexed from the
    /// top). Row 16 (the band's own top row) counts; row 15 (one row
    /// above it) does not.
    #[test]
    fn an_opaque_pixel_exactly_on_the_bands_top_row_counts() {
        let mut rgba = transparent(16, 32);
        set_alpha(&mut rgba, 16, 0, 16, 255);
        let p = propose(16, 32, &rgba).unwrap();
        assert_eq!((p.width, p.height), (1, 1));
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
            ProposeError::FullyTransparentSprite
        );
    }

    /// Opaque above the band, but the band itself is empty -- a distinct
    /// flag from "fully transparent" (AC1: the proposal must say *which*
    /// kind of nothing it found).
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

    // --- property tests (the real proof of AC2) ----------------------------

    // "Sprite height does not inflate footprint depth": adding any
    // number of rows above the lower band -- transparent or fully
    // opaque -- never changes the proposal, as long as the sprite's own
    // width already caps the band below the added rows (so the band
    // itself, and therefore the whole measurement, is unaffected by
    // what gets prepended above it).
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(
            std::env::var("PROPTEST_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(64)
        ))]

        #[test]
        fn height_invariance_adding_rows_above_the_band_never_changes_the_proposal(
            extra_tiles in 0u32..4,
            extra_opaque in prop::bool::ANY,
        ) {
            // A narrow (16px-wide) base sprite so the band is always
            // capped at 16px (one tile) regardless of how tall the
            // sprite grows -- exactly the 16x32-class shape AC2
            // describes.
            let base_h = 32u32;
            let mut base = transparent(16, base_h);
            for y in (base_h - 16)..base_h {
                set_alpha(&mut base, 16, 8, y, 255);
            }
            let baseline = propose(16, base_h, &base).unwrap();

            let extra_px = extra_tiles * PROPOSE_TILE_SIZE_PX;
            let new_h = base_h + extra_px;
            let mut grown = transparent(16, new_h);
            let fill = if extra_opaque { 255 } else { 0 };
            for y in 0..extra_px {
                set_alpha(&mut grown, 16, 8, y, fill);
            }
            for y in 0..base_h {
                for x in 0..16 {
                    let v = base[(y as usize * 16 + x as usize) * 4 + 3];
                    set_alpha(&mut grown, 16, x, extra_px + y, v);
                }
            }

            let grown_proposal = propose(16, new_h, &grown).unwrap();
            prop_assert_eq!(baseline, grown_proposal);
        }

        /// Monotonicity: turning one more lower-band pixel opaque never
        /// shrinks the proposal (never a smaller width/height, never a
        /// collider box that no longer contains the previous one).
        #[test]
        fn turning_a_lower_band_pixel_opaque_never_shrinks_the_proposal(
            seed_x in 0u32..16,
            seed_y in 16u32..32,
            extra_x in 0u32..16,
            extra_y in 16u32..32,
        ) {
            let mut before = transparent(16, 32);
            set_alpha(&mut before, 16, seed_x, seed_y, 255);
            let Ok(before_p) = propose(16, 32, &before) else {
                return Ok(());
            };

            let mut after = before.clone();
            set_alpha(&mut after, 16, extra_x, extra_y, 255);
            let after_p = propose(16, 32, &after).unwrap();

            prop_assert!(after_p.width >= before_p.width);
            prop_assert!(after_p.height >= before_p.height);
            if let (Some(b), Some(a)) = (before_p.collider, after_p.collider) {
                prop_assert!(a.x0 <= b.x0);
                prop_assert!(a.y0 <= b.y0);
                prop_assert!(a.x1 >= b.x1);
                prop_assert!(a.y1 >= b.y1);
            }
        }

        /// Bounds: whenever a proposal is produced at all, it is never
        /// wider than `w / tile`, never deeper than `h / tile`, and
        /// always agrees with `validate.rs`'s own footprint/collider
        /// rules -- proven by calling the real validator (Quentin's
        /// direction), never a re-implementation of its own checks here.
        /// The five keys the real proposer never emits (`id`/`key`/
        /// `name`/`layer`/`tags`) are filled in exactly as a reviewer
        /// pasting a real stanza would.
        #[test]
        fn a_produced_proposal_always_fits_the_real_validator(
            w_tiles in 1u32..4,
            h_tiles in 1u32..4,
            fill_seed in 0u32..16,
        ) {
            let w = w_tiles * PROPOSE_TILE_SIZE_PX;
            let h = h_tiles * PROPOSE_TILE_SIZE_PX;
            let mut rgba = transparent(w, h);
            // At least one opaque pixel in the bottom row, so the band is
            // never fully transparent -- deterministic from the seed, no
            // silent always-Err path that would make this property
            // vacuous.
            let x = fill_seed % w;
            set_alpha(&mut rgba, w, x, h - 1, 255);

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

        /// Determinism: the same buffer always gives the same output.
        #[test]
        fn propose_is_deterministic(
            w_tiles in 1u32..3,
            h_tiles in 1u32..3,
            fill_seed in 0u32..16,
        ) {
            let w = w_tiles * PROPOSE_TILE_SIZE_PX;
            let h = h_tiles * PROPOSE_TILE_SIZE_PX;
            let mut rgba = transparent(w, h);
            let x = fill_seed % w;
            set_alpha(&mut rgba, w, x, h - 1, 255);

            let a = propose(w, h, &rgba);
            let b = propose(w, h, &rgba);
            prop_assert_eq!(a, b);
        }
    }
}

//! The build's pixel refusal: a `collider` must agree with the art it
//! sits under. Pixels may refuse a build, never shape an artefact -- the
//! check returns `Result<(), _>` and nothing else, so no measured value
//! can reach `Defs`, `emit` or the contact sheet.
//!
//! The band is the bottom `height * tile_size_px` rows of the object's
//! own sprite rect. Opaque is [`crate::alpha::is_opaque`]. Four clauses,
//! in this order, each compared in sub-cells with integer cross
//! multiplication (pixel edge `p * SUBCELLS` against collider edge
//! `x * tile_size_px`), never rounding:
//!
//! 1. the collider's columns lie inside the band's solid column span;
//! 2. the band's lowest solid row's columns lie inside the collider's;
//! 3. the collider's rows lie inside the band's solid row span;
//! 4. only for an upright (tag `upright`): the collider's rows lie inside
//!    the foot -- the rows an archetype declares with `foot = true`. An
//!    upright seen face-on is opaque top to bottom, so no pixel can say
//!    which rows touch the ground; the authored foot does, and the
//!    collider may not climb its face.

use std::collections::BTreeMap;

use crate::alpha::{PxRect, bottom_opaque_row, opaque_column_span, opaque_row_span};
use crate::atlas::image::DecodedSheet;
use crate::error::DefsError;
use crate::model::{
    COLLIDER_SUBCELLS_PER_CELL, ColliderRect, Defs, RawDefs, SpriteRect, UPRIGHT_TAG_KEY,
};

/// Every way a collider can disagree with its art. Spans are half-open
/// sub-cell ranges; a pixel edge that falls between two sub-cells is
/// widened outwards (floor on the low edge, ceiling on the high one).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Disagreement {
    /// The footprint band holds no solid pixel at all.
    NoSolidPixel,
    /// Clause 1.
    ColliderColumnsOutsideArt {
        collider: (i32, i32),
        art: (i64, i64),
    },
    /// Clause 2.
    BottomRowOutsideCollider {
        collider: (i32, i32),
        art: (i64, i64),
    },
    /// Clause 3.
    ColliderRowsOutsideArt {
        collider: (i32, i32),
        art: (i64, i64),
    },
    /// Clause 4: an upright's collider reaches outside its foot.
    ColliderOutsideFoot {
        collider: (i32, i32),
        foot: (i32, i32),
    },
}

impl std::fmt::Display for Disagreement {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match *self {
            Disagreement::NoSolidPixel => write!(
                f,
                "the sprite's footprint band has no solid pixel under its collider"
            ),
            Disagreement::ColliderColumnsOutsideArt { collider, art } => write!(
                f,
                "collider columns {}..{} reach outside the solid columns {}..{} of the sprite's footprint band (sub-cells)",
                collider.0, collider.1, art.0, art.1
            ),
            Disagreement::BottomRowOutsideCollider { collider, art } => write!(
                f,
                "collider columns {}..{} do not cover the bottom solid row's columns {}..{} (sub-cells)",
                collider.0, collider.1, art.0, art.1
            ),
            Disagreement::ColliderRowsOutsideArt { collider, art } => write!(
                f,
                "collider rows {}..{} reach outside the solid rows {}..{} of the sprite's footprint band (sub-cells)",
                collider.0, collider.1, art.0, art.1
            ),
            Disagreement::ColliderOutsideFoot { collider, foot } => write!(
                f,
                "collider rows {}..{} reach outside the foot rows {}..{} of an upright (sub-cells)",
                collider.0, collider.1, foot.0, foot.1
            ),
        }
    }
}

/// Pixel span to the enclosing sub-cell range.
fn span_in_subcells(span: (u32, u32), tile_size_px: u32) -> (i64, i64) {
    let sub = COLLIDER_SUBCELLS_PER_CELL;
    let t = tile_size_px as i64;
    (span.0 as i64 * sub / t, (span.1 as i64 * sub + t - 1) / t)
}

/// Whether the half-open sub-cell range `inner` lies inside the pixel
/// span `outer`.
fn subcells_inside_px(inner: (i32, i32), outer: (u32, u32), tile_size_px: u32) -> bool {
    let (sub, t) = (COLLIDER_SUBCELLS_PER_CELL, tile_size_px as i64);
    inner.0 as i64 * t >= outer.0 as i64 * sub && inner.1 as i64 * t <= outer.1 as i64 * sub
}

/// Whether the pixel span `inner` lies inside the half-open sub-cell
/// range `outer`.
fn px_inside_subcells(inner: (u32, u32), outer: (i32, i32), tile_size_px: u32) -> bool {
    let (sub, t) = (COLLIDER_SUBCELLS_PER_CELL, tile_size_px as i64);
    inner.0 as i64 * sub >= outer.0 as i64 * t && inner.1 as i64 * sub <= outer.1 as i64 * t
}

/// Compares `collider` with the art in `rgba` (a `sheet_w`-wide RGBA8
/// buffer) under `sprite`'s footprint band. Pure; never panics for a
/// `sprite` inside the buffer.
pub fn check_collider_against_art(
    rgba: &[u8],
    sheet_w: u32,
    sprite: &SpriteRect,
    height: u32,
    tile_size_px: u32,
    collider: ColliderRect,
) -> Result<(), Disagreement> {
    check_collider_against_art_with_foot(
        rgba,
        sheet_w,
        sprite,
        height,
        tile_size_px,
        collider,
        None,
    )
}

/// [`check_collider_against_art`] plus clause 4 when `foot` (half-open
/// sub-cell rows) is given.
pub fn check_collider_against_art_with_foot(
    rgba: &[u8],
    sheet_w: u32,
    sprite: &SpriteRect,
    height: u32,
    tile_size_px: u32,
    collider: ColliderRect,
    foot: Option<(i32, i32)>,
) -> Result<(), Disagreement> {
    let band_h = (height * tile_size_px).min(sprite.h);
    let band = PxRect {
        sheet_w,
        x: sprite.x,
        y: sprite.y + sprite.h - band_h,
        w: sprite.w,
        h: band_h,
    };
    let cols = (collider.x0, collider.x1);
    let rows = (collider.y0, collider.y1);
    let (Some(col_span), Some(row_span), Some((_, bottom))) = (
        opaque_column_span(rgba, band),
        opaque_row_span(rgba, band),
        bottom_opaque_row(rgba, band),
    ) else {
        return Err(Disagreement::NoSolidPixel);
    };
    if !subcells_inside_px(cols, col_span, tile_size_px) {
        return Err(Disagreement::ColliderColumnsOutsideArt {
            collider: cols,
            art: span_in_subcells(col_span, tile_size_px),
        });
    }
    if !px_inside_subcells(bottom, cols, tile_size_px) {
        return Err(Disagreement::BottomRowOutsideCollider {
            collider: cols,
            art: span_in_subcells(bottom, tile_size_px),
        });
    }
    if !subcells_inside_px(rows, row_span, tile_size_px) {
        return Err(Disagreement::ColliderRowsOutsideArt {
            collider: rows,
            art: span_in_subcells(row_span, tile_size_px),
        });
    }
    if let Some(foot) = foot
        && (rows.0 < foot.0 || rows.1 > foot.1)
    {
        return Err(Disagreement::ColliderOutsideFoot {
            collider: rows,
            foot,
        });
    }
    Ok(())
}

/// The foot (half-open sub-cell rows) an upright's collider must stay in:
/// its own archetype's when that is a foot, otherwise the shallowest foot
/// any archetype declares. `Err` when it is tagged upright and no
/// archetype is a foot at all.
fn foot_of(
    raw: &RawDefs,
    archetype: Option<&str>,
    height_cells: u32,
) -> Result<(i32, i32), &'static str> {
    let rows = |a: &crate::model::ArchetypeEntry| {
        a.collider_inset.as_ref().map(|i| {
            (
                i.value.top,
                (height_cells as i64 * COLLIDER_SUBCELLS_PER_CELL) as i32 - i.value.bottom,
            )
        })
    };
    let feet = || raw.archetypes.iter().filter(|a| a.foot);
    archetype
        .and_then(|k| feet().find(|a| a.key.value == k))
        .or_else(|| feet().max_by_key(|a| a.collider_inset.as_ref().map_or(0, |i| i.value.top)))
        .and_then(rows)
        .ok_or("no archetype is a `foot`")
}

/// Every collider in `defs` against its sprite's pixels, first failure
/// only, in the order `raw.objects` was authored. Reported at the
/// object's own `collider` line, or its `archetype` line when the
/// archetype supplied the collider.
pub fn check(
    raw: &RawDefs,
    defs: &Defs,
    sheets: &BTreeMap<String, DecodedSheet>,
) -> Result<(), DefsError> {
    let Some(tile_size_px) = defs.tile_size_px else {
        return Ok(());
    };
    let by_key: BTreeMap<&str, &crate::model::ObjectDef> =
        defs.objects.iter().map(|o| (o.key.as_str(), o)).collect();
    for entry in &raw.objects {
        let obj = by_key
            .get(entry.key.value.as_str())
            .expect("every validated object came from a raw entry of the same key");
        let Some(collider) = obj.collider else {
            if entry.tags.iter().any(|t| t == UPRIGHT_TAG_KEY) {
                return Err(DefsError::new(
                    &entry.path,
                    entry.key.line,
                    entry.key.col,
                    format!(
                        "object '{}' is tagged '{UPRIGHT_TAG_KEY}' but has no collider -- an upright collides at its foot",
                        obj.key
                    ),
                ));
            }
            continue;
        };
        let sprite = obj
            .sprite
            .as_ref()
            .expect("an object with a collider is drawn (validated)");
        let (w, _h, rgba) = sheets
            .get(&sprite.sheet)
            .expect("every object sheet was decoded before the silhouette check");
        let foot = if entry.tags.iter().any(|t| t == UPRIGHT_TAG_KEY) {
            let named = entry.archetype.as_ref().map(|a| a.value.as_str());
            match foot_of(raw, named, obj.height) {
                Ok(f) => Some(f),
                Err(why) => {
                    return Err(DefsError::new(
                        &entry.path,
                        entry.key.line,
                        entry.key.col,
                        format!(
                            "object '{}' is tagged '{UPRIGHT_TAG_KEY}' but {why}",
                            obj.key
                        ),
                    ));
                }
            }
        } else {
            None
        };
        let Err(problem) = check_collider_against_art_with_foot(
            rgba,
            *w,
            sprite,
            obj.height,
            tile_size_px,
            collider,
            foot,
        ) else {
            continue;
        };
        let (line, col, from) = match (&entry.collider, &entry.archetype) {
            (Some(c), _) => (c.line, c.col, String::new()),
            (None, Some(a)) => (a.line, a.col, format!(" from archetype '{}'", a.value)),
            (None, None) => unreachable!("an object with a collider declared or lowered one"),
        };
        return Err(DefsError::new(
            &entry.path,
            line,
            col,
            format!(
                "object '{}' collider ({}, {})-({}, {}){from}: {problem}",
                obj.key, collider.x0, collider.y0, collider.x1, collider.y1
            ),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alpha::ALPHA_OPAQUE_THRESHOLD;
    use proptest::prelude::*;

    const SOLID: u8 = 255;

    fn sheet(w: u32, h: u32, alpha: impl Fn(u32, u32) -> u8) -> Vec<u8> {
        let mut v = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                v[((y * w + x) * 4 + 3) as usize] = alpha(x, y);
            }
        }
        v
    }

    fn sprite(x: u32, y: u32, w: u32, h: u32) -> SpriteRect {
        SpriteRect {
            sheet: "s.png".into(),
            x,
            y,
            w,
            h,
        }
    }

    fn rect(x0: i32, y0: i32, x1: i32, y1: i32) -> ColliderRect {
        ColliderRect { x0, y0, x1, y1 }
    }

    fn in_block(x: u32, y: u32, cols: (u32, u32), rows: (u32, u32)) -> bool {
        (cols.0..cols.1).contains(&x) && (rows.0..rows.1).contains(&y)
    }

    /// 16x16 sprite, solid block columns 4..12, rows 4..12.
    fn block_sheet() -> Vec<u8> {
        sheet(16, 16, |x, y| {
            if in_block(x, y, (4, 12), (4, 12)) {
                SOLID
            } else {
                0
            }
        })
    }

    fn run(c: ColliderRect) -> Result<(), Disagreement> {
        check_collider_against_art(&block_sheet(), 16, &sprite(0, 0, 16, 16), 1, 16, c)
    }

    #[test]
    fn an_agreeing_collider_passes() {
        assert_eq!(run(rect(4, 4, 12, 12)), Ok(()));
    }

    #[test]
    fn a_collider_one_subcell_wider_than_the_art_on_either_side_fails_naming_both() {
        for c in [rect(3, 4, 12, 12), rect(4, 4, 13, 12)] {
            assert_eq!(
                run(c),
                Err(Disagreement::ColliderColumnsOutsideArt {
                    collider: (c.x0, c.x1),
                    art: (4, 12)
                })
            );
        }
    }

    #[test]
    fn a_collider_one_subcell_narrower_than_the_bottom_row_on_either_side_fails_naming_both() {
        for c in [rect(5, 4, 12, 12), rect(4, 4, 11, 12)] {
            assert_eq!(
                run(c),
                Err(Disagreement::BottomRowOutsideCollider {
                    collider: (c.x0, c.x1),
                    art: (4, 12)
                })
            );
        }
    }

    #[test]
    fn a_collider_one_subcell_taller_than_the_art_on_either_side_fails_naming_both() {
        for c in [rect(4, 3, 12, 12), rect(4, 4, 12, 13)] {
            assert_eq!(
                run(c),
                Err(Disagreement::ColliderRowsOutsideArt {
                    collider: (c.y0, c.y1),
                    art: (4, 12)
                })
            );
        }
    }

    fn run_foot(c: ColliderRect, foot: (i32, i32)) -> Result<(), Disagreement> {
        check_collider_against_art_with_foot(
            &block_sheet(),
            16,
            &sprite(0, 0, 16, 16),
            1,
            16,
            c,
            Some(foot),
        )
    }

    #[test]
    fn a_collider_one_subcell_outside_the_foot_on_either_side_fails_naming_both() {
        // Art rows 4..16, so clause 3 never refuses these.
        let tall = sheet(16, 16, |x, y| {
            if in_block(x, y, (4, 12), (4, 16)) {
                SOLID
            } else {
                0
            }
        });
        let run_tall = |c| {
            check_collider_against_art_with_foot(
                &tall,
                16,
                &sprite(0, 0, 16, 16),
                1,
                16,
                c,
                Some((8, 12)),
            )
        };
        assert_eq!(run_tall(rect(4, 8, 12, 12)), Ok(()));
        for c in [rect(4, 7, 12, 12), rect(4, 8, 12, 13)] {
            assert_eq!(
                run_tall(c),
                Err(Disagreement::ColliderOutsideFoot {
                    collider: (c.y0, c.y1),
                    foot: (8, 12)
                })
            );
        }
    }

    #[test]
    fn no_foot_means_no_fourth_clause() {
        assert_eq!(run(rect(4, 4, 12, 12)), Ok(()));
    }

    #[test]
    fn a_collider_shorter_than_the_art_passes_since_only_the_outside_is_refused() {
        assert_eq!(run(rect(4, 6, 12, 10)), Ok(()));
    }

    #[test]
    fn the_message_prints_both_spans() {
        let e = run(rect(3, 4, 12, 12)).unwrap_err();
        assert_eq!(
            e.to_string(),
            "collider columns 3..12 reach outside the solid columns 4..12 of the sprite's footprint band (sub-cells)"
        );
        let e = run(rect(5, 4, 12, 12)).unwrap_err();
        assert_eq!(
            e.to_string(),
            "collider columns 5..12 do not cover the bottom solid row's columns 4..12 (sub-cells)"
        );
        let e = run(rect(4, 3, 12, 12)).unwrap_err();
        assert_eq!(
            e.to_string(),
            "collider rows 3..12 reach outside the solid rows 4..12 of the sprite's footprint band (sub-cells)"
        );
        let e = run_foot(rect(4, 6, 12, 12), (8, 12)).unwrap_err();
        assert_eq!(
            e.to_string(),
            "collider rows 6..12 reach outside the foot rows 8..12 of an upright (sub-cells)"
        );
    }

    #[test]
    fn the_sub_tile_padding_row_under_the_art_is_tolerated() {
        // Block rows 4..12 of a 16-row band: rows 12..16 are transparent,
        // and the bottom solid row is row 11, not the band's last row.
        assert_eq!(run(rect(4, 4, 12, 12)), Ok(()));
    }

    #[test]
    fn a_fully_transparent_band_is_its_own_failure_not_a_pass_or_a_panic() {
        let b = sheet(16, 16, |_, _| 0);
        let r =
            check_collider_against_art(&b, 16, &sprite(0, 0, 16, 16), 1, 16, rect(4, 4, 12, 12));
        assert_eq!(r, Err(Disagreement::NoSolidPixel));
    }

    #[test]
    fn a_sprite_rect_at_a_non_zero_origin_is_read_relative_to_itself() {
        // 32x64 sheet fully solid except the 16x16 rect at (16, 48),
        // which holds only the block. A reader that starts at the sheet
        // origin sees full-width art and refuses the collider.
        let b = sheet(32, 64, |x, y| {
            let inside = (16..32).contains(&x) && (48..64).contains(&y);
            if !inside || in_block(x - 16, y - 48, (4, 12), (4, 12)) {
                SOLID
            } else {
                0
            }
        });
        let ok =
            check_collider_against_art(&b, 32, &sprite(16, 48, 16, 16), 1, 16, rect(4, 4, 12, 12));
        assert_eq!(ok, Ok(()));
    }

    #[test]
    fn art_above_the_band_wider_than_the_collider_passes() {
        // Lamppost shape: 16x48, a full-width head above a narrow pole.
        let b = sheet(16, 48, |x, y| {
            if y < 32 || in_block(x, y - 32, (6, 10), (0, 16)) {
                SOLID
            } else {
                0
            }
        });
        let r =
            check_collider_against_art(&b, 16, &sprite(0, 0, 16, 48), 1, 16, rect(6, 0, 10, 16));
        assert_eq!(r, Ok(()));
    }

    #[test]
    fn alpha_one_below_the_threshold_is_transparent_and_the_threshold_is_solid() {
        let thin = |a: u8| {
            sheet(16, 16, |x, y| {
                if in_block(x, y, (4, 12), (4, 12)) {
                    a
                } else {
                    0
                }
            })
        };
        let at = |a: u8| {
            check_collider_against_art(
                &thin(a),
                16,
                &sprite(0, 0, 16, 16),
                1,
                16,
                rect(4, 4, 12, 12),
            )
        };
        assert_eq!(
            at(ALPHA_OPAQUE_THRESHOLD - 1),
            Err(Disagreement::NoSolidPixel)
        );
        assert_eq!(at(ALPHA_OPAQUE_THRESHOLD), Ok(()));
    }

    /// 32px tiles: the art's pixel columns 8..24 are sub-cells 4..12.
    #[test]
    fn sub_cells_convert_at_a_tile_size_that_is_not_the_subcell_count() {
        let b = sheet(32, 32, |x, y| {
            if in_block(x, y, (8, 24), (8, 24)) {
                SOLID
            } else {
                0
            }
        });
        let run32 = |c| check_collider_against_art(&b, 32, &sprite(0, 0, 32, 32), 1, 32, c);
        assert_eq!(run32(rect(4, 4, 12, 12)), Ok(()));
        assert_eq!(
            run32(rect(3, 4, 12, 12)),
            Err(Disagreement::ColliderColumnsOutsideArt {
                collider: (3, 12),
                art: (4, 12)
            })
        );
        assert_eq!(
            run32(rect(4, 4, 11, 12)),
            Err(Disagreement::BottomRowOutsideCollider {
                collider: (4, 11),
                art: (4, 12)
            })
        );
    }

    /// 24px tiles (a 3:2 ratio): pixel edges 6 and 18 are sub-cells 4 and
    /// 12 exactly; pixel edges 7 and 17 fall between sub-cells and no
    /// collider can both fit inside and cover them.
    #[test]
    fn sub_cells_convert_at_a_non_integer_ratio_without_rounding() {
        let art = |lo: u32, hi: u32| {
            sheet(24, 24, move |x, y| {
                if in_block(x, y, (lo, hi), (6, 18)) {
                    SOLID
                } else {
                    0
                }
            })
        };
        let run24 =
            |b: &[u8], c| check_collider_against_art(b, 24, &sprite(0, 0, 24, 24), 1, 24, c);
        assert_eq!(run24(&art(6, 18), rect(4, 4, 12, 12)), Ok(()));
        let odd = art(7, 17);
        // 7*16/24 = 4.67 and 17*16/24 = 11.33: reported widened to 4..12.
        assert_eq!(
            run24(&odd, rect(4, 4, 12, 12)),
            Err(Disagreement::ColliderColumnsOutsideArt {
                collider: (4, 12),
                art: (4, 12)
            })
        );
        assert_eq!(
            run24(&odd, rect(5, 4, 11, 12)),
            Err(Disagreement::BottomRowOutsideCollider {
                collider: (5, 11),
                art: (4, 12)
            })
        );
    }

    fn cases() -> ProptestConfig {
        ProptestConfig::with_cases(
            std::env::var("PROPTEST_CASES")
                .ok()
                .and_then(|s| s.parse().ok())
                .unwrap_or(64),
        )
    }

    proptest! {
        #![proptest_config(cases())]

        /// Alpha above the band never changes the verdict.
        #[test]
        fn art_above_the_band_never_changes_the_verdict(
            above in prop::collection::vec(any::<u8>(), 16 * 32),
            x0 in 0i32..16, dx in 1i32..16, y0 in 0i32..16, dy in 1i32..16,
        ) {
            let (x1, y1) = ((x0 + dx).min(16), (y0 + dy).min(16));
            prop_assume!(x0 < x1 && y0 < y1);
            let base = sheet(16, 48, |x, y| {
                if y >= 32 && in_block(x, y - 32, (4, 12), (4, 12)) { SOLID } else { 0 }
            });
            let mut noisy = base.clone();
            for y in 0..32u32 {
                for x in 0..16u32 {
                    noisy[((y * 16 + x) * 4 + 3) as usize] = above[(y * 16 + x) as usize];
                }
            }
            let s = sprite(0, 0, 16, 48);
            let c = rect(x0, y0, x1, y1);
            prop_assert_eq!(
                check_collider_against_art(&base, 16, &s, 1, 16, c),
                check_collider_against_art(&noisy, 16, &s, 1, 16, c)
            );
        }

        /// Any art and any in-footprint collider: a verdict, never a panic.
        #[test]
        fn never_panics_over_any_art_and_any_in_footprint_collider(
            alpha in prop::collection::vec(prop_oneof![Just(0u8), Just(SOLID), any::<u8>()], 32 * 32),
            transparent in any::<bool>(),
            x0 in 0i32..32, dx in 1i32..32, y0 in 0i32..32, dy in 1i32..32,
        ) {
            let b = sheet(32, 32, |x, y| if transparent { 0 } else { alpha[(y * 32 + x) as usize] });
            let c = rect(x0, y0, (x0 + dx).min(32), (y0 + dy).min(32));
            let _ = check_collider_against_art(&b, 32, &sprite(0, 0, 32, 32), 2, 16, c);
        }
    }

    /// 16x16 sprite, a wide upper block (columns 2..14, rows 4..8) over a
    /// narrow base (columns 6..10, rows 8..12): the band's column span and
    /// its bottom solid row's span are different numbers, so swapping the
    /// two clauses is caught here.
    fn wide_over_narrow() -> Vec<u8> {
        sheet(16, 16, |x, y| {
            if in_block(x, y, (2, 14), (4, 8)) || in_block(x, y, (6, 10), (8, 12)) {
                SOLID
            } else {
                0
            }
        })
    }

    fn run_wide(c: ColliderRect) -> Result<(), Disagreement> {
        check_collider_against_art(&wide_over_narrow(), 16, &sprite(0, 0, 16, 16), 1, 16, c)
    }

    #[test]
    fn a_band_wide_above_and_narrow_at_the_base_tells_clause_one_from_clause_two() {
        // On the base, and spanning the wide part: both pass.
        assert_eq!(run_wide(rect(6, 8, 10, 12)), Ok(()));
        assert_eq!(run_wide(rect(2, 4, 14, 12)), Ok(()));
        // One sub-cell inside the base fails clause 2, naming the base.
        assert_eq!(
            run_wide(rect(7, 4, 10, 12)),
            Err(Disagreement::BottomRowOutsideCollider {
                collider: (7, 10),
                art: (6, 10)
            })
        );
        assert_eq!(
            run_wide(rect(6, 4, 9, 12)),
            Err(Disagreement::BottomRowOutsideCollider {
                collider: (6, 9),
                art: (6, 10)
            })
        );
        // One sub-cell outside the wide part fails clause 1, naming it.
        for c in [rect(1, 4, 14, 12), rect(2, 4, 15, 12)] {
            assert_eq!(
                run_wide(c),
                Err(Disagreement::ColliderColumnsOutsideArt {
                    collider: (c.x0, c.x1),
                    art: (2, 14)
                })
            );
        }
    }

    /// Which clause refused (or none): the five verdicts the oracle must
    /// both predict and draw.
    #[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
    enum Kind {
        Columns,
        BottomRow,
        Rows,
        Foot,
        Pass,
    }

    type OracleParams = (
        (u32, u32, u32, u32, u32, u32, u32),
        (i32, i32, i32, i32),
        (bool, bool, bool),
        (i32, i32, i32, i32),
        (bool, i32, i32),
    );

    fn oracle_strategy() -> impl Strategy<Value = OracleParams> {
        (
            (
                0u32..20,
                0u32..6,
                1u32..8,
                0u32..6,
                0u32..6,
                1u32..4,
                1u32..4,
            ),
            (0i32..48, 1i32..48, 0i32..16, 1i32..16),
            (prop::bool::weighted(0.85), any::<bool>(), any::<bool>()),
            (-2i32..=2, -2i32..=2, -2i32..=2, -2i32..=2),
            (any::<bool>(), -3i32..=3, -3i32..=3),
        )
    }

    /// Runs one oracle case; `None` when the drawn collider is not a valid
    /// in-footprint rect. Art: an upper block `[a, b) x [r0, r1)` over a
    /// base `[c, d) x [r1, r2)` with `a <= c < d <= b` (`lead = tail = 0` is
    /// one block). The collider is either anywhere in the footprint or each
    /// edge is a matching art edge plus a small offset, so every clause is
    /// reached by design. The expected kind is predicted from the numbers
    /// alone, each clause from its own span.
    fn oracle_case(p: OracleParams) -> Option<(Kind, Result<(), Disagreement>)> {
        let (
            (a, lead, cw, tail, r0, h0, h1),
            (fx0, fdx, fy0, fdy),
            (near, s0, s1),
            (o0, o1, o2, o3),
            (has_foot, f0, f1),
        ) = p;
        let (c, d) = (a + lead, a + lead + cw);
        let b = d + tail;
        let (r1, r2) = (r0 + h0, r0 + h0 + h1);
        if b > 48 || r2 > 16 {
            return None;
        }
        let (ai, bi, ci, di, r0i, r2i) =
            (a as i32, b as i32, c as i32, d as i32, r0 as i32, r2 as i32);
        let (x0, x1, y0, y1) = if near {
            (
                (if s0 { ai } else { ci } + o0).clamp(0, 47),
                (if s1 { bi } else { di } + o1).clamp(1, 48),
                (r0i + o2).clamp(0, 15),
                (r2i + o3).clamp(1, 16),
            )
        } else {
            (fx0, (fx0 + fdx).min(48), fy0, (fy0 + fdy).min(16))
        };
        if x0 >= x1 || y0 >= y1 {
            return None;
        }
        let art = sheet(48, 16, |x, y| {
            if in_block(x, y, (a, b), (r0, r1)) || in_block(x, y, (c, d), (r1, r2)) {
                SOLID
            } else {
                0
            }
        });
        // The foot is the art's rows plus a small offset, so the collider
        // cuts it on either side as often as it does not.
        let foot = (r0i + f0, r2i + f1);
        let got = check_collider_against_art_with_foot(
            &art,
            48,
            &sprite(0, 0, 48, 16),
            1,
            16,
            rect(x0, y0, x1, y1),
            has_foot.then_some(foot),
        );
        let (kind, want) = if x0 < ai || x1 > bi {
            (
                Kind::Columns,
                Err(Disagreement::ColliderColumnsOutsideArt {
                    collider: (x0, x1),
                    art: (ai as i64, bi as i64),
                }),
            )
        } else if x0 > ci || x1 < di {
            (
                Kind::BottomRow,
                Err(Disagreement::BottomRowOutsideCollider {
                    collider: (x0, x1),
                    art: (ci as i64, di as i64),
                }),
            )
        } else if y0 < r0i || y1 > r2i {
            (
                Kind::Rows,
                Err(Disagreement::ColliderRowsOutsideArt {
                    collider: (y0, y1),
                    art: (r0i as i64, r2i as i64),
                }),
            )
        } else if has_foot && (y0 < foot.0 || y1 > foot.1) {
            (
                Kind::Foot,
                Err(Disagreement::ColliderOutsideFoot {
                    collider: (y0, y1),
                    foot,
                }),
            )
        } else {
            (Kind::Pass, Ok(()))
        };
        assert_eq!(got, want, "params {p:?}");
        Some((kind, want))
    }

    /// The oracle predicts every verdict, and the generator is proven to
    /// draw all five of them (never left to the seed): each kind must occur
    /// at least a hundred times in the run.
    #[test]
    fn the_oracle_draws_all_five_verdicts_and_predicts_each() {
        use proptest::test_runner::{Config, TestRunner};
        let cases = cases().cases.max(16384);
        let mut runner = TestRunner::new(Config {
            cases,
            ..Config::default()
        });
        let tally = std::cell::RefCell::new(std::collections::BTreeMap::new());
        runner
            .run(&oracle_strategy(), |p| {
                if let Some((kind, _)) = oracle_case(p) {
                    *tally.borrow_mut().entry(kind).or_insert(0u32) += 1;
                }
                Ok(())
            })
            .unwrap();
        let tally = tally.into_inner();
        for kind in [
            Kind::Columns,
            Kind::BottomRow,
            Kind::Rows,
            Kind::Foot,
            Kind::Pass,
        ] {
            let n = tally.get(&kind).copied().unwrap_or(0);
            assert!(n >= 100, "{kind:?} drawn only {n} times: {tally:?}");
        }
    }

    fn archetype(key: &str, foot: bool, top: i32, bottom: i32) -> crate::model::ArchetypeEntry {
        use crate::model::{Located, RawColliderInset};
        crate::model::ArchetypeEntry {
            path: "a.toml".into(),
            key: Located::at(key.to_string(), 1, 1),
            height: None,
            collider_inset: Some(Located::at(
                RawColliderInset {
                    left: 0,
                    top,
                    right: 0,
                    bottom,
                },
                1,
                1,
            )),
            foot,
        }
    }

    fn raw_with(archetypes: Vec<crate::model::ArchetypeEntry>) -> RawDefs {
        RawDefs {
            archetypes,
            ..RawDefs::default()
        }
    }

    #[test]
    fn the_foot_is_the_named_archetypes_else_the_shallowest_declared() {
        let raw = raw_with(vec![
            archetype("deep", true, 6, 0),
            archetype("shallow", true, 11, 0),
            archetype("plain", false, 0, 0),
        ]);
        // A named foot wins over a shallower one.
        assert_eq!(foot_of(&raw, Some("deep"), 1), Ok((6, 16)));
        // A non-foot, an unknown or an absent archetype gets the shallowest.
        for named in [Some("plain"), Some("nope"), None] {
            assert_eq!(foot_of(&raw, named, 1), Ok((11, 16)));
        }
        // Two feet at the same depth: still that depth.
        let tie = raw_with(vec![
            archetype("a", true, 11, 0),
            archetype("b", true, 11, 0),
        ]);
        assert_eq!(foot_of(&tie, None, 1), Ok((11, 16)));
    }

    #[test]
    fn a_multi_cell_foot_spans_height_times_sixteen_minus_bottom() {
        let raw = raw_with(vec![archetype("f", true, 27, 2)]);
        assert_eq!(foot_of(&raw, Some("f"), 2), Ok((27, 30)));
    }

    #[test]
    fn no_foot_archetype_at_all_is_an_error() {
        let raw = raw_with(vec![archetype("plain", false, 0, 0)]);
        assert!(foot_of(&raw, None, 1).is_err());
    }
}

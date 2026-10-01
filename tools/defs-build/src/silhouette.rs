//! The build's pixel refusal: a `collider` must agree with the art it
//! sits under. Pixels may refuse a build, never shape an artefact -- the
//! check returns `Result<(), _>` and nothing else, so no measured value
//! can reach `Defs`, `emit` or the contact sheet.
//!
//! The band is the bottom `height * tile_size_px` rows of the object's
//! own sprite rect. Opaque is [`crate::alpha::is_opaque`]. Three clauses,
//! in this order, each compared in sub-cells with integer cross
//! multiplication (pixel edge `p * SUBCELLS` against collider edge
//! `x * tile_size_px`), never rounding:
//!
//! 1. the collider's columns lie inside the band's solid column span;
//! 2. the band's lowest solid row's columns lie inside the collider's;
//! 3. the collider's rows lie inside the band's solid row span.

use std::collections::BTreeMap;

use crate::alpha::{PxRect, bottom_opaque_row, opaque_column_span, opaque_row_span};
use crate::error::DefsError;
use crate::model::{COLLIDER_SUBCELLS_PER_CELL, ColliderRect, Defs, RawDefs, SpriteRect};

/// A decoded sheet: `(width, height, rgba8)`.
pub type DecodedSheet = (u32, u32, Vec<u8>);

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
    Ok(())
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
            continue;
        };
        let (w, _h, rgba) = sheets
            .get(&obj.sprite.sheet)
            .expect("every object sheet was decoded before the silhouette check");
        let Err(problem) =
            check_collider_against_art(rgba, *w, &obj.sprite, obj.height, tile_size_px, collider)
        else {
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

        /// Oracle: one solid block `[a, b) x [r0, r1)` in a 3x1 footprint.
        /// The expected verdict is computed here from the block's own
        /// numbers, never from the implementation.
        #[test]
        fn the_verdict_matches_an_independent_oracle(
            a in 0u32..40, w in 1u32..8, r0 in 0u32..12, h in 1u32..4,
            x0 in 0i32..48, dx in 1i32..48, y0 in 0i32..16, dy in 1i32..16,
        ) {
            let (b, r1) = ((a + w).min(48), (r0 + h).min(16));
            prop_assume!(a < b && r0 < r1);
            let (x1, y1) = ((x0 + dx).min(48), (y0 + dy).min(16));
            prop_assume!(x0 < x1 && y0 < y1);
            let art = sheet(48, 16, |x, y| if in_block(x, y, (a, b), (r0, r1)) { SOLID } else { 0 });
            let got = check_collider_against_art(&art, 48, &sprite(0, 0, 48, 16), 1, 16, rect(x0, y0, x1, y1));
            let (a, b, r0, r1) = (a as i32, b as i32, r0 as i32, r1 as i32);
            let want = if x0 < a || x1 > b {
                Err(Disagreement::ColliderColumnsOutsideArt { collider: (x0, x1), art: (a as i64, b as i64) })
            } else if x0 > a || x1 < b {
                Err(Disagreement::BottomRowOutsideCollider { collider: (x0, x1), art: (a as i64, b as i64) })
            } else if y0 < r0 || y1 > r1 {
                Err(Disagreement::ColliderRowsOutsideArt { collider: (y0, y1), art: (r0 as i64, r1 as i64) })
            } else {
                Ok(())
            };
            prop_assert_eq!(got, want);
        }

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
}

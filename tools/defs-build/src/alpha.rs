//! The one place this crate decides what "opaque" means: the threshold,
//! the per-pixel test and the opaque spans of a rectangle. Pure over an
//! in-memory RGBA8 buffer. Shared by `propose` (a guess) and `silhouette`
//! (the build's refusal), so the two can never read pixels differently.

/// A pixel is solid when its alpha is at or above this. LimeZu draws drop
/// shadows into a sprite at alpha 100 (161 where two stack, 56 and 27 for
/// softer ones); every body pixel is 255. A player walks over a shadow, so
/// a shadow is not the object.
pub const ALPHA_OPAQUE_THRESHOLD: u8 = 200;

/// Whether the pixel at `(x, y)` of a `width_px`-wide RGBA8 buffer is solid.
pub fn is_opaque(rgba: &[u8], width_px: u32, x: u32, y: u32) -> bool {
    let i = (y as usize * width_px as usize + x as usize) * 4 + 3;
    rgba[i] >= ALPHA_OPAQUE_THRESHOLD
}

/// An axis-aligned pixel rectangle inside a `sheet_w`-wide RGBA8 buffer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PxRect {
    pub sheet_w: u32,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Half-open `(min, max + 1)` range, relative to the rect's own origin.
pub type Span = (u32, u32);

/// The solid column span over every row of `r`, `None` when no pixel is
/// solid.
pub fn opaque_column_span(rgba: &[u8], r: PxRect) -> Option<Span> {
    span_of(rgba, r, |x, _| x)
}

/// The solid row span over every column of `r`, `None` when no pixel is
/// solid.
pub fn opaque_row_span(rgba: &[u8], r: PxRect) -> Option<Span> {
    span_of(rgba, r, |_, y| y)
}

/// The solid column span of `r`'s lowest row holding any solid pixel,
/// with that row's index (relative to `r`'s top).
pub fn bottom_opaque_row(rgba: &[u8], r: PxRect) -> Option<(u32, Span)> {
    (0..r.h).rev().find_map(|row| {
        let line = PxRect {
            y: r.y + row,
            h: 1,
            ..r
        };
        opaque_column_span(rgba, line).map(|s| (row, s))
    })
}

fn span_of(rgba: &[u8], r: PxRect, axis: impl Fn(u32, u32) -> u32) -> Option<Span> {
    let mut span: Option<Span> = None;
    for dy in 0..r.h {
        for dx in 0..r.w {
            if is_opaque(rgba, r.sheet_w, r.x + dx, r.y + dy) {
                let v = axis(dx, dy);
                span = Some(span.map_or((v, v + 1), |(lo, hi)| (lo.min(v), hi.max(v + 1))));
            }
        }
    }
    span
}

#[cfg(test)]
mod tests {
    use super::*;

    fn buf(w: u32, h: u32, alpha: impl Fn(u32, u32) -> u8) -> Vec<u8> {
        let mut v = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                v[((y * w + x) * 4 + 3) as usize] = alpha(x, y);
            }
        }
        v
    }

    #[test]
    fn the_threshold_is_the_exact_boundary() {
        let t = ALPHA_OPAQUE_THRESHOLD;
        let b = buf(2, 1, |x, _| if x == 0 { t - 1 } else { t });
        assert!(!is_opaque(&b, 2, 0, 0));
        assert!(is_opaque(&b, 2, 1, 0));
    }

    #[test]
    fn shadow_alphas_are_not_solid_and_bodies_are() {
        for a in [27u8, 56, 100, 161] {
            let b = buf(1, 1, |_, _| a);
            assert!(!is_opaque(&b, 1, 0, 0), "alpha {a}");
        }
        assert!(is_opaque(&buf(1, 1, |_, _| 255), 1, 0, 0));
    }

    #[test]
    fn spans_are_relative_to_the_rect_origin_not_the_sheet() {
        // Solid block at sheet columns 5..9, rows 6..8; rect starts at (4, 5).
        let b = buf(16, 16, |x, y| {
            if (5..9).contains(&x) && (6..8).contains(&y) {
                255
            } else {
                0
            }
        });
        let r = PxRect {
            sheet_w: 16,
            x: 4,
            y: 5,
            w: 8,
            h: 4,
        };
        assert_eq!(opaque_column_span(&b, r), Some((1, 5)));
        assert_eq!(opaque_row_span(&b, r), Some((1, 3)));
        assert_eq!(bottom_opaque_row(&b, r), Some((2, (1, 5))));
    }

    #[test]
    fn a_fully_transparent_rect_has_no_spans() {
        let b = buf(4, 4, |_, _| 0);
        let r = PxRect {
            sheet_w: 4,
            x: 0,
            y: 0,
            w: 4,
            h: 4,
        };
        assert_eq!(opaque_column_span(&b, r), None);
        assert_eq!(opaque_row_span(&b, r), None);
        assert_eq!(bottom_opaque_row(&b, r), None);
    }
}

//! Story 15.14: an object's sprite rect must not slice through its own art.
//! A *cut edge* is an edge of a sprite rect, interior to the sheet, where an
//! opaque pixel inside the rect touches an opaque pixel just outside it. It
//! is allowed only when every such outside pixel lies inside another
//! object's rect on the same sheet (a sibling piece). Pure over a decoded
//! RGBA8 sheet; "opaque" is [`crate::alpha::is_opaque`], never a second
//! threshold.

use defs_build::alpha::is_opaque;

/// A rect on a sheet, in sheet pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Edge {
    North,
    South,
    West,
    East,
}

/// One cut edge of `rect` (index into the input list), with the half-open
/// span along the edge (sheet coordinates) where art continues outside, and
/// whether every such pixel is inside a sibling rect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CutEdge {
    pub rect: usize,
    pub edge: Edge,
    /// Half-open `(min, max + 1)` of the cut pixels along the edge, sheet
    /// coordinates (columns for N/S, rows for W/E).
    pub span: (u32, u32),
    /// Number of cut pixels along the edge.
    pub count: u32,
    /// Every cut pixel's outside neighbour lies in another rect.
    pub continued: bool,
    /// The art outside is a pixel-exact periodic repeat of the lines just
    /// inside (a tread dither made to run under a neighbour): nothing a
    /// player can see is lost by stopping there.
    pub repeats: bool,
}

impl CutEdge {
    /// Whether the cut loses no art.
    pub fn allowed(&self) -> bool {
        self.continued || self.repeats
    }
}

fn inside(r: Rect, x: u32, y: u32) -> bool {
    x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
}

/// Every cut edge of every rect in `rects` over the `sheet_w` x `sheet_h`
/// RGBA8 buffer, in rect then edge order.
pub fn cut_edges(rgba: &[u8], sheet_w: u32, sheet_h: u32, rects: &[Rect]) -> Vec<CutEdge> {
    let mut out = Vec::new();
    for (i, &r) in rects.iter().enumerate() {
        let others = |x: u32, y: u32| {
            rects
                .iter()
                .enumerate()
                .any(|(j, &o)| j != i && inside(o, x, y))
        };
        // (edge, interior to the sheet, positions along the edge, pixel
        // inside the rect, pixel just outside)
        let cols = r.x..r.x + r.w;
        let rows = r.y..r.y + r.h;
        let mut scan = |edge: Edge,
                        interior: bool,
                        along: Vec<u32>,
                        f: &dyn Fn(u32) -> ((u32, u32), (u32, u32))| {
            if !interior {
                return;
            }
            let mut min = u32::MAX;
            let mut max = 0;
            let mut count = 0;
            let mut continued = true;
            for a in along {
                let ((ix, iy), (ox, oy)) = f(a);
                if is_opaque(rgba, sheet_w, ix, iy) && is_opaque(rgba, sheet_w, ox, oy) {
                    min = min.min(a);
                    max = max.max(a);
                    count += 1;
                    continued &= others(ox, oy);
                }
            }
            if count > 0 {
                let repeats = repeats_inward(rgba, sheet_w, sheet_h, r, edge);
                out.push(CutEdge {
                    rect: i,
                    edge,
                    span: (min, max + 1),
                    count,
                    continued,
                    repeats,
                });
            }
        };
        scan(Edge::North, r.y > 0, cols.clone().collect(), &|x| {
            ((x, r.y), (x, r.y.wrapping_sub(1)))
        });
        scan(Edge::South, r.y + r.h < sheet_h, cols.collect(), &|x| {
            ((x, r.y + r.h - 1), (x, r.y + r.h))
        });
        scan(Edge::West, r.x > 0, rows.clone().collect(), &|y| {
            ((r.x, y), (r.x.wrapping_sub(1), y))
        });
        scan(Edge::East, r.x + r.w < sheet_w, rows.collect(), &|y| {
            ((r.x + r.w - 1, y), (r.x + r.w, y))
        });
    }
    out
}

/// The sheet pixel `depth` lines in from `edge` of `r` (negative: outside)
/// at position `a` along it; `None` off the sheet.
fn pixel_at(r: Rect, edge: Edge, a: u32, depth: i64, sw: u32, sh: u32) -> Option<(u32, u32)> {
    let (x, y) = match edge {
        Edge::North => (a as i64, r.y as i64 + depth),
        Edge::South => (a as i64, (r.y + r.h) as i64 - 1 - depth),
        Edge::West => (r.x as i64 + depth, a as i64),
        Edge::East => ((r.x + r.w) as i64 - 1 - depth, a as i64),
    };
    (x >= 0 && y >= 0 && x < sw as i64 && y < sh as i64).then_some((x as u32, y as u32))
}

fn line_eq(rgba: &[u8], sw: u32, sh: u32, r: Rect, edge: Edge, d1: i64, d2: i64) -> bool {
    let along = match edge {
        Edge::North | Edge::South => r.x..r.x + r.w,
        Edge::West | Edge::East => r.y..r.y + r.h,
    };
    along.into_iter().all(|a| {
        match (
            pixel_at(r, edge, a, d1, sw, sh),
            pixel_at(r, edge, a, d2, sw, sh),
        ) {
            (Some((x1, y1)), Some((x2, y2))) => {
                let i = (y1 as usize * sw as usize + x1 as usize) * 4;
                let j = (y2 as usize * sw as usize + x2 as usize) * 4;
                rgba[i..i + 4] == rgba[j..j + 4]
            }
            _ => false,
        }
    })
}

fn line_has_art(rgba: &[u8], sw: u32, sh: u32, r: Rect, edge: Edge, depth: i64) -> bool {
    let along = match edge {
        Edge::North | Edge::South => r.x..r.x + r.w,
        Edge::West | Edge::East => r.y..r.y + r.h,
    };
    along.into_iter().any(|a| {
        pixel_at(r, edge, a, depth, sw, sh).is_some_and(|(x, y)| is_opaque(rgba, sw, x, y))
    })
}

/// Every outside line, up to the first line with no art, equals the line
/// `p` lines before it (outside lines included) for one period `p`.
fn repeats_inward(rgba: &[u8], sw: u32, sh: u32, r: Rect, edge: Edge) -> bool {
    let len = match edge {
        Edge::North | Edge::South => r.h,
        Edge::West | Edge::East => r.w,
    } as i64;
    let mut outside = 0i64;
    while line_has_art(rgba, sw, sh, r, edge, -(outside + 1)) {
        outside += 1;
    }
    (1..=len.min(8)).any(|p| {
        (0..outside).all(|t| {
            let d = -(t + 1);
            line_eq(rgba, sw, sh, r, edge, d, d + p)
        })
    })
}

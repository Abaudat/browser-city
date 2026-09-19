//! Pass 2 (FR110): the street network. Receives the land-use split and the
//! parameter field (by reference; this module never mutates
//! [`super::LandUseMap`] and never imports back into `land_use.rs`); hands
//! down the street graph blocks are subdivided from. Reads density.
//!
//! Axis-aligned by construction (NFR8/AC3): [`StreetEdge`] is `{axis,
//! coord, from, to, class}` -- a diagonal is unrepresentable in the type.
//! Algorithm: a handful of jittered, full-span arterials first (laid on
//! the whole site, always reaching the site boundary), then recursive
//! axis-aligned subdivision of each resulting superblock, jittered split
//! position, target block size read from the local density field. Every
//! new split spans its own parent rect's own extent exactly, so every
//! street starts and ends on an existing street or the site boundary --
//! nothing is ever disconnected, and there is no dead end to terminate,
//! by construction. A finished block whose long side is still over `cfg.
//! max_block_depth_cells` gets one further lane-tier split.

use std::collections::{BTreeSet, BinaryHeap};

use super::land_use::{LandUseMap, Region};
use super::{GenerationConfig, SiteBounds};
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

pub const PASS_ID: u64 = super::PASS_STREETS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Axis {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum StreetClass {
    Arterial,
    Street,
    Lane,
}

/// One axis-aligned street segment: `coord` is the fixed axis (x for
/// [`Axis::Vertical`], y for [`Axis::Horizontal`]), `from`/`to` the range
/// along the perpendicular axis -- a diagonal cannot be constructed
/// (AC3). `width_cells` is baked in from `class` at generation time
/// (`GenerationConfig`'s own per-class width key), so a consumer never
/// needs the config again to know a segment's own footprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct StreetEdge {
    pub axis: Axis,
    pub coord: i32,
    pub from: i32,
    pub to: i32,
    pub class: StreetClass,
    pub width_cells: i32,
}

impl StreetEdge {
    pub fn start(&self) -> (i32, i32) {
        match self.axis {
            Axis::Vertical => (self.coord, self.from),
            Axis::Horizontal => (self.from, self.coord),
        }
    }

    pub fn end(&self) -> (i32, i32) {
        match self.axis {
            Axis::Vertical => (self.coord, self.to),
            Axis::Horizontal => (self.to, self.coord),
        }
    }

    pub fn length(&self) -> i64 {
        (self.to - self.from) as i64
    }

    /// The world-cell rect this segment's own carriageway+pavement
    /// footprint occupies.
    pub fn rect(&self) -> Rect {
        let half = self.width_cells / 2;
        match self.axis {
            Axis::Vertical => Rect {
                x0: self.coord - half,
                y0: self.from,
                x1: self.coord + half,
                y1: self.to,
            },
            Axis::Horizontal => Rect {
                x0: self.from,
                y0: self.coord - half,
                x1: self.to,
                y1: self.coord + half,
            },
        }
    }
}

/// One finished block: a leaf rect from the recursive subdivision, already
/// inset from every surrounding street's own half-width -- never
/// overlapping a [`StreetEdge::rect`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Block {
    pub bounds: Rect,
}

/// Pass 2's own output: sorted nodes (intersections), sorted edges and the
/// sorted block rects left between them (Tim's direction). No tiles, no
/// `ObjectDef` placements here.
#[derive(Debug, Clone)]
pub struct StreetNetwork {
    site: SiteBounds,
    nodes: Vec<(i32, i32)>,
    edges: Vec<StreetEdge>,
    blocks: Vec<Block>,
}

impl StreetNetwork {
    pub fn site(&self) -> SiteBounds {
        self.site
    }

    pub fn nodes(&self) -> &[(i32, i32)] {
        &self.nodes
    }

    pub fn edges(&self) -> &[StreetEdge] {
        &self.edges
    }

    pub fn blocks(&self) -> &[Block] {
        &self.blocks
    }

    pub fn is_on_boundary(&self, node: (i32, i32)) -> bool {
        node.0 == self.site.x0
            || node.0 == self.site.x1
            || node.1 == self.site.y0
            || node.1 == self.site.y1
    }

    /// The number of edges incident to `node` -- a node named by no edge
    /// at all has degree 0 (never constructed by [`run`], since a node is
    /// only ever created as an edge endpoint, but total for any caller).
    pub fn degree(&self, node: (i32, i32)) -> usize {
        self.edges
            .iter()
            .filter(|e| e.start() == node || e.end() == node)
            .count()
    }

    /// AC2 "connected": every node reachable from `self.nodes[0]` via
    /// edges. `None` if the network has no nodes at all.
    pub fn reachable_from_first_node(&self) -> Option<BTreeSet<(i32, i32)>> {
        let start = *self.nodes.first()?;
        Some(self.reachable_from(start))
    }

    fn reachable_from(&self, start: (i32, i32)) -> BTreeSet<(i32, i32)> {
        let mut seen: BTreeSet<(i32, i32)> = BTreeSet::new();
        let mut stack = vec![start];
        seen.insert(start);
        while let Some(n) = stack.pop() {
            for e in &self.edges {
                let (a, b) = (e.start(), e.end());
                let other = if a == n {
                    Some(b)
                } else if b == n {
                    Some(a)
                } else {
                    None
                };
                if let Some(o) = other
                    && seen.insert(o)
                {
                    stack.push(o);
                }
            }
        }
        seen
    }

    /// AC2 "not a maze": every node with degree 1 that is *not* on the
    /// site boundary (a boundary node's own single edge is simply the
    /// edge of the drawn world, never a real dead end -- Tim's direction).
    pub fn dead_end_nodes(&self) -> Vec<(i32, i32)> {
        self.nodes
            .iter()
            .copied()
            .filter(|&n| self.degree(n) == 1 && !self.is_on_boundary(n))
            .collect()
    }

    /// AC2 "not a perfect grid": the count of degree-3 and degree-4
    /// junctions respectively (nodes of any other degree, including
    /// boundary ones, counted in neither bucket).
    pub fn junction_mix(&self) -> (usize, usize) {
        let mut three = 0usize;
        let mut four = 0usize;
        for &n in &self.nodes {
            match self.degree(n) {
                3 => three += 1,
                4 => four += 1,
                _ => {}
            }
        }
        (three, four)
    }

    /// AC2 "every region from pass 1 contains or borders a street cell":
    /// every region whose world-cell footprint, expanded by `max_gap_
    /// cells` on every side, still touches no [`StreetEdge::rect`] at
    /// all. `max_gap_cells` is a caller-supplied search radius, never a
    /// literal here -- a caller always passes `cfg.block_size_max_cells`
    /// (the largest gap a single, never-subdivided block can put between
    /// a land-use leaf sitting entirely inside it and that block's own
    /// street-bordered edge; a leaf can be smaller than the block it
    /// falls inside, since the two passes partition the site
    /// independently), so the search radius is itself derived from
    /// `GenerationConfig`, not invented in this function.
    pub fn stranded_regions(&self, land_use: &LandUseMap, max_gap_cells: i32) -> Vec<Region> {
        let cell_size = land_use.cell_size();
        let site = land_use.site();
        let margin = max_gap_cells.max(0);
        land_use
            .regions()
            .into_iter()
            .filter(|r| {
                let world = Rect {
                    x0: site.x0 + r.bounds.x0 * cell_size - margin,
                    y0: site.y0 + r.bounds.y0 * cell_size - margin,
                    x1: site.x0 + r.bounds.x1 * cell_size + margin,
                    y1: site.y0 + r.bounds.y1 * cell_size + margin,
                };
                !self.edges.iter().any(|e| rects_touch(world, e.rect()))
            })
            .collect()
    }

    /// AC3: over a deterministic, bounded sample of node pairs (up to
    /// `max_nodes` evenly spaced through the sorted node list), the BFS
    /// network distance and the Manhattan distance between them -- the
    /// contract 3.11's pathfinding estimator relies on. Never a random
    /// sample: the same network always yields the same pairs.
    ///
    /// Two kinds of pair the estimator is not making a claim about are
    /// excluded: pairs closer than `min_manhattan` (world cells) -- a
    /// single jitter-driven jog dominates the ratio at short range even
    /// in a real city (`generation.streets.detour_min_manhattan_cells`)
    /// -- and pairs where *both* nodes sit on the site boundary. A
    /// boundary node is one of an arterial or street's own exit stub
    /// (Tim's direction: "arterials run to the site edge... they are the
    /// roads out of town"), not a through-route -- nothing runs *along*
    /// the boundary connecting one stub to the next, so travelling
    /// between two of them always means routing inward and back out. The
    /// estimator's own contract is about getting across the city, not
    /// about hugging its outer edge between two unrelated exits.
    pub fn detour_samples(&self, max_nodes: usize, min_manhattan: i64) -> Vec<DetourSample> {
        if self.nodes.is_empty() {
            return Vec::new();
        }
        let step = (self.nodes.len() / max_nodes.max(1)).max(1);
        let sample: Vec<(i32, i32)> = self.nodes.iter().copied().step_by(step).collect();
        let mut out = Vec::new();
        for (i, &a) in sample.iter().enumerate() {
            let dist = self.dijkstra_from(a);
            for &b in sample.iter().skip(i + 1) {
                if self.is_on_boundary(a) && self.is_on_boundary(b) {
                    continue;
                }
                let manhattan = ((a.0 - b.0).abs() + (a.1 - b.1).abs()) as i64;
                if manhattan < min_manhattan {
                    continue;
                }
                if let Some(&network) = dist.get(&b) {
                    out.push(DetourSample {
                        a,
                        b,
                        network,
                        manhattan,
                    });
                }
            }
        }
        out
    }

    fn dijkstra_from(&self, start: (i32, i32)) -> std::collections::BTreeMap<(i32, i32), i64> {
        let mut dist: std::collections::BTreeMap<(i32, i32), i64> =
            std::collections::BTreeMap::new();
        let mut heap: BinaryHeap<std::cmp::Reverse<(i64, (i32, i32))>> = BinaryHeap::new();
        dist.insert(start, 0);
        heap.push(std::cmp::Reverse((0, start)));
        while let Some(std::cmp::Reverse((d, n))) = heap.pop() {
            if dist.get(&n).is_some_and(|&best| d > best) {
                continue;
            }
            for e in &self.edges {
                let (a, b) = (e.start(), e.end());
                let other = if a == n {
                    Some(b)
                } else if b == n {
                    Some(a)
                } else {
                    None
                };
                let Some(o) = other else { continue };
                let nd = d + e.length();
                if dist.get(&o).is_none_or(|&best| nd < best) {
                    dist.insert(o, nd);
                    heap.push(std::cmp::Reverse((nd, o)));
                }
            }
        }
        dist
    }
}

/// One [`StreetNetwork::detour_samples`] entry.
#[derive(Debug, Clone, Copy)]
pub struct DetourSample {
    pub a: (i32, i32),
    pub b: (i32, i32),
    pub network: i64,
    pub manhattan: i64,
}

fn rects_touch(a: Rect, b: Rect) -> bool {
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
}

fn class_width(class: StreetClass, cfg: &GenerationConfig) -> i32 {
    match class {
        StreetClass::Arterial => cfg.arterial_width_cells,
        StreetClass::Street => cfg.street_width_cells,
        StreetClass::Lane => cfg.lane_width_cells,
    }
}

/// Jittered, monotonically increasing positions for `count` full-span
/// arterials across `[site_from, site_to)`, each starting from its own
/// even band (`span / (count + 1)`) so ordering never needs sorting, then
/// clamped to keep `min_block_depth_cells` margin from the site edge and
/// from its neighbours.
fn band_positions(
    rng: &mut Rng,
    site_from: i32,
    site_to: i32,
    count: u32,
    jitter_pct: i32,
    width: i32,
    min_block_depth: i32,
) -> Vec<i32> {
    if count == 0 {
        return Vec::new();
    }
    let span = site_to - site_from;
    let band = span / (count as i32 + 1);
    let half = width / 2;
    let edge_margin = half + min_block_depth;
    let mut result = Vec::with_capacity(count as usize);
    for i in 1..=count as i32 {
        let nominal = site_from + band * i;
        let jitter_span = (band * jitter_pct / 100).max(0);
        let jitter = if jitter_span > 0 {
            (rng.next_u64() % (2 * jitter_span as u64 + 1)) as i32 - jitter_span
        } else {
            0
        };
        let lo = site_from + edge_margin;
        let hi = site_to - edge_margin;
        let pos = (nominal + jitter).clamp(lo.min(hi), hi.max(lo));
        result.push(pos);
    }
    let min_gap = width + min_block_depth;
    for i in 1..result.len() {
        if result[i] < result[i - 1] + min_gap {
            result[i] = result[i - 1] + min_gap;
        }
    }
    result
}

/// The `count + 1` *physical* ranges `band_positions` leaves along one
/// axis between consecutive arterials (and the site's own two edges) --
/// each already inset by the arterial's own half-width, the real,
/// buildable extent a superblock's own leaf blocks live inside.
fn band_ranges(positions: &[i32], site_from: i32, site_to: i32, width: i32) -> Vec<(i32, i32)> {
    let half = width / 2;
    let mut ranges = Vec::with_capacity(positions.len() + 1);
    let mut cursor = site_from;
    for &p in positions {
        ranges.push((cursor, p - half));
        cursor = p + half;
    }
    ranges.push((cursor, site_to));
    ranges
}

/// [`band_ranges`]'s own *topological* counterpart: the same `count + 1`
/// ranges, but split exactly at each arterial's own centreline, with no
/// width subtracted. An internal street's own perpendicular span is
/// always measured against this rect, never the physical (inset) one --
/// so it always reaches the enclosing arterial's true centreline
/// coordinate, which is where [`build_graph`] finds it (the arterial
/// segment's own `coord`), rather than stopping short at the edge of its
/// carriageway. Without this, every superblock's internal streets would
/// be graph-disconnected from the arterial network entirely (this is the
/// bug this type exists to prevent, found by `the_street_graph_is_fully_
/// connected` failing red first).
fn band_ranges_topo(positions: &[i32], site_from: i32, site_to: i32) -> Vec<(i32, i32)> {
    let mut ranges = Vec::with_capacity(positions.len() + 1);
    let mut cursor = site_from;
    for &p in positions {
        ranges.push((cursor, p));
        cursor = p;
    }
    ranges.push((cursor, site_to));
    ranges
}

/// Interpolates the target block side length between `block_size_max_
/// cells` (at `density_min`) and `block_size_min_cells` (at `density_
/// max`) -- integer only, no float.
fn target_block_size(density: i32, cfg: &GenerationConfig) -> i32 {
    let span_density = (cfg.density_max - cfg.density_min).max(1);
    let span_block = cfg.block_size_max_cells - cfg.block_size_min_cells;
    let clamped = density.clamp(cfg.density_min, cfg.density_max);
    let d = clamped - cfg.density_min;
    cfg.block_size_max_cells - (span_block * d) / span_density
}

/// Attempts to split `phys` (the real, buildable rect, already inset from
/// every ancestor street) along `axis` with a `class`-tier street: `None`
/// if `phys` is too small on the split axis to leave `cfg.
/// min_block_depth_cells` margin on both sides once the street's own
/// half-width is subtracted -- the caller then keeps `phys` as a leaf
/// block instead.
///
/// `topo` is `phys`'s own *uninset* counterpart -- the pure centreline
/// partition, carried alongside so a new segment's perpendicular span
/// always reaches the true enclosing centreline (an ancestor street's own
/// `coord`, or the site boundary), never the inset edge of an ancestor's
/// carriageway. Split at the exact same position as `phys`, with no width
/// subtracted on either child -- see [`band_ranges_topo`]'s own doc
/// comment for why this exists.
fn try_split(
    phys: Rect,
    topo: Rect,
    axis: Axis,
    class: StreetClass,
    cfg: &GenerationConfig,
    rng: &mut Rng,
) -> Option<(Rect, Rect, Rect, Rect, StreetEdge)> {
    let width = class_width(class, cfg);
    let half = width / 2;
    let margin = cfg.min_block_depth_cells + half;

    let (from, to) = match axis {
        Axis::Vertical => (phys.x0, phys.x1),
        Axis::Horizontal => (phys.y0, phys.y1),
    };
    let (perp_from, perp_to) = match axis {
        Axis::Vertical => (topo.y0, topo.y1),
        Axis::Horizontal => (topo.x0, topo.x1),
    };
    let len = to - from;
    if (len as i64) < 2 * margin as i64 {
        return None;
    }
    let mid = from + len / 2;
    let jitter_span = (len as i64 * cfg.split_jitter_pct as i64 / 100) as i32;
    let jitter = if jitter_span > 0 {
        (rng.next_u64() % (2 * jitter_span as u64 + 1)) as i32 - jitter_span
    } else {
        0
    };
    let lo = from + margin;
    let hi = to - margin;
    if lo > hi {
        return None;
    }
    let pos = (mid + jitter).clamp(lo, hi);

    let (phys1, phys2) = match axis {
        Axis::Vertical => (
            Rect {
                x0: phys.x0,
                y0: phys.y0,
                x1: pos - half,
                y1: phys.y1,
            },
            Rect {
                x0: pos + half,
                y0: phys.y0,
                x1: phys.x1,
                y1: phys.y1,
            },
        ),
        Axis::Horizontal => (
            Rect {
                x0: phys.x0,
                y0: phys.y0,
                x1: phys.x1,
                y1: pos - half,
            },
            Rect {
                x0: phys.x0,
                y0: pos + half,
                x1: phys.x1,
                y1: phys.y1,
            },
        ),
    };
    if !phys1.is_valid() || !phys2.is_valid() {
        return None;
    }
    // `pos` was chosen within `phys`'s own margins, and `phys` is always
    // contained in `topo` on the split axis (every ancestor inset only
    // ever shrinks phys relative to topo), so `pos` always lies strictly
    // inside `topo`'s own range too -- both topo children are valid by
    // construction, no check needed.
    let (topo1, topo2) = match axis {
        Axis::Vertical => (
            Rect {
                x0: topo.x0,
                y0: topo.y0,
                x1: pos,
                y1: topo.y1,
            },
            Rect {
                x0: pos,
                y0: topo.y0,
                x1: topo.x1,
                y1: topo.y1,
            },
        ),
        Axis::Horizontal => (
            Rect {
                x0: topo.x0,
                y0: topo.y0,
                x1: topo.x1,
                y1: pos,
            },
            Rect {
                x0: topo.x0,
                y0: pos,
                x1: topo.x1,
                y1: topo.y1,
            },
        ),
    };
    let edge = StreetEdge {
        axis,
        coord: pos,
        from: perp_from,
        to: perp_to,
        class,
        width_cells: width,
    };
    Some((phys1, phys2, topo1, topo2, edge))
}

/// Whether `phys` must still be split, and at which tier: `Street` while
/// either axis exceeds the local, density-derived target size; `Lane`
/// once the target is already satisfied but either axis still exceeds
/// `cfg.max_block_depth_cells` ("lanes only split over-deep blocks",
/// Artie's direction) -- a *harder*, block-usability ceiling independent
/// of the density target, so a block can be density-appropriate and
/// still be too deep for a real plot to use. `None` once neither
/// condition holds.
fn split_tier_needed(phys: Rect, target: i64, cfg: &GenerationConfig) -> Option<StreetClass> {
    if phys.width() > target || phys.height() > target {
        return Some(StreetClass::Street);
    }
    if phys.width() > cfg.max_block_depth_cells as i64
        || phys.height() > cfg.max_block_depth_cells as i64
    {
        return Some(StreetClass::Lane);
    }
    None
}

#[allow(clippy::too_many_arguments)]
fn subdivide(
    phys: Rect,
    topo: Rect,
    land_use: &LandUseMap,
    cfg: &GenerationConfig,
    rng: &mut Rng,
    depth: u32,
    lane_depth: u32,
    segments: &mut Vec<StreetEdge>,
    blocks: &mut Vec<Block>,
) {
    let cx = (phys.x0 + phys.x1) / 2;
    let cy = (phys.y0 + phys.y1) / 2;
    let site = land_use.site();
    let sample_x = cx.clamp(site.x0, site.x1 - 1);
    let sample_y = cy.clamp(site.y0, site.y1 - 1);
    let density = land_use
        .at_world(sample_x, sample_y)
        .map(|c| c.density)
        .unwrap_or(cfg.density_min);
    let target = target_block_size(density, cfg) as i64;

    if depth >= cfg.max_recursion_depth {
        blocks.push(Block { bounds: phys });
        return;
    }
    let Some(class) = split_tier_needed(phys, target, cfg) else {
        blocks.push(Block { bounds: phys });
        return;
    };
    if class == StreetClass::Lane && lane_depth >= cfg.max_lane_splits {
        blocks.push(Block { bounds: phys });
        return;
    }

    let axis = if phys.width() >= phys.height() {
        Axis::Vertical
    } else {
        Axis::Horizontal
    };
    let next_lane_depth = if class == StreetClass::Lane {
        lane_depth + 1
    } else {
        lane_depth
    };
    if let Some((p1, p2, t1, t2, edge)) = try_split(phys, topo, axis, class, cfg, rng) {
        segments.push(edge);
        subdivide(
            p1,
            t1,
            land_use,
            cfg,
            rng,
            depth + 1,
            next_lane_depth,
            segments,
            blocks,
        );
        subdivide(
            p2,
            t2,
            land_use,
            cfg,
            rng,
            depth + 1,
            next_lane_depth,
            segments,
            blocks,
        );
    } else {
        blocks.push(Block { bounds: phys });
    }
}

/// Turns a flat list of (possibly parent-spanning) segments into a proper
/// planar graph: every point where a perpendicular segment crosses, or
/// another same-axis segment abuts, becomes a node, splitting the segment
/// into consecutive edges there. Generic over however the segments were
/// produced -- correct for any axis-aligned arrangement, not just a
/// guillotine partition.
fn build_graph(segments: &[StreetEdge]) -> (Vec<(i32, i32)>, Vec<StreetEdge>) {
    let verticals: Vec<&StreetEdge> = segments
        .iter()
        .filter(|s| s.axis == Axis::Vertical)
        .collect();
    let horizontals: Vec<&StreetEdge> = segments
        .iter()
        .filter(|s| s.axis == Axis::Horizontal)
        .collect();

    let mut edges: Vec<StreetEdge> = Vec::new();
    let mut node_set: BTreeSet<(i32, i32)> = BTreeSet::new();

    for (vi, v) in verticals.iter().enumerate() {
        let mut breakpoints: BTreeSet<i32> = BTreeSet::new();
        breakpoints.insert(v.from);
        breakpoints.insert(v.to);
        for h in &horizontals {
            if h.coord >= v.from && h.coord <= v.to && v.coord >= h.from && v.coord <= h.to {
                breakpoints.insert(h.coord);
            }
        }
        for (vi2, v2) in verticals.iter().enumerate() {
            if vi == vi2 || v2.coord != v.coord {
                continue;
            }
            if v2.from >= v.from && v2.from <= v.to {
                breakpoints.insert(v2.from);
            }
            if v2.to >= v.from && v2.to <= v.to {
                breakpoints.insert(v2.to);
            }
        }
        let pts: Vec<i32> = breakpoints.into_iter().collect();
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            if a == b {
                continue;
            }
            edges.push(StreetEdge {
                axis: Axis::Vertical,
                coord: v.coord,
                from: a,
                to: b,
                class: v.class,
                width_cells: v.width_cells,
            });
            node_set.insert((v.coord, a));
            node_set.insert((v.coord, b));
        }
    }

    for (hi, h) in horizontals.iter().enumerate() {
        let mut breakpoints: BTreeSet<i32> = BTreeSet::new();
        breakpoints.insert(h.from);
        breakpoints.insert(h.to);
        for v in &verticals {
            if v.coord >= h.from && v.coord <= h.to && h.coord >= v.from && h.coord <= v.to {
                breakpoints.insert(v.coord);
            }
        }
        for (hi2, h2) in horizontals.iter().enumerate() {
            if hi == hi2 || h2.coord != h.coord {
                continue;
            }
            if h2.from >= h.from && h2.from <= h.to {
                breakpoints.insert(h2.from);
            }
            if h2.to >= h.from && h2.to <= h.to {
                breakpoints.insert(h2.to);
            }
        }
        let pts: Vec<i32> = breakpoints.into_iter().collect();
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            if a == b {
                continue;
            }
            edges.push(StreetEdge {
                axis: Axis::Horizontal,
                coord: h.coord,
                from: a,
                to: b,
                class: h.class,
                width_cells: h.width_cells,
            });
            node_set.insert((a, h.coord));
            node_set.insert((b, h.coord));
        }
    }

    edges.sort_by_key(|e| (e.axis, e.coord, e.from, e.to));
    edges.dedup();
    (node_set.into_iter().collect(), edges)
}

/// Runs pass 2: seeds its own RNG stream from `(city_seed, PASS_ID)`,
/// lays `cfg.arterial_count_ns`/`_ew` jittered full-span arterials, then
/// recursively subdivides each resulting superblock (Street tier, Lane
/// tier for an over-deep leaf) with a target block size read from `land_
/// use`'s own density field. `land_use` is read-only -- this pass never
/// mutates pass 1's output, and never re-derives it.
pub fn run(city_seed: u64, land_use: &LandUseMap, cfg: &GenerationConfig) -> StreetNetwork {
    let mut rng = Rng::new(seed_from_ids(city_seed, PASS_ID));
    let site = land_use.site();

    let arterial_xs = band_positions(
        &mut rng,
        site.x0,
        site.x1,
        cfg.arterial_count_ns,
        cfg.arterial_jitter_pct,
        cfg.arterial_width_cells,
        cfg.min_block_depth_cells,
    );
    let arterial_ys = band_positions(
        &mut rng,
        site.y0,
        site.y1,
        cfg.arterial_count_ew,
        cfg.arterial_jitter_pct,
        cfg.arterial_width_cells,
        cfg.min_block_depth_cells,
    );

    let mut segments: Vec<StreetEdge> = Vec::new();
    for &x in &arterial_xs {
        segments.push(StreetEdge {
            axis: Axis::Vertical,
            coord: x,
            from: site.y0,
            to: site.y1,
            class: StreetClass::Arterial,
            width_cells: cfg.arterial_width_cells,
        });
    }
    for &y in &arterial_ys {
        segments.push(StreetEdge {
            axis: Axis::Horizontal,
            coord: y,
            from: site.x0,
            to: site.x1,
            class: StreetClass::Arterial,
            width_cells: cfg.arterial_width_cells,
        });
    }

    let x_ranges = band_ranges(&arterial_xs, site.x0, site.x1, cfg.arterial_width_cells);
    let y_ranges = band_ranges(&arterial_ys, site.y0, site.y1, cfg.arterial_width_cells);
    let x_ranges_topo = band_ranges_topo(&arterial_xs, site.x0, site.x1);
    let y_ranges_topo = band_ranges_topo(&arterial_ys, site.y0, site.y1);

    let mut blocks: Vec<Block> = Vec::new();
    for (i, &(x0, x1)) in x_ranges.iter().enumerate() {
        for (j, &(y0, y1)) in y_ranges.iter().enumerate() {
            let superblock = Rect { x0, y0, x1, y1 };
            if !superblock.is_valid() {
                continue;
            }
            let (tx0, tx1) = x_ranges_topo[i];
            let (ty0, ty1) = y_ranges_topo[j];
            let topo = Rect {
                x0: tx0,
                y0: ty0,
                x1: tx1,
                y1: ty1,
            };
            subdivide(
                superblock,
                topo,
                land_use,
                cfg,
                &mut rng,
                0,
                0,
                &mut segments,
                &mut blocks,
            );
        }
    }

    let (nodes, mut edges) = build_graph(&segments);
    edges.sort();
    blocks.sort_by_key(|b| (b.bounds.y0, b.bounds.x0));

    StreetNetwork {
        site,
        nodes,
        edges,
        blocks,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;
    use crate::generation::land_use;

    fn cfg() -> GenerationConfig {
        GenerationConfig::from_balance(defs::BALANCE).unwrap()
    }

    fn network(seed: u64, c: &GenerationConfig) -> (land_use::LandUseMap, StreetNetwork) {
        let lu = land_use::run(seed, c.site(), c);
        let net = run(seed, &lu, c);
        (lu, net)
    }

    #[test]
    fn run_is_deterministic_for_the_same_seed() {
        let c = cfg();
        let (_, a) = network(11, &c);
        let (_, b) = network(11, &c);
        assert_eq!(a.nodes, b.nodes);
        assert_eq!(a.edges, b.edges);
        assert_eq!(a.blocks, b.blocks);
    }

    #[test]
    fn every_edge_is_axis_aligned_by_construction() {
        // Type-level: StreetEdge cannot express a diagonal at all, so this
        // is a compile-time property -- this test just exercises the
        // accessors that would be the first thing a diagonal-checking
        // caller reaches for.
        let c = cfg();
        let (_, net) = network(1, &c);
        for e in net.edges() {
            let (sx, sy) = e.start();
            let (ex, ey) = e.end();
            assert!(sx == ex || sy == ey);
        }
    }

    #[test]
    fn the_street_graph_is_fully_connected() {
        let c = cfg();
        for seed in 0u64..12 {
            let (_, net) = network(seed, &c);
            let reachable = net.reachable_from_first_node().unwrap();
            assert_eq!(
                reachable.len(),
                net.nodes().len(),
                "seed {seed}: only {} of {} nodes reachable",
                reachable.len(),
                net.nodes().len()
            );
        }
    }

    #[test]
    fn no_land_use_region_is_stranded() {
        let c = cfg();
        for seed in 0u64..12 {
            let (lu, net) = network(seed, &c);
            let stranded = net.stranded_regions(&lu, c.block_size_max_cells);
            assert!(
                stranded.is_empty(),
                "seed {seed}: stranded regions {stranded:?}"
            );
        }
    }

    #[test]
    fn there_are_no_dead_ends_away_from_the_site_boundary() {
        let c = cfg();
        for seed in 0u64..12 {
            let (_, net) = network(seed, &c);
            let dead_ends = net.dead_end_nodes();
            assert!(dead_ends.is_empty(), "seed {seed}: dead ends {dead_ends:?}");
        }
    }

    #[test]
    fn junction_mix_has_both_three_way_and_four_way_junctions() {
        let c = cfg();
        for seed in 0u64..12 {
            let (_, net) = network(seed, &c);
            let (three, four) = net.junction_mix();
            assert!(three > 0, "seed {seed}: no 3-way junctions at all");
            assert!(four > 0, "seed {seed}: no 4-way junctions at all");
        }
    }

    #[test]
    fn detour_ratio_never_exceeds_the_configured_ceiling() {
        let c = cfg();
        for seed in 0u64..12 {
            let (_, net) = network(seed, &c);
            let samples = net.detour_samples(14, c.detour_min_manhattan_cells as i64);
            assert!(
                !samples.is_empty(),
                "seed {seed}: no detour samples produced"
            );
            let worst = samples
                .iter()
                .max_by_key(|s| s.network * 100 / s.manhattan)
                .unwrap();
            let pct = worst.network * 100 / worst.manhattan;
            assert!(
                pct <= c.max_detour_percent as i64,
                "seed {seed}: worst pair {:?}-{:?} network {} manhattan {} ratio {pct}% over the {}% ceiling",
                worst.a,
                worst.b,
                worst.network,
                worst.manhattan,
                c.max_detour_percent
            );
        }
    }

    #[test]
    fn blocks_never_overlap_a_street_rect() {
        let c = cfg();
        for seed in 0u64..8 {
            let (_, net) = network(seed, &c);
            for b in net.blocks() {
                for e in net.edges() {
                    assert!(
                        !rects_touch(b.bounds, e.rect())
                            || rects_are_adjacent_only(b.bounds, e.rect()),
                        "seed {seed}: block {:?} overlaps street rect {:?}",
                        b.bounds,
                        e.rect()
                    );
                }
            }
        }
    }

    /// True iff `a` and `b` share only a boundary (touching, not
    /// interior-overlapping) -- the expected relationship between a block
    /// and the street immediately beside it.
    fn rects_are_adjacent_only(a: Rect, b: Rect) -> bool {
        let overlap_x = a.x0.max(b.x0) < a.x1.min(b.x1);
        let overlap_y = a.y0.max(b.y0) < a.y1.min(b.y1);
        !(overlap_x && overlap_y)
    }

    #[test]
    fn block_sizes_vary_not_a_uniform_grid() {
        let c = cfg();
        let (_, net) = network(4, &c);
        let mut widths: Vec<i64> = net.blocks().iter().map(|b| b.bounds.width()).collect();
        widths.sort();
        widths.dedup();
        assert!(
            widths.len() >= 3,
            "only {} distinct block widths, looked like a uniform grid: {widths:?}",
            widths.len()
        );
    }

    #[test]
    fn arterials_reach_the_site_edge() {
        let c = cfg();
        let (_, net) = network(2, &c);
        let site = net.site();
        let arterials: Vec<&StreetEdge> = net
            .edges()
            .iter()
            .filter(|e| e.class == StreetClass::Arterial)
            .collect();
        assert!(!arterials.is_empty());

        // A single arterial line is split into several consecutive edges
        // by every crossing street, so the AC is checked per distinct
        // coordinate (one line), not per edge: the edges sharing that
        // coordinate must collectively span from one site edge to the
        // other, with no gap.
        let vertical_coords: std::collections::BTreeSet<i32> = arterials
            .iter()
            .filter(|a| a.axis == Axis::Vertical)
            .map(|a| a.coord)
            .collect();
        for coord in vertical_coords {
            let mut spans: Vec<(i32, i32)> = arterials
                .iter()
                .filter(|a| a.axis == Axis::Vertical && a.coord == coord)
                .map(|a| (a.from, a.to))
                .collect();
            spans.sort();
            assert_eq!(
                spans.first().unwrap().0,
                site.y0,
                "vertical arterial x={coord} does not start at the site edge"
            );
            assert_eq!(
                spans.last().unwrap().1,
                site.y1,
                "vertical arterial x={coord} does not reach the site edge"
            );
            for w in spans.windows(2) {
                assert_eq!(
                    w[0].1, w[1].0,
                    "vertical arterial x={coord} has a gap between {w:?}"
                );
            }
        }

        let horizontal_coords: std::collections::BTreeSet<i32> = arterials
            .iter()
            .filter(|a| a.axis == Axis::Horizontal)
            .map(|a| a.coord)
            .collect();
        for coord in horizontal_coords {
            let mut spans: Vec<(i32, i32)> = arterials
                .iter()
                .filter(|a| a.axis == Axis::Horizontal && a.coord == coord)
                .map(|a| (a.from, a.to))
                .collect();
            spans.sort();
            assert_eq!(
                spans.first().unwrap().0,
                site.x0,
                "horizontal arterial y={coord} does not start at the site edge"
            );
            assert_eq!(
                spans.last().unwrap().1,
                site.x1,
                "horizontal arterial y={coord} does not reach the site edge"
            );
            for w in spans.windows(2) {
                assert_eq!(
                    w[0].1, w[1].0,
                    "horizontal arterial y={coord} has a gap between {w:?}"
                );
            }
        }
    }

    #[test]
    fn min_block_depth_is_respected() {
        let c = cfg();
        for seed in 0u64..8 {
            let (_, net) = network(seed, &c);
            for b in net.blocks() {
                assert!(
                    b.bounds.width() >= c.min_block_depth_cells as i64,
                    "seed {seed}: block {:?} narrower than min_block_depth_cells",
                    b.bounds
                );
                assert!(
                    b.bounds.height() >= c.min_block_depth_cells as i64,
                    "seed {seed}: block {:?} shorter than min_block_depth_cells",
                    b.bounds
                );
            }
        }
    }
}

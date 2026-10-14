//! The provision index (FR50, FR130): what the city offers, and the one
//! query that finds it. A provision is an answer to one need bar; a source
//! node advertises any number of them, each with its own quality, as rows
//! keyed to the node. Pure -- a function of a [`ProvisionView`] and
//! [`Rates`]; the table is the server's, the structure is this module's.
//!
//! [`near`] answers "every source within R minutes, nearest first": the
//! radius is a [`Milliminutes`] estimate for the asker's mode, the chunks
//! visited are the ones that radius can reach (index-bounded, never the
//! whole table), and the ranking is the estimate (FR131) then node id. The
//! node ids are the ones [`super::search::search`] accepts as a destination.
//! Choosing among hits is the caller's.

use std::cell::Cell;
use std::collections::BTreeMap;

use super::estimate::{Correction, Rates, estimate};
use super::graph::{MacroGraph, Node};
use super::search::NodeId;
use super::{Milliminutes, Point, TransportMode};
use crate::balance;
use crate::generated::defs::BalanceSeed;
use crate::world::{CHUNK_SIZE, checked_chunk_key, chunk_coord};

/// The most provision rows one source node may carry: the largest list a
/// building type declares (`defs/building-types`), with headroom. The
/// `route_provision` row ceiling derives from it.
pub const MAX_PROVISIONS_PER_SOURCE: u64 = 6;

/// The top of the quality band: `0..=QUALITY_MAX`.
pub const QUALITY_MAX: u32 = 100;

/// The inputs of [`quality`]: one weight and the affluence range it reads.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct QualityDial {
    pub weight_percent: i64,
    pub affluence_min: i32,
    pub affluence_max: i32,
}

impl QualityDial {
    pub fn from_balance(b: &[BalanceSeed]) -> QualityDial {
        let get = |k| i32::try_from(balance::value(b, k)).expect("bounded by the balance max");
        QualityDial {
            weight_percent: balance::value(
                b,
                "generation.provision.quality_affluence_weight_percent",
            ),
            affluence_min: get("generation.neighbourhood.affluence_min"),
            affluence_max: get("generation.neighbourhood.affluence_max"),
        }
    }
}

/// A premises' quality: the type's base for the provision, moved by how far
/// the neighbourhood's affluence sits from the middle of its range
/// (`weight_percent` of that distance), clamped to `0..=QUALITY_MAX`. Set
/// once at generation; non-decreasing in affluence.
pub fn quality(base: u32, affluence: i32, dial: &QualityDial) -> u32 {
    let a = i64::from(affluence.clamp(dial.affluence_min, dial.affluence_max));
    let mid = (i64::from(dial.affluence_min) + i64::from(dial.affluence_max)) / 2;
    let q = i64::from(base) + (a - mid) * dial.weight_percent / 100;
    q.clamp(0, i64::from(QUALITY_MAX)) as u32
}

/// The `routing.provision.*` dials.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProvisionQuery {
    pub rates: Rates,
    /// How far the city looks, as the estimate from the asking point.
    pub radius: Milliminutes,
    pub max_results: u32,
}

impl ProvisionQuery {
    pub fn from_balance(b: &[BalanceSeed]) -> ProvisionQuery {
        let get = |k| u32::try_from(balance::value(b, k)).expect("bounded by the balance max");
        ProvisionQuery {
            rates: Rates::from_balance(b),
            radius: Milliminutes(i64::from(get("routing.provision.query_radius_minutes")) * 1000),
            max_results: get("routing.provision.max_results"),
        }
    }
}

/// One answer: the source node (a `route_node` id), the business it
/// belongs to if any, the quality it offers and the estimate from the
/// asking point.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProvisionHit {
    pub node_id: NodeId,
    pub business_id: Option<u64>,
    pub provision: u32,
    pub quality: u32,
    pub estimate: Milliminutes,
}

/// One provision row of a chunk, as the view lists it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProvisionAt {
    pub node_id: NodeId,
    pub quality: u32,
}

/// What [`near`] reads: the provision rows of one `(provision, chunk key)`,
/// and a node, with its business id, by id.
pub trait ProvisionView {
    fn in_chunk(&self, provision: u32, chunk_key: u64, out: &mut Vec<ProvisionAt>);
    fn node(&self, id: NodeId) -> Option<(Node, Option<u64>)>;
}

/// The most cells one step of `radius` can span for `mode`: the largest `c`
/// whose same-floor estimate over `c` cells is within `radius`. The estimate
/// is monotone in distance, so a bisection finds it; it is what turns the
/// minute radius into a window of chunks without a cell unit in the dial.
pub fn radius_cells(rates: &Rates, mode: TransportMode, radius: Milliminutes) -> i32 {
    let at = |c: i64| {
        estimate(
            rates,
            Point {
                x: 0,
                y: 0,
                floor: 0,
            },
            Point {
                x: c as i32,
                y: 0,
                floor: 0,
            },
            mode,
            Correction::NONE,
        )
    };
    let (mut lo, mut hi) = (0i64, 1i64 << 20);
    if at(hi) <= radius {
        return hi as i32;
    }
    while lo + 1 < hi {
        let mid = (lo + hi) / 2;
        if at(mid) <= radius {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lo as i32
}

/// Every source advertising `provision` on `floors` whose estimate from
/// `origin` in `mode` is within `query.radius`, nearest first (estimate,
/// then node id), at most `query.max_results`. The chunks visited are those
/// the radius can reach on each floor, whatever the table's size; a
/// provision nobody offers is an empty answer.
pub fn near(
    view: &impl ProvisionView,
    origin: Point,
    floors: &[i8],
    provision: u32,
    mode: TransportMode,
    query: &ProvisionQuery,
) -> Vec<ProvisionHit> {
    let c = i64::from(radius_cells(&query.rates, mode, query.radius));
    let span = |v: i32| {
        let lo = (i64::from(v) - c).max(i64::from(i32::MIN));
        let hi = (i64::from(v) + c).min(i64::from(i32::MAX));
        (chunk_coord(lo as i32), chunk_coord(hi as i32))
    };
    let ((x0, x1), (y0, y1)) = (span(origin.x), span(origin.y));
    let size = i64::from(CHUNK_SIZE);
    let mut found: BTreeMap<(Milliminutes, NodeId), ProvisionHit> = BTreeMap::new();
    let mut rows = Vec::new();
    for &floor in floors {
        for cy in y0..=y1 {
            for cx in x0..=x1 {
                let (x, y) = (i64::from(cx) * size, i64::from(cy) * size);
                let Some(key) = i32::try_from(x)
                    .ok()
                    .zip(i32::try_from(y).ok())
                    .and_then(|(x, y)| checked_chunk_key(x, y, floor))
                else {
                    continue;
                };
                rows.clear();
                view.in_chunk(provision, key, &mut rows);
                for row in &rows {
                    let Some((node, business_id)) = view.node(row.node_id) else {
                        continue;
                    };
                    let estimate =
                        estimate(&query.rates, origin, node.point(), mode, Correction::NONE);
                    if estimate > query.radius {
                        continue;
                    }
                    found.insert(
                        (estimate, row.node_id),
                        ProvisionHit {
                            node_id: row.node_id,
                            business_id,
                            provision,
                            quality: row.quality,
                            estimate,
                        },
                    );
                }
            }
        }
    }
    found
        .into_values()
        .take(query.max_results as usize)
        .collect()
}

/// An in-memory [`ProvisionView`] of one graph, for tests and tools. The
/// server's is the `route_provision` table through its index.
#[derive(Debug)]
pub struct ProvisionTable {
    by_chunk: BTreeMap<(u32, u64), Vec<ProvisionAt>>,
    nodes: BTreeMap<NodeId, (Node, Option<u64>)>,
    visits: Cell<usize>,
}

impl ProvisionTable {
    /// `node_ids[i]` and `business_ids[i]` are node `i`'s table id and
    /// business id.
    pub fn from_graph(
        graph: &MacroGraph,
        node_ids: &[u64],
        business_ids: &[Option<u64>],
    ) -> ProvisionTable {
        let mut by_chunk: BTreeMap<(u32, u64), Vec<ProvisionAt>> = BTreeMap::new();
        for p in graph.provisions() {
            let n = &graph.nodes()[p.node as usize];
            by_chunk
                .entry((p.provision, n.chunk_key()))
                .or_default()
                .push(ProvisionAt {
                    node_id: node_ids[p.node as usize],
                    quality: p.quality,
                });
        }
        let nodes = graph
            .nodes()
            .iter()
            .enumerate()
            .map(|(i, n)| (node_ids[i], (*n, business_ids.get(i).copied().flatten())))
            .collect();
        ProvisionTable {
            by_chunk,
            nodes,
            visits: Cell::new(0),
        }
    }

    pub fn reset_visits(&self) {
        self.visits.set(0);
    }

    /// Chunk lookups since the last reset.
    pub fn chunk_visits(&self) -> usize {
        self.visits.get()
    }
}

impl ProvisionView for ProvisionTable {
    fn in_chunk(&self, provision: u32, chunk_key: u64, out: &mut Vec<ProvisionAt>) {
        self.visits.set(self.visits.get() + 1);
        if let Some(v) = self.by_chunk.get(&(provision, chunk_key)) {
            out.extend_from_slice(v);
        }
    }

    fn node(&self, id: NodeId) -> Option<(Node, Option<u64>)> {
        self.nodes.get(&id).copied()
    }
}

#[cfg(test)]
mod tests;

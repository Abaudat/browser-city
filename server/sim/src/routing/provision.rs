//! The provision index (FR50, FR130): what the city offers, and the one
//! query that finds it. A provision is an answer to one need bar; a source
//! node advertises any number of them, each with its own quality, as rows
//! keyed to the node. Pure -- a function of a [`ProvisionView`] and
//! [`Rates`]; the table is the server's, the structure is this module's.
//!
//! [`near`] is index-bounded: it visits the chunks within a radius of the
//! asking point, never the whole table, ranks by the walking estimate
//! (FR131) and returns the node ids [`super::search::search`] accepts as a
//! destination. Choosing among hits is the caller's.

use std::cell::Cell;
use std::collections::BTreeMap;

use super::estimate::{Correction, Rates, estimate};
use super::graph::{MacroGraph, Node};
use super::search::NodeId;
use super::{Milliminutes, Point, TransportMode};
use crate::balance;
use crate::generated::defs::BalanceSeed;
use crate::world::{CHUNK_SIZE, checked_chunk_key, chunk_key};

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
            weight_percent: balance::value(b, "generation.provision.quality_affluence_weight_percent"),
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
    /// Chunks out from the asking point's own, in each direction.
    pub radius_chunks: u32,
    pub max_results: u32,
}

impl ProvisionQuery {
    pub fn from_balance(b: &[BalanceSeed]) -> ProvisionQuery {
        let get = |k| u32::try_from(balance::value(b, k)).expect("bounded by the balance max");
        ProvisionQuery {
            rates: Rates::from_balance(b),
            radius_chunks: get("routing.provision.query_radius_chunks"),
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

/// The chunk coordinate of a cell coordinate; the one place a chunk
/// coordinate is derived beside `world::chunk_key`'s own.
pub fn chunk_of(v: i32) -> i32 {
    v.div_euclid(CHUNK_SIZE)
}

/// The `n` nearest sources advertising `provision`, by estimate then node
/// id, within `query.radius_chunks` chunks of `origin` on each of
/// `floors`. Visits `(2r + 1)^2` chunks per floor, whatever the table's
/// size; a provision nobody offers is an empty answer.
pub fn near(
    view: &impl ProvisionView,
    origin: Point,
    floors: &[i8],
    provision: u32,
    query: &ProvisionQuery,
) -> Vec<ProvisionHit> {
    let r = i64::from(query.radius_chunks);
    let (cx, cy) = (i64::from(chunk_of(origin.x)), i64::from(chunk_of(origin.y)));
    let size = i64::from(CHUNK_SIZE);
    let mut found: BTreeMap<(Milliminutes, NodeId), ProvisionHit> = BTreeMap::new();
    let mut rows = Vec::new();
    for &floor in floors {
        for dy in -r..=r {
            for dx in -r..=r {
                let (x, y) = ((cx + dx) * size, (cy + dy) * size);
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
                    let estimate = estimate(
                        &query.rates,
                        origin,
                        node.point(),
                        TransportMode::Walk,
                        Correction::NONE,
                    );
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
/// server's is the `node_provision` table through its index.
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
                .entry((p.provision, chunk_key(n.x, n.y, n.floor)))
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
            .map(|(i, n)| {
                (
                    node_ids[i],
                    (*n, business_ids.get(i).copied().flatten()),
                )
            })
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

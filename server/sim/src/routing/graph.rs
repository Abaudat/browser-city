//! The macro routing graph (FR129, FR130, FR134): street junctions, one
//! entrance per enterable building, an internal node for a large one, and
//! portals between floors. Pure -- a function of the finished district's
//! street network, interiors and walkability, and [`Rates`]. Nodes and
//! edges are sorted vectors with indices as references: iteration order is
//! part of the output.
//!
//! Every edge's cost is [`estimate`] between its endpoints, in walking
//! mode, and nothing else: one formula for the commute tax, the search
//! heuristic and the edge. The graph holds no cell unit.

use std::collections::BTreeMap;

use super::estimate::{Correction, Rates, estimate};
use super::{Milliminutes, Point, TransportMode};
use crate::codes::{edge_kind, node_kind};
use crate::generation::{Axis, Side, StreetNetwork};
use crate::world::{FloorCollision, Rect};

/// The measured size of a 512 x 512 district's graph: the means over the
/// seeds of the `macro graph` block of `docs/generation.md`. AC1 says "a few
/// thousand nodes and roughly ten thousand edges"; one undirected edge per
/// street segment and per door lands near 1,900, which the block records.
pub const NODE_COUNT_MEASURED_512: u64 = 1_850;
pub const EDGE_COUNT_MEASURED_512: u64 = 1_900;
/// How far either count may drift from its measurement, in percent, before
/// a test trips and the block must be re-stamped.
pub const COUNT_BAND_PERCENT: u64 = 30;
/// The 512 x 512 bands: the measurement plus or minus [`COUNT_BAND_PERCENT`].
/// The upper bounds are also the ceilings `TABLE_BOUNDS` scales to a site.
pub const NODE_COUNT_BAND_512: (u64, u64) = (
    NODE_COUNT_MEASURED_512 * (100 - COUNT_BAND_PERCENT) / 100,
    NODE_COUNT_MEASURED_512 * (100 + COUNT_BAND_PERCENT) / 100,
);
pub const EDGE_COUNT_BAND_512: (u64, u64) = (
    EDGE_COUNT_MEASURED_512 * (100 - COUNT_BAND_PERCENT) / 100,
    EDGE_COUNT_MEASURED_512 * (100 + COUNT_BAND_PERCENT) / 100,
);
/// The side, in cells, the bands above are declared at.
pub const BAND_SITE_SIDE_CELLS: u64 = 512;
/// The side, in cells, of the district the tables are bounded for (NFR14).
pub const GROWTH_TARGET_SIDE_CELLS: u64 = 1024;

/// The most nodes a site of `side` cells may hold: the band's ceiling
/// scaled linearly with area. Used by the structural performance test
/// and `TABLE_BOUNDS`.
pub const fn max_nodes_for_side(side: u64) -> u64 {
    NODE_COUNT_BAND_512.1 * side * side / (BAND_SITE_SIDE_CELLS * BAND_SITE_SIDE_CELLS)
}

/// The most edges a site of `side` cells may hold.
pub const fn max_edges_for_side(side: u64) -> u64 {
    EDGE_COUNT_BAND_512.1 * side * side / (BAND_SITE_SIDE_CELLS * BAND_SITE_SIDE_CELLS)
}

/// Each floor's tile grid, by floor.
pub type Floors = BTreeMap<i8, FloorCollision>;

/// What a node is. `Street` is a junction, dead end or door split, or a
/// walking node on another floor; `Source` is a building's entrance;
/// `Internal` the one node a large building adds beyond it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum NodeKind {
    Street,
    Source,
    Internal,
    Portal,
}

impl NodeKind {
    pub fn code(self) -> u32 {
        match self {
            NodeKind::Street => node_kind::STREET,
            NodeKind::Source => node_kind::ENTRANCE,
            NodeKind::Internal => node_kind::INTERNAL,
            NodeKind::Portal => node_kind::PORTAL,
        }
    }

    pub fn from_code(code: u32) -> Option<NodeKind> {
        [
            NodeKind::Street,
            NodeKind::Source,
            NodeKind::Internal,
            NodeKind::Portal,
        ]
        .into_iter()
        .find(|k| k.code() == code)
    }
}

/// What an edge is. Only `Portal` edges cross floors.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum EdgeKind {
    Street,
    Entrance,
    Internal,
    Portal,
    /// A portal endpoint to the nearest walking node on its own floor.
    PortalLink,
}

impl EdgeKind {
    pub fn code(self) -> u32 {
        match self {
            EdgeKind::Street => edge_kind::STREET,
            EdgeKind::Entrance => edge_kind::ENTRANCE,
            EdgeKind::Internal => edge_kind::INTERNAL,
            EdgeKind::Portal => edge_kind::PORTAL,
            EdgeKind::PortalLink => edge_kind::PORTAL_LINK,
        }
    }

    pub fn from_code(code: u32) -> Option<EdgeKind> {
        [
            EdgeKind::Street,
            EdgeKind::Entrance,
            EdgeKind::Internal,
            EdgeKind::Portal,
            EdgeKind::PortalLink,
        ]
        .into_iter()
        .find(|k| k.code() == code)
    }
}

/// The building a `Source` node is the entrance of: its plot index.
/// Whether it is a workplace is its `employment` provision, nothing else.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct SourceRef {
    pub plot: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Node {
    pub kind: NodeKind,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub source: Option<SourceRef>,
}

impl Node {
    /// The chunk the node's cell is in: the one derivation of a provision
    /// row's `chunk_key` (nodes never move).
    pub fn chunk_key(&self) -> u64 {
        crate::world::chunk_key(self.x, self.y, self.floor)
    }

    pub fn point(&self) -> Point {
        Point {
            x: self.x,
            y: self.y,
            floor: self.floor,
        }
    }
}

/// One undirected edge, stored once with `a < b` (node indices).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edge {
    pub a: u32,
    pub b: u32,
    pub kind: EdgeKind,
    pub cost: Milliminutes,
}

/// Why a graph is not valid. Names the offending edge or node by index.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum GraphError {
    /// An edge names a node index past the end of the node list.
    DanglingEdge {
        edge: u32,
    },
    SelfLoop {
        edge: u32,
    },
    /// `a >= b`, or the pair appears twice (edges are sorted, unique).
    UnorderedEdge {
        edge: u32,
    },
    /// An edge between two floors that is not a portal edge between two
    /// portal nodes.
    CrossFloorNonPortal {
        edge: u32,
    },
    /// A portal edge whose endpoints share a floor, or whose end is not a
    /// portal node.
    MalformedPortal {
        edge: u32,
    },
    NonPositiveCost {
        edge: u32,
    },
    /// A node the search from node 0 cannot reach: the graph is not one
    /// connected component.
    Disconnected {
        node: u32,
    },
    /// A node on a blocked tile, or outside its floor's grid.
    NodeNotWalkable {
        node: u32,
    },
    /// A diagonal edge whose corner, or an arm to it, is not walkable.
    CornerBlocked {
        edge: u32,
    },
    /// A building entrance whose approach ends off every street.
    EntranceOffStreet {
        plot: u32,
    },
    /// A provision row on a node that is not a building's entrance.
    ProvisionOffSource {
        node: u32,
    },
    /// The same provision twice on one node, a row naming no node, or rows
    /// out of (node, provision) order.
    BadProvisions {
        node: u32,
    },
    /// A row's kind code names no kind.
    UnknownKind {
        code: u32,
    },
    /// Rows that do not describe one graph (duplicate or unsorted ids).
    BadRows,
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "routing::graph: {self:?}")
    }
}

impl std::error::Error for GraphError {}

/// One node table row, in `route_node`'s shape. `node_id` is the id the
/// table assigned; a freshly mapped row carries 0.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NodeRow {
    pub node_id: u64,
    pub kind: u32,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub business_id: Option<u64>,
}

/// One edge table row, in `route_edge`'s shape.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EdgeRow {
    pub edge_id: u64,
    pub node_a: u64,
    pub node_b: u64,
    pub kind: u32,
    pub cost_milliminutes: i64,
}

/// One provision a source node advertises: its quality is set once at
/// generation. Sorted by (node, provision) in a graph.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct NodeProvision {
    pub node: u32,
    pub provision: u32,
    pub quality: u32,
}

/// One `route_provision` table row, in its shape; `provision_id` is 0 for
/// a freshly mapped row.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ProvisionRow {
    pub provision_id: u64,
    pub node_id: u64,
    pub provision: u32,
    pub quality: u32,
    pub chunk_key: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct MacroGraph {
    nodes: Vec<Node>,
    edges: Vec<Edge>,
    provisions: Vec<NodeProvision>,
}

/// One enterable building, as the builder reads it.
#[derive(Clone, Debug)]
pub struct BuildingInput {
    pub plot: u32,
    /// `(provision code, quality)` the building advertises.
    pub provisions: Vec<(u32, u32)>,
    pub front: Side,
    /// The street door cell, ground floor.
    pub entrance: (i32, i32),
    /// The straight run from the door out to the street's first cell.
    pub approach: Vec<(i32, i32)>,
    /// The building's rooms (floor rects, no walls).
    pub rooms: Vec<Rect>,
}

/// One floor transition: standing on `from` arrives at `to`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PortalPair {
    pub from: Point,
    pub to: Point,
}

/// The rule behind an internal node, in one place.
pub fn has_internal_node(interior_cells: i64, min_interior_cells: i64) -> bool {
    interior_cells >= min_interior_cells
}

/// A building's net interior floor area: the sum of its rooms.
pub fn interior_cells(rooms: &[Rect]) -> i64 {
    rooms.iter().map(|r| r.width() * r.height()).sum()
}

/// The inputs of [`MacroGraph::build`].
pub struct BuildInput<'a> {
    pub streets: &'a StreetNetwork,
    pub buildings: &'a [BuildingInput],
    pub portals: &'a [PortalPair],
    pub rates: Rates,
    pub internal_node_min_floor_area: i64,
    /// Walking nodes on floors the street network does not cover (floor
    /// transitions' own floors); generation emits none yet. Those of one
    /// floor are chained in cell order.
    pub floor_nodes: &'a [Point],
    /// Every floor's tile grid.
    pub walkability: &'a Floors,
}

/// The one rule for a segment that is neither horizontal nor vertical: it
/// is walked through its axis-aligned corner, so the walked length is the
/// costed Manhattan one. The corner is the same whichever way the segment
/// is walked: the endpoint first in (y, x) order runs along its row, then
/// down the other's column. `None` on an axis-aligned segment or one that
/// changes floor. `MacroGraph::check` holds both arms walkable.
pub fn corner(a: Point, b: Point) -> Option<Point> {
    if a.floor != b.floor || a.x == b.x || a.y == b.y {
        return None;
    }
    let (lo, hi) = if (a.y, a.x) <= (b.y, b.x) {
        (a, b)
    } else {
        (b, a)
    };
    Some(Point {
        x: hi.x,
        y: lo.y,
        floor: lo.floor,
    })
}

/// Every cell of the two arms of `a` to `b` through [`corner`], ends
/// included.
fn corner_cells(a: Point, b: Point, c: Point) -> impl Iterator<Item = (i32, i32)> {
    let (lo, hi) = if (a.y, a.x) <= (b.y, b.x) {
        (a, b)
    } else {
        (b, a)
    };
    let row = (lo.x.min(c.x)..=lo.x.max(c.x)).map(move |x| (x, lo.y));
    let col = (lo.y.min(hi.y)..=lo.y.max(hi.y)).map(move |y| (c.x, y));
    row.chain(col)
}

fn cost(rates: &Rates, a: Point, b: Point) -> Milliminutes {
    estimate(rates, a, b, TransportMode::Walk, Correction::NONE)
}

fn walkable(w: &Floors, floor: i8, x: i32, y: i32) -> bool {
    w.get(&floor).is_some_and(|g| g.is_standable(x, y))
}

impl MacroGraph {
    pub fn nodes(&self) -> &[Node] {
        &self.nodes
    }

    pub fn edges(&self) -> &[Edge] {
        &self.edges
    }

    /// A graph from raw parts, for tests and for [`Self::from_rows`];
    /// [`Self::check`] is the verdict on it.
    pub fn from_parts(
        nodes: Vec<Node>,
        edges: Vec<Edge>,
        provisions: Vec<NodeProvision>,
    ) -> MacroGraph {
        MacroGraph {
            nodes,
            edges,
            provisions,
        }
    }

    /// Whether node `node` (an index) advertises `provision`. A workplace
    /// is a source that advertises `employment`.
    pub fn advertises(&self, node: u32, provision: u32) -> bool {
        self.provisions
            .binary_search_by_key(&(node, provision), |p| (p.node, p.provision))
            .is_ok()
    }

    /// Every provision a source node advertises, by (node, provision).
    pub fn provisions(&self) -> &[NodeProvision] {
        &self.provisions
    }

    /// Builds the graph. No pairwise scan: street edges split at the
    /// building doors that land on them, and each building adds its own
    /// handful of edges.
    pub fn build(input: &BuildInput) -> Result<MacroGraph, GraphError> {
        let rates = &input.rates;
        // A street ending on the site's far boundary names a corner line,
        // one past the last cell: the node stands on the last cell.
        let site = input.streets.site();
        let inside = |(x, y): (i32, i32)| (x.min(site.x1 - 1), y.min(site.y1 - 1));
        // (floor, y, x) -> kind/source. Ordered, so the node order is the
        // cell order.
        let mut cells: BTreeMap<(i8, i32, i32), (NodeKind, Option<SourceRef>)> = BTreeMap::new();
        let mut put = |x: i32, y: i32, floor: i8, kind: NodeKind, src: Option<SourceRef>| {
            cells.entry((floor, y, x)).or_insert((kind, src));
        };
        for &n in input.streets.nodes() {
            let (x, y) = inside(n);
            put(x, y, 0, NodeKind::Street, None);
        }
        // Street edges by fixed coordinate, to find the one a door meets.
        let mut horizontal: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
        let mut vertical: BTreeMap<i32, Vec<usize>> = BTreeMap::new();
        for (i, e) in input.streets.edges().iter().enumerate() {
            match e.axis {
                Axis::Horizontal => horizontal.entry(e.coord).or_default().push(i),
                Axis::Vertical => vertical.entry(e.coord).or_default().push(i),
            }
        }
        let half_max = input
            .streets
            .edges()
            .iter()
            .map(|e| e.width_cells / 2)
            .max()
            .unwrap_or(0);
        // Per building: (entrance, split cell, internal cell).
        struct Placed {
            plot: u32,
            provisions: Vec<(u32, u32)>,
            entrance: (i32, i32),
            split: (i32, i32),
            street_edge: usize,
            internal: Option<(i32, i32)>,
        }
        let mut placed: Vec<Placed> = Vec::new();
        for b in input.buildings {
            let end = *b
                .approach
                .last()
                .ok_or(GraphError::EntranceOffStreet { plot: b.plot })?;
            // A door facing north/south meets a horizontal street.
            let (index, along) = match b.front {
                Side::North | Side::South => (&horizontal, end.0),
                Side::East | Side::West => (&vertical, end.1),
            };
            let fixed = match b.front {
                Side::North | Side::South => end.1,
                Side::East | Side::West => end.0,
            };
            let hit = index
                .range(fixed - half_max..=fixed + half_max)
                .flat_map(|(_, v)| v.iter().copied())
                .find(|&i| {
                    let r = input.streets.edges()[i].rect();
                    r.contains(end.0, end.1)
                });
            let Some(ei) = hit else {
                return Err(GraphError::EntranceOffStreet { plot: b.plot });
            };
            let e = &input.streets.edges()[ei];
            let a = along.clamp(e.from, e.to);
            let split = match e.axis {
                Axis::Horizontal => (a, e.coord),
                Axis::Vertical => (e.coord, a),
            };
            let internal =
                (has_internal_node(interior_cells(&b.rooms), input.internal_node_min_floor_area))
                    .then(|| internal_cell(&b.rooms, b.entrance, input.walkability))
                    .flatten();
            placed.push(Placed {
                plot: b.plot,
                provisions: b.provisions.clone(),
                entrance: b.entrance,
                split,
                street_edge: ei,
                internal,
            });
        }
        for p in &placed {
            let (sx, sy) = inside(p.split);
            put(sx, sy, 0, NodeKind::Street, None);
            put(
                p.entrance.0,
                p.entrance.1,
                0,
                NodeKind::Source,
                Some(SourceRef { plot: p.plot }),
            );
            if let Some((x, y)) = p.internal {
                put(x, y, 0, NodeKind::Internal, None);
            }
        }
        for p in input.floor_nodes {
            put(p.x, p.y, p.floor, NodeKind::Street, None);
        }
        for pp in input.portals {
            put(pp.from.x, pp.from.y, pp.from.floor, NodeKind::Portal, None);
            put(pp.to.x, pp.to.y, pp.to.floor, NodeKind::Portal, None);
        }
        let nodes: Vec<Node> = cells
            .iter()
            .map(|(&(floor, y, x), &(kind, source))| Node {
                kind,
                x,
                y,
                floor,
                source,
            })
            .collect();
        let index: BTreeMap<(i8, i32, i32), u32> = cells
            .keys()
            .enumerate()
            .map(|(i, &k)| (k, i as u32))
            .collect();
        let at = |x: i32, y: i32, floor: i8| index[&(floor, y, x)];
        let pt = |x: i32, y: i32, floor: i8| Point { x, y, floor };

        let mut pairs: BTreeMap<(u32, u32), EdgeKind> = BTreeMap::new();
        let mut link = |a: u32, b: u32, kind: EdgeKind| {
            if a != b {
                pairs.entry((a.min(b), a.max(b))).or_insert(kind);
            }
        };
        // Street edges: consecutive nodes along one centreline.
        let mut on_edge: BTreeMap<usize, Vec<i32>> = BTreeMap::new();
        for (i, e) in input.streets.edges().iter().enumerate() {
            let list = on_edge.entry(i).or_default();
            list.push(e.from);
            list.push(e.to);
        }
        for p in &placed {
            let e = &input.streets.edges()[p.street_edge];
            let along = match e.axis {
                Axis::Horizontal => p.split.0,
                Axis::Vertical => p.split.1,
            };
            on_edge.entry(p.street_edge).or_default().push(along);
        }
        for (i, list) in &mut on_edge {
            list.sort_unstable();
            list.dedup();
            let e = &input.streets.edges()[*i];
            for w in list.windows(2) {
                let cell = |t: i32| match e.axis {
                    Axis::Horizontal => (t, e.coord),
                    Axis::Vertical => (e.coord, t),
                };
                let (ax, ay) = inside(cell(w[0]));
                let (bx, by) = inside(cell(w[1]));
                link(at(ax, ay, 0), at(bx, by, 0), EdgeKind::Street);
            }
        }
        for p in &placed {
            let (sx, sy) = inside(p.split);
            link(
                at(p.entrance.0, p.entrance.1, 0),
                at(sx, sy, 0),
                EdgeKind::Entrance,
            );
            if let Some((x, y)) = p.internal {
                link(
                    at(p.entrance.0, p.entrance.1, 0),
                    at(x, y, 0),
                    EdgeKind::Internal,
                );
            }
        }
        for pp in input.portals {
            link(
                at(pp.from.x, pp.from.y, pp.from.floor),
                at(pp.to.x, pp.to.y, pp.to.floor),
                EdgeKind::Portal,
            );
        }
        // Walking nodes of a floor the network does not cover: chained in
        // cell order, one component per floor.
        let mut chain: Vec<&Point> = input.floor_nodes.iter().collect();
        chain.sort_by_key(|p| (p.floor, p.y, p.x));
        for w in chain.windows(2) {
            if w[0].floor == w[1].floor {
                link(
                    at(w[0].x, w[0].y, w[0].floor),
                    at(w[1].x, w[1].y, w[1].floor),
                    EdgeKind::Street,
                );
            }
        }
        // Each portal endpoint joins the walking network of its own floor
        // at the nearest walking node (cost, then node order). Portals are
        // few: this is the one scan of the node list, and it is per portal.
        for (i, n) in nodes.iter().enumerate() {
            if n.kind != NodeKind::Portal {
                continue;
            }
            let nearest = nodes
                .iter()
                .enumerate()
                .filter(|(_, m)| m.floor == n.floor && m.kind != NodeKind::Portal)
                .min_by_key(|(j, m)| (cost(rates, n.point(), m.point()), *j));
            if let Some((j, _)) = nearest {
                link(i as u32, j as u32, EdgeKind::PortalLink);
            }
        }
        let edges: Vec<Edge> = pairs
            .into_iter()
            .map(|((a, b), kind)| {
                let (na, nb) = (&nodes[a as usize], &nodes[b as usize]);
                Edge {
                    a,
                    b,
                    kind,
                    cost: cost(rates, pt(na.x, na.y, na.floor), pt(nb.x, nb.y, nb.floor)),
                }
            })
            .collect();
        let mut provisions: Vec<NodeProvision> = Vec::new();
        for p in &placed {
            let node = at(p.entrance.0, p.entrance.1, 0);
            for &(provision, quality) in &p.provisions {
                provisions.push(NodeProvision {
                    node,
                    provision,
                    quality,
                });
            }
        }
        provisions.sort_unstable();
        Ok(MacroGraph {
            nodes,
            edges,
            provisions,
        })
    }

    /// Every verdict on the graph's shape: no dangling or self-looping or
    /// duplicate edge, positive costs, only portal edges cross floors,
    /// every node walkable, and one connected component over every node
    /// kind, portals included.
    pub fn check(&self, walkability: &Floors) -> Result<(), GraphError> {
        let n = self.nodes.len() as u32;
        let mut prev: Option<(u32, u32)> = None;
        for (i, e) in self.edges.iter().enumerate() {
            let edge = i as u32;
            if e.a >= n || e.b >= n {
                return Err(GraphError::DanglingEdge { edge });
            }
            if e.a == e.b {
                return Err(GraphError::SelfLoop { edge });
            }
            if e.a > e.b || prev.is_some_and(|p| p >= (e.a, e.b)) {
                return Err(GraphError::UnorderedEdge { edge });
            }
            prev = Some((e.a, e.b));
            let (na, nb) = (&self.nodes[e.a as usize], &self.nodes[e.b as usize]);
            let crosses = na.floor != nb.floor;
            let portal_ends = na.kind == NodeKind::Portal && nb.kind == NodeKind::Portal;
            if crosses && !(e.kind == EdgeKind::Portal && portal_ends) {
                return Err(GraphError::CrossFloorNonPortal { edge });
            }
            if e.kind == EdgeKind::Portal && !(crosses && portal_ends) {
                return Err(GraphError::MalformedPortal { edge });
            }
            if e.cost.0 <= 0 {
                return Err(GraphError::NonPositiveCost { edge });
            }
        }
        for (i, node) in self.nodes.iter().enumerate() {
            if !walkable(walkability, node.floor, node.x, node.y) {
                return Err(GraphError::NodeNotWalkable { node: i as u32 });
            }
        }
        for (i, e) in self.edges.iter().enumerate() {
            let (a, b) = (
                self.nodes[e.a as usize].point(),
                self.nodes[e.b as usize].point(),
            );
            if let Some(c) = corner(a, b)
                && !corner_cells(a, b, c).all(|(x, y)| walkable(walkability, c.floor, x, y))
            {
                return Err(GraphError::CornerBlocked { edge: i as u32 });
            }
        }
        self.check_provisions()?;
        self.check_connected()
    }

    /// A provision sits only on a building's entrance, once per code per
    /// node, in order.
    fn check_provisions(&self) -> Result<(), GraphError> {
        let mut prev: Option<(u32, u32)> = None;
        for p in &self.provisions {
            let Some(n) = self.nodes.get(p.node as usize) else {
                return Err(GraphError::BadProvisions { node: p.node });
            };
            if n.kind != NodeKind::Source {
                return Err(GraphError::ProvisionOffSource { node: p.node });
            }
            if prev.is_some_and(|q| q >= (p.node, p.provision)) {
                return Err(GraphError::BadProvisions { node: p.node });
            }
            prev = Some((p.node, p.provision));
        }
        Ok(())
    }

    /// The provision table rows, in (node, provision) order. `node_ids[i]`
    /// is the id the table assigned node `i`; `provision_id` is left 0.
    pub fn provision_rows(&self, node_ids: &[u64]) -> Vec<ProvisionRow> {
        self.provisions
            .iter()
            .map(|p| ProvisionRow {
                provision_id: 0,
                node_id: node_ids[p.node as usize],
                provision: p.provision,
                quality: p.quality,
                chunk_key: self.nodes[p.node as usize].chunk_key(),
            })
            .collect()
    }

    /// One component: every node, portals included, is reachable from
    /// node 0. A street network split in two, a source with no path to the
    /// streets and a staircase tied to no floor's walking network are all
    /// `Disconnected`, naming the first node the search misses.
    fn check_connected(&self) -> Result<(), GraphError> {
        if self.nodes.is_empty() {
            return Ok(());
        }
        let mut adj: Vec<Vec<u32>> = vec![Vec::new(); self.nodes.len()];
        for e in &self.edges {
            adj[e.a as usize].push(e.b);
            adj[e.b as usize].push(e.a);
        }
        let mut seen = vec![false; self.nodes.len()];
        let mut queue: Vec<u32> = vec![0];
        seen[0] = true;
        while let Some(i) = queue.pop() {
            for &j in &adj[i as usize] {
                if !seen[j as usize] {
                    seen[j as usize] = true;
                    queue.push(j);
                }
            }
        }
        match seen.iter().position(|s| !s) {
            Some(i) => Err(GraphError::Disconnected { node: i as u32 }),
            None => Ok(()),
        }
    }

    /// The node table rows, in node order. `business_ids[i]` is node `i`'s
    /// business id; `node_id` is left 0 for the table to assign.
    pub fn node_rows(&self, business_ids: &[Option<u64>]) -> Vec<NodeRow> {
        self.nodes
            .iter()
            .enumerate()
            .map(|(i, n)| NodeRow {
                node_id: 0,
                kind: n.kind.code(),
                x: n.x,
                y: n.y,
                floor: n.floor,
                business_id: business_ids.get(i).copied().flatten(),
            })
            .collect()
    }

    /// The edge table rows, in edge order. `node_ids[i]` is the id the
    /// table assigned node `i`.
    pub fn edge_rows(&self, node_ids: &[u64]) -> Vec<EdgeRow> {
        self.edges
            .iter()
            .map(|e| EdgeRow {
                edge_id: 0,
                node_a: node_ids[e.a as usize],
                node_b: node_ids[e.b as usize],
                kind: e.kind.code(),
                cost_milliminutes: e.cost.0,
            })
            .collect()
    }

    /// The inverse of the three row mappings: the graph and each node's
    /// business id, in the rows' order. Rows must be sorted by id, as a
    /// table scan returns them; a provision row naming an unknown node is
    /// `BadRows`.
    pub fn from_rows(
        nodes: &[NodeRow],
        edges: &[EdgeRow],
        provisions: &[ProvisionRow],
    ) -> Result<(MacroGraph, Vec<Option<u64>>), GraphError> {
        let mut index: BTreeMap<u64, u32> = BTreeMap::new();
        let mut out_nodes = Vec::with_capacity(nodes.len());
        let mut business = Vec::with_capacity(nodes.len());
        for (i, r) in nodes.iter().enumerate() {
            if index.insert(r.node_id, i as u32).is_some() {
                return Err(GraphError::BadRows);
            }
            let kind =
                NodeKind::from_code(r.kind).ok_or(GraphError::UnknownKind { code: r.kind })?;
            out_nodes.push(Node {
                kind,
                x: r.x,
                y: r.y,
                floor: r.floor,
                source: None,
            });
            business.push(r.business_id);
        }
        let mut out_edges = Vec::with_capacity(edges.len());
        for r in edges {
            let kind =
                EdgeKind::from_code(r.kind).ok_or(GraphError::UnknownKind { code: r.kind })?;
            let a = *index.get(&r.node_a).ok_or(GraphError::BadRows)?;
            let b = *index.get(&r.node_b).ok_or(GraphError::BadRows)?;
            out_edges.push(Edge {
                a,
                b,
                kind,
                cost: Milliminutes(r.cost_milliminutes),
            });
        }
        let mut out_provisions = Vec::with_capacity(provisions.len());
        for r in provisions {
            let node = *index.get(&r.node_id).ok_or(GraphError::BadRows)?;
            out_provisions.push(NodeProvision {
                node,
                provision: r.provision,
                quality: r.quality,
            });
        }
        out_provisions.sort_unstable();
        Ok((
            MacroGraph {
                nodes: out_nodes,
                edges: out_edges,
                provisions: out_provisions,
            },
            business,
        ))
    }
}

/// The centre of the largest room (first on a tie), snapped to the
/// nearest walkable floor cell: nearest by Manhattan distance, then row,
/// then column, among the cells whose walk from `entrance` through
/// [`corner`] is on walkable tiles (the edge's own post-condition).
/// `None` when no room has such a cell.
fn internal_cell(rooms: &[Rect], entrance: (i32, i32), walkability: &Floors) -> Option<(i32, i32)> {
    let from = Point {
        x: entrance.0,
        y: entrance.1,
        floor: 0,
    };
    let reachable = |x: i32, y: i32| {
        let to = Point { x, y, floor: 0 };
        corner(from, to).is_none_or(|c| {
            corner_cells(from, to, c).all(|(cx, cy)| walkable(walkability, 0, cx, cy))
        })
    };
    let mut order: Vec<&Rect> = rooms.iter().collect();
    order.sort_by_key(|r| std::cmp::Reverse(r.width() * r.height()));
    for r in order {
        let cx = r.x0 + (r.x1 - r.x0 - 1) / 2;
        let cy = r.y0 + (r.y1 - r.y0 - 1) / 2;
        let mut best: Option<(i64, i32, i32)> = None;
        for y in r.y0..r.y1 {
            for x in r.x0..r.x1 {
                if !walkable(walkability, 0, x, y) || !reachable(x, y) {
                    continue;
                }
                let d = (x - cx).abs() as i64 + (y - cy).abs() as i64;
                if best.is_none_or(|b| (d, y, x) < b) {
                    best = Some((d, y, x));
                }
            }
        }
        if let Some((_, y, x)) = best {
            return Some((x, y));
        }
    }
    None
}

#[cfg(test)]
mod tests;

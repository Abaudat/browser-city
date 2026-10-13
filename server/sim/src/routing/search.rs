//! The one route search (FR131, FR132): A* from one origin to the one
//! destination a decision chose. Pure -- a function of a [`GraphView`], two
//! node ids and [`Rates`]; no table, clock, cache or multi-target variant.

use std::cmp::Reverse;
use std::collections::{BTreeMap, BTreeSet, BinaryHeap};

use super::Point;
use super::estimate::{Correction, Rates, estimate};
use super::graph::{EdgeKind, EdgeRow, GraphError, MacroGraph, Node, NodeRow, corner};
use super::{Milliminutes, TransportMode};
use crate::actor_location::Waypoint;
use crate::balance;
use crate::generated::defs::BalanceSeed;

/// A node's stable id: the `route_node` row id, so the in-memory graph and
/// the table view agree.
pub type NodeId = u64;

/// What the search reads of a graph: a node by id and one node's edges.
pub trait GraphView {
    fn node(&self, id: NodeId) -> Option<Node>;
    /// Appends `(other end, kind, cost)` for every edge at `id`.
    fn neighbours(&self, id: NodeId, out: &mut Vec<(NodeId, EdgeKind, Milliminutes)>);
}

/// One single-floor stretch of a route, times in milliminutes from the
/// route's own start.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteLeg {
    pub waypoints: Vec<Waypoint>,
    pub t_depart: i64,
    pub t_arrive: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Route {
    pub legs: Vec<RouteLeg>,
    /// The nodes walked, origin first.
    pub nodes: Vec<NodeId>,
    pub cost: Milliminutes,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchError {
    UnknownNode(NodeId),
    Unreachable,
    BudgetExceeded,
}

/// The expansion ceiling (`routing.search.node_budget`).
pub fn node_budget(balance: &[BalanceSeed]) -> u32 {
    u32::try_from(balance::value(balance, "routing.search.node_budget"))
        .expect("bounded by the balance max")
}

type Parents = BTreeMap<NodeId, (NodeId, i64)>;

/// A* from `from` to the one `to`, optimal and deterministic.
///
/// The heuristic is the walking estimate between cells; every edge costs at
/// least that (the estimate is a metric, rounded up), so it is consistent
/// and a closed set is enough. The open set orders on `(f, h, node id)` and
/// neighbours are sorted by `(id, kind, cost)`: no iteration order of the
/// view reaches the result. Work is bounded by `budget` expansions.
pub fn search(
    graph: &impl GraphView,
    from: NodeId,
    to: NodeId,
    rates: &Rates,
    budget: u32,
) -> Result<Route, SearchError> {
    let origin = graph.node(from).ok_or(SearchError::UnknownNode(from))?;
    let goal = graph.node(to).ok_or(SearchError::UnknownNode(to))?;
    let h = |n: &Node| {
        estimate(
            rates,
            n.point(),
            goal.point(),
            TransportMode::Walk,
            Correction::NONE,
        )
        .0
    };

    let mut g_score: BTreeMap<NodeId, i64> = BTreeMap::new();
    let mut parent: Parents = BTreeMap::new();
    let mut closed: BTreeSet<NodeId> = BTreeSet::new();
    let mut open: BinaryHeap<Reverse<(i64, i64, NodeId)>> = BinaryHeap::new();
    g_score.insert(from, 0);
    let h0 = h(&origin);
    open.push(Reverse((h0, h0, from)));
    let mut expansions = 0u32;
    let mut batch = Vec::new();

    while let Some(Reverse((_, _, id))) = open.pop() {
        if !closed.insert(id) {
            continue;
        }
        let g = g_score[&id];
        if id == to {
            return Ok(assemble(graph, from, to, g, &parent));
        }
        expansions += 1;
        if expansions > budget {
            return Err(SearchError::BudgetExceeded);
        }
        batch.clear();
        graph.neighbours(id, &mut batch);
        batch.sort_unstable();
        for &(next, _, cost) in &batch {
            if closed.contains(&next) {
                continue;
            }
            let ng = g + cost.0;
            if g_score.get(&next).is_some_and(|&old| ng >= old) {
                continue;
            }
            // Only an improving edge costs a node lookup.
            let Some(n) = graph.node(next) else { continue };
            g_score.insert(next, ng);
            parent.insert(next, (id, cost.0));
            let hn = h(&n);
            open.push(Reverse((ng + hn, hn, next)));
        }
    }
    Err(SearchError::Unreachable)
}

/// The path as single-floor legs. A leg ends where the floor changes; the
/// portal edge's cost is the gap to the next leg's departure.
fn assemble(
    graph: &impl GraphView,
    from: NodeId,
    to: NodeId,
    total: i64,
    parent: &Parents,
) -> Route {
    let mut steps: Vec<(NodeId, i64)> = Vec::new(); // (node, edge cost into it)
    let mut at = to;
    while at != from {
        let (p, c) = parent[&at];
        steps.push((at, c));
        at = p;
    }
    steps.push((from, 0));
    steps.reverse();

    let wp = |id: NodeId| {
        let n = graph.node(id).expect("a path node is known");
        (n.x, n.y, n.floor)
    };
    let mut legs: Vec<RouteLeg> = Vec::new();
    let mut cumulative = 0i64;
    let mut prev = wp(from);
    let mut leg = RouteLeg {
        waypoints: vec![prev],
        t_depart: 0,
        t_arrive: 0,
    };
    for &(id, c) in &steps[1..] {
        let w = wp(id);
        cumulative += c;
        if w.2 != prev.2 {
            let next = RouteLeg {
                waypoints: vec![w],
                t_depart: cumulative,
                t_arrive: cumulative,
            };
            legs.push(std::mem::replace(&mut leg, next));
        } else {
            // A diagonal segment is walked at its straight-line length but
            // costed Manhattan: route through its axis-aligned corner (the
            // one rule, `graph::corner`, which `MacroGraph::check` holds
            // walkable) so the walked length is the costed one.
            let point = |t: Waypoint| Point {
                x: t.0,
                y: t.1,
                floor: t.2,
            };
            if let Some(c) = corner(point(prev), point(w)) {
                leg.waypoints.push((c.x, c.y, c.floor));
            }
            leg.waypoints.push(w);
            leg.t_arrive = cumulative;
        }
        prev = w;
    }
    legs.push(leg);
    Route {
        legs,
        nodes: steps.iter().map(|s| s.0).collect(),
        cost: Milliminutes(total),
    }
}

/// A [`MacroGraph`] with an id per node and per-node adjacency. Ids are the
/// table row ids ([`Self::from_rows`]) or the node indices
/// ([`Self::from_graph`]).
pub struct SearchGraph {
    nodes: Vec<Node>,
    ids: Vec<NodeId>,
    index: BTreeMap<NodeId, usize>,
    /// Per node index: `(other node index, kind, cost)`.
    adjacent: Vec<Vec<(usize, EdgeKind, Milliminutes)>>,
}

impl SearchGraph {
    pub fn from_graph(g: &MacroGraph) -> SearchGraph {
        let ids: Vec<NodeId> = (0..g.nodes().len() as u64).collect();
        Self::new(g, ids)
    }

    pub fn from_rows(nodes: &[NodeRow], edges: &[EdgeRow]) -> Result<SearchGraph, GraphError> {
        let (g, _) = MacroGraph::from_rows(nodes, edges)?;
        Ok(Self::new(&g, nodes.iter().map(|r| r.node_id).collect()))
    }

    fn new(g: &MacroGraph, ids: Vec<NodeId>) -> SearchGraph {
        let index = ids.iter().enumerate().map(|(i, &id)| (id, i)).collect();
        let mut adjacent = vec![Vec::new(); g.nodes().len()];
        for e in g.edges() {
            adjacent[e.a as usize].push((e.b as usize, e.kind, e.cost));
            adjacent[e.b as usize].push((e.a as usize, e.kind, e.cost));
        }
        SearchGraph {
            nodes: g.nodes().to_vec(),
            ids,
            index,
            adjacent,
        }
    }
}

impl GraphView for SearchGraph {
    fn node(&self, id: NodeId) -> Option<Node> {
        self.index.get(&id).map(|&i| self.nodes[i])
    }

    fn neighbours(&self, id: NodeId, out: &mut Vec<(NodeId, EdgeKind, Milliminutes)>) {
        if let Some(&i) = self.index.get(&id) {
            out.extend(
                self.adjacent[i]
                    .iter()
                    .map(|&(j, k, c)| (self.ids[j], k, c)),
            );
        }
    }
}

#[cfg(test)]
mod tests;

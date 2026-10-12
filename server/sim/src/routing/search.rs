//! The one route search (FR131, FR132): A* from one origin to the one
//! destination a decision chose. Pure -- a function of a [`GraphView`], two
//! node ids and [`Rates`]; no table, clock, cache or multi-target variant.

use super::Milliminutes;
use super::estimate::Rates;
use super::graph::{EdgeKind, EdgeRow, GraphError, MacroGraph, Node, NodeRow};
use crate::actor_location::Waypoint;

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

pub fn search(
    _graph: &impl GraphView,
    _from: NodeId,
    _to: NodeId,
    _rates: &Rates,
    _budget: u32,
) -> Result<Route, SearchError> {
    Err(SearchError::Unreachable)
}

/// A [`MacroGraph`] with an id per node and per-node adjacency.
pub struct SearchGraph;

impl SearchGraph {
    pub fn from_graph(_g: &MacroGraph) -> SearchGraph {
        SearchGraph
    }

    pub fn from_rows(_n: &[NodeRow], _e: &[EdgeRow]) -> Result<SearchGraph, GraphError> {
        Ok(SearchGraph)
    }
}

impl GraphView for SearchGraph {
    fn node(&self, _id: NodeId) -> Option<Node> {
        None
    }

    fn neighbours(&self, _id: NodeId, _out: &mut Vec<(NodeId, EdgeKind, Milliminutes)>) {}
}

#[cfg(test)]
mod tests;

//! The commute (FR4, FR6, FR7): one walking route search, converted to the
//! mode's speed and clamped to the floor. Pure; derived on demand, never
//! stored. A mode is a percent on the walking cost -- no second speed, no
//! per-mode graph. Citizens and players share this one function.

use super::estimate::{Correction, Rates, estimate};
use super::search::{GraphView, NodeId, SearchError, node_budget, search};
use super::{Milliminutes, TransportMode};
use crate::balance;
use crate::generated::defs::BalanceSeed;

impl Rates {
    /// A walking-mode cost as `mode` travels it: x walk percent / mode
    /// percent, rounded up so a faster mode never undercharges.
    pub fn in_mode(&self, walk_cost: Milliminutes, mode: TransportMode) -> Milliminutes {
        let num = walk_cost.0 as i128 * self.walk_percent as i128;
        let den = self.percent(mode) as i128;
        Milliminutes(
            i64::try_from((num + den - 1) / den).expect("a cost only shrinks, or grows <= 100x"),
        )
    }
}

/// The floor under every leg (`routing.commute.floor_minutes`), in
/// milliminutes. The one place the number is read.
pub fn floor(balance: &[BalanceSeed]) -> Milliminutes {
    Milliminutes(balance::value(balance, "routing.commute.floor_minutes") * 1000)
}

/// The opening commute target (`routing.commute.opening_minutes`).
pub fn opening_target(balance: &[BalanceSeed]) -> Milliminutes {
    Milliminutes(balance::value(balance, "routing.commute.opening_minutes") * 1000)
}

/// The clamp: the one line that enforces the floor.
fn clamped(cost: Milliminutes, floor: Milliminutes) -> Milliminutes {
    cost.max(floor)
}

/// A leg's figure from the walking cost of its route.
pub fn leg_from_cost(
    rates: &Rates,
    walk_cost: Milliminutes,
    mode: TransportMode,
    floor: Milliminutes,
) -> Milliminutes {
    clamped(rates.in_mode(walk_cost, mode), floor)
}

/// One commute leg `home` -> `work` by `mode`: one search, then the mode,
/// then the floor. Errors propagate unchanged.
pub fn leg(
    graph: &impl GraphView,
    home: NodeId,
    work: NodeId,
    rates: &Rates,
    mode: TransportMode,
    floor: Milliminutes,
    budget: u32,
) -> Result<Milliminutes, SearchError> {
    let route = search(graph, home, work, rates, budget)?;
    Ok(leg_from_cost(rates, route.cost, mode, floor))
}

/// Opening commute: the workplace among `workplaces` (node ids, the
/// caller's candidates) whose walking leg lands nearest the opening target.
/// Candidates are tried in order of `(|estimate - target|, node id)`, at
/// most `routing.commute.opening_max_candidates` of them, and the first
/// whose leg is within `routing.commute.opening_band_percent` of the target
/// wins; with none in band, the searched one nearest the target. Ties are by
/// node id only: spreading players over employers with open posts, and the
/// draw from the character id, are the hire's business. At most
/// `opening_max_candidates` searches, never one per workplace. Only
/// `Unreachable` skips a candidate; any other error reaches the caller.
/// Returns the node and the search's own figure.
pub fn opening_workplace(
    graph: &impl GraphView,
    home: NodeId,
    workplaces: &[NodeId],
    rates: &Rates,
    balance: &[BalanceSeed],
) -> Result<Option<(NodeId, Milliminutes)>, SearchError> {
    let target = opening_target(balance).0;
    let band = target * balance::value(balance, "routing.commute.opening_band_percent") / 100;
    let max = balance::value(balance, "routing.commute.opening_max_candidates") as usize;
    let fl = floor(balance);
    let budget = node_budget(balance);
    let origin = graph
        .node(home)
        .ok_or(SearchError::UnknownNode(home))?
        .point();
    let mut ranked: Vec<(i64, NodeId)> = Vec::with_capacity(workplaces.len());
    for w in workplaces {
        let n = graph.node(*w).ok_or(SearchError::UnknownNode(*w))?;
        let e = estimate(
            rates,
            origin,
            n.point(),
            TransportMode::Walk,
            Correction::NONE,
        )
        .0;
        ranked.push(((e - target).abs(), *w));
    }
    ranked.sort_unstable();
    let mut best: Option<(NodeId, Milliminutes)> = None;
    for (_, w) in ranked.into_iter().take(max) {
        let c = match leg(graph, home, w, rates, TransportMode::Walk, fl, budget) {
            Ok(c) => c,
            Err(SearchError::Unreachable) => continue,
            Err(e) => return Err(e),
        };
        if (c.0 - target).abs() <= band {
            return Ok(Some((w, c)));
        }
        if best.is_none_or(|(_, b)| (c.0 - target).abs() < (b.0 - target).abs()) {
            best = Some((w, c));
        }
    }
    Ok(best)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::defs;

    fn rates() -> Rates {
        Rates::from_balance(defs::BALANCE)
    }

    fn fl() -> Milliminutes {
        floor(defs::BALANCE)
    }

    fn m(min: i64) -> Milliminutes {
        Milliminutes(min * 1000)
    }

    fn lf(cost: Milliminutes, mode: TransportMode) -> Milliminutes {
        leg_from_cost(&rates(), cost, mode, fl())
    }

    #[test]
    fn the_ladder_rungs() {
        use TransportMode::*;
        assert_eq!(lf(m(60), Walk), m(60));
        assert_eq!(lf(m(60), Bike), m(30));
        assert_eq!(lf(m(60), Transit), m(20));
    }

    #[test]
    fn short_and_empty_routes_are_charged_the_floor() {
        use TransportMode::*;
        for mode in [Walk, Bike, Transit] {
            assert_eq!(lf(Milliminutes(182), mode), fl());
            assert_eq!(lf(Milliminutes(0), mode), fl());
        }
    }

    #[test]
    fn the_clamp_is_what_holds_the_floor() {
        // 60 minutes at 500% is 12 minutes: only the clamp holds the floor.
        let mut r = rates();
        r.transit_percent = 500;
        assert_eq!(r.in_mode(m(60), TransportMode::Transit), m(12));
        assert_eq!(leg_from_cost(&r, m(60), TransportMode::Transit, fl()), fl());
    }

    #[test]
    fn conversion_rounds_up() {
        let mut r = rates();
        r.bike_percent = 300;
        assert_eq!(r.in_mode(Milliminutes(100), TransportMode::Bike).0, 34);
        assert_eq!(r.in_mode(Milliminutes(99), TransportMode::Bike).0, 33);
        assert_eq!(r.in_mode(Milliminutes(1), TransportMode::Bike).0, 1);
    }

    use crate::routing::graph::{Edge, EdgeKind, MacroGraph, Node, NodeKind};
    use crate::routing::search::SearchGraph;
    use std::cell::Cell;

    /// 41 street nodes on a line, ten cells apart.
    fn line() -> MacroGraph {
        let nodes: Vec<Node> = (0..41)
            .map(|i| Node {
                kind: NodeKind::Street,
                x: i * 10,
                y: 0,
                floor: 0,
                source: None,
            })
            .collect();
        let edges = (0..40u32)
            .map(|i| Edge {
                a: i,
                b: i + 1,
                kind: EdgeKind::Street,
                cost: estimate(
                    &rates(),
                    nodes[i as usize].point(),
                    nodes[i as usize + 1].point(),
                    TransportMode::Walk,
                    Correction::NONE,
                ),
            })
            .collect();
        MacroGraph::from_parts(nodes, edges, vec![])
    }

    /// Counts searches: each one expands its origin exactly once.
    struct Counting<'a> {
        inner: SearchGraph,
        origin: NodeId,
        searches: &'a Cell<u32>,
    }

    impl GraphView for Counting<'_> {
        fn node(&self, id: NodeId) -> Option<Node> {
            self.inner.node(id)
        }
        fn neighbours(
            &self,
            id: NodeId,
            out: &mut Vec<(NodeId, crate::routing::graph::EdgeKind, Milliminutes)>,
        ) {
            if id == self.origin {
                self.searches.set(self.searches.get() + 1);
            }
            self.inner.neighbours(id, out)
        }
    }

    fn pick(works: &[NodeId]) -> (Result<Option<(NodeId, Milliminutes)>, SearchError>, u32) {
        let n = Cell::new(0);
        let g = Counting {
            inner: SearchGraph::from_graph(&line()),
            origin: 0,
            searches: &n,
        };
        let r = opening_workplace(&g, 0, works, &rates(), defs::BALANCE);
        (r, n.get())
    }

    #[test]
    fn an_in_band_first_candidate_costs_one_search() {
        let works: Vec<NodeId> = (1..=40).collect();
        let (r, searches) = pick(&works);
        let (_, cost) = r.unwrap().unwrap();
        assert_eq!(searches, 1);
        let band = balance::value(defs::BALANCE, "routing.commute.opening_band_percent");
        assert!((cost.0 - m(60).0).abs() <= m(60).0 * band / 100);
    }

    #[test]
    fn no_candidate_in_band_stops_at_the_cap_and_returns_the_nearest() {
        let works: Vec<NodeId> = (1..=20).collect();
        let (r, searches) = pick(&works);
        let cap = balance::value(defs::BALANCE, "routing.commute.opening_max_candidates") as u32;
        assert_eq!(searches, cap);
        assert_eq!(r.unwrap().unwrap().0, 20);
    }

    #[test]
    fn ties_break_on_node_id_and_the_input_order_is_irrelevant() {
        let a = pick(&[5, 3, 4]).0.unwrap();
        let b = pick(&[3, 4, 5]).0.unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn an_unknown_node_reaches_the_caller_and_no_workplace_is_none() {
        assert_eq!(pick(&[3, 999]).0, Err(SearchError::UnknownNode(999)));
        assert_eq!(pick(&[]).0, Ok(None));
    }
}

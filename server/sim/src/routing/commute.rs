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
    cost.max(floor).max(Milliminutes(1))
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

/// The opening workplace among `workplaces` (node ids): the walking leg
/// nearest the opening target; ties by lower node id. Candidates whose
/// estimate (a lower bound on the route) is over target x (100 +
/// `band_percent`) are not searched; if none is left, all are.
/// Unreachable candidates are skipped. Returns the node and the search's
/// own figure.
pub fn opening_workplace(
    graph: &impl GraphView,
    home: NodeId,
    workplaces: &[NodeId],
    rates: &Rates,
    balance: &[BalanceSeed],
    band_percent: i64,
) -> Option<(NodeId, Milliminutes)> {
    let target = opening_target(balance);
    let fl = floor(balance);
    let budget = node_budget(balance);
    let origin = graph.node(home)?.point();
    let limit = target.0 * (100 + band_percent) / 100;
    let near: Vec<NodeId> = workplaces
        .iter()
        .copied()
        .filter(|w| {
            graph.node(*w).is_some_and(|n| {
                estimate(
                    rates,
                    origin,
                    n.point(),
                    TransportMode::Walk,
                    Correction::NONE,
                )
                .0 <= limit
            })
        })
        .collect();
    let pool = if near.is_empty() { workplaces } else { &near };
    pool.iter()
        .filter_map(|w| {
            leg(graph, home, *w, rates, TransportMode::Walk, fl, budget)
                .ok()
                .map(|c| (*w, c))
        })
        .min_by_key(|(w, c)| ((c.0 - target.0).abs(), *w))
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
    fn the_floor_is_twenty_minutes_from_the_balance() {
        assert_eq!(fl(), m(20));
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

    #[test]
    fn a_zero_floor_still_charges_a_milliminute() {
        let l = leg_from_cost(
            &rates(),
            Milliminutes(0),
            TransportMode::Walk,
            Milliminutes(0),
        );
        assert_eq!(l.0, 1);
    }

    #[test]
    fn never_below_the_floor_and_monotone_in_speed() {
        let mut r = rates();
        for cost in [0i64, 1, 999, 20_000, 59_999, 60_000, 1_000_000, 123_456_789] {
            let mut prev = i64::MAX;
            for pct in 100..=500 {
                r.transit_percent = pct;
                let l = leg_from_cost(&r, Milliminutes(cost), TransportMode::Transit, fl()).0;
                assert!(l >= fl().0 && l <= prev, "cost {cost} pct {pct}");
                prev = l;
            }
            r.transit_percent = 100;
            let at_walk = leg_from_cost(&r, Milliminutes(cost), TransportMode::Transit, fl()).0;
            assert_eq!(at_walk, cost.max(fl().0));
        }
    }
}

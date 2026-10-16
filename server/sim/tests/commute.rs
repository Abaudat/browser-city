//! Story 7.2 (FR4, FR6, FR7): the commute. One walking search, converted to
//! the mode and clamped to the floor; the day it leaves; and the generated
//! district's own opening commute. Everything here is `sim`.

use sim::day;
use sim::generated::defs::{self, BALANCE};
use sim::generation::{GenerationConfig, GenerationContent, generate};
use sim::housing;
use sim::routing::commute::{self, leg, leg_from_cost, opening_workplace};
use sim::routing::estimate::{Correction, Rates, estimate};
use sim::routing::graph::{Edge, EdgeKind, MacroGraph, Node, NodeKind};
use sim::routing::search::{SearchGraph, node_budget, search};
use sim::routing::{Milliminutes, Point, TransportMode};
use sim::time::{CITY_MINUTES_PER_DAY, REAL_MS_PER_CITY_MINUTE};

const SEEDS: [u64; 5] = [1, 2, 3, 42, 123_456_789];

/// The `employment` provision code (`sim::codes::provision`).
const EMPLOYMENT: u32 = 1;

/// The band the opening commute must land in, in city minutes. Derek owns
/// the width.
const BAND_MINUTES: (i64, i64) = (50, 70);
/// The design's figures (GDD): the cells and the real seconds of 60 minutes.
const DESIGN_CELLS: i64 = 333;
const DESIGN_REAL_SECONDS: i64 = 151;
/// The prefilter band `opening_workplace` is asked for.
const OPENING_BAND_PERCENT: i64 = 20;

fn rates() -> Rates {
    Rates::from_balance(BALANCE)
}

fn bal(key: &str) -> i64 {
    sim::balance::value(BALANCE, key)
}

// --- AC1 ------------------------------------------------------------------

/// The walking estimate for the design's 333 cells is 60 city minutes and
/// 151 real seconds -- derived from the balance, so a change to the walk
/// speed, the ladder or the clock fails here.
#[test]
fn the_design_commute_is_sixty_minutes_and_151_real_seconds() {
    let walk = estimate(
        &rates(),
        Point {
            x: 0,
            y: 0,
            floor: 0,
        },
        Point {
            x: DESIGN_CELLS as i32,
            y: 0,
            floor: 0,
        },
        TransportMode::Walk,
        Correction::NONE,
    );
    let target_ms = bal("routing.commute.opening_minutes") * 1000;
    assert!((walk.0 - target_ms).abs() <= 1000, "{} ms", walk.0);
    let real_s = walk.0 * REAL_MS_PER_CITY_MINUTE / 1000 / 1000;
    assert!((real_s - DESIGN_REAL_SECONDS).abs() <= 2, "{real_s} s");
}

/// A route's cost in real milliseconds is its walked cells over the walk
/// speed the client moves at, within the estimate's own rounding.
#[test]
fn route_cost_in_real_ms_is_cells_over_the_walk_speed() {
    let cells = DESIGN_CELLS;
    let walk = estimate(
        &rates(),
        Point {
            x: 0,
            y: 0,
            floor: 0,
        },
        Point {
            x: cells as i32,
            y: 0,
            floor: 0,
        },
        TransportMode::Walk,
        Correction::NONE,
    );
    let real_ms = walk.0 * REAL_MS_PER_CITY_MINUTE / 1000;
    let speed =
        bal("movement.walk_speed_millicells_per_s") * bal("routing.speed_percent.walk") / 100;
    let walked_ms = cells * 1_000_000 / speed;
    assert!((real_ms - walked_ms).abs() <= 3, "{real_ms} vs {walked_ms}");
}

struct Opening {
    cells: i64,
    cost: Milliminutes,
}

/// The opening commute of `seed`: from the entrance node of the flat the
/// first character is let (lowest [`housing::Home::rank`]) to the workplace
/// `opening_workplace` picks.
fn opening(seed: u64) -> Opening {
    let cfg = GenerationConfig::from_balance(BALANCE).unwrap();
    let content = GenerationContent::committed();
    let (district, _) = generate(seed, &cfg, &content).unwrap();
    let graph: MacroGraph = district.graph(&cfg, &content).unwrap();
    let dwellings = housing::dwellings(&district, &cfg, &content, BALANCE);
    let flat = dwellings
        .iter()
        .min_by_key(|d| (d.home.rank(), d.home.id))
        .expect("a district has a dwelling");
    let node_of = |plot: u32| {
        graph
            .nodes()
            .iter()
            .position(|n| n.kind == NodeKind::Source && n.source.is_some_and(|s| s.plot == plot))
    };
    let home = node_of(flat.plot).expect("a dwelling has an entrance node") as u64;
    let works: Vec<u64> = (0..graph.nodes().len() as u32)
        .filter(|n| graph.advertises(*n, EMPLOYMENT))
        .map(u64::from)
        .collect();
    assert!(!works.is_empty(), "seed {seed}: no workplace");
    let view = SearchGraph::from_graph(&graph);
    let (work, cost) =
        opening_workplace(&view, home, &works, &rates(), BALANCE, OPENING_BAND_PERCENT)
            .expect("a generated graph is connected");
    let route = search(&view, home, work, &rates(), node_budget(BALANCE)).unwrap();
    assert_eq!(
        cost,
        leg(
            &view,
            home,
            work,
            &rates(),
            TransportMode::Walk,
            commute::floor(BALANCE),
            node_budget(BALANCE)
        )
        .unwrap()
    );
    let pts: Vec<Point> = route
        .nodes
        .iter()
        .map(|n| graph.nodes()[*n as usize].point())
        .collect();
    let cells = pts
        .windows(2)
        .map(|w| ((w[0].x - w[1].x).abs() + (w[0].y - w[1].y).abs()) as i64)
        .sum();
    Opening { cells, cost }
}

/// The generated district delivers the opening commute: a workplace whose
/// walking leg from the first flat is within the band, over roughly the
/// design's cells and real seconds.
#[test]
fn the_generated_district_delivers_the_opening_commute() {
    for seed in SEEDS {
        let o = opening(seed);
        let minutes = o.cost.0 / 1000;
        assert!(
            (BAND_MINUTES.0..=BAND_MINUTES.1).contains(&minutes),
            "seed {seed}: {minutes} min"
        );
        assert!(
            (o.cells - DESIGN_CELLS).abs() * 100 <= DESIGN_CELLS * 15,
            "seed {seed}: {} cells",
            o.cells
        );
        let real_s = o.cost.0 * REAL_MS_PER_CITY_MINUTE / 1_000_000;
        assert!(
            (real_s - DESIGN_REAL_SECONDS).abs() * 100 <= DESIGN_REAL_SECONDS * 15,
            "seed {seed}: {real_s} s"
        );
    }
}

/// Per seed: the opening commute's cost in milliminutes. A move is a
/// generation or search change; re-bless deliberately with
/// `COMMUTE_PRINT_GOLDEN=1 cargo test -p sim --test commute -- --nocapture`.
const OPENING_COSTS: [(u64, i64); 5] = [
    (1, 59_831),
    (2, 60_020),
    (3, 59_834),
    (42, 59_834),
    (123_456_789, 60_201),
];

#[test]
fn opening_commute_matches_committed_figures() {
    let print = std::env::var_os("COMMUTE_PRINT_GOLDEN").is_some();
    for (seed, cost) in OPENING_COSTS {
        let got = opening(seed).cost.0;
        if print {
            println!("commute-golden ({seed}, {got}),");
        } else {
            assert_eq!(got, cost, "seed {seed}: the opening commute moved");
        }
    }
}

// --- AC2 ------------------------------------------------------------------

#[test]
fn two_legs_fill_the_commute_block_and_own_time_is_derived() {
    for seed in SEEDS {
        let leg = opening(seed).cost;
        let blocks = bal("day.sleep_minutes") + bal("day.shift_minutes");
        let own = day::own_time(BALANCE, leg).0;
        assert_eq!(blocks * 1000 + 2 * leg.0 + own, CITY_MINUTES_PER_DAY * 1000);
    }
    let target = commute::opening_target(BALANCE);
    let own = day::own_time(BALANCE, target).0 / 1000;
    assert_eq!(own, 360);
    let commute_block = 2 * target.0 / 1000;
    assert!((commute_block - 120).abs() <= 2);
}

// --- AC3 / AC4 -------------------------------------------------------------

fn lattice() -> MacroGraph {
    let node = |x: i32| Node {
        kind: NodeKind::Street,
        x,
        y: 0,
        floor: 0,
        source: None,
    };
    let nodes: Vec<Node> = (0..4).map(|i| node(i * 110)).collect();
    let edges: Vec<Edge> = (0..3u32)
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

/// One search; every mode is the same route cost x 100 / percent, rounded
/// up, then the floor.
#[test]
fn every_mode_is_one_search_scaled_by_its_percent() {
    let g = lattice();
    let view = SearchGraph::from_graph(&g);
    let r = rates();
    let fl = commute::floor(BALANCE);
    let walk = search(&view, 0, 3, &r, node_budget(BALANCE)).unwrap().cost;
    for mode in TransportMode::ALL {
        let pct = r.percent(mode);
        let want = Milliminutes((walk.0 * 100 + pct - 1) / pct).max(fl);
        let got = leg(&view, 0, 3, &r, mode, fl, node_budget(BALANCE)).unwrap();
        assert_eq!(got, want, "{mode:?}");
        assert_eq!(got, leg_from_cost(&r, walk, mode, fl));
    }
}

/// A route of no length is still charged the floor.
#[test]
fn a_zero_length_route_is_charged_the_floor() {
    let g = lattice();
    let view = SearchGraph::from_graph(&g);
    for mode in TransportMode::ALL {
        let got = leg(
            &view,
            2,
            2,
            &rates(),
            mode,
            commute::floor(BALANCE),
            node_budget(BALANCE),
        );
        assert_eq!(got, Ok(commute::floor(BALANCE)));
    }
}

#[test]
fn search_errors_propagate_unchanged() {
    let g = lattice();
    let view = SearchGraph::from_graph(&g);
    let e = leg(
        &view,
        0,
        99,
        &rates(),
        TransportMode::Walk,
        commute::floor(BALANCE),
        100,
    );
    assert_eq!(e, Err(sim::routing::search::SearchError::UnknownNode(99)));
}

#[test]
fn the_balance_floor_is_the_twenty_minutes_the_gdd_names() {
    let f = defs::BALANCE
        .iter()
        .find(|b| b.key == "routing.commute.floor_minutes")
        .unwrap();
    assert_eq!((f.value, f.min), (20, 1));
    assert_eq!(commute::floor(BALANCE).0, 20_000);
}

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
use sim::time::REAL_MS_PER_CITY_MINUTE;

const SEEDS: [u64; 5] = [1, 2, 3, 42, 123_456_789];

use sim::codes::provision::EMPLOYMENT;

/// The design's figures (GDD): the cells and the real seconds of 60 minutes.
const DESIGN_CELLS: i64 = 333;
const DESIGN_REAL_SECONDS: i64 = 151;

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
    /// Whether the flat is in the best rank group: the first a new player is let.
    first_group: bool,
    cells: i64,
    cost: Milliminutes,
}

/// The opening commute from every edge-tier dwelling of `seed` (each is
/// some player's starting flat as the district fills): from its entrance
/// node to the workplace `opening_workplace` picks among the businesses
/// whose building type employs the opening profession.
fn compute_openings(seed: u64) -> Vec<Opening> {
    let cfg = GenerationConfig::from_balance(BALANCE).unwrap();
    let content = GenerationContent::committed();
    let (district, _) = generate(seed, &cfg, &content).unwrap();
    let graph: MacroGraph = district.graph(&cfg, &content).unwrap();
    let dwellings = housing::dwellings(&district, &cfg, &content, BALANCE);
    let profession_id = bal("routing.commute.opening_profession_id") as u32;
    let profession = defs::PROFESSIONS
        .iter()
        .find(|p| p.id == profession_id)
        .expect("the opening profession exists")
        .key;
    let employs: Vec<u32> = content
        .building_types
        .iter()
        .filter(|b| b.professions.contains(&profession))
        .map(|b| b.id)
        .collect();
    let plots_employing: Vec<u32> = district
        .skeleton
        .building_types
        .assignments()
        .iter()
        .filter(|a| employs.contains(&a.building_type))
        .map(|a| a.plot)
        .collect();
    let node_of = |plot: u32| {
        graph
            .nodes()
            .iter()
            .position(|n| n.kind == NodeKind::Source && n.source.is_some_and(|s| s.plot == plot))
    };
    let works: Vec<u64> = plots_employing
        .iter()
        .filter_map(|p| node_of(*p))
        .filter(|n| graph.advertises(*n as u32, EMPLOYMENT))
        .map(|n| n as u64)
        .collect();
    assert!(!works.is_empty(), "seed {seed}: no opening workplace");
    let view = SearchGraph::from_graph(&graph);
    let best = dwellings.iter().map(|d| d.home.rank()).min().unwrap();
    let mut out = Vec::new();
    for d in dwellings
        .iter()
        .filter(|d| d.home.tier == housing::Tier::Edge)
    {
        let home = node_of(d.plot).expect("a dwelling has an entrance node") as u64;
        let (work, cost) = opening_workplace(&view, home, &works, &rates(), BALANCE)
            .unwrap()
            .expect("a generated graph is connected");
        let route = search(&view, home, work, &rates(), node_budget(BALANCE)).unwrap();
        assert_eq!(cost, route.cost);
        let pts: Vec<Point> = route
            .nodes
            .iter()
            .map(|n| graph.nodes()[*n as usize].point())
            .collect();
        let cells = pts
            .windows(2)
            .map(|w| ((w[0].x - w[1].x).abs() + (w[0].y - w[1].y).abs()) as i64)
            .sum();
        out.push(Opening {
            first_group: d.home.rank() == best,
            cells,
            cost,
        });
    }
    assert!(!out.is_empty(), "seed {seed}: no edge dwelling");
    out
}

/// Every seed's openings, computed once (in parallel) and shared by the
/// tests that read them: the generation is the cost.
fn openings(seed: u64) -> &'static [Opening] {
    static ALL: std::sync::OnceLock<Vec<(u64, Vec<Opening>)>> = std::sync::OnceLock::new();
    let all = ALL.get_or_init(|| {
        std::thread::scope(|s| {
            let hs: Vec<_> = SEEDS
                .iter()
                .map(|seed| s.spawn(move || (*seed, compute_openings(*seed))))
                .collect();
            hs.into_iter().map(|h| h.join().unwrap()).collect()
        })
    });
    &all.iter()
        .find(|(s, _)| *s == seed)
        .expect("a committed seed")
        .1
}

fn in_band(o: &Opening) -> bool {
    let target = bal("routing.commute.opening_minutes") * 1000;
    let band = target * bal("routing.commute.opening_band_percent") / 100;
    (o.cost.0 - target).abs() <= band
}

/// The share of edge flats that must reach the opening band. A finding, not
/// a tolerance: the seeds under it are reported to Derek and Tim on the
/// issue, and the band itself is `routing.commute.opening_band_percent`.
const MIN_IN_BAND_PERCENT: usize = 85;

/// The generated district delivers the opening commute from the edge
/// flats: most land within the balance band of the opening minutes, those
/// that do over roughly the design's cells and real seconds. Per-seed
/// counts are committed below.
#[test]
fn the_generated_district_delivers_the_opening_commute() {
    for seed in SEEDS {
        let all = openings(seed);
        let banded: Vec<&Opening> = all.iter().filter(|o| in_band(o)).collect();
        assert!(
            banded.len() * 100 >= all.len() * MIN_IN_BAND_PERCENT,
            "seed {seed}: {} of {} edge flats in band",
            banded.len(),
            all.len()
        );
        assert!(
            all.iter().any(|o| o.first_group && in_band(o)),
            "seed {seed}: no first-group flat in band"
        );
        for o in banded {
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
}

/// Per seed over every edge dwelling: (dwellings, dwellings in band, least
/// cost, greatest cost) of the opening commute in milliminutes. A move is a
/// generation or search change; re-bless deliberately with
/// `COMMUTE_PRINT_GOLDEN=1 cargo test -p sim --test commute -- --nocapture`.
const OPENING_COSTS: [(u64, usize, usize, i64, i64); 5] = [
    (1, 189, 184, 57_107, 73_839),
    (2, 162, 156, 57_648, 70_924),
    (3, 190, 178, 58_198, 76_935),
    (42, 171, 153, 58_557, 76_384),
    (123_456_789, 162, 162, 57_285, 65_836),
];

#[test]
fn opening_commute_matches_committed_figures() {
    let print = std::env::var_os("COMMUTE_PRINT_GOLDEN").is_some();
    for (seed, count, banded, lo, hi) in OPENING_COSTS {
        let o = openings(seed);
        let got = (
            o.len(),
            o.iter().filter(|x| in_band(x)).count(),
            o.iter().map(|x| x.cost.0).min().unwrap(),
            o.iter().map(|x| x.cost.0).max().unwrap(),
        );
        if print {
            println!(
                "commute-golden ({seed}, {}, {}, {}, {}),",
                got.0, got.1, got.2, got.3
            );
        } else {
            assert_eq!(
                got,
                (count, banded, lo, hi),
                "seed {seed}: the opening commute moved"
            );
        }
    }
}

#[test]
fn the_opening_profession_id_names_the_cashier() {
    let id = bal("routing.commute.opening_profession_id") as u32;
    let p = defs::PROFESSIONS.iter().find(|p| p.id == id).unwrap();
    assert_eq!(p.key, "cashier");
}

// --- AC2 ------------------------------------------------------------------

#[test]
fn two_legs_fill_the_commute_block_and_own_time_is_derived() {
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

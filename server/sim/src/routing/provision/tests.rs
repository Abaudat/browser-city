use super::*;
use crate::codes::provision as code;
use crate::generated::defs;
use crate::routing::graph::{Node, NodeKind, NodeProvision, SourceRef};
use proptest::prelude::*;

fn dial() -> QualityDial {
    QualityDial::from_balance(defs::BALANCE)
}

fn rates() -> Rates {
    Rates::from_balance(defs::BALANCE)
}

fn minutes(m: i64) -> Milliminutes {
    Milliminutes(m * 1000)
}

fn query(radius_minutes: i64, max_results: u32) -> ProvisionQuery {
    ProvisionQuery {
        rates: rates(),
        radius: minutes(radius_minutes),
        max_results,
    }
}

const WALK: TransportMode = TransportMode::Walk;

fn source(x: i32, y: i32, floor: i8, plot: u32) -> Node {
    Node {
        kind: NodeKind::Source,
        x,
        y,
        floor,
        source: Some(SourceRef { plot }),
    }
}

type Row<'a> = (i32, i32, i8, &'a [(u32, u32)], Option<u64>);

/// A table of hand-placed sources: `(x, y, floor, provisions, business)`.
/// Node ids are 1000 + index, so an id is never an index by accident.
fn table(rows: &[Row]) -> ProvisionTable {
    let nodes: Vec<Node> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| source(r.0, r.1, r.2, i as u32))
        .collect();
    let mut provisions = Vec::new();
    for (i, r) in rows.iter().enumerate() {
        for &(p, q) in r.3 {
            provisions.push(NodeProvision {
                node: i as u32,
                provision: p,
                quality: q,
            });
        }
    }
    let graph = MacroGraph::from_parts(nodes, Vec::new(), provisions);
    let ids: Vec<u64> = (0..rows.len() as u64).map(|i| 1000 + i).collect();
    let business: Vec<Option<u64>> = rows.iter().map(|r| r.4).collect();
    ProvisionTable::from_graph(&graph, &ids, &business)
}

fn origin(x: i32, y: i32, floor: i8) -> Point {
    Point { x, y, floor }
}

fn est(q: &ProvisionQuery, mode: TransportMode, o: Point, p: Point) -> Milliminutes {
    estimate(&q.rates, o, p, mode, Correction::NONE)
}

const FOOD50: &[(u32, u32)] = &[(code::FOOD, 50)];

// ---- AC2: rows, many per venue ----

#[test]
fn one_venue_with_two_provisions_answers_two_queries() {
    let t = table(&[(10, 0, 0, &[(code::FOOD, 60), (code::SOCIAL, 70)], None)]);
    let q = query(20, 8);
    let food = near(&t, origin(0, 0, 0), &[0], code::FOOD, WALK, &q);
    let social = near(&t, origin(0, 0, 0), &[0], code::SOCIAL, WALK, &q);
    assert_eq!(food.len(), 1);
    assert_eq!(social.len(), 1);
    assert_eq!(food[0].node_id, social[0].node_id);
    assert_eq!((food[0].quality, social[0].quality), (60, 70));
    assert!(near(&t, origin(0, 0, 0), &[0], code::REST, WALK, &q).is_empty());
}

#[test]
fn a_provision_nobody_offers_is_empty_not_a_panic() {
    let t = table(&[]);
    assert!(near(&t, origin(0, 0, 0), &[0], code::FOOD, WALK, &query(20, 8)).is_empty());
}

// ---- AC1: every source within R minutes, nearest first ----

#[test]
fn nearer_in_minutes_wins_even_when_further_in_cells() {
    // 20 cells off on this floor; the other is 5 cells off but on another
    // floor, whose change penalty makes it dearer in minutes.
    let t = table(&[(5, 0, 1, FOOD50, None), (20, 0, 0, FOOD50, None)]);
    let q = query(20, 8);
    let hits = near(&t, origin(0, 0, 0), &[0, 1], code::FOOD, WALK, &q);
    let a = est(&q, WALK, origin(0, 0, 0), origin(5, 0, 1));
    let b = est(&q, WALK, origin(0, 0, 0), origin(20, 0, 0));
    assert_ne!(a, b);
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].estimate, a.min(b));
}

#[test]
fn a_tie_breaks_on_node_id() {
    let t = table(&[
        (10, 0, 0, &[(code::FOOD, 50)], None),
        (-10, 0, 0, &[(code::FOOD, 90)], None),
        (0, 10, 0, &[(code::FOOD, 10)], None),
    ]);
    let hits = near(&t, origin(0, 0, 0), &[0], code::FOOD, WALK, &query(20, 8));
    let ids: Vec<u64> = hits.iter().map(|h| h.node_id).collect();
    assert_eq!(ids, vec![1000, 1001, 1002]);
}

#[test]
fn the_radius_is_minutes_and_the_limit_is_respected() {
    let rows: Vec<Row> = (0..10).map(|i| (i * 40, 0, 0, FOOD50, None)).collect();
    let t = table(&rows);
    let o = origin(0, 0, 0);
    // 40 cells is about 7.3 minutes on foot, 80 about 14.5.
    let ids = |r: i64| -> Vec<u64> {
        near(&t, o, &[0], code::FOOD, WALK, &query(r, 100))
            .iter()
            .map(|h| h.node_id)
            .collect()
    };
    assert_eq!(ids(0), vec![1000]);
    assert_eq!(ids(10), vec![1000, 1001]);
    assert_eq!(ids(600).len(), 10);
    assert_eq!(near(&t, o, &[0], code::FOOD, WALK, &query(600, 3)).len(), 3);
}

#[test]
fn a_faster_mode_widens_the_same_radius() {
    let t = table(&[(100, 0, 0, FOOD50, None)]);
    let q = query(10, 8);
    let o = origin(0, 0, 0);
    assert!(near(&t, o, &[0], code::FOOD, TransportMode::Walk, &q).is_empty());
    assert_eq!(
        near(&t, o, &[0], code::FOOD, TransportMode::Transit, &q).len(),
        1
    );
}

#[test]
fn a_source_just_outside_a_chunk_window_is_not_beaten_by_one_in_the_far_corner() {
    // The origin sits on the west edge of its chunk, so a window sized in
    // chunks around it reaches far less to the west than to the east. The
    // source 120 cells west is nearer than the one 130 cells north-east.
    let q = query(25, 1);
    let t = table(&[
        (100, 30, 0, FOOD50, None), // 130 cells away
        (-120, 0, 0, FOOD50, None), // 120 cells away
    ]);
    let hits = near(&t, origin(0, 0, 0), &[0], code::FOOD, WALK, &q);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].node_id, 1001);
}

#[test]
fn the_query_visits_chunks_not_rows() {
    let rows: Vec<Row> = (0..200).map(|i| (i * 40, 0, 0, FOOD50, None)).collect();
    let t = table(&rows);
    t.reset_visits();
    near(&t, origin(0, 0, 0), &[0], code::FOOD, WALK, &query(10, 100));
    // 10 minutes is under 60 cells: at most four chunks a side.
    assert!(t.chunk_visits() <= 16, "visited {}", t.chunk_visits());
}

// ---- AC4: the business id comes with the hit ----

#[test]
fn a_hit_carries_its_nodes_business_id() {
    let t = table(&[
        (5, 0, 0, &[(code::EMPLOYMENT, 50)], Some(77)),
        (9, 0, 0, &[(code::REST, 50)], None),
    ]);
    let q = query(20, 8);
    let work = near(&t, origin(0, 0, 0), &[0], code::EMPLOYMENT, WALK, &q);
    assert_eq!(work[0].business_id, Some(77));
    let rest = near(&t, origin(0, 0, 0), &[0], code::REST, WALK, &q);
    assert_eq!(rest[0].business_id, None);
}

#[test]
fn the_hit_node_id_is_a_node_the_search_accepts() {
    let t = table(&[(5, 0, 0, FOOD50, None)]);
    let h = &near(&t, origin(0, 0, 0), &[0], code::FOOD, WALK, &query(20, 8))[0];
    assert!(ProvisionView::node(&t, h.node_id).is_some());
}

// ---- AC3: quality ----

#[test]
fn quality_is_clamped_and_moves_with_affluence() {
    let d = dial();
    let mid = (d.affluence_min + d.affluence_max) / 2;
    assert_eq!(quality(50, mid, &d), 50);
    assert!(quality(50, d.affluence_max, &d) > 50);
    assert!(quality(50, d.affluence_min, &d) < 50);
    assert_eq!(quality(100, d.affluence_max, &d), 100);
    assert_eq!(quality(0, d.affluence_min, &d), 0);
    assert_eq!(
        quality(50, d.affluence_max + 1000, &d),
        quality(50, d.affluence_max, &d)
    );
    assert_eq!(
        quality(50, d.affluence_min - 1000, &d),
        quality(50, d.affluence_min, &d)
    );
}

fn edge_biased() -> impl Strategy<Value = i32> {
    prop_oneof![
        -35i32..=-29,
        -3i32..=3,
        29i32..=35,
        61i32..=67,
        -200i32..200
    ]
}

proptest! {
    #[test]
    fn quality_stays_in_range_and_never_falls_as_affluence_rises(
        base in 0u32..=100, a in -50i32..=150, b in -50i32..=150
    ) {
        let d = dial();
        let (lo, hi) = (a.min(b), a.max(b));
        prop_assert!(quality(base, lo, &d) <= quality(base, hi, &d));
        prop_assert!(quality(base, hi, &d) <= 100);
    }

    /// The oracle has no chunk logic: every row on the floors, kept when
    /// its estimate is within the radius, sorted, truncated.
    #[test]
    fn near_equals_a_scan_of_every_row(
        pts in proptest::collection::vec((edge_biased(), edge_biased(), 0i8..2), 1..40),
        ox in edge_biased(), oy in edge_biased(), radius in 0i64..40, limit in 1u32..10,
        mode in prop_oneof![
            Just(TransportMode::Walk), Just(TransportMode::Bike), Just(TransportMode::Transit)
        ],
    ) {
        let rows: Vec<Row> = pts.iter().map(|&(x, y, f)| (x, y, f, FOOD50, None)).collect();
        let t = table(&rows);
        let q = query(radius, limit);
        let o = origin(ox, oy, 0);
        let got = near(&t, o, &[0, 1], code::FOOD, mode, &q);
        let mut want: Vec<(Milliminutes, u64)> = pts.iter().enumerate()
            .map(|(i, &(x, y, f))| (est(&q, mode, o, origin(x, y, f)), 1000 + i as u64))
            .filter(|(e, _)| *e <= q.radius)
            .collect();
        want.sort();
        want.truncate(limit as usize);
        let got: Vec<(Milliminutes, u64)> = got.iter().map(|h| (h.estimate, h.node_id)).collect();
        prop_assert_eq!(got, want);
    }
}

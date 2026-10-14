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

fn query(radius_chunks: u32, max_results: u32) -> ProvisionQuery {
    ProvisionQuery {
        rates: rates(),
        radius_chunks,
        max_results,
    }
}

fn source(x: i32, y: i32, floor: i8, plot: u32) -> Node {
    Node {
        kind: NodeKind::Source,
        x,
        y,
        floor,
        source: Some(SourceRef {
            plot,
            workplace: false,
        }),
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
    let graph = MacroGraph::from_parts_with_provisions(nodes, Vec::new(), provisions);
    let ids: Vec<u64> = (0..rows.len() as u64).map(|i| 1000 + i).collect();
    let business: Vec<Option<u64>> = rows.iter().map(|r| r.4).collect();
    ProvisionTable::from_graph(&graph, &ids, &business)
}

fn origin(x: i32, y: i32, floor: i8) -> Point {
    Point { x, y, floor }
}

const FOOD50: &[(u32, u32)] = &[(code::FOOD, 50)];

// ---- AC2: rows, many per venue ----

#[test]
fn one_venue_with_two_provisions_answers_two_queries() {
    let t = table(&[(10, 0, 0, &[(code::FOOD, 60), (code::SOCIAL, 70)], None)]);
    let q = query(2, 8);
    let food = near(&t, origin(0, 0, 0), &[0], code::FOOD, &q);
    let social = near(&t, origin(0, 0, 0), &[0], code::SOCIAL, &q);
    assert_eq!(food.len(), 1);
    assert_eq!(social.len(), 1);
    assert_eq!(food[0].node_id, social[0].node_id);
    assert_eq!((food[0].quality, social[0].quality), (60, 70));
    assert!(near(&t, origin(0, 0, 0), &[0], code::REST, &q).is_empty());
}

#[test]
fn a_provision_nobody_offers_is_empty_not_a_panic() {
    let t = table(&[]);
    assert!(near(&t, origin(0, 0, 0), &[0], code::FOOD, &query(2, 8)).is_empty());
}

// ---- AC1: nearest in minutes, deterministic ----

#[test]
fn nearer_in_minutes_wins_even_when_further_in_cells() {
    // 20 cells off on this floor; the other is 5 cells off but on another
    // floor, whose change penalty makes it dearer in minutes.
    let t = table(&[(5, 0, 1, FOOD50, None), (20, 0, 0, FOOD50, None)]);
    let hits = near(&t, origin(0, 0, 0), &[0, 1], code::FOOD, &query(2, 8));
    let est = |p: Point| {
        estimate(
            &rates(),
            origin(0, 0, 0),
            p,
            TransportMode::Walk,
            Correction::NONE,
        )
    };
    assert_eq!(hits.len(), 2);
    let best = est(origin(5, 0, 1)).min(est(origin(20, 0, 0)));
    assert_eq!(hits[0].estimate, best);
    assert!(hits[0].estimate <= hits[1].estimate);
    assert_ne!(est(origin(5, 0, 1)), est(origin(20, 0, 0)));
}

#[test]
fn a_tie_breaks_on_node_id() {
    let t = table(&[
        (10, 0, 0, &[(code::FOOD, 50)], None),
        (-10, 0, 0, &[(code::FOOD, 90)], None),
        (0, 10, 0, &[(code::FOOD, 10)], None),
    ]);
    let hits = near(&t, origin(0, 0, 0), &[0], code::FOOD, &query(2, 8));
    let ids: Vec<u64> = hits.iter().map(|h| h.node_id).collect();
    assert_eq!(ids, vec![1000, 1001, 1002]);
}

#[test]
fn the_limit_and_the_radius_are_respected() {
    let rows: Vec<Row> = (0..10).map(|i| (i * 40, 0, 0, FOOD50, None)).collect();
    let t = table(&rows);
    assert_eq!(
        near(&t, origin(0, 0, 0), &[0], code::FOOD, &query(64, 3)).len(),
        3
    );
    // Radius 0 sees only the origin's own chunk.
    let own = near(&t, origin(0, 0, 0), &[0], code::FOOD, &query(0, 100));
    assert_eq!(own.iter().map(|h| h.node_id).collect::<Vec<_>>(), vec![1000]);
}

#[test]
fn the_query_visits_chunks_not_rows() {
    let rows: Vec<Row> = (0..200).map(|i| (i * 40, 0, 0, FOOD50, None)).collect();
    let t = table(&rows);
    t.reset_visits();
    near(&t, origin(0, 0, 0), &[0], code::FOOD, &query(1, 100));
    assert!(t.chunk_visits() <= 9, "visited {}", t.chunk_visits());
}

// ---- AC4: the business id comes with the hit ----

#[test]
fn a_hit_carries_its_nodes_business_id() {
    let t = table(&[
        (5, 0, 0, &[(code::EMPLOYMENT, 50)], Some(77)),
        (9, 0, 0, &[(code::REST, 50)], None),
    ]);
    let q = query(2, 8);
    let work = near(&t, origin(0, 0, 0), &[0], code::EMPLOYMENT, &q);
    assert_eq!(work[0].business_id, Some(77));
    let rest = near(&t, origin(0, 0, 0), &[0], code::REST, &q);
    assert_eq!(rest[0].business_id, None);
}

#[test]
fn the_hit_node_id_is_a_node_the_search_accepts() {
    let t = table(&[(5, 0, 0, FOOD50, None)]);
    let h = &near(&t, origin(0, 0, 0), &[0], code::FOOD, &query(2, 8))[0];
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

    #[test]
    fn near_equals_a_brute_force_scan(
        pts in proptest::collection::vec((-200i32..200, -200i32..200, 0i8..2), 1..40),
        ox in -100i32..100, oy in -100i32..100, radius in 0u32..4, limit in 1u32..10,
    ) {
        let rows: Vec<Row> = pts.iter().map(|&(x, y, f)| (x, y, f, FOOD50, None)).collect();
        let t = table(&rows);
        let q = query(radius, limit);
        let got = near(&t, origin(ox, oy, 0), &[0, 1], code::FOOD, &q);
        let mut want: Vec<(Milliminutes, u64)> = pts.iter().enumerate()
            .filter(|&(_, &(x, y, _))| {
                let r = radius as i32;
                (chunk_of(x) - chunk_of(ox)).abs() <= r
                    && (chunk_of(y) - chunk_of(oy)).abs() <= r
            })
            .map(|(i, &(x, y, f))| (
                estimate(&q.rates, origin(ox, oy, 0), origin(x, y, f), TransportMode::Walk, Correction::NONE),
                1000 + i as u64,
            ))
            .collect();
        want.sort();
        want.truncate(limit as usize);
        let got: Vec<(Milliminutes, u64)> = got.iter().map(|h| (h.estimate, h.node_id)).collect();
        prop_assert_eq!(got, want);
    }
}

use super::*;
use crate::actor_location::leg_instants;
use crate::generated::defs;
use crate::routing::TransportMode;
use crate::routing::estimate::{Correction, estimate};
use crate::routing::graph::{Edge, NodeKind};
use std::cell::Cell;
use std::collections::BTreeSet;

fn rates() -> Rates {
    Rates::from_balance(defs::BALANCE)
}

fn node(x: i32, y: i32, floor: i8) -> Node {
    Node {
        kind: if floor == 0 {
            NodeKind::Street
        } else {
            NodeKind::Portal
        },
        x,
        y,
        floor,
        source: None,
    }
}

fn edge(nodes: &[Node], a: u32, b: u32, kind: EdgeKind) -> Edge {
    let cost = estimate(
        &rates(),
        nodes[a as usize].point(),
        nodes[b as usize].point(),
        TransportMode::Walk,
        Correction::NONE,
    );
    Edge {
        a: a.min(b),
        b: a.max(b),
        kind,
        cost,
    }
}

/// A 4x4 street lattice on floor 0, node `y * 4 + x`.
fn lattice() -> MacroGraph {
    let mut nodes = Vec::new();
    for y in 0..4 {
        for x in 0..4 {
            nodes.push(node(x * 10, y * 10, 0));
        }
    }
    let mut edges = Vec::new();
    for y in 0..4u32 {
        for x in 0..4u32 {
            if x + 1 < 4 {
                edges.push(edge(&nodes, y * 4 + x, y * 4 + x + 1, EdgeKind::Street));
            }
            if y + 1 < 4 {
                edges.push(edge(&nodes, y * 4 + x, (y + 1) * 4 + x, EdgeKind::Street));
            }
        }
    }
    MacroGraph::from_parts(nodes, edges)
}

fn run(g: &MacroGraph, a: u64, b: u64) -> Result<Route, SearchError> {
    search(&SearchGraph::from_graph(g), a, b, &rates(), 10_000)
}

#[test]
fn route_cost_is_the_sum_of_edge_costs_and_endpoints_hold() {
    let g = lattice();
    let r = run(&g, 0, 15).unwrap();
    assert_eq!(r.nodes.first(), Some(&0));
    assert_eq!(r.nodes.last(), Some(&15));
    let view = SearchGraph::from_graph(&g);
    let mut sum = 0;
    let mut seen = BTreeSet::new();
    for w in r.nodes.windows(2) {
        let mut out = Vec::new();
        view.neighbours(w[0], &mut out);
        let c = out.iter().filter(|n| n.0 == w[1]).map(|n| n.2.0).min();
        sum += c.expect("consecutive nodes share an edge");
        assert!(seen.insert(w[0]), "node repeats");
    }
    assert_eq!(Milliminutes(sum), r.cost);
    assert!(sum > 0);
    assert_eq!(r.legs.len(), 1);
    assert_eq!((r.legs[0].t_depart, r.legs[0].t_arrive), (0, sum));
    assert_eq!(r.legs[0].waypoints.len(), r.nodes.len());
}

#[test]
fn origin_equal_destination_is_a_one_node_route() {
    let g = lattice();
    let r = run(&g, 5, 5).unwrap();
    assert_eq!(r.nodes, vec![5]);
    assert_eq!(r.cost, Milliminutes(0));
    assert_eq!(r.legs.len(), 1);
    assert_eq!(r.legs[0].waypoints, vec![(10, 10, 0)]);
    assert_eq!((r.legs[0].t_depart, r.legs[0].t_arrive), (0, 0));
}

#[test]
fn a_disconnected_goal_is_a_typed_error() {
    let nodes = vec![node(0, 0, 0), node(5, 0, 0), node(50, 50, 0)];
    let edges = vec![edge(&nodes, 0, 1, EdgeKind::Street)];
    let g = MacroGraph::from_parts(nodes, edges);
    assert_eq!(run(&g, 0, 2), Err(SearchError::Unreachable));
}

#[test]
fn an_unknown_id_is_a_typed_error() {
    let g = lattice();
    assert_eq!(run(&g, 0, 99), Err(SearchError::UnknownNode(99)));
    assert_eq!(run(&g, 99, 0), Err(SearchError::UnknownNode(99)));
}

#[test]
fn the_node_budget_is_refused_as_a_typed_error() {
    let g = lattice();
    let view = SearchGraph::from_graph(&g);
    assert_eq!(
        search(&view, 0, 15, &rates(), 2),
        Err(SearchError::BudgetExceeded)
    );
    assert!(search(&view, 0, 15, &rates(), 16).is_ok());
}

#[test]
fn a_portal_edge_splits_the_route_into_single_floor_legs() {
    let nodes = vec![
        node(0, 0, 0),
        node(10, 0, 0),
        node(10, 0, 1),
        node(20, 0, 1),
    ];
    let edges = vec![
        edge(&nodes, 0, 1, EdgeKind::Street),
        edge(&nodes, 1, 2, EdgeKind::Portal),
        edge(&nodes, 2, 3, EdgeKind::Street),
    ];
    let c: Vec<i64> = edges.iter().map(|e| e.cost.0).collect();
    let g = MacroGraph::from_parts(nodes, edges);
    let r = run(&g, 0, 3).unwrap();
    assert_eq!(r.legs.len(), 2);
    assert_eq!(r.legs[0].waypoints, vec![(0, 0, 0), (10, 0, 0)]);
    assert_eq!(r.legs[1].waypoints, vec![(10, 0, 1), (20, 0, 1)]);
    assert_eq!((r.legs[0].t_depart, r.legs[0].t_arrive), (0, c[0]));
    assert_eq!(
        (r.legs[1].t_depart, r.legs[1].t_arrive),
        (c[0] + c[1], c[0] + c[1] + c[2])
    );
    assert_eq!(r.cost.0, c.iter().sum::<i64>());
    for leg in &r.legs {
        assert!(leg_instants(&leg.waypoints, leg.t_depart, leg.t_arrive).is_some());
    }
}

#[test]
fn ties_break_on_node_id_not_on_edge_order() {
    // Two equal routes 0-1-3 and 0-2-3: the lower id wins whatever order
    // the edges are listed in.
    let nodes = vec![node(0, 5, 0), node(5, 0, 0), node(5, 10, 0), node(10, 5, 0)];
    let es = |order: &[(u32, u32)]| {
        order
            .iter()
            .map(|&(a, b)| edge(&nodes, a, b, EdgeKind::Street))
            .collect::<Vec<_>>()
    };
    let fwd = MacroGraph::from_parts(nodes.clone(), es(&[(0, 1), (0, 2), (1, 3), (2, 3)]));
    let rev = MacroGraph::from_parts(nodes.clone(), es(&[(2, 3), (1, 3), (0, 2), (0, 1)]));
    let a = run(&fwd, 0, 3).unwrap();
    assert_eq!(a.nodes, vec![0, 1, 3]);
    assert_eq!(a, run(&rev, 0, 3).unwrap());
}

#[test]
fn the_graph_view_is_only_asked_about_expanded_nodes() {
    struct Counting<'a> {
        inner: SearchGraph,
        asked: &'a Cell<u32>,
    }
    impl GraphView for Counting<'_> {
        fn node(&self, id: NodeId) -> Option<Node> {
            self.inner.node(id)
        }
        fn neighbours(&self, id: NodeId, out: &mut Vec<(NodeId, EdgeKind, Milliminutes)>) {
            self.asked.set(self.asked.get() + 1);
            self.inner.neighbours(id, out)
        }
    }
    let g = lattice();
    let asked = Cell::new(0);
    let v = Counting {
        inner: SearchGraph::from_graph(&g),
        asked: &asked,
    };
    search(&v, 0, 1, &rates(), 100).unwrap();
    assert!(
        asked.get() < 16,
        "a near goal expanded {} nodes",
        asked.get()
    );
}

#[test]
fn rows_give_the_same_route_in_any_row_order() {
    let g = lattice();
    let nodes: Vec<NodeRow> = g
        .nodes()
        .iter()
        .enumerate()
        .map(|(i, n)| NodeRow {
            node_id: 1000 + i as u64,
            kind: n.kind.code(),
            x: n.x,
            y: n.y,
            floor: n.floor,
            business_id: None,
        })
        .collect();
    let edges: Vec<EdgeRow> = g
        .edges()
        .iter()
        .enumerate()
        .map(|(i, e)| EdgeRow {
            edge_id: i as u64,
            node_a: 1000 + e.a as u64,
            node_b: 1000 + e.b as u64,
            kind: e.kind.code(),
            cost_milliminutes: e.cost.0,
        })
        .collect();
    let base = SearchGraph::from_rows(&nodes, &edges).unwrap();
    let want = search(&base, 1000, 1015, &rates(), 10_000).unwrap();
    assert_eq!(want.nodes.first(), Some(&1000));
    assert_eq!(want.nodes.last(), Some(&1015));
    let (mut n2, mut e2) = (nodes.clone(), edges.clone());
    n2.reverse();
    e2.reverse();
    e2.rotate_left(7);
    let shuffled = SearchGraph::from_rows(&n2, &e2).unwrap();
    assert_eq!(
        search(&shuffled, 1000, 1015, &rates(), 10_000).unwrap(),
        want
    );
}

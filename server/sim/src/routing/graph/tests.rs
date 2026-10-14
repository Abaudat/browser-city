use super::*;
use crate::generated::defs;
use crate::generation::{StreetClass, StreetEdge};

const SITE: Rect = Rect {
    x0: 0,
    y0: 0,
    x1: 40,
    y1: 40,
};

fn rates() -> Rates {
    Rates::from_balance(defs::BALANCE)
}

fn floors() -> Floors {
    (-1..=1)
        .map(|f| (f, FloorCollision::build(SITE, &[]).unwrap())) // collision-inference: allow (a hand-laid test grid)
        .collect()
}

fn street(axis: Axis, coord: i32, from: i32, to: i32) -> StreetEdge {
    StreetEdge {
        axis,
        coord,
        from,
        to,
        class: StreetClass::Street,
        width_cells: 4,
    }
}

fn network() -> StreetNetwork {
    StreetNetwork::test_fixture(SITE, vec![street(Axis::Horizontal, 20, 0, 39)], Vec::new())
}

/// A south-fronting building above the street at y = 20: door at
/// (`x`, 10), approach running down to the street's first cell.
fn building(plot: u32, x: i32, room_w: i32) -> BuildingInput {
    BuildingInput {
        plot,
        provisions: if plot.is_multiple_of(2) {
            vec![(crate::codes::provision::EMPLOYMENT, 50)]
        } else {
            vec![(crate::codes::provision::FOOD, 40)]
        },
        front: Side::South,
        entrance: (x, 10),
        approach: (11..=18).map(|y| (x, y)).collect(),
        rooms: vec![Rect {
            x0: x - room_w / 2,
            y0: 2,
            x1: x - room_w / 2 + room_w,
            y1: 10,
        }],
    }
}

fn build(buildings: &[BuildingInput], portals: &[PortalPair], min: i64) -> MacroGraph {
    let streets = network();
    let f = floors();
    // The street network covers floor 0; a portal elsewhere needs a
    // walking node on its own floor to join.
    let floor_nodes: Vec<Point> = portals
        .iter()
        .flat_map(|p| [p.from, p.to])
        .filter(|p| p.floor != 0)
        .map(|p| Point { x: p.x + 1, ..p })
        .collect();
    MacroGraph::build(&BuildInput {
        streets: &streets,
        buildings,
        portals,
        floor_nodes: &floor_nodes,
        rates: rates(),
        internal_node_min_floor_area: min,
        walkability: &f,
    })
    .unwrap()
}

fn count(g: &MacroGraph, k: NodeKind) -> usize {
    g.nodes().iter().filter(|n| n.kind == k).count()
}

#[test]
fn a_building_collapses_to_one_entrance_and_a_split_on_its_street() {
    let g = build(&[building(0, 20, 6)], &[], 1_000);
    assert_eq!(count(&g, NodeKind::Source), 1);
    assert_eq!(count(&g, NodeKind::Internal), 0);
    // Two street ends and the split.
    assert_eq!(count(&g, NodeKind::Street), 3);
    assert_eq!(g.edges().len(), 3);
    assert_eq!(g.check(&floors()), Ok(()));
}

#[test]
fn the_internal_node_appears_exactly_at_the_threshold() {
    // 8 rows x 5 columns = 40 cells; 8 x 4 = 32.
    let forty = building(0, 20, 5);
    let thirty_two = building(0, 20, 4);
    assert_eq!(interior_cells(&forty.rooms), 40);
    assert_eq!(interior_cells(&thirty_two.rooms), 32);
    for (b, min, internal) in [
        (&forty, 41, 0),
        (&forty, 40, 1),
        (&forty, 39, 1),
        (&thirty_two, 33, 0),
        (&thirty_two, 32, 1),
    ] {
        let g = build(std::slice::from_ref(b), &[], min);
        assert_eq!(count(&g, NodeKind::Internal), internal, "min {min}");
    }
    assert!(!has_internal_node(39, 40));
    assert!(has_internal_node(40, 40));
}

#[test]
fn an_internal_node_lies_in_the_largest_room_and_joins_the_entrance_only() {
    let g = build(&[building(0, 20, 6)], &[], 10);
    let room = building(0, 20, 6).rooms[0];
    let internal: Vec<usize> = (0..g.nodes().len())
        .filter(|&i| g.nodes()[i].kind == NodeKind::Internal)
        .collect();
    assert_eq!(internal.len(), 1);
    let n = g.nodes()[internal[0]];
    assert!(room.contains(n.x, n.y));
    let touching: Vec<&Edge> = g
        .edges()
        .iter()
        .filter(|e| e.a as usize == internal[0] || e.b as usize == internal[0])
        .collect();
    assert_eq!(touching.len(), 1);
    assert_eq!(touching[0].kind, EdgeKind::Internal);
}

#[test]
fn every_edge_costs_the_estimate_between_its_endpoints() {
    let g = build(&[building(0, 12, 6), building(1, 28, 6)], &[], 10);
    for e in g.edges() {
        let (a, b) = (g.nodes()[e.a as usize], g.nodes()[e.b as usize]);
        assert_eq!(
            e.cost,
            estimate(
                &rates(),
                a.point(),
                b.point(),
                TransportMode::Walk,
                Correction::NONE
            )
        );
        assert!(e.cost.0 > 0);
    }
}

#[test]
fn two_doors_on_one_cell_of_street_share_its_split_node() {
    let g = build(&[building(0, 20, 6), building(1, 20, 6)], &[], 1_000);
    assert_eq!(count(&g, NodeKind::Street), 3);
}

#[test]
fn a_portal_pair_makes_two_portal_nodes_and_one_floor_crossing_edge() {
    let pair = PortalPair {
        from: Point {
            x: 5,
            y: 5,
            floor: 0,
        },
        to: Point {
            x: 5,
            y: 5,
            floor: -1,
        },
    };
    let g = build(&[], &[pair], 1_000);
    assert_eq!(count(&g, NodeKind::Portal), 2);
    // Each endpoint joins its own floor's walking network.
    let links = g
        .edges()
        .iter()
        .filter(|e| e.kind == EdgeKind::PortalLink)
        .count();
    assert_eq!(links, 2);
    let portal: Vec<&Edge> = g
        .edges()
        .iter()
        .filter(|e| e.kind == EdgeKind::Portal)
        .collect();
    assert_eq!(portal.len(), 1);
    let e = portal[0];
    assert_ne!(g.nodes()[e.a as usize].floor, g.nodes()[e.b as usize].floor);
    assert_eq!(
        e.cost,
        estimate(
            &rates(),
            pair.from,
            pair.to,
            TransportMode::Walk,
            Correction::NONE
        )
    );
    assert_eq!(g.check(&floors()), Ok(()));
}

fn node(kind: NodeKind, x: i32, floor: i8) -> Node {
    Node {
        kind,
        x,
        y: 5,
        floor,
        source: None,
    }
}

fn edge(a: u32, b: u32, kind: EdgeKind) -> Edge {
    Edge {
        a,
        b,
        kind,
        cost: Milliminutes(1000),
    }
}

#[test]
fn a_cross_floor_edge_that_is_not_a_portal_names_that_edge() {
    let g = MacroGraph::from_parts(
        vec![
            node(NodeKind::Street, 1, 0),
            node(NodeKind::Street, 2, 0),
            node(NodeKind::Street, 3, 1),
        ],
        vec![edge(0, 1, EdgeKind::Street), edge(1, 2, EdgeKind::Street)],
        Vec::new(),
    );
    assert_eq!(
        g.check(&floors()),
        Err(GraphError::CrossFloorNonPortal { edge: 1 })
    );
}

#[test]
fn a_portal_edge_between_non_portal_nodes_or_one_floor_is_malformed() {
    let on_two_floors = MacroGraph::from_parts(
        vec![node(NodeKind::Street, 1, 0), node(NodeKind::Street, 2, 1)],
        vec![edge(0, 1, EdgeKind::Portal)],
        Vec::new(),
    );
    assert_eq!(
        on_two_floors.check(&floors()),
        Err(GraphError::CrossFloorNonPortal { edge: 0 })
    );
    let same_floor = MacroGraph::from_parts(
        vec![node(NodeKind::Portal, 1, 0), node(NodeKind::Portal, 2, 0)],
        vec![edge(0, 1, EdgeKind::Portal)],
        Vec::new(),
    );
    assert_eq!(
        same_floor.check(&floors()),
        Err(GraphError::MalformedPortal { edge: 0 })
    );
}

#[test]
fn an_edge_to_a_missing_node_names_that_edge() {
    let g = MacroGraph::from_parts(
        vec![node(NodeKind::Street, 1, 0), node(NodeKind::Street, 2, 0)],
        vec![edge(0, 1, EdgeKind::Street), edge(1, 7, EdgeKind::Street)],
        Vec::new(),
    );
    assert_eq!(
        g.check(&floors()),
        Err(GraphError::DanglingEdge { edge: 1 })
    );
}

#[test]
fn self_loops_duplicates_and_zero_costs_are_refused() {
    let two = vec![node(NodeKind::Street, 1, 0), node(NodeKind::Street, 2, 0)];
    assert_eq!(
        MacroGraph::from_parts(two.clone(), vec![edge(1, 1, EdgeKind::Street)], Vec::new())
            .check(&floors()),
        Err(GraphError::SelfLoop { edge: 0 })
    );
    assert_eq!(
        MacroGraph::from_parts(
            two.clone(),
            vec![edge(0, 1, EdgeKind::Street), edge(0, 1, EdgeKind::Street)],
            Vec::new()
        )
        .check(&floors()),
        Err(GraphError::UnorderedEdge { edge: 1 })
    );
    let mut free = edge(0, 1, EdgeKind::Street);
    free.cost = Milliminutes(0);
    assert_eq!(
        MacroGraph::from_parts(two, vec![free], Vec::new()).check(&floors()),
        Err(GraphError::NonPositiveCost { edge: 0 })
    );
}

#[test]
fn a_node_on_a_blocked_tile_or_off_the_grid_is_refused() {
    let blocked = Rect {
        x0: 2,
        y0: 5,
        x1: 3,
        y1: 6,
    };
    let mut f = floors();
    f.insert(0, FloorCollision::build(SITE, &[blocked]).unwrap()); // collision-inference: allow (a hand-laid test grid)
    let g = MacroGraph::from_parts(vec![node(NodeKind::Street, 2, 0)], Vec::new(), Vec::new());
    assert_eq!(g.check(&f), Err(GraphError::NodeNotWalkable { node: 0 }));
    let off = MacroGraph::from_parts(vec![node(NodeKind::Street, 90, 0)], Vec::new(), Vec::new());
    assert_eq!(off.check(&f), Err(GraphError::NodeNotWalkable { node: 0 }));
}

#[test]
fn a_source_with_no_path_to_a_transit_node_is_refused() {
    let g = MacroGraph::from_parts(
        vec![node(NodeKind::Street, 1, 0), node(NodeKind::Source, 2, 0)],
        Vec::new(),
        Vec::new(),
    );
    assert_eq!(
        g.check(&floors()),
        Err(GraphError::Disconnected { node: 1 })
    );
}

#[test]
fn rows_to_graph_to_rows_is_identical() {
    let g = build(&[building(0, 12, 6), building(1, 28, 6)], &[], 10);
    let business: Vec<Option<u64>> = g
        .nodes()
        .iter()
        .enumerate()
        .map(|(i, n)| (n.kind == NodeKind::Source).then_some(100 + i as u64))
        .collect();
    let mut node_rows = g.node_rows(&business);
    for (i, r) in node_rows.iter_mut().enumerate() {
        r.node_id = 7 + 3 * i as u64;
    }
    let ids: Vec<u64> = node_rows.iter().map(|r| r.node_id).collect();
    let mut edge_rows = g.edge_rows(&ids);
    for (i, r) in edge_rows.iter_mut().enumerate() {
        r.edge_id = 1 + i as u64;
    }
    let mut prov_rows = g.provision_rows(&ids);
    for (i, r) in prov_rows.iter_mut().enumerate() {
        r.provision_id = 1 + i as u64;
    }
    assert!(!prov_rows.is_empty(), "the fixture has provisions to carry");
    let (back, biz) = MacroGraph::from_rows(&node_rows, &edge_rows, &prov_rows).unwrap();
    assert_eq!(back.provisions(), g.provisions());
    let mut again_prov = back.provision_rows(&ids);
    for (r, o) in again_prov.iter_mut().zip(&prov_rows) {
        r.provision_id = o.provision_id;
    }
    assert_eq!(again_prov, prov_rows);
    let mut again = back.node_rows(&biz);
    for (r, o) in again.iter_mut().zip(&node_rows) {
        r.node_id = o.node_id;
    }
    let mut again_edges = back.edge_rows(&ids);
    for (r, o) in again_edges.iter_mut().zip(&edge_rows) {
        r.edge_id = o.edge_id;
    }
    assert_eq!(again, node_rows);
    assert_eq!(again_edges, edge_rows);
    assert_eq!(back.edges(), g.edges());
}

#[test]
fn the_same_input_builds_the_same_graph() {
    let a = build(&[building(1, 28, 6), building(0, 12, 6)], &[], 10);
    let b = build(&[building(1, 28, 6), building(0, 12, 6)], &[], 10);
    assert_eq!(a, b);
}

#[test]
fn the_node_and_edge_ceilings_scale_linearly_with_area() {
    assert_eq!(max_nodes_for_side(512), NODE_COUNT_BAND_512.1);
    assert_eq!(max_nodes_for_side(1024), 4 * NODE_COUNT_BAND_512.1);
    assert_eq!(max_edges_for_side(1024), 4 * EDGE_COUNT_BAND_512.1);
}

#[test]
fn an_isolated_portal_pair_is_disconnected() {
    let g = MacroGraph::from_parts(
        vec![
            node(NodeKind::Street, 1, 0),
            node(NodeKind::Portal, 2, 0),
            node(NodeKind::Portal, 2, 1),
        ],
        vec![edge(1, 2, EdgeKind::Portal)],
        Vec::new(),
    );
    assert_eq!(
        g.check(&floors()),
        Err(GraphError::Disconnected { node: 1 })
    );
}

#[test]
fn two_street_components_with_no_link_are_disconnected() {
    let g = MacroGraph::from_parts(
        vec![
            node(NodeKind::Street, 1, 0),
            node(NodeKind::Street, 2, 0),
            node(NodeKind::Street, 5, 0),
            node(NodeKind::Street, 6, 0),
        ],
        vec![edge(0, 1, EdgeKind::Street), edge(2, 3, EdgeKind::Street)],
        Vec::new(),
    );
    assert_eq!(
        g.check(&floors()),
        Err(GraphError::Disconnected { node: 2 })
    );
}

#[test]
fn corner_is_the_same_whichever_way_the_segment_is_walked() {
    let p = |x, y| Point { x, y, floor: 0 };
    assert_eq!(corner(p(2, 3), p(9, 8)), Some(p(9, 3)));
    assert_eq!(corner(p(9, 8), p(2, 3)), Some(p(9, 3)));
    assert_eq!(corner(p(9, 3), p(2, 8)), Some(p(2, 3)));
    assert_eq!(corner(p(2, 8), p(9, 3)), Some(p(2, 3)));
    assert_eq!(corner(p(2, 3), p(9, 3)), None);
    assert_eq!(corner(p(2, 3), p(2, 9)), None);
    assert_eq!(
        corner(
            p(2, 3),
            Point {
                floor: 1,
                ..p(9, 8)
            }
        ),
        None
    );
}

#[test]
fn a_diagonal_edge_whose_corner_or_arm_is_blocked_names_that_edge() {
    let at = |x, y| Node {
        kind: NodeKind::Street,
        x,
        y,
        floor: 0,
        source: None,
    };
    // (1,1) to (6,5): the corner is (6,1); its arms run along row 1 and
    // down column 6.
    let g = MacroGraph::from_parts(
        vec![at(1, 1), at(6, 5)],
        vec![edge(0, 1, EdgeKind::Street)],
        Vec::new(),
    );
    assert_eq!(g.check(&floors()), Ok(()));
    for (x, y) in [(6, 1), (3, 1), (6, 3)] {
        let wall = Rect {
            x0: x,
            y0: y,
            x1: x + 1,
            y1: y + 1,
        };
        let mut f = floors();
        f.insert(0, FloorCollision::build(SITE, &[wall]).unwrap()); // collision-inference: allow (a hand-laid test grid)
        assert_eq!(
            g.check(&f),
            Err(GraphError::CornerBlocked { edge: 0 }),
            "wall at ({x}, {y})"
        );
    }
}

// ---- Story 3.10: provisions ride on source nodes ----

#[test]
fn a_built_graph_carries_each_buildings_provisions_on_its_entrance() {
    let g = build(&[building(0, 10, 6), building(1, 20, 6)], &[], 1000);
    g.check(&floors()).unwrap();
    let rows = g.provisions();
    assert_eq!(rows.len(), 2);
    for p in rows {
        assert_eq!(g.nodes()[p.node as usize].kind, NodeKind::Source);
    }
    assert!(
        rows.windows(2)
            .all(|w| (w[0].node, w[0].provision) < (w[1].node, w[1].provision))
    );
}

#[test]
fn a_provision_row_off_a_source_node_is_refused() {
    let g = build(&[building(0, 10, 6)], &[], 1000);
    let street = g
        .nodes()
        .iter()
        .position(|n| n.kind == NodeKind::Street)
        .unwrap() as u32;
    let mut rows = g.provisions().to_vec();
    rows.push(NodeProvision {
        node: street,
        provision: crate::codes::provision::FOOD,
        quality: 10,
    });
    rows.sort();
    let bad = MacroGraph::from_parts(g.nodes().to_vec(), g.edges().to_vec(), rows);
    assert!(matches!(
        bad.check(&floors()),
        Err(GraphError::ProvisionOffSource { .. })
    ));
}

#[test]
fn the_same_provision_twice_on_one_node_is_refused() {
    let g = build(&[building(0, 10, 6)], &[], 1000);
    let mut rows = g.provisions().to_vec();
    rows.push(rows[0]);
    let bad = MacroGraph::from_parts(g.nodes().to_vec(), g.edges().to_vec(), rows);
    assert!(matches!(
        bad.check(&floors()),
        Err(GraphError::BadProvisions { .. })
    ));
}

#[test]
fn a_provision_row_naming_an_unknown_node_is_bad_rows() {
    let g = build(&[building(0, 10, 6)], &[], 1000);
    let ids: Vec<u64> = (500..500 + g.nodes().len() as u64).collect();
    let nodes = g.node_rows(&vec![None; ids.len()]);
    let nodes: Vec<NodeRow> = nodes
        .into_iter()
        .zip(&ids)
        .map(|(mut r, id)| {
            r.node_id = *id;
            r
        })
        .collect();
    let mut prov = g.provision_rows(&ids);
    prov[0].node_id = 1;
    assert_eq!(
        MacroGraph::from_rows(&nodes, &g.edge_rows(&ids), &prov).err(),
        Some(GraphError::BadRows)
    );
}

#[test]
fn a_node_advertises_what_its_rows_say() {
    let g = build(&[building(0, 10, 6), building(1, 20, 6)], &[], 1000);
    let p = g.provisions();
    assert!(g.advertises(p[0].node, p[0].provision));
    assert!(!g.advertises(p[0].node, 999));
}

#[test]
fn provision_rows_carry_the_node_id_and_its_chunk() {
    let g = build(&[building(0, 10, 6)], &[], 1000);
    let ids: Vec<u64> = (500..500 + g.nodes().len() as u64).collect();
    let rows = g.provision_rows(&ids);
    assert_eq!(rows.len(), g.provisions().len());
    for (r, p) in rows.iter().zip(g.provisions()) {
        let n = &g.nodes()[p.node as usize];
        assert_eq!(r.node_id, ids[p.node as usize]);
        assert_eq!(r.chunk_key, crate::world::chunk_key(n.x, n.y, n.floor));
        assert_eq!((r.provision, r.quality), (p.provision, p.quality));
    }
}

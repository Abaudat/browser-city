//! The macro routing graph (FR129, FR130, FR134): one row per node and one
//! per edge, written once per district by `create_district` from the
//! graph `sim::routing::graph` builds -- and restored by `restore_*`,
//! nowhere else (`scripts/ci/check-district-write-path.sh`). Private;
//! nothing reads it client-side (FR135). Never cached in module state
//! (`scripts/ci/check-server-src-bans.sh`): a search reads these rows.
//!
//! `kind` columns are `sim::codes::node_kind`/`edge_kind` codes. Every
//! `cost_milliminutes` is the estimate between the edge's endpoints; there
//! is no cell unit in either table.

#[derive(Clone)]
#[spacetimedb::table(accessor = route_node)]
pub struct RouteNode {
    #[primary_key]
    #[auto_inc]
    pub node_id: u64,
    pub kind: u32,
    pub x: i32,
    pub y: i32,
    pub floor: i32,
    /// The generated business a source node is the entrance of.
    pub business_id: Option<u64>,
}

#[derive(Clone)]
#[spacetimedb::table(
    accessor = route_edge,
    index(accessor = by_node_a, btree(columns = [node_a])),
    index(accessor = by_node_b, btree(columns = [node_b]))
)]
pub struct RouteEdge {
    #[primary_key]
    #[auto_inc]
    pub edge_id: u64,
    pub node_a: u64,
    pub node_b: u64,
    pub kind: u32,
    pub cost_milliminutes: i64,
}

/// The `edge_kind` extensible set's companion table (NFR36), seeded by
/// `codes::seed_all_codes`.
#[spacetimedb::table(accessor = edge_kind)]
pub struct EdgeKind {
    #[primary_key]
    pub code: u32,
    pub name: String,
}

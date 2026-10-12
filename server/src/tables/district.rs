//! The record of a generated district: one row per district ever generated,
//! carrying its seed, its world-absolute site and every version its output
//! depends on. Read back as stored, never re-stamped. Private; nothing
//! reads it client-side.
//!
//! `create_district` is the only path to the generator
//! (`sim::generation::create` decides, this reducer only reads the rows and
//! inserts the record). `scripts/ci/check-district-write-path.sh` fails any
//! other file under `server/src/` that names `generation::` or the
//! `district` accessor outside the places listed there.

use sim::generated::defs;
use sim::generation::{
    DistrictRecord, GenerationConfig, GenerationContent, RuleSetVersion, SiteBounds, create,
};
use sim::reducer_classes::ReducerClass;
use sim::routing::graph::{MacroGraph, NodeKind};
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::metrics::count_call;
use super::ops::require_owner;
use super::routing::{RouteEdge, RouteNode, route_edge, route_node};
use super::stock::{Business, business};

#[derive(Clone)]
#[spacetimedb::table(accessor = district)]
pub struct District {
    // bc:wide-table: one permanent record row -- site rect plus the three version fields
    #[primary_key]
    #[auto_inc]
    pub district_id: u64,
    pub seed: u64,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub generation_version: u32,
    pub rng_version: u32,
    pub defs_version: String,
    pub generated_at: Timestamp,
}

/// Generates the district for `seed` over the configured site and records
/// it, once: a site that already has a record is refused, whatever the
/// recorded versions.
#[spacetimedb::reducer]
pub fn create_district(ctx: &ReducerContext, seed: u64) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    require_owner(ctx)?;
    let existing: Vec<DistrictRecord> = ctx
        .db
        .district()
        .iter()
        .map(|r| DistrictRecord {
            seed: r.seed,
            site: SiteBounds {
                x0: r.x0,
                y0: r.y0,
                x1: r.x1,
                y1: r.y1,
            },
            version: RuleSetVersion {
                generation: r.generation_version,
                rng: r.rng_version,
                defs: r.defs_version,
            },
        })
        .collect();
    let cfg = GenerationConfig::from_balance(defs::BALANCE).map_err(|e| e.to_string())?;
    let content = GenerationContent::committed();
    let (record, district) = create(&existing, seed, &cfg, &content).map_err(|e| e.to_string())?;
    let graph = district.graph(&cfg, &content).map_err(|e| e.to_string())?;
    ctx.db.district().insert(District {
        district_id: 0,
        seed: record.seed,
        x0: record.site.x0,
        y0: record.site.y0,
        x1: record.site.x1,
        y1: record.site.y1,
        generation_version: record.version.generation,
        rng_version: record.version.rng,
        defs_version: record.version.defs,
        generated_at: ctx.timestamp,
    });
    write_graph(ctx, &graph);
    Ok(())
}

/// The one graph writer: one `business` row per workplace source node,
/// then every node in graph order (the ids the table assigns are kept),
/// then every edge through those ids. Inside the caller's transaction, so
/// a later `Err` rolls the graph back with everything else.
fn write_graph(ctx: &ReducerContext, graph: &MacroGraph) {
    let business_ids: Vec<Option<u64>> = graph
        .nodes()
        .iter()
        .map(|n| match (n.kind, n.source) {
            (NodeKind::Source, Some(s)) if s.workplace => Some(
                ctx.db
                    .business()
                    .insert(Business {
                        business_id: 0,
                        created_at: ctx.timestamp,
                    })
                    .business_id,
            ),
            _ => None,
        })
        .collect();
    let node_ids: Vec<u64> = graph
        .node_rows(&business_ids)
        .into_iter()
        .map(|r| {
            ctx.db
                .route_node()
                .insert(RouteNode {
                    node_id: 0,
                    kind: r.kind,
                    x: r.x,
                    y: r.y,
                    floor: r.floor,
                    business_id: r.business_id,
                })
                .node_id
        })
        .collect();
    for r in graph.edge_rows(&node_ids) {
        ctx.db.route_edge().insert(RouteEdge {
            edge_id: 0,
            node_a: r.node_a,
            node_b: r.node_b,
            kind: r.kind,
            cost_milliminutes: r.cost_milliminutes,
        });
    }
}

/// Test-only (`time-control` flavour, never deployed): generates a graph
/// for `seed`, writes it through [`write_graph`] -- on top of whatever is
/// there -- and returns `Err`. The rehearsal proves the rows roll back.
#[cfg(feature = "time-control")]
#[spacetimedb::reducer]
pub fn debug_write_graph_then_fail(ctx: &ReducerContext, seed: u64) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    let cfg = GenerationConfig::from_balance(defs::BALANCE).map_err(|e| e.to_string())?;
    let content = GenerationContent::committed();
    let (_, district) = create(&[], seed, &cfg, &content).map_err(|e| e.to_string())?;
    let graph = district.graph(&cfg, &content).map_err(|e| e.to_string())?;
    write_graph(ctx, &graph);
    Err("debug_write_graph_then_fail: rolled back on purpose".to_string())
}

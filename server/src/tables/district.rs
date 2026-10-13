//! The record of a generated district: one row per district ever generated,
//! carrying its seed, its world-absolute site and every version its output
//! depends on. Read back as stored, never re-stamped. Private; nothing
//! reads it client-side.
//!
//! `create_district` is the only path to the generator
//! (`sim::generation::create` decides, this reducer only reads the rows and
//! inserts the record, the macro graph and the district's world rows).
//! `scripts/ci/check-district-write-path.sh` fails any other file under
//! `server/src/` that names `generation::` or the `district` accessor
//! outside the places listed there, and any writer of the four region
//! tables other than this file and `restore.rs`.

use sim::generated::defs;
use sim::generation::{
    DistrictRecord, GenerationConfig, GenerationContent, GroundConfig, RegionRows, RuleSetVersion,
    SiteBounds, create,
};
use sim::reducer_classes::ReducerClass;
use sim::routing::graph::{MacroGraph, NodeKind};
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::metrics::count_call;
use super::ops::require_owner;
use super::player_position::relocate_stranded;
use super::routing::{RouteEdge, RouteNode, route_edge, route_node};
use super::stock::{Business, business};
use super::world::{
    BuildingArea, FloorTransition, PlacedObject, RoomArea, building_area, floor_transition,
    placed_object, room_area,
};

#[derive(Clone)]
#[spacetimedb::table(accessor = district)]
pub struct District {
    // bc:wide-table: one permanent record row -- site rect plus the three version fields
    #[primary_key]
    #[auto_inc]
    pub district_id: u64,
    /// Indexed only so `arrival_cell_in_view` can read the row: a view has
    /// no table scan.
    #[index(btree)]
    pub seed: u64,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub generation_version: u32,
    pub rng_version: u32,
    pub defs_version: String,
    pub generated_at: Timestamp,
    /// `District::arrival_cell`, floor 0: where a new character first
    /// stands. Derived once, at generation, and read back as stored.
    #[default(0)]
    pub arrival_x: i32,
    #[default(0)]
    pub arrival_y: i32,
}

/// The same cell, read from a view.
pub fn arrival_cell_in_view(ctx: &spacetimedb::ViewContext) -> Option<(i32, i32)> {
    ctx.db
        .district()
        .seed()
        .filter(0u64..)
        .next()
        .map(|d| (d.arrival_x, d.arrival_y))
}

/// The district's arrival cell, floor 0: none before the district exists.
pub fn arrival_cell_of(ctx: &ReducerContext) -> Option<(i32, i32)> {
    ctx.db
        .district()
        .iter()
        .next()
        .map(|d| (d.arrival_x, d.arrival_y))
}

/// Generates the city's district (`city.seed`, never a caller's
/// argument) over the configured site and records it, once: a site that
/// already has a record is refused, whatever the recorded versions. Writes
/// the record, the macro graph and the world rows in one transaction, then
/// moves every player standing somewhere that is not walkable on the new
/// district to its arrival cell.
#[spacetimedb::reducer]
pub fn create_district(ctx: &ReducerContext) -> Result<(), String> {
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
    let seed = GroundConfig::city_seed(defs::BALANCE);
    let (record, district, graph) =
        create(&existing, seed, &cfg, &content).map_err(|e| e.to_string())?;
    let arrival = district
        .arrival_cell(&cfg, &content)
        .ok_or_else(|| "the district has no arrival cell".to_string())?;
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
        arrival_x: arrival.0,
        arrival_y: arrival.1,
    });
    write_graph(ctx, &graph);
    let ground = GroundConfig::from_balance(defs::BALANCE);
    write_world(ctx, &district.region_rows(&ground, &content));
    relocate_stranded(ctx, arrival, |x, y, f| {
        f == 0 && district.is_standable_at(x, y, f)
    });
    Ok(())
}

/// The one world writer: every row of `rows`, as given, inside the
/// caller's transaction (`restore.rs` is the only other writer of these
/// four tables).
fn write_world(ctx: &ReducerContext, rows: &RegionRows) {
    for r in &rows.placed {
        ctx.db.placed_object().insert(PlacedObject {
            object_id: 0,
            def_id: r.def_id,
            x: r.x,
            y: r.y,
            floor: r.floor,
            layer: r.layer,
            orientation: r.orientation,
            chunk_key: r.chunk_key,
        });
    }
    for r in &rows.transitions {
        ctx.db.floor_transition().insert(FloorTransition {
            transition_id: 0,
            x: r.x,
            y: r.y,
            floor: r.floor,
            target_x: r.target_x,
            target_y: r.target_y,
            target_floor: r.target_floor,
            chunk_key: r.chunk_key,
        });
    }
    for r in &rows.building_areas {
        ctx.db.building_area().insert(BuildingArea {
            area_id: 0,
            building_id: r.owner_id,
            x0: r.x0,
            y0: r.y0,
            x1: r.x1,
            y1: r.y1,
            floor: r.floor,
            chunk_key: r.chunk_key,
        });
    }
    for r in &rows.room_areas {
        ctx.db.room_area().insert(RoomArea {
            area_id: 0,
            room_id: r.owner_id,
            x0: r.x0,
            y0: r.y0,
            x1: r.x1,
            y1: r.y1,
            floor: r.floor,
            chunk_key: r.chunk_key,
        });
    }
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
    let (_, _, graph) = create(&[], seed, &cfg, &content).map_err(|e| e.to_string())?;
    write_graph(ctx, &graph);
    Err("debug_write_graph_then_fail: rolled back on purpose".to_string())
}

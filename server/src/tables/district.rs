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

use sim::codes::provision;
use sim::generated::defs;
use sim::generation::{
    DistrictRecord, GenerationConfig, GenerationContent, RuleSetVersion, SiteBounds, create,
};
use sim::reducer_classes::ReducerClass;
use sim::routing::graph::{MacroGraph, NodeKind};
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::housing::{Dwelling, dwelling};
use super::metrics::count_call;
use super::ops::require_owner;
use super::routing::{
    RouteEdge, RouteNode, RouteProvision, route_edge, route_node, route_provision,
};
use super::stock::{Business, business};
use super::world::{
    Building, BuildingArea, Room, RoomArea, building, building_area, room, room_area,
};
use super::world::{PlacedObject, placed_object};
use sim::world::clip_rect_to_chunks;

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
    let (record, district, graph) =
        create(&existing, seed, &cfg, &content).map_err(|e| e.to_string())?;
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
    write_buildings(ctx, &district, &cfg, &content);
    Ok(())
}

/// One `building` row per laid interior, in plot order, carrying what
/// `sim::housing` derived for a dwelling; its ownership areas and its
/// rooms, each clipped to the chunk it lies in. Inside the caller's
/// transaction, with the graph.
fn write_buildings(
    ctx: &ReducerContext,
    district: &sim::generation::District,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) {
    let homes: std::collections::BTreeMap<u32, sim::housing::Home> =
        sim::housing::dwellings(district, cfg, content, defs::BALANCE)
            .into_iter()
            .map(|d| (d.plot, d.home))
            .collect();
    // Pass 7: every placed row, anchored in its chunk. The same
    // transaction as the graph and the buildings.
    for r in district.props.rows() {
        if let Some(chunk_key) = sim::world::checked_chunk_key(r.x, r.y, r.floor) {
            ctx.db.placed_object().insert(PlacedObject {
                object_id: 0,
                def_id: r.def_id,
                x: r.x,
                y: r.y,
                floor: r.floor,
                layer: r.layer,
                orientation: r.orientation,
                chunk_key,
            });
        }
    }
    for (plot, _ty, interior) in district.interiors.laid() {
        let b = ctx.db.building().insert(Building {
            building_id: 0,
            created_at: ctx.timestamp,
        });
        if let Some(h) = homes.get(&plot) {
            let home = sim::housing::Home {
                id: b.building_id,
                ..*h
            };
            ctx.db.dwelling().insert(Dwelling::of_home(&home));
        }
        for (piece, chunk_key) in clip_rect_to_chunks(interior.footprint, 0) {
            ctx.db.building_area().insert(BuildingArea {
                area_id: 0,
                building_id: b.building_id,
                x0: piece.x0,
                y0: piece.y0,
                x1: piece.x1,
                y1: piece.y1,
                floor: 0,
                chunk_key,
            });
        }
        for r in &interior.rooms {
            let room = ctx.db.room().insert(Room {
                room_id: 0,
                building_id: b.building_id,
                created_at: ctx.timestamp,
            });
            for (piece, chunk_key) in clip_rect_to_chunks(r.rect, 0) {
                ctx.db.room_area().insert(RoomArea {
                    area_id: 0,
                    room_id: room.room_id,
                    x0: piece.x0,
                    y0: piece.y0,
                    x1: piece.x1,
                    y1: piece.y1,
                    floor: 0,
                    chunk_key,
                });
            }
        }
    }
}

/// The one graph writer: one `business` row per workplace source node,
/// then every node in graph order (the ids the table assigns are kept),
/// then every edge and every provision row through those ids. Inside the caller's transaction, so
/// a later `Err` rolls the graph back with everything else.
fn write_graph(ctx: &ReducerContext, graph: &MacroGraph) {
    let business_ids: Vec<Option<u64>> = graph
        .nodes()
        .iter()
        .enumerate()
        .map(|(i, n)| {
            // A workplace is a source that advertises employment.
            (n.kind == NodeKind::Source && graph.advertises(i as u32, provision::EMPLOYMENT)).then(
                || {
                    ctx.db
                        .business()
                        .insert(Business {
                            business_id: 0,
                            created_at: ctx.timestamp,
                        })
                        .business_id
                },
            )
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
    for r in graph.provision_rows(&node_ids) {
        ctx.db.route_provision().insert(RouteProvision {
            provision_id: 0,
            node_id: r.node_id,
            provision: r.provision,
            quality: r.quality,
            chunk_key: r.chunk_key,
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

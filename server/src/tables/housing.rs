//! Story 7.1 (FR20, FR145): a character's first flat is a tenancy over a
//! generated dwelling. `sim::housing` decides which flat and where the
//! tenant stands (`sim::identity::plan_arrival`); this file reads the
//! building rows' derived columns through the `home_tier` index, writes the
//! tenancy, the first position and the starting kit, in the caller's
//! transaction -- so a character is never created without its arrival.
//!
//! `tenancy` is private. `tenant_kind` is a `sim::codes::actor_kind` code,
//! so a citizen's home is the same row kind (NFR24). One tenancy per
//! dwelling: `building_id` is unique.

use sim::codes::actor_kind;
use sim::generated::defs;
use sim::housing::{Home, Tier, starting_pieces};
use sim::identity::plan_arrival;
use sim::item_instance::Placed;
use sim::world::checked_chunk_key;
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::item_instance::{ItemInstance, ItemPlaced, item_instance, item_placed};
use super::player_position::write_first_position;
use super::world::{Building, PlacedObject, building, placed_object};

#[derive(Clone)]
#[spacetimedb::table(accessor = tenancy)]
pub struct Tenancy {
    #[primary_key]
    #[auto_inc]
    pub tenancy_id: u64,
    /// The dwelling's `building_id`; one tenancy per dwelling.
    #[unique]
    pub building_id: u64,
    /// A `sim::codes::actor_kind` code.
    pub tenant_kind: u32,
    #[index(btree)]
    pub tenant_id: u64,
    /// The asked rent as signed, in the currency's smallest unit.
    pub weekly_rent: u64,
    pub started_at: Timestamp,
}

fn home_of(row: &Building, tier: Tier) -> Home {
    Home {
        id: row.building_id,
        tier,
        density: row.density,
        affluence: row.affluence,
        rent: row.asking_rent,
        spawn: (row.spawn_x, row.spawn_y),
        door: (row.door_x, row.door_y),
        kit: (row.kit_x, row.kit_y),
    }
}

/// Every lettable dwelling, edge first, read through the `home_tier` index.
fn stock(ctx: &ReducerContext) -> Vec<Home> {
    [Tier::Edge, Tier::Inner]
        .into_iter()
        .flat_map(|tier| {
            ctx.db
                .building()
                .home_tier()
                .filter(tier.code())
                .map(move |r| home_of(&r, tier))
        })
        .collect()
}

/// A new character's arrival: its tenancy, its first position row and its
/// starting kit, together. A world with no generated dwellings writes
/// nothing (the client then starts where it always did); a full stock puts
/// the character on the street at the edge.
pub fn arrive(ctx: &ReducerContext, character_id: u64) {
    let homes = stock(ctx);
    if homes.is_empty() {
        return;
    }
    let occupied = |id: u64| ctx.db.tenancy().building_id().find(id).is_some();
    let arrival = plan_arrival(character_id, &homes, &occupied);
    write_first_position(ctx, character_id, arrival.spawn.0, arrival.spawn.1, 0);
    let Some(t) = arrival.tenancy else {
        return;
    };
    ctx.db.tenancy().insert(Tenancy {
        tenancy_id: 0,
        building_id: t.home,
        tenant_kind: actor_kind::CHARACTER,
        tenant_id: character_id,
        weekly_rent: t.weekly_rent,
        started_at: ctx.timestamp,
    });
    if let Some(home) = homes.iter().find(|h| h.id == t.home) {
        place_kit(ctx, home.kit);
    }
}

/// The starting kit: a moving box on the flat's floor and the starting
/// cash lying in whole denominations on its cell. Minted by the world, the
/// way the generator places a prop: no citizen authors it.
fn place_kit(ctx: &ReducerContext, (x, y): (i32, i32)) {
    let box_def = sim::balance::value(defs::BALANCE, "housing.starting_box_object_id") as u32;
    let Some(def) = defs::OBJECTS.iter().find(|o| o.id == box_def) else {
        return;
    };
    let Some(chunk_key) = checked_chunk_key(x, y, 0) else {
        return;
    };
    ctx.db.placed_object().insert(PlacedObject {
        object_id: 0,
        def_id: box_def,
        x,
        y,
        floor: 0,
        layer: def.layer,
        orientation: 0,
        chunk_key,
    });
    let Some(pieces) = starting_pieces(defs::DENOMINATIONS, defs::BALANCE) else {
        return;
    };
    for (item, count) in pieces {
        for _ in 0..count {
            let Ok(placed) = Placed::new(x, y, 0, (0, 0), 0) else {
                return;
            };
            let inst = ctx.db.item_instance().insert(ItemInstance {
                instance_id: 0,
                def_id: item,
                created_at: ctx.timestamp,
            });
            ctx.db.item_placed().insert(ItemPlaced {
                instance_id: inst.instance_id,
                x: placed.cell().0,
                y: placed.cell().1,
                floor: placed.floor(),
                offset_x: placed.offset().0,
                offset_y: placed.offset().1,
                orientation: placed.orientation(),
                chunk_key: placed.chunk_key(),
            });
        }
    }
}

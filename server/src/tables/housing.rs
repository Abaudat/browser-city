//! Story 7.1 (FR20, FR145): a character's first flat is a tenancy over a
//! generated dwelling. `sim::housing` decides which flat, where the tenant
//! stands and where the kit goes (`sim::identity::plan_arrival`,
//! `sim::housing::plan_kit`); this file walks the `dwelling` rows by `rank`,
//! skipping the let ones, writes the tenancy, the first position and the
//! starting kit in the caller's transaction, and returns `Err` (rolling the
//! whole `create_character` back) rather than leave a half-made arrival.
//!
//! `dwelling` and `tenancy` are private. `tenant_kind` is a
//! `sim::codes::actor_kind` code, so a citizen's home is the same row kind
//! (NFR24). One tenancy per dwelling: `building_id` is unique.

use sim::codes::actor_kind;
use sim::generated::defs;
use sim::housing::{Home, Tier, plan_kit};
use sim::identity::plan_arrival;
use sim::item_instance::Placed;
use sim::world::checked_chunk_key;
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::item_instance::{ItemInstance, ItemPlaced, item_instance, item_placed};
use super::player_position::write_first_position;
use super::world::{PlacedObject, placed_object};

/// A lettable building: what the generator derived about it, and the let
/// itself. `building_id` is the `building` row's id (primary key, one row
/// per dwelling; absence is "not a dwelling"). Generation facts never
/// change; `asking_rent` is the landlord's and the market's to move later
/// (7.6). Whether a tenancy holds the flat is the `tenancy` rows' alone.
#[derive(Clone)]
#[spacetimedb::table(accessor = dwelling)]
pub struct Dwelling {
    // bc:wide-table: written once at generation; one row of derived facts per dwelling
    #[primary_key]
    pub building_id: u64,
    /// `sim::housing::Tier::code`: 1 edge, 2 inner.
    #[index(btree)]
    pub tier: u8,
    pub density: i32,
    pub affluence: i32,
    /// Laid cells of the interior.
    pub area: u32,
    pub asking_rent: u64,
    /// `sim::housing::Home::rank`, fixed at generation.
    #[index(btree)]
    pub rank: u64,
    pub spawn_x: i32,
    pub spawn_y: i32,
    pub door_x: i32,
    pub door_y: i32,
    pub kit_x: i32,
    pub kit_y: i32,
}

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

/// What a document instance says, in its own table keyed by the instance
/// (never columns on `item_instance`): a tenancy agreement names the
/// tenancy it is the paper of.
#[derive(Clone)]
#[spacetimedb::table(accessor = tenancy_document)]
pub struct TenancyDocument {
    #[primary_key]
    pub instance_id: u64,
    #[index(btree)]
    pub tenancy_id: u64,
}

impl Dwelling {
    /// The row of a derived [`Home`] (`id` is the building row's id).
    pub fn of_home(h: &Home) -> Dwelling {
        Dwelling {
            building_id: h.id,
            tier: h.tier.code(),
            density: h.density,
            affluence: h.affluence,
            area: h.area,
            asking_rent: h.rent,
            rank: h.rank(),
            spawn_x: h.spawn.0,
            spawn_y: h.spawn.1,
            door_x: h.door.0,
            door_y: h.door.1,
            kit_x: h.kit.0,
            kit_y: h.kit.1,
        }
    }
}

fn home_of(row: &Dwelling) -> Option<Home> {
    Some(Home {
        id: row.building_id,
        tier: Tier::from_code(row.tier)?,
        density: row.density,
        affluence: row.affluence,
        rent: row.asking_rent,
        spawn: (row.spawn_x, row.spawn_y),
        door: (row.door_x, row.door_y),
        kit: (row.kit_x, row.kit_y),
        area: row.area,
    })
}

/// A new character's arrival: its tenancy, its first position row, the
/// starting box and the agreement on it, together. A world with no
/// generated dwellings writes nothing (the client then starts where it
/// always did); a full stock puts the character on the street at the edge.
/// Any failure is an `Err`: the caller's transaction rolls back.
pub fn arrive(ctx: &ReducerContext, character_id: u64) -> Result<(), String> {
    // The street: the most edge dwelling's door, by the stable rank index.
    let Some(street) = ctx
        .db
        .dwelling()
        .rank()
        .filter(0..=u64::MAX)
        .next()
        .map(|r| (r.door_x, r.door_y))
    else {
        return Ok(());
    };
    // The open homes in ascending rank: a flat a tenancy holds is skipped
    // (one point lookup), and `plan_arrival` stops at the end of the first
    // rank group with a vacancy.
    let open = ctx
        .db
        .dwelling()
        .rank()
        .filter(0..=u64::MAX)
        .filter(|r| ctx.db.tenancy().building_id().find(r.building_id).is_none())
        .filter_map(|r| home_of(&r));
    let arrival = plan_arrival(character_id, open, street);
    write_first_position(ctx, character_id, arrival.spawn.0, arrival.spawn.1, 0)?;
    let Some(t) = arrival.tenancy else {
        return Ok(());
    };
    let Some(row) = ctx.db.dwelling().building_id().find(t.home) else {
        return Err("the dwelling chosen for a tenancy has no row".to_string());
    };
    let home = home_of(&row).ok_or("a dwelling row has an unknown tier")?;
    let signed = ctx.db.tenancy().insert(Tenancy {
        tenancy_id: 0,
        building_id: t.home,
        tenant_kind: actor_kind::CHARACTER,
        tenant_id: character_id,
        weekly_rent: t.weekly_rent,
        started_at: ctx.timestamp,
    });
    place_kit(ctx, &home, signed.tenancy_id)
}

/// The starting kit, minted by the world the way the generator places a
/// prop (no citizen authors it): the moving box on the flat's floor and
/// the tenancy agreement lying on it. Money is stock and is not minted
/// here.
fn place_kit(ctx: &ReducerContext, home: &Home, tenancy_id: u64) -> Result<(), String> {
    let plan = plan_kit(home);
    let box_def = sim::balance::value(defs::BALANCE, "housing.starting_box_object_id") as u32;
    let doc_item = sim::balance::value(defs::BALANCE, "housing.starting_document_item_id") as u32;
    let def = defs::OBJECTS
        .iter()
        .find(|o| o.id == box_def)
        .ok_or("the starting box object is not in the defs")?;
    if !defs::ITEMS.iter().any(|i| i.id == doc_item) {
        return Err("the starting document item is not in the defs".to_string());
    }
    let (x, y) = plan.box_cell;
    let chunk_key = checked_chunk_key(x, y, 0).ok_or("the starting box cell is not addressable")?;
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
    let (lx, ly) = plan.letter_cell;
    let placed = Placed::new(lx, ly, 0, plan.letter_offset, 0)
        .map_err(|_| "the agreement's placement is out of range".to_string())?;
    let inst = ctx.db.item_instance().insert(ItemInstance {
        instance_id: 0,
        def_id: doc_item,
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
    ctx.db.tenancy_document().insert(TenancyDocument {
        instance_id: inst.instance_id,
        tenancy_id,
    });
    Ok(())
}

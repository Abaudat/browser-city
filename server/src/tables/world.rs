//! World addressing storage (FR117-FR119, NFR33-NFR37, story 1.5): cell
//! facts are always derived, never stored -- there is no dense per-cell
//! table anywhere in this module, and there never will be (a city a few
//! thousand tiles square across a handful of floors is tens of millions of
//! rows per stored cell attribute, which blows every bound in NFR37 and
//! makes the world unreplicable to a browser). What is stored is the
//! placed content a generator writes once: object instances, floor
//! transitions, and building/room ownership areas. `sim::world` is the
//! pure logic that turns these rows into a collision set, a transition
//! resolution or an ownership answer -- nothing here computes any of that
//! itself (NFR28).
//!
//! See `docs/architecture.md`'s "World addressing" section for the
//! permanent decisions this file encodes.

use spacetimedb::Timestamp;

/// One placed object instance, anchored at a cell (FR126): a multi-cell
/// prop is one row, and its extent comes from its definition (`defs/`,
/// epic 2), never from this row -- `def_id` is a plain column with no
/// companion table yet, since nothing resolves it until that epic lands.
/// Orientation and mutable state (if a def ever needs one) belong in their
/// own table keyed to `object_id`, never added as a column here (NFR35):
/// this row is static placement, not hot state.
#[derive(Clone, Default)]
#[spacetimedb::table(accessor = placed_object)]
pub struct PlacedObject {
    #[primary_key]
    #[auto_inc]
    pub object_id: u64,
    /// Not yet backed by a companion table (`defs/` is epic 2) -- resolved
    /// by whichever story first reads it.
    pub def_id: u32,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    /// A rendering-order code (FR123), never a second collision dimension
    /// -- see `layer_code` and `sim::codes::layer`.
    pub layer: u32,
    pub orientation: u8,
    /// `sim::world::chunk_key(x, y, floor)` -- this object's anchor chunk.
    /// A multi-cell object may overhang its anchor chunk; the client
    /// absorbs that with a one-chunk subscription halo (Tech Lead
    /// direction), so this key is never clipped to fit.
    #[index(btree)]
    pub chunk_key: u64,
}

/// One floor transition (FR117): stairs, ramps, ladders, manholes and
/// station steps are all rows here, never a boolean on an object and never
/// a special layer. A door is never one of these rows -- FR118's whole
/// point is that a door is an ordinary walkable `placed_object`-free cell,
/// with no transition, no portal and no load.
#[derive(Clone, Default)]
#[spacetimedb::table(accessor = floor_transition)]
pub struct FloorTransition {
    #[primary_key]
    #[auto_inc]
    pub transition_id: u64,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub target_x: i32,
    pub target_y: i32,
    pub target_floor: i8,
    /// `sim::world::chunk_key(x, y, floor)` -- the anchor cell's chunk,
    /// never the target's.
    #[index(btree)]
    pub chunk_key: u64,
}

/// A building's static description (FR119). Ownership is stored as areas
/// (see `building_area`), not as a per-cell column -- this row is only the
/// surrogate id everything else hangs off.
#[derive(Clone)]
#[spacetimedb::table(accessor = building)]
pub struct Building {
    #[primary_key]
    #[auto_inc]
    pub building_id: u64,
    pub created_at: Timestamp,
}

/// Manual, not derived: `Timestamp` has no `Default` impl. Only ever used
/// as a throwaway row by `tables::restore`'s sequence-floor advance --
/// field values never matter, since that row is deleted again
/// immediately.
impl Default for Building {
    fn default() -> Self {
        Building {
            building_id: 0,
            created_at: Timestamp::UNIX_EPOCH,
        }
    }
}

/// A room's static description (FR119), always inside exactly one
/// building. Static description and hot state never share a table
/// (NFR35): if a room ever needs mutable state, it gets its own table
/// keyed to `room_id`, not a column here.
#[derive(Clone)]
#[spacetimedb::table(accessor = room)]
pub struct Room {
    #[primary_key]
    #[auto_inc]
    pub room_id: u64,
    #[index(btree)]
    pub building_id: u64,
    pub created_at: Timestamp,
}

/// Manual, not derived: see `Building`'s own `impl Default` above.
impl Default for Room {
    fn default() -> Self {
        Room {
            room_id: 0,
            building_id: 0,
            created_at: Timestamp::UNIX_EPOCH,
        }
    }
}

/// One axis-aligned rectangle of a building's ownership (FR119). A
/// non-rectangular building decomposes into several rows sharing one
/// `building_id` -- cell-to-owner is a pure lookup over the rects covering
/// an address (`sim::world::World::ownership_at`). Clipped so the rect
/// lies entirely inside the chunk `chunk_key` names, so a per-chunk
/// subscription of this table is never partial --
/// `sim::world::clip_rect_to_chunks` is what a generator uses to produce
/// that split, and `sim::world::WorldSpec::build` is what rejects a row
/// that violates it (or overlaps another `building_area` row on the same
/// floor).
#[derive(Clone, Default)]
#[spacetimedb::table(accessor = building_area)]
pub struct BuildingArea {
    #[primary_key]
    #[auto_inc]
    pub area_id: u64,
    #[index(btree)]
    pub building_id: u64,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub floor: i8,
    #[index(btree)]
    pub chunk_key: u64,
}

/// One axis-aligned rectangle of a room's ownership (FR119) -- the room
/// analogue of `building_area`. A cell inside a building but not inside
/// any of its rooms (a corridor) has a `building_id` but
/// `sim::world::NO_OWNER` for its room.
#[derive(Clone, Default)]
#[spacetimedb::table(accessor = room_area)]
pub struct RoomArea {
    #[primary_key]
    #[auto_inc]
    pub area_id: u64,
    #[index(btree)]
    pub room_id: u64,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub floor: i8,
    #[index(btree)]
    pub chunk_key: u64,
}

/// The `layer` code's companion data table (NFR36): `rank` (FR123's depth
/// sort key) lives here, on the code's own row, never on a per-cell
/// column -- read by story 1.6, not by anything in this one.
#[spacetimedb::table(accessor = layer_code)]
pub struct LayerCode {
    #[primary_key]
    pub code: u32,
    pub name: String,
    pub rank: u32,
}

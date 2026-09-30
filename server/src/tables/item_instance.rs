//! Item instances (FR95). `item_instance` is the identity -- the one row a
//! move never touches, and what anything keyed by `instance_id` hangs off.
//! The two states are two tables: `item_placed` (a cell, a sub-cell offset
//! and a floor; it references nothing) and `item_held` (a container named
//! by `container_kind` + `container_id`, and a grid slot). An instance has
//! a row in exactly one of them. No foreign key and no cascade: a
//! `container_id` whose object is gone is a dangling reference.
//!
//! Mutable per-instance state lives in its own table keyed by
//! `instance_id`, never as columns here. `sim::item_instance` holds the
//! ranges and the move plans; no reducer applies one yet.

use spacetimedb::Timestamp;

#[derive(Clone)]
#[spacetimedb::table(accessor = item_instance)]
pub struct ItemInstance {
    #[primary_key]
    #[auto_inc]
    pub instance_id: u64,
    /// An `ITEMS` id (`defs/`); no item table.
    pub def_id: u32,
    pub created_at: Timestamp,
}

/// The world form. `chunk_key` is `sim::world::chunk_key(x, y, floor)`, as
/// on `placed_object`.
#[derive(Clone)]
#[spacetimedb::table(accessor = item_placed)]
pub struct ItemPlaced {
    #[primary_key]
    pub instance_id: u64,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub offset_x: u8,
    pub offset_y: u8,
    pub orientation: u8,
    #[index(btree)]
    pub chunk_key: u64,
}

/// The container form. `container_kind` is a `sim::codes::container_kind`
/// code; `container_id` is the id in that kind's own table.
#[derive(Clone)]
#[spacetimedb::table(
    accessor = item_held,
    index(accessor = by_container, btree(columns = [container_kind, container_id]))
)]
pub struct ItemHeld {
    #[primary_key]
    pub instance_id: u64,
    pub container_kind: u32,
    pub container_id: u64,
    pub slot_x: u8,
    pub slot_y: u8,
    pub orientation: u8,
}

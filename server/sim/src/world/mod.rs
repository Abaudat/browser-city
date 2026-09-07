//! World addressing, collision, floor transitions and cell ownership
//! (FR117-FR119). Pure functions and data only (NFR28): everything here is
//! integer arithmetic over caller-supplied geometry, no table, no clock, no
//! network. `../../src/tables/world.rs` is the only thing that ever turns a
//! `placed_object`/`floor_transition`/`building_area`/`room_area` row into
//! the shapes this module consumes -- that resolution (def id to footprint,
//! rasterising colliders) is later stories' job (defs is epic 2); this
//! module is exercised today against hand-built fixtures ([`fixture`]) and
//! `proptest`-generated ones (`../../tests/world_invariants.rs`).
//!
//! Addressing is `(x, y, floor, layer)` (FR117). `x`/`y` are absolute tile
//! coordinates, `floor` is a signed storey index (the subway is -1), and
//! `layer` is a rendering-order code (FR123) read by story 1.6 -- it plays
//! no part in collision here: a collision test only ever consults one
//! floor's merged blocking set, never a layer.

mod chunk;
mod collision;
pub mod fixture;

pub use chunk::{CHUNK_SIZE, chunk_key, unpack_chunk_key};
pub use collision::{
    AreaSpec, FloorCollision, FloorSpec, NO_OWNER, Ownership, Rect, Transition, TransitionSpec,
    World, WorldSpec,
};

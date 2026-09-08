//! World addressing, collision, floor transitions and cell ownership
//! (FR117-FR119). Pure functions and data only (NFR28): everything here is
//! integer arithmetic over caller-supplied geometry, no table, no clock, no
//! network. `../../src/tables/world.rs` is the only thing that ever turns a
//! `placed_object`/`floor_transition`/`building_area`/`room_area` row into
//! the shapes this module consumes -- that resolution (def id to footprint,
//! rasterising colliders) is later stories' job (defs is epic 2); this
//! module is exercised today against hand-built fixtures (`fixture`) and
//! `proptest`-generated ones (`../../tests/invariants.rs`).
//!
//! Addressing is `(x, y, floor, layer)` (FR117). `x`/`y` are absolute tile
//! coordinates, `floor` is a signed storey index (the subway is -1), and
//! `layer` is a rendering-order code (FR123) read by story 1.6 -- it plays
//! no part in collision here: a collision test only ever consults one
//! floor's merged blocking set, never a layer.
//!
//! `fixture` (the hand-authored conformance world module) is compiled only
//! behind the `fixture` Cargo feature: `bounds` enables it for its own
//! dependency and `sim`'s own dev-dependency on itself enables it for
//! `cargo test`, but `browser_city` never enables it, so hand-authored
//! test geometry never reaches the published wasm module.

mod chunk;
mod collision;
#[cfg(feature = "fixture")]
pub mod fixture;

pub use chunk::{
    CHUNK_SIZE, chunk_key, clip_rect_to_chunks, rect_is_within_one_chunk, unpack_chunk_key,
};
pub use collision::{
    AreaSpec, FloorCollision, FloorSpec, MAX_CELLS_PER_FLOOR, NO_OWNER, Ownership, Rect,
    Transition, TransitionSpec, World, WorldSpec, cell_index,
};

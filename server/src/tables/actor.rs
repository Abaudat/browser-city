//! Where actors stand, at chunk grain (FR136). One `actor_location` row
//! per actor -- `(actor_kind, actor_id)` is the natural key, upheld by the
//! write path (`sim::actor_location::plan_move`) because SpacetimeDB has
//! no composite unique constraint.

/// Where one actor is. `chunk_key` exists solely so a chunk filter is
/// expressible as a subscription (a derived value cannot be subscribed
/// to): it is `sim::world::chunk_key`, derived server-side, never a second
/// packing and never a value a client sent. No `x` or `y` is ever added
/// here for consistency with the other spatial tables -- a row rewritten
/// per step would re-send to every subscriber of the chunk; cell-grain
/// position belongs to a table of its own, joined through `actor_id`
/// (hence its index). The row is rewritten only when the actor's chunk or
/// floor changes. `bounds/tests/actor_location_shape.rs` pins this shape.
#[derive(Clone)]
#[spacetimedb::table(accessor = actor_location, public)]
pub struct ActorLocation {
    #[primary_key]
    #[auto_inc]
    pub location_id: u64,
    /// A `sim::codes::actor_kind` code.
    pub actor_kind: u32,
    /// The id in `actor_kind`'s own table.
    #[index(btree)]
    pub actor_id: u64,
    #[index(btree)]
    pub chunk_key: u64,
    pub floor: i8,
}

/// The `actor_kind` code set's companion table (NFR36). Private.
#[spacetimedb::table(accessor = actor_kind)]
pub struct ActorKind {
    #[primary_key]
    pub code: u32,
    pub name: String,
}

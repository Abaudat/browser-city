//! Where actors stand, at chunk grain (FR136). One `actor_location` row
//! per actor -- `(actor_kind, actor_id)` is the natural key, upheld by the
//! write path (`sim::actor_location::plan_move`) because SpacetimeDB has
//! no composite unique constraint.

use sim::actor_location::{Placement, plan_move};
use spacetimedb::{ReducerContext, Table};

/// The one writer of `actor_location` (besides restore): places `(kind, id)`
/// at `(x, y, floor)`. Nothing is written when the chunk and floor are
/// already right, the row is updated in place when either changes, and the
/// first call inserts -- all decided by `sim::actor_location::plan_move`.
/// Story 5.5 calls it from a citizen's chunk-crossing wake-up
/// (`sim::actor_location::crossings`) and from nowhere else;
/// `scripts/ci/check-actor-location-path.sh` holds the accessor to this
/// file, `restore.rs` and `metrics.rs`.
#[expect(
    dead_code,
    reason = "story 5.5's crossing wake-up is its first caller; delete this once it is"
)]
pub fn place_actor(ctx: &ReducerContext, kind: u32, id: u64, x: i32, y: i32, floor: i8) {
    let existing = ctx
        .db
        .actor_location()
        .actor_id()
        .filter(id)
        .find(|r| r.actor_kind == kind);
    let current = existing.as_ref().map(|r| Placement {
        chunk_key: r.chunk_key,
        floor: r.floor,
    });
    let Some(next) = plan_move(current, x, y, floor) else {
        return;
    };
    match existing {
        Some(mut row) => {
            row.chunk_key = next.chunk_key;
            row.floor = next.floor;
            ctx.db.actor_location().location_id().update(row);
        }
        None => {
            ctx.db.actor_location().insert(ActorLocation {
                location_id: 0,
                actor_kind: kind,
                actor_id: id,
                chunk_key: next.chunk_key,
                floor: next.floor,
            });
        }
    }
}

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

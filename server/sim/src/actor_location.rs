//! Where an actor stands, at chunk grain (FR136). `actor_location` exists
//! so a client can subscribe to the actors of a chunk: a derived value
//! cannot be subscribed to, so the chunk is a stored column. It is
//! rewritten only when an actor's chunk or floor changes -- never per
//! step -- and [`plan_move`] is the only thing that decides so. The chunk
//! is always derived here, through [`crate::world::chunk_key`], never
//! taken from a caller.

use crate::codes::actor_kind;
use crate::world::chunk_key;

/// Each actor kind's own table accessor. Feeds `actor_location`'s row
/// bound (`bounds/tests/schema_shape.rs`).
pub const ACTOR_TABLES: &[(u32, &str)] = &[(actor_kind::CITIZEN, "citizen")];

/// What `actor_location` stores about where an actor is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub chunk_key: u64,
    pub floor: i8,
}

/// The write a move requires, if any: `current` is the actor's row (none
/// for an actor never placed), `(x, y, floor)` where it now stands.
/// `None` means the row is already right and nothing is written.
pub fn plan_move(current: Option<Placement>, x: i32, y: i32, floor: i8) -> Option<Placement> {
    let next = Placement {
        chunk_key: chunk_key(x, y, floor),
        floor,
    };
    (current != Some(next)).then_some(next)
}

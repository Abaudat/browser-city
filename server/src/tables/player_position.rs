//! Where a player stands, at cell grain and durable (FR138). One
//! `player_position` row per character; `sim::player_position` plans every
//! write. Nothing here validates speed, distance or collision (FR137).

use sim::player_position::{Write, plan_position};
use sim::reducer_classes::ReducerClass;
use spacetimedb::{ReducerContext, Table, Timestamp};

use super::district::arrival_cell_of;
use super::identity::character_of;
use super::metrics::count_call;

/// A character's feet point: the cell plus the fraction of the cell in
/// 1/`POSITION_UNITS_PER_CELL`. `chunk_key` exists solely so a chunk
/// filter is expressible as a subscription: it is `sim::world::chunk_key`,
/// derived server-side from the position, never a value a client sent. The
/// primary key makes one row per character structural. Nothing else is
/// ever added (no identity, facing, velocity, sequence or online flag).
/// `bounds/tests/player_position_shape.rs` pins this shape.
#[derive(Clone)]
#[spacetimedb::table(accessor = player_position, public)]
pub struct PlayerPosition {
    #[primary_key]
    pub character_id: u64,
    #[index(btree)]
    pub chunk_key: u64,
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub frac_x: u8,
    pub frac_y: u8,
    /// The server's `ctx.timestamp` of the write.
    pub updated_at: Timestamp,
}

/// Writes the caller's own character's position: the reducer takes no
/// character or identity argument, so no caller can write another's row.
/// Refused: a caller with no character, a floor outside the declared range,
/// a cell outside the addressable world. Never panics (NFR41).
#[spacetimedb::reducer]
pub fn set_player_position(
    ctx: &ReducerContext,
    x: i32,
    y: i32,
    floor: i8,
    frac_x: u8,
    frac_y: u8,
) -> Result<(), String> {
    count_call(ctx, ReducerClass::Position);
    let Some(character_id) = character_of(ctx, ctx.sender()) else {
        return Err("no character".to_string());
    };
    let current = ctx.db.player_position().character_id().find(character_id);
    let plan = plan_position(current.is_some(), x, y, floor, frac_x, frac_y)
        .map_err(|e| e.message().to_string())?;
    let (Write::Insert(r) | Write::Update(r)) = plan;
    let row = PlayerPosition {
        character_id,
        chunk_key: r.chunk_key,
        x: r.x,
        y: r.y,
        floor: r.floor,
        frac_x: r.frac_x,
        frac_y: r.frac_y,
        updated_at: ctx.timestamp,
    };
    match plan {
        Write::Insert(_) => {
            ctx.db.player_position().insert(row);
        }
        Write::Update(_) => {
            ctx.db.player_position().character_id().update(row);
        }
    }
    Ok(())
}

/// Places a character that has no position yet at the district's arrival
/// cell; a no-op before a district exists or once a row is there.
pub fn place_at_arrival(ctx: &ReducerContext, character_id: u64) {
    let Some((x, y)) = arrival_cell_of(ctx) else {
        return;
    };
    if ctx
        .db
        .player_position()
        .character_id()
        .find(character_id)
        .is_some()
    {
        return;
    }
    let half = (sim::generated::defs::POSITION_UNITS_PER_CELL / 2) as u8;
    if let Ok(Write::Insert(r) | Write::Update(r)) = plan_position(false, x, y, 0, half, half) {
        ctx.db.player_position().insert(PlayerPosition {
            character_id,
            chunk_key: r.chunk_key,
            x: r.x,
            y: r.y,
            floor: r.floor,
            frac_x: r.frac_x,
            frac_y: r.frac_y,
            updated_at: ctx.timestamp,
        });
    }
}

/// Moves, in place, every position whose cell `standable` refuses to
/// `arrival` (floor 0, the middle of the cell). An update, never a delete;
/// idempotent.
pub fn relocate_stranded(
    ctx: &ReducerContext,
    arrival: (i32, i32),
    standable: impl Fn(i32, i32, i8) -> bool,
) {
    let stranded: Vec<PlayerPosition> = ctx
        .db
        .player_position()
        .iter()
        .filter(|p| !standable(p.x, p.y, p.floor))
        .collect();
    let half = (sim::generated::defs::POSITION_UNITS_PER_CELL / 2) as u8;
    for p in stranded {
        let Ok(Write::Update(r) | Write::Insert(r)) =
            plan_position(true, arrival.0, arrival.1, 0, half, half)
        else {
            continue;
        };
        ctx.db.player_position().character_id().update(PlayerPosition {
            character_id: p.character_id,
            chunk_key: r.chunk_key,
            x: r.x,
            y: r.y,
            floor: r.floor,
            frac_x: r.frac_x,
            frac_y: r.frac_y,
            updated_at: ctx.timestamp,
        });
    }
}

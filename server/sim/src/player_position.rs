//! Where a player stands, at cell grain and durable (FR138). One
//! `player_position` row per character, written by the character's own
//! client. [`plan_position`] is the only thing deciding the write: it
//! derives the chunk itself, through [`crate::world::checked_chunk_key`],
//! and checks only that the floor and cell are addressable -- never speed,
//! distance or collision (FR137: movement is not validated).

use crate::generated::defs::{MAX_FLOOR, MIN_FLOOR};
use crate::world::{ADDRESSABLE_CELL_MAX, ADDRESSABLE_CELL_MIN, checked_chunk_key};

/// The lowest and highest cell either axis may hold.
pub const CELL_MIN: i32 = ADDRESSABLE_CELL_MIN;
pub const CELL_MAX: i32 = ADDRESSABLE_CELL_MAX;

/// What `player_position` stores about where a character is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PositionRow {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub frac_x: u8,
    pub frac_y: u8,
    pub chunk_key: u64,
}

/// Why a position is refused. Never clamped.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionError {
    FloorOutOfRange,
    CellOutOfRange,
}

impl PositionError {
    pub fn message(self) -> &'static str {
        match self {
            PositionError::FloorOutOfRange => "floor is outside the declared range",
            PositionError::CellOutOfRange => "position is outside the addressable world",
        }
    }
}

/// The one write a position report requires.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Write {
    Insert(PositionRow),
    Update(PositionRow),
}

/// The write for a character reporting `(x, y, floor)` plus the fraction of
/// the cell in 1/`POSITION_UNITS_PER_CELL`. `row_exists` is whether the character's
/// own row exists (false before its first report).
pub fn plan_position(
    row_exists: bool,
    x: i32,
    y: i32,
    floor: i8,
    frac_x: u8,
    frac_y: u8,
) -> Result<Write, PositionError> {
    if !(MIN_FLOOR..=MAX_FLOOR).contains(&(floor as i32)) {
        return Err(PositionError::FloorOutOfRange);
    }
    let chunk_key = checked_chunk_key(x, y, floor).ok_or(PositionError::CellOutOfRange)?;
    let row = PositionRow {
        x,
        y,
        floor,
        frac_x,
        frac_y,
        chunk_key,
    };
    Ok(if row_exists {
        Write::Update(row)
    } else {
        Write::Insert(row)
    })
}

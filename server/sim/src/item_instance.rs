//! Item instances (FR95): one discrete item in exactly one of two forms.
//! *Placed* in the world at a cell with a sub-cell offset and a floor, or
//! *held* in a container's grid at a slot. There is no third form and no
//! parent relationship: a placed item references nothing, and a held item
//! names its container by `(kind, id)` alone.
//!
//! Every value is checked on construction and refused when out of range,
//! never clamped or wrapped. A move between forms is a [`MovePlan`]: one
//! delete in the form being left and one insert in the form being entered,
//! so a caller cannot half-apply it. The instance's identity row
//! (`item_instance`) and anything keyed by its id are never part of a plan.

use crate::codes::container_kind;
use crate::generated::defs::COLLIDER_SUBCELLS_PER_CELL;
use crate::world::{ORIENTATIONS, chunk_key};

/// Sub-cell resolution of a placed item's offset: the collider's own.
pub const OFFSET_SUBCELLS: u8 = COLLIDER_SUBCELLS_PER_CELL as u8;

/// The widest a container grid may be per axis, pending each container's
/// own grid (FR94).
pub const MAX_GRID_EXTENT: u8 = 64;

/// The most items one container holds. `item_held`'s row bound is this
/// times `placed_object`'s.
pub const MAX_ITEMS_PER_CONTAINER: u64 = 64;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemError {
    UnknownContainerKind(u32),
    ZeroContainerId,
    OffsetOutOfRange { x: u8, y: u8 },
    SlotOutOfRange { x: u8, y: u8 },
    OrientationOutOfRange(u8),
}

fn orientation_ok(orientation: u8) -> Result<u8, ItemError> {
    if orientation < ORIENTATIONS {
        Ok(orientation)
    } else {
        Err(ItemError::OrientationOutOfRange(orientation))
    }
}

/// The one way to name a container.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct ContainerRef {
    kind: u32,
    id: u64,
}

impl ContainerRef {
    /// `kind` must be a minted `container_kind` code and `id` a real row id
    /// (auto-inc ids start at 1).
    pub fn new(kind: u32, id: u64) -> Result<Self, ItemError> {
        if !container_kind::CODES.iter().any(|c| c.code == kind) {
            return Err(ItemError::UnknownContainerKind(kind));
        }
        if id == 0 {
            return Err(ItemError::ZeroContainerId);
        }
        Ok(Self { kind, id })
    }

    pub fn kind(&self) -> u32 {
        self.kind
    }

    pub fn id(&self) -> u64 {
        self.id
    }
}

/// The world form: a cell, a sub-cell offset within it, and a floor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placed {
    x: i32,
    y: i32,
    floor: i8,
    offset: (u8, u8),
    orientation: u8,
}

impl Placed {
    pub fn new(
        x: i32,
        y: i32,
        floor: i8,
        offset: (u8, u8),
        orientation: u8,
    ) -> Result<Self, ItemError> {
        if offset.0 >= OFFSET_SUBCELLS || offset.1 >= OFFSET_SUBCELLS {
            return Err(ItemError::OffsetOutOfRange {
                x: offset.0,
                y: offset.1,
            });
        }
        Ok(Self {
            x,
            y,
            floor,
            offset,
            orientation: orientation_ok(orientation)?,
        })
    }

    /// The `item_placed.chunk_key` column: derived here and nowhere else.
    pub fn chunk_key(&self) -> u64 {
        chunk_key(self.x, self.y, self.floor)
    }

    pub fn cell(&self) -> (i32, i32) {
        (self.x, self.y)
    }

    pub fn floor(&self) -> i8 {
        self.floor
    }

    pub fn offset(&self) -> (u8, u8) {
        self.offset
    }

    pub fn orientation(&self) -> u8 {
        self.orientation
    }
}

/// The container form: a container and a grid slot in it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Held {
    container: ContainerRef,
    slot: (u8, u8),
    orientation: u8,
}

impl Held {
    pub fn new(
        container: ContainerRef,
        slot: (u8, u8),
        orientation: u8,
    ) -> Result<Self, ItemError> {
        if slot.0 >= MAX_GRID_EXTENT || slot.1 >= MAX_GRID_EXTENT {
            return Err(ItemError::SlotOutOfRange {
                x: slot.0,
                y: slot.1,
            });
        }
        Ok(Self {
            container,
            slot,
            orientation: orientation_ok(orientation)?,
        })
    }

    pub fn container(&self) -> ContainerRef {
        self.container
    }

    pub fn slot(&self) -> (u8, u8) {
        self.slot
    }

    pub fn orientation(&self) -> u8 {
        self.orientation
    }
}

/// Exactly two states; the type admits no third.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Placement {
    Placed(Placed),
    Held(Held),
}

/// A stored form: the table a placement row lives in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Placed,
    Held,
}

impl Placement {
    pub fn form(&self) -> Form {
        match self {
            Placement::Placed(_) => Form::Placed,
            Placement::Held(_) => Form::Held,
        }
    }
}

/// The writes a move comes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MovePlan {
    /// The form changes: delete the row in `delete`, insert `insert` in the
    /// other form -- nothing else.
    Cross { delete: Form, insert: Placement },
    /// The form does not change: the row is updated in place.
    Within(Placement),
    /// Nothing changes: no write.
    Nothing,
}

/// What moving an item from `current` to `target` writes.
pub fn plan_move(current: Placement, target: Placement) -> MovePlan {
    if current == target {
        MovePlan::Nothing
    } else if current.form() == target.form() {
        MovePlan::Within(target)
    } else {
        MovePlan::Cross {
            delete: current.form(),
            insert: target,
        }
    }
}

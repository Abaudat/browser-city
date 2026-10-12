//! The container fit rule (FR94, FR95): the one place "does it go in" is
//! answered, for a player, an NPC packer or a van loader alike.
//!
//! An item's footprint in a grid is its world `bulk`, unchanged, with width
//! and height swapped on odd orientations. A placement fits when every cell
//! it covers is inside the grid and no other item covers one of them.
//! Capacity is that shape check and nothing else: no count, no volume, no
//! sum of areas. Not fitting is an outcome, never an `Err`.

use crate::item_instance::{ContainerRef, Held, ItemError, MovePlan, Placement, plan_move};

/// A width and height, or a column and row, in whole cells.
pub type Cells = (u8, u8);

/// An item already in a grid, as the fit rule sees it. The instance
/// being moved is not an occupant of its own destination: callers either
/// leave it out or pass its id to [`plan_store`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Occupant {
    pub instance_id: u64,
    pub slot: Cells,
    /// The item def's `bulk`, unrotated.
    pub bulk: Cells,
    pub orientation: u8,
}

/// Why a placement is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FitError {
    /// A covered cell lies outside the grid.
    OutOfGrid,
    /// A covered cell is already covered by this occupant.
    Overlaps { instance_id: u64 },
    /// The item is larger than the grid in both orientations: no slot,
    /// however empty the grid.
    NeverFits,
}

/// The cells `bulk` covers at `orientation`: odd orientations swap.
pub fn footprint(bulk: Cells, orientation: u8) -> Cells {
    if orientation % 2 == 1 {
        (bulk.1, bulk.0)
    } else {
        bulk
    }
}

/// Whether an empty `grid` has any placement for `bulk`.
pub fn can_ever_fit(grid: Cells, bulk: Cells) -> bool {
    (bulk.0 <= grid.0 && bulk.1 <= grid.1) || (bulk.1 <= grid.0 && bulk.0 <= grid.1)
}

fn covers(o: &Occupant, x: u16, y: u16) -> bool {
    let (w, h) = footprint(o.bulk, o.orientation);
    let (sx, sy) = (u16::from(o.slot.0), u16::from(o.slot.1));
    x >= sx && x < sx + u16::from(w) && y >= sy && y < sy + u16::from(h)
}

/// Does `bulk` at `orientation` and `slot` fit `grid` beside `occupants`.
/// Never clamps and reads no count.
pub fn fits(
    grid: Cells,
    occupants: &[Occupant],
    bulk: Cells,
    orientation: u8,
    slot: Cells,
) -> Result<(), FitError> {
    if !can_ever_fit(grid, bulk) {
        return Err(FitError::NeverFits);
    }
    let (w, h) = footprint(bulk, orientation);
    let (x0, y0) = (u16::from(slot.0), u16::from(slot.1));
    if x0 + u16::from(w) > u16::from(grid.0) || y0 + u16::from(h) > u16::from(grid.1) {
        return Err(FitError::OutOfGrid);
    }
    for y in y0..y0 + u16::from(h) {
        for x in x0..x0 + u16::from(w) {
            if let Some(o) = occupants.iter().find(|o| covers(o, x, y)) {
                return Err(FitError::Overlaps {
                    instance_id: o.instance_id,
                });
            }
        }
    }
    Ok(())
}

/// The first placement for `bulk`: slots row-major, orientation 0 then 1.
pub fn first_fit(grid: Cells, occupants: &[Occupant], bulk: Cells) -> Option<(Cells, u8)> {
    for y in 0..grid.1 {
        for x in 0..grid.0 {
            for orientation in [0u8, 1] {
                if fits(grid, occupants, bulk, orientation, (x, y)).is_ok() {
                    return Some(((x, y), orientation));
                }
            }
        }
    }
    None
}

/// The cells of `grid` covered by `occupants`, row-major, for a view.
pub fn occupied(grid: Cells, occupants: &[Occupant]) -> Vec<Cells> {
    let mut out = Vec::new();
    for y in 0..grid.1 {
        for x in 0..grid.0 {
            if occupants
                .iter()
                .any(|o| covers(o, u16::from(x), u16::from(y)))
            {
                out.push((x, y));
            }
        }
    }
    out
}

/// What a store comes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Store {
    /// The writes to make.
    Stored(MovePlan),
    /// Nothing is written: a full container is the game working.
    DoesNotFit(FitError),
}

/// Plans moving instance `instance_id`, currently `current`, into
/// `container` at `slot` and `orientation`. The only code that builds a
/// [`Held`] meant for a write, so no writer can skip the fit check. The
/// instance's own cells in `occupants` are ignored, so rotating in place
/// is judged against everything else.
#[allow(clippy::too_many_arguments)]
pub fn plan_store(
    current: Placement,
    container: ContainerRef,
    grid: Cells,
    instance_id: u64,
    occupants: &[Occupant],
    bulk: Cells,
    slot: Cells,
    orientation: u8,
) -> Result<Store, ItemError> {
    let target = Held::new(container, slot, orientation)?;
    let others: Vec<Occupant> = occupants
        .iter()
        .copied()
        .filter(|o| o.instance_id != instance_id)
        .collect();
    match fits(grid, &others, bulk, orientation, slot) {
        Ok(()) => Ok(Store::Stored(plan_move(current, Placement::Held(target)))),
        Err(e) => Ok(Store::DoesNotFit(e)),
    }
}

/// Whether no unrotated placement exists for `bulk` while some rotated
/// one does: the item "needed a rotation".
pub fn needs_rotation(grid: Cells, occupants: &[Occupant], bulk: Cells) -> bool {
    let placeable = |o: u8| {
        (0..grid.1).any(|y| (0..grid.0).any(|x| fits(grid, occupants, bulk, o, (x, y)).is_ok()))
    };
    !placeable(0) && placeable(1)
}

/// The tedium dial's per-attempt verdict (`packing_forced`): the container
/// refused the store, or the item fit only rotated. `occupants` may
/// include the instance itself; it is ignored.
pub fn packing_forced(
    grid: Cells,
    instance_id: u64,
    occupants: &[Occupant],
    bulk: Cells,
    store: &Store,
) -> bool {
    match store {
        Store::DoesNotFit(_) => true,
        Store::Stored(_) => {
            let others: Vec<Occupant> = occupants
                .iter()
                .copied()
                .filter(|o| o.instance_id != instance_id)
                .collect();
            needs_rotation(grid, &others, bulk)
        }
    }
}

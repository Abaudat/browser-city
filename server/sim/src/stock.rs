//! Stock and its holders (FR87). A holder is a `(kind, id)` pair -- a
//! `sim::codes::holder_kind` code plus the id of the row in that kind's
//! own table -- and stock is one line per `(holder, item)`, an unsigned
//! integer in the item's own unit (FR86). Never keyed by room or brand.
//!
//! An absent line is zero and no line stores zero. SpacetimeDB has no
//! composite unique constraint, so that rule lives here: every write goes
//! through [`plan_deposit`] or [`plan_withdraw`], which read the holder's
//! existing lines and say which one row the write lands on.

use crate::codes::holder_kind;

/// The most distinct items one holder may hold. The `stock` table's row
/// bound is this times every holder table's own ceiling.
pub const MAX_LINES_PER_HOLDER: usize = 64;

/// Each holder kind's own table accessor, or `None` while that kind has no
/// table yet (vehicles, municipal facilities). Feeds `stock`'s row bound.
pub const HOLDER_TABLES: &[(u32, Option<&str>)] = &[
    (holder_kind::BUSINESS, Some("business")),
    (holder_kind::CITIZEN, Some("citizen")),
    (holder_kind::VEHICLE, None),
    (holder_kind::BUILDING, Some("building")),
    (holder_kind::MUNICIPAL_FACILITY, None),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HolderError {
    UnknownKind(u32),
    ZeroId,
}

/// The one way to name a holder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct HolderRef {
    kind: u32,
    id: u64,
}

impl HolderRef {
    /// `kind` must be a minted holder-kind code and `id` a real row id
    /// (auto-inc ids start at 1).
    pub fn new(kind: u32, id: u64) -> Result<Self, HolderError> {
        if !holder_kind::CODES.iter().any(|c| c.code == kind) {
            return Err(HolderError::UnknownKind(kind));
        }
        if id == 0 {
            return Err(HolderError::ZeroId);
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

/// One stored `stock` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StockLine {
    pub row_id: u64,
    pub holder: HolderRef,
    pub item_id: u32,
    pub quantity: u64,
}

/// The single write a deposit or withdrawal comes to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    Insert { quantity: u64 },
    Update { row_id: u64, quantity: u64 },
    Delete { row_id: u64 },
    Nothing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StockError {
    /// The result would pass `u64::MAX`.
    QuantityOverflow,
    /// The holder already holds [`MAX_LINES_PER_HOLDER`] other items.
    TooManyLines,
}

/// What a withdrawal actually took, what is left, and the write for it. A
/// shortfall is content (NFR43), not an error: `taken` is then less than
/// asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Withdrawal {
    pub taken: u64,
    pub remaining: u64,
    pub plan: Plan,
}

fn line_of(existing: &[StockLine], holder: HolderRef, item: u32) -> Option<&StockLine> {
    existing
        .iter()
        .find(|l| l.holder == holder && l.item_id == item)
}

/// Adds `amount` of `item` to `holder`. `existing` may hold any lines;
/// only `holder`'s are read.
pub fn plan_deposit(
    existing: &[StockLine],
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Result<Plan, StockError> {
    if amount == 0 {
        return Ok(Plan::Nothing);
    }
    match line_of(existing, holder, item) {
        Some(line) => {
            let quantity = line
                .quantity
                .checked_add(amount)
                .ok_or(StockError::QuantityOverflow)?;
            Ok(Plan::Update {
                row_id: line.row_id,
                quantity,
            })
        }
        None => {
            let held = existing.iter().filter(|l| l.holder == holder).count();
            if held >= MAX_LINES_PER_HOLDER {
                return Err(StockError::TooManyLines);
            }
            Ok(Plan::Insert { quantity: amount })
        }
    }
}

/// Takes up to `amount` of `item` from `holder`.
pub fn plan_withdraw(
    existing: &[StockLine],
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Withdrawal {
    let Some(line) = line_of(existing, holder, item) else {
        return Withdrawal {
            taken: 0,
            remaining: 0,
            plan: Plan::Nothing,
        };
    };
    let taken = amount.min(line.quantity);
    let remaining = line.quantity - taken;
    let plan = if taken == 0 {
        Plan::Nothing
    } else if remaining == 0 {
        Plan::Delete {
            row_id: line.row_id,
        }
    } else {
        Plan::Update {
            row_id: line.row_id,
            quantity: remaining,
        }
    };
    Withdrawal {
        taken,
        remaining,
        plan,
    }
}

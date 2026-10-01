//! Stock and its holders (FR87). A holder is a `(kind, id)` pair -- a
//! `sim::codes::holder_kind` code plus the id of the row in that kind's
//! own table -- and stock is one line per `(holder, item)`, an unsigned
//! integer in the item's own unit (FR86). Never keyed by room or brand.
//!
//! An absent line is zero and no line stores zero. SpacetimeDB has no
//! composite unique constraint, so that rule lives here: every write goes
//! through [`plan_deposit`], [`plan_withdraw`] or [`plan_transfer`], each
//! of which takes an [`Author`] (FR89) and returns a [`Write`], the only
//! thing a stock write can be. They read the holder's existing lines and
//! say which one row the write lands on.

pub use crate::author::{Author, AuthorError, Cause};
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

/// One authored write: who and why, where, and the one row it lands on.
/// Private fields and no public constructor: only this module's plan
/// functions return one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Write {
    author: Author,
    holder: HolderRef,
    item_id: u32,
    plan: Plan,
}

impl Write {
    pub fn author(&self) -> Author {
        self.author
    }

    pub fn holder(&self) -> HolderRef {
        self.holder
    }

    pub fn item_id(&self) -> u32 {
        self.item_id
    }

    pub fn plan(&self) -> Plan {
        self.plan
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StockError {
    /// The result would pass `u64::MAX`.
    QuantityOverflow,
    /// The holder already holds [`MAX_LINES_PER_HOLDER`] other items.
    TooManyLines,
    /// Goods enter a holder only under a procedure step.
    ConsumptionCannotMake,
}

/// What a withdrawal actually took, what is left, and the write for it. A
/// shortfall is content (NFR43), not an error: `taken` is then less than
/// asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Withdrawal {
    pub taken: u64,
    pub remaining: u64,
    pub write: Write,
}

/// What a transfer did. `writes` is empty or the giving and the receiving
/// write, which land in one transaction or not at all. A shortfall leaves
/// `taken` below the ask; a receiver that cannot take the goods leaves
/// `taken` 0 with the reason in `refused` and nothing written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transfer {
    pub taken: u64,
    /// What the giving holder still holds.
    pub remaining: u64,
    pub refused: Option<StockError>,
    pub writes: Vec<Write>,
}

fn line_of(existing: &[StockLine], holder: HolderRef, item: u32) -> Option<&StockLine> {
    existing
        .iter()
        .find(|l| l.holder == holder && l.item_id == item)
}

fn deposit_plan(
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
            let lines = existing.iter().filter(|l| l.holder == holder).count();
            if lines >= MAX_LINES_PER_HOLDER {
                return Err(StockError::TooManyLines);
            }
            Ok(Plan::Insert { quantity: amount })
        }
    }
}

/// Makes `amount` of `item` appear in `holder`: a procedure step only.
/// `existing` may hold any lines; only `holder`'s are read.
pub fn plan_deposit(
    existing: &[StockLine],
    by: Author,
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Result<Write, StockError> {
    match by.cause() {
        Cause::Consumption => Err(StockError::ConsumptionCannotMake),
        Cause::ProcedureStep => Ok(Write {
            author: by,
            holder,
            item_id: item,
            plan: deposit_plan(existing, holder, item, amount)?,
        }),
    }
}

/// Takes up to `amount` of `item` out of `holder`, under either cause.
pub fn plan_withdraw(
    existing: &[StockLine],
    by: Author,
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Withdrawal {
    let mut taken = 0;
    let mut remaining = 0;
    let mut plan = Plan::Nothing;
    if let Some(line) = line_of(existing, holder, item) {
        taken = amount.min(line.quantity);
        remaining = line.quantity - taken;
        plan = if taken == 0 {
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
    }
    Withdrawal {
        taken,
        remaining,
        write: Write {
            author: by,
            holder,
            item_id: item,
            plan,
        },
    }
}

/// Moves up to `amount` of `item` from one holder to another: exactly
/// what is taken lands on the receiver, or nothing moves. A procedure step
/// only.
pub fn plan_transfer(
    existing: &[StockLine],
    by: Author,
    from: HolderRef,
    to: HolderRef,
    item: u32,
    amount: u64,
) -> Transfer {
    transfer(existing, by, from, to, item, amount, false)
}

/// As [`plan_transfer`], but all of `amount` or none of it.
pub fn plan_transfer_exact(
    existing: &[StockLine],
    by: Author,
    from: HolderRef,
    to: HolderRef,
    item: u32,
    amount: u64,
) -> Transfer {
    transfer(existing, by, from, to, item, amount, true)
}

fn transfer(
    existing: &[StockLine],
    by: Author,
    from: HolderRef,
    to: HolderRef,
    item: u32,
    amount: u64,
    exact: bool,
) -> Transfer {
    let at_giver = line_of(existing, from, item).map_or(0, |l| l.quantity);
    let nothing = |refused| Transfer {
        taken: 0,
        remaining: at_giver,
        refused,
        writes: Vec::new(),
    };
    if by.cause() == Cause::Consumption {
        return nothing(Some(StockError::ConsumptionCannotMake));
    }
    if from == to || (exact && at_giver < amount) {
        return nothing(None);
    }
    let give = plan_withdraw(existing, by, from, item, amount);
    if give.taken == 0 {
        return nothing(None);
    }
    match deposit_plan(existing, to, item, give.taken) {
        Err(e) => nothing(Some(e)),
        Ok(plan) => Transfer {
            taken: give.taken,
            remaining: give.remaining,
            refused: None,
            writes: vec![
                give.write,
                Write {
                    author: by,
                    holder: to,
                    item_id: item,
                    plan,
                },
            ],
        },
    }
}

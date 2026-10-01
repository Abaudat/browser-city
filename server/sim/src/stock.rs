//! Stock and its holders (FR87). A holder is a `(kind, id)` pair -- a
//! `sim::codes::holder_kind` code plus the id of the row in that kind's
//! own table -- and stock is one line per `(holder, item)`, an unsigned
//! integer in the item's own unit (FR86). Never keyed by room or brand.
//!
//! An absent line is zero and no line stores zero. SpacetimeDB has no
//! composite unique constraint, so that rule lives here: every write goes
//! through [`plan_make`], [`plan_consume`] or [`plan_transfer`], each of
//! which takes an [`Author`] (FR89) and returns a [`Write`], the only thing
//! a stock write can be. They read the holder's existing lines and
//! say which one row the write lands on.

use crate::author::{Author, Cause};
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

/// The single write a make, a consumption or a move comes to.
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

/// A real error: the caller asked for something that cannot be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StockError {
    /// The result would pass `u64::MAX`.
    QuantityOverflow,
    /// The author's cause may not do this verb.
    CauseNotPermitted,
}

/// The receiving holder has no room for a new line. World content (NFR43),
/// not an error: nothing moved and nothing was destroyed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NoRoom;

/// What a make came to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Made {
    Done(Write),
    NoRoom(NoRoom),
}

/// What a consumption actually took, what is left, and the write for it. A
/// shortfall is content (NFR43), not an error: `taken` is then less than
/// asked.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Withdrawal {
    pub taken: u64,
    pub remaining: u64,
    pub write: Write,
}

/// What a transfer did. `writes` is the giving then the receiving write,
/// which land in one transaction or not at all; `None` when nothing moved.
/// A shortfall leaves `taken` below the ask. `no_room` is set when the
/// receiver cannot take the goods: `taken` is then 0 and nothing is
/// written. It never carries a cause error: that is an `Err`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transfer {
    pub taken: u64,
    /// What the giving holder still holds.
    pub remaining: u64,
    pub no_room: Option<NoRoom>,
    pub writes: Option<[Write; 2]>,
}

#[derive(Clone, Copy)]
enum Verb {
    Make,
    Take,
    Move,
}

/// The one decision on which cause may do which verb. Exhaustive: a third
/// cause does not compile until it is decided here.
fn permit(by: Author, verb: Verb) -> Result<(), StockError> {
    match (by.cause(), verb) {
        (Cause::ProcedureStep, Verb::Make | Verb::Take | Verb::Move) => Ok(()),
        (Cause::Consumption, Verb::Take) => Ok(()),
        (Cause::Consumption, Verb::Make | Verb::Move) => Err(StockError::CauseNotPermitted),
    }
}

fn line_of(existing: &[StockLine], holder: HolderRef, item: u32) -> Option<&StockLine> {
    existing
        .iter()
        .find(|l| l.holder == holder && l.item_id == item)
}

/// `Ok(None)` when the holder has no room for a new line.
fn deposit_plan(
    existing: &[StockLine],
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Result<Option<Plan>, StockError> {
    if amount == 0 {
        return Ok(Some(Plan::Nothing));
    }
    match line_of(existing, holder, item) {
        Some(line) => {
            let quantity = line
                .quantity
                .checked_add(amount)
                .ok_or(StockError::QuantityOverflow)?;
            Ok(Some(Plan::Update {
                row_id: line.row_id,
                quantity,
            }))
        }
        None => {
            let lines = existing.iter().filter(|l| l.holder == holder).count();
            if lines >= MAX_LINES_PER_HOLDER {
                return Ok(None);
            }
            Ok(Some(Plan::Insert { quantity: amount }))
        }
    }
}

/// Makes `amount` of `item` come into existence in `holder`: a procedure
/// step only. Goods that already exist somewhere are moved with
/// [`plan_transfer`], never made again. `existing` may hold any lines; only
/// the holder's own are read.
pub fn plan_make(
    existing: &[StockLine],
    by: Author,
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Result<Made, StockError> {
    permit(by, Verb::Make)?;
    Ok(match deposit_plan(existing, holder, item, amount)? {
        Some(plan) => Made::Done(Write {
            author: by,
            holder,
            item_id: item,
            plan,
        }),
        None => Made::NoRoom(NoRoom),
    })
}

/// Takes up to `amount` of `item` out of existence in `holder`: inputs a
/// step uses up, or what a consumption eats. Never the first half of a
/// move: goods that go somewhere else use [`plan_transfer`].
pub fn plan_consume(
    existing: &[StockLine],
    by: Author,
    holder: HolderRef,
    item: u32,
    amount: u64,
) -> Result<Withdrawal, StockError> {
    permit(by, Verb::Take)?;
    Ok(withdraw(existing, by, holder, item, amount))
}

fn withdraw(
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
) -> Result<Transfer, StockError> {
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
) -> Result<Transfer, StockError> {
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
) -> Result<Transfer, StockError> {
    permit(by, Verb::Move)?;
    let at_giver = line_of(existing, from, item).map_or(0, |l| l.quantity);
    let nothing = |no_room| Transfer {
        taken: 0,
        remaining: at_giver,
        no_room,
        writes: None,
    };
    if from == to || (exact && at_giver < amount) {
        return Ok(nothing(None));
    }
    let give = withdraw(existing, by, from, item, amount);
    if give.taken == 0 {
        return Ok(nothing(None));
    }
    Ok(match deposit_plan(existing, to, item, give.taken)? {
        None => nothing(Some(NoRoom)),
        Some(plan) => Transfer {
            taken: give.taken,
            remaining: give.remaining,
            no_room: None,
            writes: Some([
                give.write,
                Write {
                    author: by,
                    holder: to,
                    item_id: item,
                    plan,
                },
            ]),
        },
    })
}

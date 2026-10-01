//! Cash is stock (FR92). A denomination is an item that carries a face
//! value; a citizen's cash is that citizen's stock lines and a till is the
//! business holder's lines of the same items. This module values a handful
//! of pieces, chooses change and plans a payment as ordinary authored
//! transfers. It takes the denomination table as a parameter, names no
//! item, never makes or destroys a piece, and never builds an `Author`.
//!
//! A payment that cannot be made is a [`Payment`] variant, never an `Err`
//! (NFR43): nothing moved, nothing is logged. A [`CashError`] is only what
//! cannot be.

use std::collections::BTreeMap;

use crate::author::Author;
use crate::generated::defs::Denomination;
use crate::stock::{HolderRef, StockError, StockLine, Write, plan_transfer_all};

/// A real error: the caller asked for something that cannot be.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CashError {
    /// The stock layer refused: an overflow or a cause that may not move
    /// stock.
    Stock(StockError),
    /// A tendered item is not a denomination.
    NotADenomination(u32),
    /// A value passes `u64::MAX`.
    ValueOverflow,
}

/// Which side of the counter could not take what the payment gives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Till,
    Customer,
}

/// What a payment came to. Only `Paid` carries writes, which land in one
/// transaction or not at all. Every other variant is something a person at
/// the counter could watch: nothing moved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Payment {
    /// Tender went to the till and `change` (possibly empty) came back.
    Paid {
        change: BTreeMap<u32, u64>,
        writes: Vec<Write>,
    },
    /// The tender is worth less than the price.
    TenderBelowPrice,
    /// The customer does not hold this much of the item.
    TenderNotHeld { item_id: u32 },
    /// The tender holds a piece the price does not need: the change due
    /// reaches its face value.
    SuperfluousPiece { item_id: u32 },
    /// No combination of what the till holds makes the change due.
    NoChange,
    /// This side would pass the line ceiling.
    NoRoom(Side),
}

fn face_of(denoms: &[Denomination], item: u32) -> Option<u32> {
    denoms
        .iter()
        .find(|d| d.item_id == item)
        .map(|d| d.face_value)
}

fn quantity_of(existing: &[StockLine], holder: HolderRef, item: u32) -> u64 {
    existing
        .iter()
        .find(|l| l.holder == holder && l.item_id == item)
        .map_or(0, |l| l.quantity)
}

/// The face value of a handful: a checked sum, thrown away after use. A
/// zero quantity counts for nothing; an item that is not a denomination is
/// an error.
pub fn value_of(lot: &BTreeMap<u32, u64>, denoms: &[Denomination]) -> Result<u64, CashError> {
    let mut total: u64 = 0;
    for (&item, &quantity) in lot.iter().filter(|&(_, &q)| q > 0) {
        let face = face_of(denoms, item).ok_or(CashError::NotADenomination(item))?;
        let worth = quantity
            .checked_mul(u64::from(face))
            .ok_or(CashError::ValueOverflow)?;
        total = total.checked_add(worth).ok_or(CashError::ValueOverflow)?;
    }
    Ok(total)
}

/// The pieces `holder` holds that sum to exactly `amount`: `None` only when
/// no combination of what it holds does. Fewest pieces; ties to more of the
/// larger denomination, whatever order the table is in. Iterative; cost is
/// a function of `amount` and the table, never of the quantities held.
/// `amount` is expected to be small (a change due is below a face value).
pub fn choose_change(
    existing: &[StockLine],
    holder: HolderRef,
    amount: u64,
    denoms: &[Denomination],
) -> Option<BTreeMap<u32, u64>> {
    let mut table: Vec<Denomination> = denoms
        .iter()
        .copied()
        .filter(|d| d.face_value > 0)
        .collect();
    table.sort_by(|a, b| b.face_value.cmp(&a.face_value));
    let target = usize::try_from(amount).ok()?;
    // Pieces of each kind that could ever matter.
    let usable: Vec<usize> = table
        .iter()
        .map(|d| {
            let held = quantity_of(existing, holder, d.item_id);
            let fits = amount / u64::from(d.face_value);
            usize::try_from(held.min(fits)).unwrap_or(usize::MAX)
        })
        .collect();
    let face = |k: usize| table[k].face_value as usize;

    // fewest[k][a]: fewest pieces of kinds k.. that make a, if any do.
    let mut fewest: Vec<Vec<Option<u64>>> = vec![vec![None; target + 1]; table.len() + 1];
    fewest[table.len()][0] = Some(0);
    for k in (0..table.len()).rev() {
        for a in 0..=target {
            let mut best: Option<u64> = None;
            for c in 0..=usable[k].min(a / face(k)) {
                if let Some(rest) = fewest[k + 1][a - c * face(k)] {
                    let pieces = rest + c as u64;
                    best = Some(best.map_or(pieces, |b| b.min(pieces)));
                }
            }
            fewest[k][a] = best;
        }
    }
    let total = fewest[0][target]?;

    // Walk the table largest first, taking as many of each kind as still
    // reaches the fewest total.
    let mut change = BTreeMap::new();
    let mut left = target;
    let mut remaining = total;
    for k in 0..table.len() {
        for c in (0..=usable[k].min(left / face(k))).rev() {
            let rest = fewest[k + 1][left - c * face(k)];
            if rest.is_some_and(|r| r + c as u64 == remaining) {
                if c > 0 {
                    change.insert(table[k].item_id, c as u64);
                }
                left -= c * face(k);
                remaining -= c as u64;
                break;
            }
        }
    }
    Some(change)
}

/// Plans a cash payment as one unit: the tender moves customer to till and
/// the change moves till to customer, every write under `by`, or none. The
/// change due is below the smallest tendered piece, so the two lots share
/// no item, no row is planned twice and the till's change is the same
/// whether or not the tender has landed. A line one direction empties is
/// room for the other.
pub fn plan_payment(
    existing: &[StockLine],
    by: Author,
    customer: HolderRef,
    till: HolderRef,
    tender: &BTreeMap<u32, u64>,
    price: u64,
    denoms: &[Denomination],
) -> Result<Payment, CashError> {
    let value = value_of(tender, denoms)?;
    let pieces: Vec<(u32, u64)> = tender
        .iter()
        .filter(|&(_, &q)| q > 0)
        .map(|(&i, &q)| (i, q))
        .collect();
    if let Some(&(item_id, _)) = pieces
        .iter()
        .find(|&&(i, q)| quantity_of(existing, customer, i) < q)
    {
        return Ok(Payment::TenderNotHeld { item_id });
    }
    let Some(due) = value.checked_sub(price) else {
        return Ok(Payment::TenderBelowPrice);
    };
    let smallest = pieces
        .iter()
        .filter_map(|&(i, _)| face_of(denoms, i).map(|f| (f, i)))
        .min();
    if let Some((face, item_id)) = smallest {
        if due >= u64::from(face) {
            return Ok(Payment::SuperfluousPiece { item_id });
        }
    }
    let Some(change) = choose_change(existing, till, due, denoms) else {
        return Ok(Payment::NoChange);
    };

    // Each direction is planned against the lines as the other leaves them:
    // a line a lot empties no longer counts against its holder's ceiling.
    let tender_view = without_emptied(existing, till, &change);
    let change_view = without_emptied(existing, customer, tender);

    let paid =
        plan_transfer_all(&tender_view, by, customer, till, tender).map_err(CashError::Stock)?;
    if let Some(item_id) = paid.short {
        return Ok(Payment::TenderNotHeld { item_id });
    }
    if paid.no_room.is_some() {
        return Ok(Payment::NoRoom(Side::Till));
    }
    let back =
        plan_transfer_all(&change_view, by, till, customer, &change).map_err(CashError::Stock)?;
    if back.short.is_some() {
        return Ok(Payment::NoChange);
    }
    if back.no_room.is_some() {
        return Ok(Payment::NoRoom(Side::Customer));
    }
    let mut writes = paid.writes;
    writes.extend(back.writes);
    Ok(Payment::Paid { change, writes })
}

/// `existing` minus the lines of `holder` that `lot` takes in full.
fn without_emptied(
    existing: &[StockLine],
    holder: HolderRef,
    lot: &BTreeMap<u32, u64>,
) -> Vec<StockLine> {
    existing
        .iter()
        .copied()
        .filter(|l| !(l.holder == holder && lot.get(&l.item_id).is_some_and(|&q| q >= l.quantity)))
        .collect()
}

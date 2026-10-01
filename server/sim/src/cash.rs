//! Cash is stock (FR92). A denomination is an item that plays the role of
//! money; a citizen's cash is that citizen's stock lines and a till is the
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
use crate::generated::defs::{Denomination, MAX_FACE_VALUE};
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
    /// A change amount the search will not take: it is at or above
    /// `MAX_FACE_VALUE`.
    AmountOutOfRange,
}

/// Which side of the counter could not take what the payment gives it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Till,
    Customer,
}

/// One side of the counter: a holder and the citizen who authors whatever
/// leaves it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Party {
    pub holder: HolderRef,
    pub by: Author,
}

/// What a payment came to. Only `Paid` carries writes, which land in one
/// transaction or not at all. Every other variant is something a person at
/// the counter could watch: nothing moved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Payment {
    /// The customer's pieces went to the till and the change came back,
    /// netted per denomination: a piece handed over and handed straight
    /// back does not move. `change` is the change chosen from the till and
    /// the tender, possibly empty.
    Paid {
        change: BTreeMap<u32, u64>,
        writes: Vec<Write>,
    },
    /// A holder cannot pay itself: nothing would move.
    SameHolder,
    /// The tender is worth less than the price.
    TenderBelowPrice,
    /// The customer does not hold this much of the item.
    TenderNotHeld { item_id: u32 },
    /// The change due is under `MAX_FACE_VALUE` and no combination of what
    /// the till holds, and what was just tendered, makes it. The till is
    /// short.
    NoChange,
    /// The change due reached `MAX_FACE_VALUE`, so whole tendered pieces
    /// went back, largest first, and what remains cannot be made. Not a
    /// short till: the tender is too big for the search to settle.
    TenderTooLarge,
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

/// The denominations worth anything, largest face value first.
fn largest_first(denoms: &[Denomination]) -> Vec<Denomination> {
    let mut table: Vec<Denomination> = denoms
        .iter()
        .copied()
        .filter(|d| d.face_value > 0)
        .collect();
    table.sort_by_key(|d| std::cmp::Reverse(d.face_value));
    table
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

/// The pieces out of `available` (item to quantity) that sum to exactly
/// `amount`: `Ok(None)` only when no combination of them does. Fewest
/// pieces; ties to more of the larger denomination, whatever order the
/// table is in. An `amount` at or above `MAX_FACE_VALUE` is
/// `Err(AmountOutOfRange)` before anything is allocated. The search is
/// iterative and grows with the square of the amount (a table of `amount`
/// cells per denomination, each taking up to `amount` / face value steps),
/// never with the quantities held; `MAX_FACE_VALUE` is what bounds it, so
/// it may not be raised without changing this search.
pub fn choose_change(
    available: &BTreeMap<u32, u64>,
    amount: u64,
    denoms: &[Denomination],
) -> Result<Option<BTreeMap<u32, u64>>, CashError> {
    if amount >= u64::from(MAX_FACE_VALUE) {
        return Err(CashError::AmountOutOfRange);
    }
    let target = amount as usize;
    let table = largest_first(denoms);
    // Pieces of each kind that could ever matter.
    let usable: Vec<usize> = table
        .iter()
        .map(|d| {
            let held = available.get(&d.item_id).copied().unwrap_or(0);
            held.min(amount / u64::from(d.face_value)) as usize
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
    let Some(total) = fewest[0][target] else {
        return Ok(None);
    };

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
    Ok(Some(change))
}

/// Plans a cash payment as one unit, every write or none. The change is
/// chosen from the till as it stands with the tender in it, and what each
/// side hands over is netted per denomination, so every row moves one way
/// or not at all. What moves customer to till is authored by the
/// customer's `by`, what moves till to customer by the till's. A line one
/// direction empties is room for the other.
///
/// The change is exact while the change due is under `MAX_FACE_VALUE`. At
/// or above it whole tendered pieces go back first, largest first, never
/// more than the due covers, until it is under (they never leave the
/// customer); the change is then exact for what remains, and a remainder
/// that cannot be made is `TenderTooLarge`.
pub fn plan_payment(
    existing: &[StockLine],
    customer: Party,
    till: Party,
    tender: &BTreeMap<u32, u64>,
    price: u64,
    denoms: &[Denomination],
) -> Result<Payment, CashError> {
    if customer.holder == till.holder {
        return Ok(Payment::SameHolder);
    }
    let value = value_of(tender, denoms)?;
    let mut tendered: BTreeMap<u32, u64> = tender
        .iter()
        .filter(|&(_, &q)| q > 0)
        .map(|(&i, &q)| (i, q))
        .collect();
    if let Some((&item_id, _)) = tendered
        .iter()
        .find(|&(&i, &q)| quantity_of(existing, customer.holder, i) < q)
    {
        return Ok(Payment::TenderNotHeld { item_id });
    }
    let Some(mut due) = value.checked_sub(price) else {
        return Ok(Payment::TenderBelowPrice);
    };

    let ceiling = u64::from(MAX_FACE_VALUE);
    let mut handed_back = false;
    for d in largest_first(denoms) {
        if due < ceiling {
            break;
        }
        let face = u64::from(d.face_value);
        let held = tendered.get(&d.item_id).copied().unwrap_or(0);
        let back = (due - (ceiling - 1))
            .div_ceil(face)
            .min(held)
            .min(due / face);
        if back > 0 {
            tendered.insert(d.item_id, held - back);
            due -= back * face;
            handed_back = true;
        }
    }

    // The till as it stands with the tender in it.
    let mut pool: BTreeMap<u32, u64> = BTreeMap::new();
    for d in denoms {
        let total = quantity_of(existing, till.holder, d.item_id)
            .checked_add(tendered.get(&d.item_id).copied().unwrap_or(0))
            .ok_or(CashError::ValueOverflow)?;
        if total > 0 {
            pool.insert(d.item_id, total);
        }
    }
    let Some(change) = choose_change(&pool, due, denoms)? else {
        return Ok(if handed_back {
            Payment::TenderTooLarge
        } else {
            Payment::NoChange
        });
    };

    // Net per denomination: what is handed over minus what comes back.
    let mut to_till = BTreeMap::new();
    let mut to_customer = BTreeMap::new();
    for item in tendered.keys().chain(change.keys()) {
        let over = tendered.get(item).copied().unwrap_or(0);
        let back = change.get(item).copied().unwrap_or(0);
        if over > back {
            to_till.insert(*item, over - back);
        } else if back > over {
            to_customer.insert(*item, back - over);
        }
    }

    let tender_view = without_emptied(existing, till.holder, &to_customer);
    let change_view = without_emptied(existing, customer.holder, &to_till);
    let paid = plan_transfer_all(
        &tender_view,
        customer.by,
        customer.holder,
        till.holder,
        &to_till,
    )
    .map_err(CashError::Stock)?;
    if let Some(item_id) = paid.short {
        return Ok(Payment::TenderNotHeld { item_id });
    }
    if paid.no_room.is_some() {
        return Ok(Payment::NoRoom(Side::Till));
    }
    let back = plan_transfer_all(
        &change_view,
        till.by,
        till.holder,
        customer.holder,
        &to_customer,
    )
    .map_err(CashError::Stock)?;
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

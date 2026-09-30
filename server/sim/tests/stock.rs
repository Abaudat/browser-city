//! Story 6.2 (FR87): stock is held by a holder -- a (kind, id) pair -- and
//! never by a room or a brand. The pure decisions live in `sim::stock`;
//! the module's `stock` table is a thin shell over them.

use sim::codes::holder_kind;
use sim::stock::{
    HOLDER_TABLES, HolderError, HolderRef, MAX_LINES_PER_HOLDER, Plan, StockError, StockLine,
    plan_deposit, plan_withdraw,
};

fn holder(kind: u32, id: u64) -> HolderRef {
    HolderRef::new(kind, id).expect("a valid holder")
}

/// A ledger driver: applies a plan the way the table shell will.
fn apply(
    ledger: &mut Vec<StockLine>,
    next_row: &mut u64,
    holder: HolderRef,
    item: u32,
    plan: Plan,
) {
    match plan {
        Plan::Insert { quantity } => {
            *next_row += 1;
            ledger.push(StockLine {
                row_id: *next_row,
                holder,
                item_id: item,
                quantity,
            });
        }
        Plan::Update { row_id, quantity } => {
            ledger
                .iter_mut()
                .find(|l| l.row_id == row_id)
                .unwrap()
                .quantity = quantity;
        }
        Plan::Delete { row_id } => ledger.retain(|l| l.row_id != row_id),
        Plan::Nothing => {}
    }
}

fn quantity_of(ledger: &[StockLine], holder: HolderRef, item: u32) -> u64 {
    ledger
        .iter()
        .filter(|l| l.holder == holder && l.item_id == item)
        .map(|l| l.quantity)
        .sum()
}

const BEANS: u32 = 1;

#[test]
fn two_cafes_of_one_chain_hold_independent_stock() {
    // Both cafes carry the same brand value; the brand is not part of the
    // holder reference, so the two are told apart by id alone.
    let cafe_a = holder(holder_kind::BUSINESS, 1);
    let cafe_b = holder(holder_kind::BUSINESS, 2);
    assert_ne!(cafe_a, cafe_b);

    let mut ledger = Vec::new();
    let mut next = 0;
    for h in [cafe_a, cafe_b] {
        let plan = plan_deposit(&ledger, h, BEANS, 500).unwrap();
        apply(&mut ledger, &mut next, h, BEANS, plan);
    }
    let w = plan_withdraw(&ledger, cafe_a, BEANS, 500);
    assert_eq!((w.taken, w.remaining), (500, 0));
    apply(&mut ledger, &mut next, cafe_a, BEANS, w.plan);

    assert_eq!(quantity_of(&ledger, cafe_a, BEANS), 0);
    assert_eq!(quantity_of(&ledger, cafe_b, BEANS), 500);
}

#[test]
fn the_same_id_under_two_kinds_is_two_holders() {
    let citizen = holder(holder_kind::CITIZEN, 7);
    let business = holder(holder_kind::BUSINESS, 7);
    assert_ne!(citizen, business);

    let mut ledger = Vec::new();
    let mut next = 0;
    for (h, amount) in [(citizen, 4), (business, 9)] {
        let plan = plan_deposit(&ledger, h, BEANS, amount).unwrap();
        apply(&mut ledger, &mut next, h, BEANS, plan);
    }
    assert_eq!(ledger.len(), 2, "one row per holder, not one per id");

    let w = plan_withdraw(&ledger, citizen, BEANS, 4);
    assert_eq!((w.taken, w.remaining), (4, 0));
    apply(&mut ledger, &mut next, citizen, BEANS, w.plan);
    assert_eq!(quantity_of(&ledger, citizen, BEANS), 0);
    assert_eq!(quantity_of(&ledger, business, BEANS), 9);
}

#[test]
fn withdrawing_zero_from_a_held_line_writes_nothing() {
    let h = holder(holder_kind::BUSINESS, 1);
    let mut ledger = Vec::new();
    let mut next = 0;
    let plan = plan_deposit(&ledger, h, BEANS, 3).unwrap();
    apply(&mut ledger, &mut next, h, BEANS, plan);
    let w = plan_withdraw(&ledger, h, BEANS, 0);
    assert_eq!((w.taken, w.remaining, w.plan), (0, 3, Plan::Nothing));
}

#[test]
fn one_holder_and_item_resolve_to_exactly_one_row_however_often_written() {
    let h = holder(holder_kind::CITIZEN, 3);
    let mut ledger = Vec::new();
    let mut next = 0;
    for _ in 0..10 {
        let plan = plan_deposit(&ledger, h, BEANS, 2).unwrap();
        apply(&mut ledger, &mut next, h, BEANS, plan);
    }
    assert_eq!(ledger.len(), 1);
    assert_eq!(ledger[0].quantity, 20);
}

#[test]
fn an_absent_row_is_zero_and_no_row_stores_zero() {
    let h = holder(holder_kind::CITIZEN, 3);
    let mut ledger = Vec::new();
    let mut next = 0;
    // Depositing nothing creates nothing.
    assert_eq!(plan_deposit(&ledger, h, BEANS, 0).unwrap(), Plan::Nothing);
    let plan = plan_deposit(&ledger, h, BEANS, 5).unwrap();
    apply(&mut ledger, &mut next, h, BEANS, plan);
    // Withdrawing everything deletes the row.
    let w = plan_withdraw(&ledger, h, BEANS, 5);
    assert!(matches!(w.plan, Plan::Delete { .. }));
    apply(&mut ledger, &mut next, h, BEANS, w.plan);
    assert!(ledger.is_empty());
    // Withdrawing from an absent row takes nothing and writes nothing.
    let w = plan_withdraw(&ledger, h, BEANS, 5);
    assert_eq!((w.taken, w.remaining, w.plan), (0, 0, Plan::Nothing));
}

#[test]
fn a_withdrawal_reports_a_shortfall_and_never_underflows() {
    let h = holder(holder_kind::BUSINESS, 1);
    let mut ledger = Vec::new();
    let mut next = 0;
    let plan = plan_deposit(&ledger, h, BEANS, 3).unwrap();
    apply(&mut ledger, &mut next, h, BEANS, plan);
    let w = plan_withdraw(&ledger, h, BEANS, 10);
    assert_eq!((w.taken, w.remaining), (3, 0));
    let w = plan_withdraw(&ledger, h, BEANS, 2);
    assert_eq!((w.taken, w.remaining), (2, 1));
    assert_eq!(
        w.plan,
        Plan::Update {
            row_id: 1,
            quantity: 1
        }
    );
}

#[test]
fn a_deposit_past_the_type_range_is_a_typed_error_never_wrapped_or_clamped() {
    let h = holder(holder_kind::BUSINESS, 1);
    let full = StockLine {
        row_id: 1,
        holder: h,
        item_id: BEANS,
        quantity: u64::MAX,
    };
    assert_eq!(
        plan_deposit(&[full], h, BEANS, 1),
        Err(StockError::QuantityOverflow)
    );
    let nearly = StockLine {
        quantity: u64::MAX - 1,
        ..full
    };
    assert_eq!(
        plan_deposit(&[nearly], h, BEANS, 1).unwrap(),
        Plan::Update {
            row_id: 1,
            quantity: u64::MAX
        }
    );
}

#[test]
fn a_holder_may_hold_at_most_the_line_ceiling_of_distinct_items() {
    let h = holder(holder_kind::CITIZEN, 1);
    let other = holder(holder_kind::CITIZEN, 2);
    let mut ledger = Vec::new();
    let mut next = 0;
    for item in 0..MAX_LINES_PER_HOLDER as u32 {
        let plan = plan_deposit(&ledger, h, item, 1).unwrap();
        apply(&mut ledger, &mut next, h, item, plan);
    }
    // One past the ceiling is refused ...
    assert_eq!(
        plan_deposit(&ledger, h, MAX_LINES_PER_HOLDER as u32, 1),
        Err(StockError::TooManyLines)
    );
    // ... topping up a line already held is not a new line ...
    assert!(plan_deposit(&ledger, h, 0, 1).is_ok());
    // ... and another holder's lines never count against this one's.
    assert!(plan_deposit(&ledger, other, MAX_LINES_PER_HOLDER as u32, 1).is_ok());
}

#[test]
fn a_holder_needs_a_minted_kind_and_a_nonzero_id() {
    assert_eq!(HolderRef::new(99, 1), Err(HolderError::UnknownKind(99)));
    assert_eq!(
        HolderRef::new(holder_kind::CITIZEN, 0),
        Err(HolderError::ZeroId)
    );
    let h = holder(holder_kind::BUILDING, 9);
    assert_eq!((h.kind(), h.id()), (holder_kind::BUILDING, 9));
}

#[test]
fn every_holder_kind_maps_to_a_table_or_none_yet() {
    for c in holder_kind::CODES {
        assert!(
            HOLDER_TABLES.iter().any(|(k, _)| *k == c.code),
            "holder kind {} ({}) has no entry in sim::stock::HOLDER_TABLES",
            c.code,
            c.name
        );
    }
    assert_eq!(HOLDER_TABLES.len(), holder_kind::CODES.len());
}

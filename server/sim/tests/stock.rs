//! Story 6.2 (FR87) and 6.3 (FR89): stock is held by a holder -- a (kind,
//! id) pair -- and never by a room or a brand, and no write can be planned
//! without an author. The pure decisions live in `sim::stock`; the
//! module's `stock` table is a thin shell over them.

use sim::author::{Author, AuthorError, Cause};
use sim::codes::holder_kind;
use sim::stock::{
    HOLDER_TABLES, HolderError, HolderRef, MAX_LINES_PER_HOLDER, Made, NoRoom, Plan, StockError,
    StockLine, Withdrawal, Write, plan_consume, plan_make, plan_transfer, plan_transfer_exact,
};

mod support;
use support::stock_ledger::Ledger;

fn holder(kind: u32, id: u64) -> HolderRef {
    HolderRef::new(kind, id).expect("a valid holder")
}

fn maker() -> Author {
    Author::new(1, Cause::ProcedureStep).unwrap()
}

fn eater() -> Author {
    Author::new(1, Cause::Consumption).unwrap()
}

/// A make that is expected to find room.
fn make(
    lines: &[StockLine],
    by: Author,
    h: HolderRef,
    item: u32,
    amount: u64,
) -> Result<Write, StockError> {
    plan_make(lines, by, h, item, amount).map(|m| match m {
        Made::Done(w) => w,
        Made::NoRoom(_) => panic!("no room"),
    })
}

fn consume(lines: &[StockLine], by: Author, h: HolderRef, item: u32, amount: u64) -> Withdrawal {
    plan_consume(lines, by, h, item, amount).expect("a permitted take")
}

/// Makes `amount` of `item` at `h` under a procedure step.
fn put(ledger: &mut Ledger, h: HolderRef, item: u32, amount: u64) {
    let w = make(ledger.lines(), maker(), h, item, amount).unwrap();
    ledger.apply(&w);
}

const BEANS: u32 = 1;

#[test]
fn two_cafes_of_one_chain_hold_independent_stock() {
    // Both cafes carry the same brand value; the brand is not part of the
    // holder reference, so the two are told apart by id alone.
    let cafe_a = holder(holder_kind::BUSINESS, 1);
    let cafe_b = holder(holder_kind::BUSINESS, 2);
    assert_ne!(cafe_a, cafe_b);

    let mut ledger = Ledger::default();
    for h in [cafe_a, cafe_b] {
        put(&mut ledger, h, BEANS, 500);
    }
    let w = consume(ledger.lines(), eater(), cafe_a, BEANS, 500);
    assert_eq!((w.taken, w.remaining), (500, 0));
    ledger.apply(&w.write);

    assert_eq!(ledger.quantity(cafe_a, BEANS), 0);
    assert_eq!(ledger.quantity(cafe_b, BEANS), 500);
}

#[test]
fn the_same_id_under_two_kinds_is_two_holders() {
    let citizen = holder(holder_kind::CITIZEN, 7);
    let business = holder(holder_kind::BUSINESS, 7);
    assert_ne!(citizen, business);

    let mut ledger = Ledger::default();
    put(&mut ledger, citizen, BEANS, 4);
    put(&mut ledger, business, BEANS, 9);
    assert_eq!(
        ledger.lines().len(),
        2,
        "one row per holder, not one per id"
    );

    let w = consume(ledger.lines(), eater(), citizen, BEANS, 4);
    assert_eq!((w.taken, w.remaining), (4, 0));
    ledger.apply(&w.write);
    assert_eq!(ledger.quantity(citizen, BEANS), 0);
    assert_eq!(ledger.quantity(business, BEANS), 9);
}

#[test]
fn withdrawing_zero_from_a_held_line_writes_nothing() {
    let h = holder(holder_kind::BUSINESS, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, h, BEANS, 3);
    let w = consume(ledger.lines(), eater(), h, BEANS, 0);
    assert_eq!(
        (w.taken, w.remaining, w.write.plan()),
        (0, 3, Plan::Nothing)
    );
}

#[test]
fn one_holder_and_item_resolve_to_exactly_one_row_however_often_written() {
    let h = holder(holder_kind::CITIZEN, 3);
    let mut ledger = Ledger::default();
    for _ in 0..10 {
        put(&mut ledger, h, BEANS, 2);
    }
    assert_eq!(ledger.lines().len(), 1);
    assert_eq!(ledger.lines()[0].quantity, 20);
}

#[test]
fn an_absent_row_is_zero_and_no_row_stores_zero() {
    let h = holder(holder_kind::CITIZEN, 3);
    let mut ledger = Ledger::default();
    // Depositing nothing creates nothing.
    let w = make(ledger.lines(), maker(), h, BEANS, 0).unwrap();
    assert_eq!(w.plan(), Plan::Nothing);
    put(&mut ledger, h, BEANS, 5);
    // Withdrawing everything deletes the row.
    let w = consume(ledger.lines(), eater(), h, BEANS, 5);
    assert!(matches!(w.write.plan(), Plan::Delete { .. }));
    ledger.apply(&w.write);
    assert!(ledger.lines().is_empty());
    // Withdrawing from an absent row takes nothing and writes nothing.
    let w = consume(ledger.lines(), eater(), h, BEANS, 5);
    assert_eq!(
        (w.taken, w.remaining, w.write.plan()),
        (0, 0, Plan::Nothing)
    );
}

#[test]
fn a_withdrawal_reports_a_shortfall_and_never_underflows() {
    let h = holder(holder_kind::BUSINESS, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, h, BEANS, 3);
    let w = consume(ledger.lines(), eater(), h, BEANS, 10);
    assert_eq!((w.taken, w.remaining), (3, 0));
    let w = consume(ledger.lines(), eater(), h, BEANS, 2);
    assert_eq!((w.taken, w.remaining), (2, 1));
    assert_eq!(
        w.write.plan(),
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
        make(&[full], maker(), h, BEANS, 1).unwrap_err(),
        StockError::QuantityOverflow
    );
    let nearly = StockLine {
        quantity: u64::MAX - 1,
        ..full
    };
    assert_eq!(
        make(&[nearly], maker(), h, BEANS, 1).unwrap().plan(),
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
    let mut ledger = Ledger::default();
    for item in 0..MAX_LINES_PER_HOLDER as u32 {
        put(&mut ledger, h, item, 1);
    }
    let l = ledger.lines();
    // One past the ceiling is refused ...
    assert_eq!(
        plan_make(l, maker(), h, MAX_LINES_PER_HOLDER as u32, 1),
        Ok(Made::NoRoom(NoRoom))
    );
    // ... topping up a line already held is not a new line ...
    assert!(make(l, maker(), h, 0, 1).is_ok());
    // ... and another holder's lines never count against this one's.
    assert!(make(l, maker(), other, MAX_LINES_PER_HOLDER as u32, 1).is_ok());
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

// ---- Story 6.3 (FR89): stock moves only by hand ----

/// The cause of a stock write is exactly a procedure step or a consumption
/// event. The match has no wildcard arm: a third cause fails to compile
/// here until this test is edited on purpose.
#[test]
fn the_cause_of_a_stock_write_is_a_step_or_a_consumption_and_nothing_else() {
    for cause in [Cause::ProcedureStep, Cause::Consumption] {
        match cause {
            Cause::ProcedureStep | Cause::Consumption => {}
        }
    }
    let source = include_str!("../src/author.rs");
    let variants = source
        .split("pub enum Cause {")
        .nth(1)
        .and_then(|rest| rest.split('}').next())
        .expect("the Cause enum");
    let count = variants
        .lines()
        .filter(|l| {
            let t = l.trim();
            !t.is_empty() && !t.starts_with("//") && !t.starts_with("#[")
        })
        .count();
    assert_eq!(count, 2, "FR89: exactly two causes, got: {variants}");
}

#[test]
fn an_author_needs_a_citizen() {
    assert_eq!(
        Author::new(0, Cause::ProcedureStep),
        Err(AuthorError::ZeroCitizen)
    );
    assert_eq!(
        Author::new(0, Cause::Consumption),
        Err(AuthorError::ZeroCitizen)
    );
    let a = Author::new(5, Cause::Consumption).unwrap();
    assert_eq!((a.citizen_id(), a.cause()), (5, Cause::Consumption));
}

/// The public functions of `sim::stock` that yield a plan, a withdrawal, a
/// make or a transfer are exactly these four, so a new verb (a "set", an
/// "adjust") is a deliberate edit here; each takes an `Author`; and none
/// takes a `Plan`, a `Write` or a row id to set.
#[test]
fn the_public_write_verbs_are_exactly_make_consume_and_the_two_transfers() {
    let source = include_str!("../src/stock.rs");
    let mut verbs: Vec<String> = Vec::new();
    let mut rest = source;
    while let Some(at) = rest.find("pub fn ") {
        rest = &rest[at + "pub fn ".len()..];
        let end = rest.find('{').expect("a body");
        let sig = &rest[..end];
        let name = sig.split('(').next().unwrap().trim().to_string();
        if sig.contains("&self") {
            continue; // a getter on a finished `Write`
        }
        let (params, ret) = sig.split_once(") ->").unwrap_or((sig, ""));
        if ["Plan", "Write", "Withdrawal", "Transfer", "Made"]
            .iter()
            .any(|t| sig.contains(t))
        {
            assert!(
                params.contains("Author"),
                "FR89: `{name}` yields a write without an author"
            );
            assert!(
                !["Plan", "Write", "row_id", "quantity"]
                    .iter()
                    .any(|t| params.contains(t)),
                "FR89: `{name}` takes a plan, a write or a quantity to set"
            );
            verbs.push(name);
        } else {
            assert!(!ret.contains("Plan"), "`{name}` yields a plan another way");
        }
    }
    verbs.sort();
    assert_eq!(
        verbs,
        [
            "plan_consume",
            "plan_make",
            "plan_transfer",
            "plan_transfer_exact"
        ]
    );
}

#[test]
fn a_write_carries_its_author_holder_and_item() {
    let h = holder(holder_kind::CITIZEN, 3);
    let by = Author::new(9, Cause::ProcedureStep).unwrap();
    let w = make(&[], by, h, BEANS, 4).unwrap();
    assert_eq!((w.author(), w.holder(), w.item_id()), (by, h, BEANS));
}

/// The author on every returned write is the exact one the call was made
/// with: a make, a take (under either cause) and both writes of a move.
#[test]
fn every_write_carries_the_exact_author_it_was_asked_with() {
    let a = holder(holder_kind::BUSINESS, 1);
    let b = holder(holder_kind::CITIZEN, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 10);
    let step = Author::new(7, Cause::ProcedureStep).unwrap();
    let eat = Author::new(8, Cause::Consumption).unwrap();

    assert_eq!(
        make(ledger.lines(), step, b, BEANS, 1).unwrap().author(),
        step
    );
    assert_eq!(
        consume(ledger.lines(), step, a, BEANS, 1).write.author(),
        step
    );
    assert_eq!(
        consume(ledger.lines(), eat, a, BEANS, 1).write.author(),
        eat
    );
    let t = plan_transfer(ledger.lines(), step, a, b, BEANS, 3).unwrap();
    let [give, take] = t.writes.expect("both sides");
    assert_eq!((give.author(), take.author()), (step, step));
    assert_eq!((give.holder(), take.holder()), (a, b));
}

#[test]
fn a_consumption_may_take_but_never_make_or_move() {
    let a = holder(holder_kind::BUSINESS, 1);
    let b = holder(holder_kind::CITIZEN, 3);
    assert_eq!(
        plan_make(&[], eater(), b, BEANS, 1),
        Err(StockError::CauseNotPermitted)
    );
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 3);
    assert_eq!(consume(ledger.lines(), eater(), a, BEANS, 1).taken, 1);
    assert_eq!(
        plan_transfer(ledger.lines(), eater(), a, b, BEANS, 1),
        Err(StockError::CauseNotPermitted)
    );
    assert_eq!(
        plan_transfer_exact(ledger.lines(), eater(), a, b, BEANS, 1),
        Err(StockError::CauseNotPermitted)
    );
}

#[test]
fn a_procedure_step_may_use_up_its_inputs() {
    let a = holder(holder_kind::BUSINESS, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 3);
    assert_eq!(consume(ledger.lines(), maker(), a, BEANS, 2).taken, 2);
}

#[test]
fn a_transfer_moves_goods_from_one_holder_to_another() {
    let a = holder(holder_kind::BUSINESS, 1);
    let b = holder(holder_kind::CITIZEN, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 10);
    let t = plan_transfer(ledger.lines(), maker(), a, b, BEANS, 4).unwrap();
    assert_eq!((t.taken, t.remaining, t.no_room), (4, 6, None));
    for w in t.writes.expect("both sides") {
        ledger.apply(&w);
    }
    assert_eq!(ledger.quantity(a, BEANS), 6);
    assert_eq!(ledger.quantity(b, BEANS), 4);
}

#[test]
fn an_up_to_transfer_takes_what_is_there_and_an_exact_one_all_or_nothing() {
    let a = holder(holder_kind::BUSINESS, 1);
    let b = holder(holder_kind::CITIZEN, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 3);

    let exact = plan_transfer_exact(ledger.lines(), maker(), a, b, BEANS, 5).unwrap();
    assert_eq!((exact.taken, exact.remaining, exact.no_room), (0, 3, None));
    assert!(exact.writes.is_none());

    let up_to = plan_transfer(ledger.lines(), maker(), a, b, BEANS, 5).unwrap();
    assert_eq!((up_to.taken, up_to.remaining), (3, 0));
    let exact = plan_transfer_exact(ledger.lines(), maker(), a, b, BEANS, 3).unwrap();
    assert_eq!(exact.taken, 3);
}

/// No room is content (an outcome, same for a make and a move); overflow
/// is a real error.
#[test]
fn a_receiver_without_room_is_an_outcome_and_an_overflow_is_an_error() {
    let a = holder(holder_kind::BUSINESS, 1);
    let b = holder(holder_kind::CITIZEN, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 3);
    let full = Ledger::from_lines(vec![
        StockLine {
            row_id: 1,
            holder: a,
            item_id: BEANS,
            quantity: 3,
        },
        StockLine {
            row_id: 2,
            holder: b,
            item_id: BEANS,
            quantity: u64::MAX,
        },
    ]);
    assert_eq!(
        plan_transfer(full.lines(), maker(), a, b, BEANS, 1),
        Err(StockError::QuantityOverflow)
    );

    let c = holder(holder_kind::CITIZEN, 2);
    for item in 100..100 + MAX_LINES_PER_HOLDER as u32 {
        put(&mut ledger, c, item, 1);
    }
    let t = plan_transfer(ledger.lines(), maker(), a, c, BEANS, 1).unwrap();
    assert_eq!((t.taken, t.remaining, t.no_room), (0, 3, Some(NoRoom)));
    assert!(t.writes.is_none());
    assert_eq!(
        plan_make(ledger.lines(), maker(), c, BEANS, 1),
        Ok(Made::NoRoom(NoRoom))
    );
}

#[test]
fn a_transfer_to_oneself_writes_nothing() {
    let a = holder(holder_kind::BUSINESS, 1);
    let mut ledger = Ledger::default();
    put(&mut ledger, a, BEANS, 3);
    let t = plan_transfer(ledger.lines(), maker(), a, a, BEANS, 2).unwrap();
    assert_eq!(t.taken, 0);
    assert!(t.writes.is_none());
}

/// A shortfall and a full receiver are returned values (NFR43):
/// `StockError` has no variant for either.
#[test]
fn neither_a_shortfall_nor_a_full_receiver_is_an_error_variant() {
    let source = include_str!("../src/stock.rs");
    let body = source
        .split("pub enum StockError {")
        .nth(1)
        .and_then(|r| r.split('}').next())
        .unwrap()
        .to_lowercase();
    for banned in [
        "insufficient",
        "short",
        "empty",
        "missing",
        "notenough",
        "room",
        "full",
        "lines",
        "ceiling",
    ] {
        assert!(!body.contains(banned), "not an error variant: {banned}");
    }
}

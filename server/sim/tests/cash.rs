//! Story 6.8 (FR92, NFR43): cash is stock. A denomination is an item with
//! a face value, a till is a business holder's lines of those items, and a
//! payment is ordinary authored transfers planned by `sim::cash`. Every
//! test runs on generated denomination sets, never the committed one.

use std::collections::BTreeMap;

use sim::author::{Author, Cause};
use sim::cash::{CashError, Payment, Side, choose_change, plan_payment, value_of};
use sim::codes::holder_kind;
use sim::generated::defs::Denomination;
use sim::stock::{
    HolderRef, MAX_LINES_PER_HOLDER, Made, Plan, StockError, plan_make, plan_transfer_exact,
};

mod support;
use support::stock_ledger::Ledger;

const COIN_2: u32 = 102;
const COIN_5: u32 = 105;
const NOTE_20: u32 = 120;
const BOTTLE: u32 = 1;

fn denoms_of(pairs: &[(u32, u32)]) -> Vec<Denomination> {
    pairs
        .iter()
        .map(|&(item_id, face_value)| Denomination {
            item_id,
            face_value,
        })
        .collect()
}

/// Largest face value first, as the generated table is.
fn denoms() -> Vec<Denomination> {
    denoms_of(&[(NOTE_20, 20), (COIN_5, 5), (COIN_2, 2)])
}

fn till() -> HolderRef {
    HolderRef::new(holder_kind::BUSINESS, 1).unwrap()
}

fn customer() -> HolderRef {
    HolderRef::new(holder_kind::CITIZEN, 1).unwrap()
}

fn third() -> HolderRef {
    HolderRef::new(holder_kind::CITIZEN, 2).unwrap()
}

fn step() -> Author {
    Author::new(1, Cause::ProcedureStep).unwrap()
}

fn lot(pairs: &[(u32, u64)]) -> BTreeMap<u32, u64> {
    pairs.iter().copied().collect()
}

/// A ledger holding exactly these lines, put there by authored makes.
fn ledger_of(holdings: &[(HolderRef, u32, u64)]) -> Ledger {
    let mut ledger = Ledger::default();
    for &(h, item, n) in holdings {
        let Made::Done(w) = plan_make(ledger.lines(), step(), h, item, n).unwrap() else {
            panic!("no room")
        };
        ledger.apply(&w);
    }
    ledger
}

/// `n` distinct non-money lines at `h`.
fn junk(h: HolderRef, n: usize) -> Vec<(HolderRef, u32, u64)> {
    (0..n as u32).map(|i| (h, 1000 + i, 1)).collect()
}

fn held(ledger: &Ledger, h: HolderRef) -> BTreeMap<u32, u64> {
    ledger
        .lines()
        .iter()
        .filter(|l| l.holder == h)
        .map(|l| (l.item_id, l.quantity))
        .collect()
}

fn pay(ledger: &Ledger, tender: &[(u32, u64)], price: u64) -> Payment {
    plan_payment(
        ledger.lines(),
        step(),
        customer(),
        till(),
        &lot(tender),
        price,
        &denoms(),
    )
    .unwrap()
}

fn apply_paid(ledger: &mut Ledger, payment: &Payment) {
    let Payment::Paid { writes, .. } = payment else {
        panic!("expected a completed payment, got {payment:?}")
    };
    for w in writes {
        ledger.apply(w);
    }
}

fn value_in(ledger: &Ledger, h: HolderRef) -> u64 {
    value_of(&held(ledger, h), &denoms()).unwrap()
}

/// AC1: a till is quantities per denomination, never a sum. Both tills
/// hold 20; the same payment completes at one and not at the other.
#[test]
fn two_tills_worth_the_same_hold_different_change() {
    let other = HolderRef::new(holder_kind::BUSINESS, 2).unwrap();
    let ledger = ledger_of(&[
        (till(), COIN_5, 4),
        (other, NOTE_20, 1),
        (customer(), NOTE_20, 1),
    ]);
    assert_eq!(value_in(&ledger, till()), value_in(&ledger, other));
    // A 20 against a price of 15 needs 5 back.
    let at = |t| {
        plan_payment(
            ledger.lines(),
            step(),
            customer(),
            t,
            &lot(&[(NOTE_20, 1)]),
            15,
            &denoms(),
        )
        .unwrap()
    };
    assert!(matches!(at(till()), Payment::Paid { .. }));
    assert_eq!(at(other), Payment::NoChange);
}

/// The ticket's own case: a large note against three coins.
#[test]
fn a_large_note_against_three_coins_cannot_be_changed() {
    let ledger = ledger_of(&[(till(), COIN_2, 3), (customer(), NOTE_20, 1)]);
    assert_eq!(pay(&ledger, &[(NOTE_20, 1)], 5), Payment::NoChange);
}

#[test]
fn a_completed_cash_payment_moves_tender_one_way_and_change_the_other() {
    let mut ledger = ledger_of(&[
        (customer(), NOTE_20, 1),
        (customer(), COIN_2, 1),
        (till(), COIN_5, 3),
        (till(), COIN_2, 2),
    ]);
    let outcome = pay(&ledger, &[(NOTE_20, 1)], 5);
    let Payment::Paid { change, .. } = &outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(change, &lot(&[(COIN_5, 3)]));
    apply_paid(&mut ledger, &outcome);
    assert_eq!(
        held(&ledger, customer()),
        lot(&[(COIN_2, 1), (COIN_5, 3)]),
        "the customer gave the note and took the change"
    );
    assert_eq!(held(&ledger, till()), lot(&[(NOTE_20, 1), (COIN_2, 2)]));
}

#[test]
fn an_exact_tender_moves_no_change() {
    let mut ledger = ledger_of(&[(customer(), COIN_5, 2), (till(), COIN_2, 1)]);
    let outcome = pay(&ledger, &[(COIN_5, 2)], 10);
    let Payment::Paid { change, .. } = &outcome else {
        panic!("{outcome:?}")
    };
    assert!(change.is_empty());
    apply_paid(&mut ledger, &outcome);
    assert_eq!(held(&ledger, till()), lot(&[(COIN_5, 2), (COIN_2, 1)]));
    assert!(held(&ledger, customer()).is_empty());
}

#[test]
fn refusing_the_sale_is_an_outcome_and_writes_nothing() {
    let ledger = ledger_of(&[(till(), COIN_2, 3), (customer(), NOTE_20, 1)]);
    let before = ledger.lines().to_vec();
    assert_eq!(pay(&ledger, &[(NOTE_20, 1)], 5), Payment::NoChange);
    assert_eq!(ledger.lines(), &before[..], "the note never left the hand");
}

#[test]
fn a_tender_below_the_price_is_an_outcome_not_an_error() {
    let ledger = ledger_of(&[(customer(), COIN_5, 1)]);
    assert_eq!(pay(&ledger, &[(COIN_5, 1)], 6), Payment::TenderBelowPrice);
}

#[test]
fn a_tender_of_pieces_the_customer_does_not_hold_is_an_outcome() {
    let ledger = ledger_of(&[(customer(), COIN_5, 1)]);
    assert_eq!(
        pay(&ledger, &[(COIN_5, 2)], 6),
        Payment::TenderNotHeld { item_id: COIN_5 }
    );
}

/// What a payment reports for change is the shortfall a bottle transfer
/// reports: no parallel type.
#[test]
fn a_till_short_of_change_and_a_shop_out_of_bottles_are_the_same_shortfall() {
    let ledger = ledger_of(&[
        (till(), COIN_2, 1),
        (till(), BOTTLE, 1),
        (customer(), NOTE_20, 1),
    ]);
    let bottles =
        plan_transfer_exact(ledger.lines(), step(), till(), customer(), BOTTLE, 2).unwrap();
    let coins = plan_transfer_exact(ledger.lines(), step(), till(), customer(), COIN_2, 3).unwrap();
    assert_eq!(
        (bottles.taken, bottles.no_room, bottles.writes),
        (coins.taken, coins.no_room, coins.writes)
    );
    assert_eq!(pay(&ledger, &[(NOTE_20, 1)], 5), Payment::NoChange);
}

/// Exhaustive: adding a "short of change" or "refused" variant to the error
/// type stops this compiling.
#[test]
fn no_payment_outcome_a_person_could_shrug_at_is_an_error_variant() {
    fn only_what_cannot_be(e: CashError) {
        match e {
            CashError::Stock(StockError::QuantityOverflow | StockError::CauseNotPermitted) => {}
            CashError::NotADenomination(_) | CashError::ValueOverflow => {}
        }
    }
    only_what_cannot_be(CashError::ValueOverflow);
    let ledger = ledger_of(&[(customer(), NOTE_20, 1)]);
    for (tender, price) in [(1, 50), (2, 5)] {
        let outcome = plan_payment(
            ledger.lines(),
            step(),
            customer(),
            till(),
            &lot(&[(NOTE_20, tender)]),
            price,
            &denoms(),
        );
        assert!(outcome.is_ok(), "{outcome:?}");
    }
}

#[test]
fn the_errors_are_a_cause_not_permitted_a_non_denomination_and_an_overflow() {
    let ledger = ledger_of(&[
        (customer(), NOTE_20, 1),
        (customer(), BOTTLE, 1),
        (till(), COIN_5, 3),
    ]);
    let ask = |by, tender: &[(u32, u64)]| {
        plan_payment(
            ledger.lines(),
            by,
            customer(),
            till(),
            &lot(tender),
            5,
            &denoms(),
        )
    };
    assert_eq!(
        ask(Author::new(1, Cause::Consumption).unwrap(), &[(NOTE_20, 1)]),
        Err(CashError::Stock(StockError::CauseNotPermitted))
    );
    assert_eq!(
        ask(step(), &[(BOTTLE, 1)]),
        Err(CashError::NotADenomination(BOTTLE))
    );
}

/// A customer already at the line ceiling who would receive a denomination
/// they do not hold: no sale, and the note stays.
#[test]
fn a_customer_with_no_room_for_the_change_gets_no_sale_and_keeps_the_note() {
    let mut holdings = vec![(customer(), NOTE_20, 2), (till(), COIN_5, 3)];
    holdings.extend(junk(customer(), MAX_LINES_PER_HOLDER - 1));
    let ledger = ledger_of(&holdings);
    let before = ledger.lines().to_vec();
    assert_eq!(
        pay(&ledger, &[(NOTE_20, 1)], 15),
        Payment::NoRoom(Side::Customer)
    );
    assert_eq!(ledger.lines(), &before[..]);
}

/// The slot the tender frees is room for the change: the customer gives up
/// their only note line and takes coins in its place.
#[test]
fn a_line_the_tender_empties_is_room_for_the_change() {
    let mut holdings = vec![(customer(), NOTE_20, 1), (till(), COIN_5, 3)];
    holdings.extend(junk(customer(), MAX_LINES_PER_HOLDER - 1));
    let mut ledger = ledger_of(&holdings);
    let outcome = pay(&ledger, &[(NOTE_20, 1)], 5);
    apply_paid(&mut ledger, &outcome);
    assert_eq!(held(&ledger, customer()).len(), MAX_LINES_PER_HOLDER);
    assert_eq!(ledger.quantity(customer(), COIN_5), 3);
}

#[test]
fn a_till_with_no_room_for_the_tender_gets_no_sale_unless_the_change_empties_a_line() {
    // 63 other lines and one coin line: giving change keeps the line (two
    // coins stay), so the note has nowhere to go.
    let mut full = vec![(customer(), NOTE_20, 1), (till(), COIN_5, 3)];
    full.extend(junk(till(), MAX_LINES_PER_HOLDER - 1));
    let ledger = ledger_of(&full);
    assert_eq!(
        pay(&ledger, &[(NOTE_20, 1)], 15),
        Payment::NoRoom(Side::Till)
    );
    // The same till holding exactly the one coin the change takes: the line
    // is freed and the note takes its place.
    let mut freed = vec![(customer(), NOTE_20, 1), (till(), COIN_5, 1)];
    freed.extend(junk(till(), MAX_LINES_PER_HOLDER - 1));
    let ledger = ledger_of(&freed);
    assert!(matches!(
        pay(&ledger, &[(NOTE_20, 1)], 15),
        Payment::Paid { .. }
    ));
}

/// Change is always smaller than the smallest tendered piece, so the
/// tender and the change never name one item and no row is planned twice.
#[test]
fn a_superfluous_piece_is_an_outcome_so_no_row_is_planned_twice() {
    let ledger = ledger_of(&[
        (customer(), NOTE_20, 1),
        (customer(), COIN_5, 1),
        (till(), COIN_5, 9),
    ]);
    // 20 + 5 for a price of 10: the 5 is superfluous.
    assert_eq!(
        pay(&ledger, &[(NOTE_20, 1), (COIN_5, 1)], 10),
        Payment::SuperfluousPiece { item_id: COIN_5 }
    );
    // Tendering a kind the till could give back is the same outcome.
    let both = ledger_of(&[(customer(), COIN_5, 3), (till(), COIN_5, 9)]);
    assert_eq!(
        pay(&both, &[(COIN_5, 3)], 10),
        Payment::SuperfluousPiece { item_id: COIN_5 }
    );
}

#[test]
fn value_times_quantity_past_the_type_range_is_a_typed_error() {
    let ledger = ledger_of(&[(customer(), NOTE_20, u64::MAX)]);
    let outcome = plan_payment(
        ledger.lines(),
        step(),
        customer(),
        till(),
        &lot(&[(NOTE_20, u64::MAX)]),
        5,
        &denoms(),
    );
    assert_eq!(outcome, Err(CashError::ValueOverflow));
    assert_eq!(
        value_of(&lot(&[(NOTE_20, u64::MAX)]), &denoms()),
        Err(CashError::ValueOverflow)
    );
}

/// AC5's testable half: the refused payment, then an authored transfer of
/// coins from a third holder, then the same payment completes. No helper
/// sets a quantity.
#[test]
fn a_short_till_is_remedied_by_a_transfer_from_another_holder() {
    let mut ledger = ledger_of(&[
        (customer(), NOTE_20, 1),
        (till(), COIN_2, 1),
        (third(), COIN_5, 3),
    ]);
    assert_eq!(pay(&ledger, &[(NOTE_20, 1)], 5), Payment::NoChange);
    let t = plan_transfer_exact(ledger.lines(), step(), third(), till(), COIN_5, 3).unwrap();
    for w in t.writes.expect("coins moved") {
        ledger.apply(&w);
    }
    let outcome = pay(&ledger, &[(NOTE_20, 1)], 5);
    apply_paid(&mut ledger, &outcome);
    assert_eq!(ledger.quantity(customer(), COIN_5), 3);
}

#[test]
fn every_write_of_a_payment_carries_the_exact_author_it_was_asked_with() {
    let ledger = ledger_of(&[(customer(), NOTE_20, 1), (till(), COIN_5, 3)]);
    let by = Author::new(42, Cause::ProcedureStep).unwrap();
    let outcome = plan_payment(
        ledger.lines(),
        by,
        customer(),
        till(),
        &lot(&[(NOTE_20, 1)]),
        5,
        &denoms(),
    )
    .unwrap();
    let Payment::Paid { writes, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(writes.len(), 4);
    assert!(writes.iter().all(|w| w.author() == by));
    assert!(
        writes.iter().all(|w| !matches!(w.plan(), Plan::Nothing)),
        "no empty write is planned"
    );
}

/// Change of 6 from one 5 and three 2s must be found: greedy largest-first
/// would refuse it.
#[test]
fn the_till_makes_change_a_greedy_cashier_would_refuse() {
    let ledger = ledger_of(&[(till(), COIN_5, 1), (till(), COIN_2, 3)]);
    assert_eq!(
        choose_change(ledger.lines(), till(), 6, &denoms()),
        Some(lot(&[(COIN_2, 3)]))
    );
    assert_eq!(choose_change(ledger.lines(), till(), 1, &denoms()), None);
    assert_eq!(
        choose_change(ledger.lines(), till(), 0, &denoms()),
        Some(lot(&[]))
    );
}

/// Fewest pieces; ties to more of the larger denomination; whatever order
/// the table is passed in.
#[test]
fn the_choice_of_change_is_a_total_order() {
    // 10 is two 5s (2 pieces), not five 2s; 12 is 5+5+2.
    let ledger = ledger_of(&[(till(), COIN_5, 4), (till(), COIN_2, 10)]);
    assert_eq!(
        choose_change(ledger.lines(), till(), 10, &denoms()),
        Some(lot(&[(COIN_5, 2)]))
    );
    assert_eq!(
        choose_change(ledger.lines(), till(), 12, &denoms()),
        Some(lot(&[(COIN_5, 2), (COIN_2, 1)]))
    );
    // 10 is 6+4 or 5+5: two pieces either way, so the larger face wins.
    let (six, five, four) = (106, COIN_5, 104);
    let wallet = ledger_of(&[(till(), six, 1), (till(), five, 2), (till(), four, 1)]);
    let table = denoms_of(&[(six, 6), (five, 5), (four, 4)]);
    let reversed = denoms_of(&[(four, 4), (five, 5), (six, 6)]);
    for t in [&table, &reversed] {
        assert_eq!(
            choose_change(wallet.lines(), till(), 10, t),
            Some(lot(&[(six, 1), (four, 1)]))
        );
    }
}

/// Quantities of 10^12 per denomination answer at once: the search is a
/// function of the amount, never of the quantity.
#[test]
fn a_till_of_a_trillion_coins_answers_at_once() {
    const TRILLION: u64 = 1_000_000_000_000;
    let ledger = ledger_of(&[
        (till(), COIN_5, TRILLION),
        (till(), COIN_2, TRILLION),
        (customer(), NOTE_20, 1),
    ]);
    // 999 = 199 fives and two 2s.
    assert_eq!(
        choose_change(ledger.lines(), till(), 999, &denoms()),
        Some(lot(&[(COIN_5, 199), (COIN_2, 2)]))
    );
    assert!(matches!(
        pay(&ledger, &[(NOTE_20, 1)], 3),
        Payment::Paid { .. }
    ));
}

/// Only what `sim::cash` plans lands as stock: the module offers a value, a
/// change choice and a payment, and no way to top a till up.
#[test]
fn the_public_functions_of_cash_are_exactly_these() {
    let source = include_str!("../src/cash.rs");
    let mut names: Vec<&str> = source
        .match_indices("pub fn ")
        .map(|(at, _)| {
            source[at + "pub fn ".len()..]
                .split(['(', '<'])
                .next()
                .unwrap()
                .trim()
        })
        .collect();
    names.sort();
    assert_eq!(names, ["choose_change", "plan_payment", "value_of"]);
    let code: String = source
        .lines()
        .filter(|l| !l.trim_start().starts_with("//"))
        .collect::<Vec<_>>()
        .join("\n");
    for banned in [
        "plan_make",
        "plan_consume",
        "Author::new",
        "Cause",
        "DENOMINATIONS",
        "ITEMS",
        "\"",
    ] {
        assert!(
            !code.contains(banned),
            "cash.rs must not contain {banned:?}"
        );
    }
}

/// The face-value table is read from content: a sorted, unique table with
/// every entry an item of the generated defs.
#[test]
fn the_committed_denominations_are_largest_first_with_unique_face_values() {
    use sim::generated::defs::{DENOMINATIONS, ITEMS, MAX_DENOMINATIONS, MAX_FACE_VALUE};
    assert!(!DENOMINATIONS.is_empty() && DENOMINATIONS.len() <= MAX_DENOMINATIONS);
    for pair in DENOMINATIONS.windows(2) {
        assert!(pair[0].face_value > pair[1].face_value);
    }
    for d in DENOMINATIONS {
        let item = ITEMS.iter().find(|i| i.id == d.item_id).expect("an item");
        assert_eq!(
            (item.face_value, item.shelf_life_minutes),
            (d.face_value, 0)
        );
        assert!(d.face_value <= MAX_FACE_VALUE);
    }
    assert_eq!(
        ITEMS.iter().filter(|i| i.face_value > 0).count(),
        DENOMINATIONS.len()
    );
}

/// A holder paying itself moves nothing, so it is never a completed sale.
#[test]
fn a_holder_paying_itself_is_not_a_paid_sale() {
    let ledger = ledger_of(&[(till(), NOTE_20, 1), (till(), COIN_5, 3)]);
    let outcome = plan_payment(
        ledger.lines(),
        step(),
        till(),
        till(),
        &lot(&[(NOTE_20, 1)]),
        5,
        &denoms(),
    )
    .unwrap();
    assert!(!matches!(outcome, Payment::Paid { .. }), "{outcome:?}");
}

/// The change search answers any amount without panicking.
#[test]
fn choose_change_never_panics_on_the_largest_amount() {
    let ledger = ledger_of(&[(till(), COIN_5, 3)]);
    let _ = choose_change(ledger.lines(), till(), u64::MAX, &denoms());
}

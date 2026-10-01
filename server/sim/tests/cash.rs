//! Story 6.8 (FR92, NFR43): cash is stock. A denomination is an item that
//! plays the role of money, a till is a business holder's lines of those
//! items, and a payment is authored transfers planned by `sim::cash`. Every
//! test runs on generated denomination sets, never the committed one.

use std::collections::BTreeMap;

use sim::author::{Author, Cause};
use sim::cash::{CashError, Party, Payment, Side, choose_change, plan_payment, value_of};
use sim::codes::holder_kind;
use sim::generated::defs::{Denomination, MAX_DENOMINATIONS, MAX_FACE_VALUE};
use sim::stock::{
    HolderRef, MAX_LINES_PER_HOLDER, Made, Plan, StockError, plan_make, plan_transfer_all,
    plan_transfer_exact,
};

mod support;
use support::stock_ledger::Ledger;

const COIN_1: u32 = 101;
const COIN_2: u32 = 102;
const COIN_5: u32 = 105;
const NOTE_10: u32 = 110;
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

fn cust(by: Author) -> Party {
    Party {
        holder: customer(),
        by,
    }
}

fn shop(by: Author) -> Party {
    Party { holder: till(), by }
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

fn pay_with(ledger: &Ledger, table: &[Denomination], tender: &[(u32, u64)], price: u64) -> Payment {
    plan_payment(
        ledger.lines(),
        cust(step()),
        shop(step()),
        &lot(tender),
        price,
        table,
    )
    .unwrap()
}

fn pay(ledger: &Ledger, tender: &[(u32, u64)], price: u64) -> Payment {
    pay_with(ledger, &denoms(), tender, price)
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

fn change_of(
    ledger: &Ledger,
    holder: HolderRef,
    amount: u64,
    table: &[Denomination],
) -> Option<BTreeMap<u32, u64>> {
    choose_change(&held(ledger, holder), amount, table).unwrap()
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
            cust(step()),
            Party {
                holder: t,
                by: step(),
            },
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

/// A customer who owes 6 hands over a 10 and a 1 because the till has one
/// 5: the sale the note alone could not make completes with the odd coin.
#[test]
fn an_odd_coin_completes_a_sale_the_note_alone_could_not() {
    let table = denoms_of(&[(NOTE_10, 10), (COIN_5, 5), (COIN_1, 1)]);
    let mut ledger = ledger_of(&[
        (till(), COIN_5, 1),
        (customer(), NOTE_10, 1),
        (customer(), COIN_1, 1),
    ]);
    assert_eq!(
        pay_with(&ledger, &table, &[(NOTE_10, 1)], 6),
        Payment::NoChange
    );
    let outcome = pay_with(&ledger, &table, &[(NOTE_10, 1), (COIN_1, 1)], 6);
    let Payment::Paid { change, .. } = &outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(change, &lot(&[(COIN_5, 1)]));
    apply_paid(&mut ledger, &outcome);
    assert_eq!(held(&ledger, customer()), lot(&[(COIN_5, 1)]));
    assert_eq!(held(&ledger, till()), lot(&[(NOTE_10, 1), (COIN_1, 1)]));
}

/// Over-tendering is not a refusal: three 5s for a price of 10 completes
/// and one 5 comes back, so the 5s move one way, by the net.
#[test]
fn a_denomination_both_tendered_and_returned_lands_on_one_row() {
    let mut ledger = ledger_of(&[(customer(), COIN_5, 3), (till(), COIN_5, 9)]);
    let outcome = pay(&ledger, &[(COIN_5, 3)], 10);
    let Payment::Paid { change, writes } = &outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(change, &lot(&[(COIN_5, 1)]));
    assert_eq!(writes.len(), 2, "one giving and one receiving write");
    apply_paid(&mut ledger, &outcome);
    assert_eq!(ledger.quantity(till(), COIN_5), 11);
    assert_eq!(ledger.quantity(customer(), COIN_5), 1);
}

/// A holder paying itself moves nothing, so it is never a completed sale.
#[test]
fn a_holder_paying_itself_is_an_outcome_that_moves_nothing() {
    let ledger = ledger_of(&[(till(), NOTE_20, 1), (till(), COIN_5, 3)]);
    let outcome = plan_payment(
        ledger.lines(),
        shop(step()),
        shop(step()),
        &lot(&[(NOTE_20, 1)]),
        5,
        &denoms(),
    )
    .unwrap();
    assert_eq!(outcome, Payment::SameHolder);
}

/// When a payment is `NoChange`, the handful it would need is not in the
/// till: moving it reports the same `short` a lot of bottles gets.
#[test]
fn a_till_short_of_change_and_a_shop_out_of_bottles_are_the_same_shortfall() {
    let ledger = ledger_of(&[
        (till(), COIN_2, 1),
        (till(), BOTTLE, 1),
        (customer(), NOTE_20, 1),
    ]);
    assert_eq!(pay(&ledger, &[(NOTE_20, 1)], 5), Payment::NoChange);
    let move_lot = |item, n| {
        plan_transfer_all(
            ledger.lines(),
            step(),
            till(),
            customer(),
            &lot(&[(item, n)]),
        )
        .unwrap()
    };
    let coins = move_lot(COIN_5, 3);
    let bottles = move_lot(BOTTLE, 2);
    assert_eq!(coins.short, Some(COIN_5));
    assert_eq!(bottles.short, Some(BOTTLE));
    assert_eq!(
        (coins.no_room, coins.writes),
        (bottles.no_room, bottles.writes)
    );
}

/// Exhaustive: adding a variant to either enum stops this compiling, so a
/// new outcome or error is a deliberate edit here.
#[test]
fn every_outcome_and_every_error_is_pinned() {
    fn outcome(p: Payment) -> u8 {
        match p {
            Payment::Paid { .. } => 0,
            Payment::SameHolder => 1,
            Payment::TenderBelowPrice => 2,
            Payment::TenderNotHeld { .. } => 3,
            Payment::NoChange => 4,
            Payment::TenderTooLarge => 6,
            Payment::NoRoom(Side::Till | Side::Customer) => 5,
        }
    }
    fn error(e: CashError) -> u8 {
        match e {
            CashError::Stock(StockError::QuantityOverflow | StockError::CauseNotPermitted) => 0,
            CashError::NotADenomination(_) => 1,
            CashError::ValueOverflow => 2,
            CashError::AmountOutOfRange => 3,
        }
    }
    assert_eq!(outcome(Payment::NoChange), 4);
    assert_eq!(error(CashError::AmountOutOfRange), 3);
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
            cust(by),
            shop(by),
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

#[test]
fn value_times_quantity_past_the_type_range_is_a_typed_error() {
    let ledger = ledger_of(&[(customer(), NOTE_20, u64::MAX)]);
    let outcome = plan_payment(
        ledger.lines(),
        cust(step()),
        shop(step()),
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

/// A payment has two authors: what leaves the customer's holder carries the
/// customer's, what leaves the till the cashier's.
#[test]
fn every_write_of_a_payment_carries_the_author_of_the_side_it_leaves() {
    let ledger = ledger_of(&[(customer(), NOTE_20, 1), (till(), COIN_5, 3)]);
    let (by_customer, by_cashier) = (
        Author::new(42, Cause::ProcedureStep).unwrap(),
        Author::new(43, Cause::ProcedureStep).unwrap(),
    );
    let outcome = plan_payment(
        ledger.lines(),
        cust(by_customer),
        shop(by_cashier),
        &lot(&[(NOTE_20, 1)]),
        5,
        &denoms(),
    )
    .unwrap();
    let Payment::Paid { writes, .. } = outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(writes.len(), 4);
    for w in &writes {
        let want = if w.item_id() == NOTE_20 {
            by_customer
        } else {
            by_cashier
        };
        assert_eq!(w.author(), want, "item {}", w.item_id());
    }
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
        change_of(&ledger, till(), 6, &denoms()),
        Some(lot(&[(COIN_2, 3)]))
    );
    assert_eq!(change_of(&ledger, till(), 1, &denoms()), None);
    assert_eq!(change_of(&ledger, till(), 0, &denoms()), Some(lot(&[])));
}

/// Fewest pieces; ties to more of the larger denomination; whatever order
/// the table is passed in.
#[test]
fn the_choice_of_change_is_a_total_order() {
    // 10 is two 5s (2 pieces), not five 2s; 12 is 5+5+2.
    let ledger = ledger_of(&[(till(), COIN_5, 4), (till(), COIN_2, 10)]);
    assert_eq!(
        change_of(&ledger, till(), 10, &denoms()),
        Some(lot(&[(COIN_5, 2)]))
    );
    assert_eq!(
        change_of(&ledger, till(), 12, &denoms()),
        Some(lot(&[(COIN_5, 2), (COIN_2, 1)]))
    );
    // 10 is 6+4 or 5+5: two pieces either way, so the larger face wins.
    let (six, five, four) = (106, COIN_5, 104);
    let wallet = ledger_of(&[(till(), six, 1), (till(), five, 2), (till(), four, 1)]);
    let table = denoms_of(&[(six, 6), (five, 5), (four, 4)]);
    let reversed = denoms_of(&[(four, 4), (five, 5), (six, 6)]);
    for t in [&table, &reversed] {
        assert_eq!(
            change_of(&wallet, till(), 10, t),
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
        change_of(&ledger, till(), 999, &denoms()),
        Some(lot(&[(COIN_5, 199), (COIN_2, 2)]))
    );
    assert!(matches!(
        pay(&ledger, &[(NOTE_20, 1)], 3),
        Payment::Paid { .. }
    ));
}

/// The worst case the bound admits: a full table including face 1, every
/// line held in the trillions, the largest amount the search takes. No
/// wall-clock: a search that is not bounded simply never finishes.
#[test]
fn the_worst_case_the_bound_admits_returns() {
    const TRILLION: u64 = 1_000_000_000_000;
    let faces: Vec<(u32, u32)> = (1..=MAX_DENOMINATIONS as u32)
        .map(|f| (300 + f, f))
        .collect();
    let table = denoms_of(&faces);
    let holdings: Vec<(HolderRef, u32, u64)> = faces
        .iter()
        .map(|&(item, _)| (till(), item, TRILLION))
        .collect();
    let ledger = ledger_of(&holdings);
    let amount = u64::from(MAX_FACE_VALUE) - 1;
    // 62 sixteens and a seven: 63 pieces, the fewest there can be.
    assert_eq!(
        change_of(&ledger, till(), amount, &table),
        Some(lot(&[(316, 62), (307, 1)]))
    );
}

/// An amount at or above the bound is a typed error before anything is
/// allocated -- never a panic, never `None`, never a huge allocation.
#[test]
fn an_amount_at_or_past_the_bound_is_a_typed_error() {
    let ledger = ledger_of(&[(till(), COIN_5, 3)]);
    for amount in [
        u64::from(MAX_FACE_VALUE),
        1_000_000_000_000,
        u64::MAX - 1,
        u64::MAX,
    ] {
        assert_eq!(
            choose_change(&held(&ledger, till()), amount, &denoms()),
            Err(CashError::AmountOutOfRange),
            "{amount}"
        );
    }
    assert_eq!(
        choose_change(
            &held(&ledger, till()),
            u64::from(MAX_FACE_VALUE) - 1,
            &denoms()
        ),
        Ok(None)
    );
}

/// A change due past the bound is met by handing whole tendered pieces
/// back, never by a refusal: the notes stay with the customer.
#[test]
fn a_change_due_past_the_bound_hands_tendered_pieces_back() {
    let table = denoms_of(&[(NOTE_20, 20), (COIN_5, 5)]);
    let mut ledger = ledger_of(&[(customer(), NOTE_20, 100), (till(), COIN_5, 10)]);
    // 100 notes = 2000 against a price of 20: due 1980, far past the bound.
    let outcome = pay_with(&ledger, &table, &[(NOTE_20, 100)], 20);
    apply_paid(&mut ledger, &outcome);
    assert_eq!(ledger.quantity(till(), NOTE_20), 1);
    assert_eq!(ledger.quantity(customer(), NOTE_20), 99);
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
    use sim::generated::defs::{DENOMINATIONS, ITEMS};
    assert!(!DENOMINATIONS.is_empty() && DENOMINATIONS.len() <= MAX_DENOMINATIONS);
    for pair in DENOMINATIONS.windows(2) {
        assert!(pair[0].face_value > pair[1].face_value);
    }
    for d in DENOMINATIONS {
        let item = ITEMS.iter().find(|i| i.id == d.item_id).expect("an item");
        assert_eq!(item.shelf_life_minutes, 0);
        assert!((1..=MAX_FACE_VALUE).contains(&d.face_value));
    }
}

/// Past the bound the answer is its own outcome, never "the till is short
/// of change": this customer's pile of notes is payable (the 50 goes over,
/// one 20 comes back), but the hand-back takes the 50 first and the 970
/// that remains cannot be made from 20s.
#[test]
fn a_big_pile_of_notes_is_too_large_not_a_till_short_of_change() {
    let note_50 = 150;
    let table = denoms_of(&[(note_50, 50), (NOTE_20, 20)]);
    let ledger = ledger_of(&[
        (customer(), note_50, 1),
        (customer(), NOTE_20, 50),
        (till(), NOTE_20, 1),
    ]);
    // Under the bound the same wallet is paid.
    assert!(matches!(
        pay_with(&ledger, &table, &[(note_50, 1), (NOTE_20, 47)], 30),
        Payment::Paid { .. }
    ));
    assert_eq!(
        pay_with(&ledger, &table, &[(note_50, 1), (NOTE_20, 50)], 30),
        Payment::TenderTooLarge
    );
}

/// With faces 700, 600 and 400 the right change for two 600s against a price
/// of 100 is 700 + 400, but one 600 goes back first and 500 cannot be made:
/// the limit is a pinned behaviour, not a surprise.
#[test]
fn the_search_is_exact_only_under_the_bound() {
    let table = denoms_of(&[(701, 700), (601, 600), (401, 400)]);
    let ledger = ledger_of(&[(customer(), 601, 2), (till(), 701, 1), (till(), 401, 1)]);
    assert_eq!(
        pay_with(&ledger, &table, &[(601, 2)], 100),
        Payment::TenderTooLarge
    );
}

/// A table with a face above the cap is a typed answer, never a panic.
#[test]
fn a_face_above_the_cap_is_a_typed_error_not_a_panic() {
    let table = denoms_of(&[(500, 5000), (COIN_1, 1)]);
    let ledger = ledger_of(&[(customer(), 500, 1), (till(), COIN_1, 5000)]);
    let outcome = plan_payment(
        ledger.lines(),
        cust(step()),
        shop(step()),
        &lot(&[(500, 1)]),
        3800,
        &table,
    );
    assert_eq!(outcome, Err(CashError::AmountOutOfRange));
}

/// Past the bound with two tendered kinds: the hand-back takes the largest
/// first and no more than needed, so the rows and the reported change tell
/// the rules apart. 25 fifties and 10 twenties are tendered against 500
/// (1,200 due); five fifties go back, and 950 comes back as nineteen fifties.
#[test]
fn past_the_bound_the_largest_pieces_go_back_first_and_no_more_than_needed() {
    let (note_50, table) = (150, denoms_of(&[(150, 50), (NOTE_20, 20), (COIN_5, 5)]));
    let mut ledger = ledger_of(&[
        (customer(), note_50, 30),
        (customer(), NOTE_20, 10),
        (till(), COIN_5, 200),
    ]);
    let outcome = pay_with(&ledger, &table, &[(note_50, 30), (NOTE_20, 10)], 500);
    let Payment::Paid { change, .. } = &outcome else {
        panic!("{outcome:?}")
    };
    assert_eq!(change, &lot(&[(note_50, 19)]));
    apply_paid(&mut ledger, &outcome);
    assert_eq!(
        held(&ledger, till()),
        lot(&[(note_50, 6), (NOTE_20, 10), (COIN_5, 200)])
    );
    assert_eq!(held(&ledger, customer()), lot(&[(note_50, 24)]));
}

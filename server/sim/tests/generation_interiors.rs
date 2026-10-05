//! Story 3.5 (AC2): the reject path seen firing. A generator that happens
//! to be right never exercises "regenerated or rejected", so this plants
//! a requirement no layout can meet and asserts the building comes out
//! as a typed, counted `Rejected` -- bounded by the committed attempt cap,
//! never a panic, never a half-emitted room. Lives here, not in
//! `src/generation/interiors.rs`: building a `RuleSet` from a slice is
//! `RuleSet::for_test`, which `check-rule-source.sh` keeps out of every
//! `src/` tree outside `sim::rules`.

use sim::generated::defs;
use sim::generation::envelopes::Envelope;
use sim::generation::interiors::{self, InteriorMap, InteriorOutcome, RejectReason, Vocabulary};
use sim::generation::plots::Plot;
use sim::generation::streets::Side;
use sim::generation::{GenerationConfig, GenerationContent, LandUse};
use sim::rules::RuleSet;
use sim::world::Rect;

const FOOTPRINT: Rect = Rect {
    x0: 100,
    y0: 100,
    x1: 112,
    y1: 111,
};

fn plot_and_envelope() -> (Plot, Envelope) {
    (
        Plot {
            bounds: Rect {
                x0: 100,
                y0: 100,
                x1: 112,
                y1: 114,
            },
            block: 0,
            front: Some(Side::South),
            land_use: LandUse::Residential,
            density: 30,
            open: false,
        },
        Envelope {
            plot: 0,
            footprint: FOOTPRINT,
            front: Side::South,
        },
    )
}

#[test]
fn forcing_every_attempt_to_fail_is_a_typed_counted_rejection_with_no_cells() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let base = GenerationContent::committed();
    let def = base
        .building_types
        .iter()
        .find(|b| b.rooms.len() >= 2)
        .expect("a committed type with a room program");
    let vocab = Vocabulary::new(&base);
    let front = base
        .room_types
        .iter()
        .find(|r| r.id == def.rooms[0])
        .unwrap();
    // The one requirement no layout can meet: the front room owes a
    // million of a fixture it already owes one of.
    let owed = base
        .rules
        .iter()
        .filter_map(|r| r.as_requirement())
        .find(|r| front.tags.contains(&r.container) && r.requires != vocab.parts.floor)
        .expect("the front room owes at least one fixture");
    let rules = [sim::rules::testing::requirement(
        9_999,
        "forced_to_fail",
        owed.container,
        owed.requires,
        1_000_000,
    )];
    let forced = GenerationContent {
        rules: RuleSet::for_test(&rules),
        ..base
    };
    let (plot, env) = plot_and_envelope();
    let out = interiors::lay_out(21, &env, &plot, def, &cfg, &forced, &vocab);
    assert_eq!(
        out,
        InteriorOutcome::Rejected {
            plot: 0,
            building_type: def.id,
            reason: RejectReason::NoValidLayout,
            attempts: cfg.interior_max_layout_attempts,
        },
        "never a panic, never an unbounded loop, never a half-emitted room"
    );
    let map = InteriorMap::test_fixture(vec![out]);
    assert_eq!(map.enterable_count(), 0);
    assert_eq!(map.rejected_count(), 1);
    assert_eq!(map.rejected_percent(), 100);
    assert!(map.building_areas().is_empty() && map.room_areas().is_empty());
}

#[test]
fn a_rule_the_layout_cannot_satisfy_by_one_cell_is_refused_by_its_own_key() {
    // Unsatisfiable only past what a room can hold: one more light than
    // the front room has floor cells. The verdict names the planted rule.
    let base = GenerationContent::committed();
    let def = base
        .building_types
        .iter()
        .find(|b| b.rooms.len() >= 2)
        .unwrap();
    let vocab = Vocabulary::new(&base);
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let (plot, env) = plot_and_envelope();
    let InteriorOutcome::Laid { interior, .. } =
        interiors::lay_out(5, &env, &plot, def, &cfg, &base, &vocab)
    else {
        panic!("the committed content lays this building out");
    };
    let front = base
        .room_types
        .iter()
        .find(|r| r.id == interior.rooms[0].room_type)
        .unwrap();
    let owed = base
        .rules
        .iter()
        .filter_map(|r| r.as_requirement())
        .find(|r| front.tags.contains(&r.container) && r.requires != vocab.parts.floor)
        .unwrap();
    let have = interior
        .fixtures
        .iter()
        .filter(|f| f.room == 0 && f.tag == owed.requires)
        .count() as u32;
    let rules = [sim::rules::testing::requirement(
        9_998,
        "one_more_than_placed",
        owed.container,
        owed.requires,
        have + 1,
    )];
    let strict = RuleSet::for_test(&rules);
    let violations = interiors::check_layout(&interior, &vocab, strict);
    assert!(
        violations
            .iter()
            .any(|v| strict.key_of(v.rule_id) == Some("one_more_than_placed")),
        "the planted rule must be refused by its own key, got {violations:?}"
    );
}

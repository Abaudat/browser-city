//! Story 7.1 (FR20, FR145): the first flat is a tenancy over a dwelling
//! the generator laid out, assigned by a pure plan from stable ids.
//! Everything here is `sim`; the reducers only read, call and write.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use sim::generated::defs;
use sim::generation::{District, GenerationConfig, GenerationContent, Interior, generate};
use sim::housing::{self, Assignment, Dwelling, Home, KitPlan, Tier};
use sim::identity::{Arrival, CreatePlan, plan_arrival, plan_create};

/// The three evidence seeds `bounds::generation_evidence` renders, plus
/// the next two.
const SEEDS: [u64; 5] = [1, 2, 3, 4, 5];

fn world(seed: u64) -> (District, GenerationConfig) {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let (district, _) = generate(seed, &cfg, &content).unwrap();
    (district, cfg)
}

fn dwellings(seed: u64) -> (District, GenerationConfig, Vec<Dwelling>) {
    let (district, cfg) = world(seed);
    let content = GenerationContent::committed();
    let d = housing::dwellings(&district, &cfg, &content, defs::BALANCE);
    (district, cfg, d)
}

fn homes(d: &[Dwelling]) -> Vec<Home> {
    d.iter().map(|x| x.home).collect()
}

fn none_taken(_: u64) -> bool {
    false
}

// --- inv_starting_flat_is_a_generated_dwelling ------------------------

#[test]
fn inv_starting_flat_is_a_generated_dwelling() {
    let content = GenerationContent::committed();
    for seed in SEEDS {
        let (district, _cfg, d) = dwellings(seed);
        let (Assignment::Edge(id) | Assignment::Fallback(id)) =
            housing::plan_assign(7, &homes(&d), &none_taken)
        else {
            panic!("seed {seed}: no flat for the first character");
        };
        let plot = id as u32;
        // Laid: the interior exists.
        let (_, ty, _) = district
            .interiors
            .laid()
            .find(|(p, _, _)| *p == plot)
            .unwrap_or_else(|| panic!("seed {seed}: flat {plot} is not a Laid interior"));
        let def = content.building_types.iter().find(|b| b.id == ty).unwrap();
        assert!(
            def.tags.contains(&housing::dwelling_tag(defs::BALANCE)),
            "seed {seed}: flat {plot} is type {ty}, which carries no dwelling tag"
        );
    }
}

/// Negative control: some seed lays out a building that is no dwelling,
/// so "any building" is observably not "a dwelling".
#[test]
fn a_plan_that_picks_any_building_fails_the_dwelling_invariant() {
    let content = GenerationContent::committed();
    let mut caught = false;
    for seed in SEEDS {
        let (district, cfg) = world(seed);
        let stock: BTreeSet<u32> = housing::dwellings(&district, &cfg, &content, defs::BALANCE)
            .iter()
            .map(|d| d.plot)
            .collect();
        caught |= district
            .interiors
            .laid()
            .any(|(p, _, _)| !stock.contains(&p));
    }
    assert!(
        caught,
        "no seed lays out a building outside the dwelling stock"
    );
}

// --- inv_starting_flat_is_on_the_district_edge ------------------------

#[test]
fn inv_starting_flat_is_on_the_district_edge() {
    for seed in SEEDS {
        let (_district, cfg, d) = dwellings(seed);
        assert!(
            d.iter().any(|x| housing::is_edge(x.home.density, &cfg)),
            "seed {seed}: the district has no edge dwelling at all"
        );
        for character in [1u64, 2, 3, 99, 4_000_000_007] {
            let Assignment::Edge(id) = housing::plan_assign(character, &homes(&d), &none_taken)
            else {
                panic!("seed {seed}, character {character}: not an edge flat");
            };
            let chosen = d.iter().find(|x| u64::from(x.plot) == id).unwrap();
            assert!(
                housing::is_edge(chosen.home.density, &cfg),
                "seed {seed}: flat {id} has density {}, past the periphery",
                chosen.home.density
            );
        }
    }
}

/// Negative control for the edge predicate: the most central dwelling is
/// not on the edge, so a plan that picked it would fail the invariant.
#[test]
fn a_plan_that_picks_the_most_central_dwelling_fails_the_edge_invariant() {
    for seed in SEEDS {
        let (_district, cfg, d) = dwellings(seed);
        let central = d.iter().max_by_key(|x| x.home.density).unwrap();
        assert!(
            !housing::is_edge(central.home.density, &cfg),
            "seed {seed}: the most central dwelling reads as edge"
        );
    }
}

#[test]
fn the_edge_predicate_is_the_generators_periphery_band() {
    let (_d, cfg) = world(1);
    let span = i64::from(cfg.density_max - cfg.density_min).max(1);
    let low_max = i64::from(cfg.density_min) + span / 3;
    assert!(housing::is_edge(low_max as i32, &cfg));
    assert!(!housing::is_edge(low_max as i32 + 1, &cfg));
}

/// Poor reads as small: among the vacant edge flats at the lowest rent,
/// the first character is let one of the smallest interiors.
#[test]
fn the_starting_flat_is_among_the_smallest_at_its_rent() {
    for seed in SEEDS {
        let (_district, _cfg, d) = dwellings(seed);
        let Assignment::Edge(id) = housing::plan_assign(3, &homes(&d), &none_taken) else {
            panic!("seed {seed}: not an edge flat");
        };
        let chosen = d.iter().find(|x| u64::from(x.plot) == id).unwrap();
        let smallest = d
            .iter()
            .filter(|x| x.home.tier == Tier::Edge && x.home.affluence == chosen.home.affluence)
            .map(|x| x.home.area)
            .min()
            .unwrap();
        assert_eq!(chosen.home.area, smallest, "seed {seed}");
    }
}

// --- the figure ------------------------------------------------------------

#[test]
fn the_cheapest_dwelling_asks_the_seed_rent() {
    for seed in SEEDS {
        let (_d, cfg, ds) = dwellings(seed);
        let cheapest = ds.iter().map(|x| x.home.rent).min().unwrap();
        let seed_rent = defs::BALANCE
            .iter()
            .find(|b| b.key == "economy.rent.edge_flat_per_week")
            .unwrap()
            .value as u64;
        assert_eq!(cheapest, seed_rent, "seed {seed}");
        assert_eq!(
            housing::asking_rent(cfg.neighbourhood.poor_band_max, &cfg, defs::BALANCE),
            seed_rent
        );
    }
}

#[test]
fn the_asked_rent_never_falls_as_affluence_rises() {
    let (_d, cfg) = world(1);
    let mut last = 0;
    for a in 0..=100 {
        let r = housing::asking_rent(a, &cfg, defs::BALANCE);
        assert!(r >= last);
        last = r;
    }
}

/// FR20: the starting rent is 45 per cent of the entry week's gross. The
/// share is derived here from the keys, never stored; a retune of either
/// figure is a deliberate edit of this test.
#[test]
fn fr20_rent_is_forty_five_percent_of_the_entry_weeks_gross() {
    let share = housing::rent_share_percent(defs::BALANCE);
    assert_eq!(
        share, 45,
        "FR20: starting rent over an entry week's gross is {share}%, not 45% -- \
         a retune of economy.rent.* or economy.wage.* must edit FR20 and this test together"
    );
    assert_eq!(housing::weekly_gross(defs::BALANCE), 560);
}

/// The kit container is named by an append-only id; this holds that id
/// to the moving box.
#[test]
fn the_starting_box_id_names_the_moving_box() {
    let id = defs::BALANCE
        .iter()
        .find(|b| b.key == "housing.starting_box_object_id")
        .unwrap()
        .value as u32;
    let def = defs::OBJECTS.iter().find(|o| o.id == id).unwrap();
    assert_eq!(def.key, "moving_box");
    assert!(def.grid.is_some(), "the starting box is a container");
}

/// The agreement is the generic document kind's first instance.
#[test]
fn the_starting_document_id_names_the_tenancy_agreement() {
    let id = defs::BALANCE
        .iter()
        .find(|b| b.key == "housing.starting_document_item_id")
        .unwrap()
        .value as u32;
    let item = defs::ITEMS.iter().find(|i| i.id == id).unwrap();
    assert_eq!(item.key, "tenancy_agreement");
}

// --- assignment: once, deterministic, exhaustion -----------------------

fn candidates(ids: &[(u64, Tier, i32, i32)]) -> Vec<Home> {
    ids.iter()
        .map(|&(id, tier, density, affluence)| Home {
            id,
            tier,
            density,
            affluence,
            rent: 250 + affluence as u64,
            spawn: (id as i32, 0),
            door: (id as i32, 5),
            kit: (id as i32 + 1, 0),
            area: 40,
        })
        .collect()
}

/// The vacant homes in rank order, as the reducer reads them off the index.
fn open_in_rank_order(stock: &[Home], occupied: &dyn Fn(u64) -> bool) -> Vec<Home> {
    let mut v: Vec<Home> = stock.iter().filter(|h| !occupied(h.id)).copied().collect();
    v.sort_by_key(|h| (h.rank(), h.id));
    v
}

fn arrive(character: u64, stock: &[Home], occupied: &dyn Fn(u64) -> bool) -> Arrival {
    plan_arrival(character, open_in_rank_order(stock, occupied), (-1, -1))
}

#[test]
fn assignment_is_deterministic_and_ignores_input_order() {
    let mut stock = candidates(&[
        (5, Tier::Edge, 10, 5),
        (9, Tier::Edge, 12, 5),
        (2, Tier::Edge, 11, 5),
        (7, Tier::Inner, 50, 30),
    ]);
    let first = housing::plan_assign(42, &stock, &none_taken);
    stock.reverse();
    assert_eq!(first, housing::plan_assign(42, &stock, &none_taken));
    assert_eq!(first, housing::plan_assign(42, &stock, &none_taken));
}

#[test]
fn the_cheapest_edge_flat_is_taken_before_a_dearer_one() {
    let stock = candidates(&[
        (1, Tier::Edge, 10, 30),
        (2, Tier::Edge, 12, 5),
        (3, Tier::Edge, 12, 20),
    ]);
    for c in 0..50 {
        assert_eq!(
            housing::plan_assign(c, &stock, &none_taken),
            Assignment::Edge(2)
        );
    }
}

#[test]
fn a_smaller_flat_is_let_before_a_larger_one_at_the_same_rent() {
    let mut stock = candidates(&[(1, Tier::Edge, 10, 5), (2, Tier::Edge, 10, 5)]);
    stock[0].area = 90;
    stock[1].area = 40;
    for c in 0..32 {
        assert_eq!(
            housing::plan_assign(c, &stock, &none_taken),
            Assignment::Edge(2)
        );
    }
}

#[test]
fn ties_are_broken_by_the_character_id_not_by_row_order() {
    let stock = candidates(&[
        (1, Tier::Edge, 10, 5),
        (2, Tier::Edge, 10, 5),
        (3, Tier::Edge, 10, 5),
        (4, Tier::Edge, 10, 5),
    ]);
    let picks: BTreeSet<u64> = (0..64)
        .filter_map(|c| match housing::plan_assign(c, &stock, &none_taken) {
            Assignment::Edge(id) => Some(id),
            _ => None,
        })
        .collect();
    assert!(picks.len() > 1, "every character drew the same flat");
}

#[test]
fn exhaustion_falls_back_to_the_nearest_to_edge_then_to_no_vacancy() {
    let stock = candidates(&[
        (1, Tier::Edge, 10, 5),
        (2, Tier::Inner, 70, 40),
        (3, Tier::Inner, 50, 40),
        (4, Tier::Inner, 60, 40),
    ]);
    let mut taken: BTreeSet<u64> = BTreeSet::new();
    let mut order = Vec::new();
    loop {
        let occupied = |id: u64| taken.contains(&id);
        match housing::plan_assign(3, &stock, &occupied) {
            Assignment::Edge(id) => {
                order.push(("edge", id));
                taken.insert(id);
            }
            Assignment::Fallback(id) => {
                order.push(("fallback", id));
                taken.insert(id);
            }
            Assignment::NoVacancy => break,
        }
    }
    assert_eq!(
        order,
        vec![
            ("edge", 1),
            ("fallback", 3),
            ("fallback", 4),
            ("fallback", 2)
        ]
    );
}

// --- character creation and tenancy are one plan -------------------------

/// Plays `arrivals` (character ids; a repeat is a reconnect or a second
/// `create_character`) against a growing occupied set. Returns each
/// character's flat and whether any flat was handed out twice.
fn play(stock: &[Home], arrivals: &[u64], guard_repeats: bool) -> (Vec<(u64, u64)>, bool) {
    let mut taken: BTreeSet<u64> = BTreeSet::new();
    let mut by_character: BTreeMap<u64, u64> = BTreeMap::new();
    let mut doubled = false;
    for &c in arrivals {
        if guard_repeats && by_character.contains_key(&c) {
            // create_character is a no-op for a character that exists.
            assert_eq!(plan_create(Some(c)), CreatePlan::Existing(c));
            continue;
        }
        let occupied = |id: u64| taken.contains(&id);
        if let Some(t) = arrive(c, stock, &occupied).tenancy {
            doubled |= !taken.insert(t.home);
            by_character.insert(c, t.home);
        }
    }
    (by_character.into_iter().collect(), doubled)
}

proptest! {
    /// `inv_tenancy_assigned_once`: over any sequence of create, reconnect
    /// and link calls for any characters, each character holds exactly one
    /// flat and no flat is held by two, until the stock runs out.
    #[test]
    fn inv_tenancy_assigned_once(
        arrivals in proptest::collection::vec(0u64..12, 0..40),
        flats in 1usize..9,
    ) {
        let spec: Vec<(u64, Tier, i32, i32)> = (0..flats as u64)
            .map(|i| {
                let tier = if i % 2 == 0 { Tier::Edge } else { Tier::Inner };
                (i + 1, tier, 10 + i as i32, 5 + i as i32)
            })
            .collect();
        let stock = candidates(&spec);
        let (held, doubled) = play(&stock, &arrivals, true);
        prop_assert!(!doubled);
        let distinct: BTreeSet<u64> = held.iter().map(|(_, h)| *h).collect();
        prop_assert_eq!(distinct.len(), held.len());
        let characters: BTreeSet<u64> = arrivals.iter().copied().collect();
        prop_assert_eq!(held.len(), characters.len().min(flats));
    }
}

/// Negative control: an assignment that ignores occupancy (every arrival
/// sees the whole stock open) hands one flat to two characters, which is
/// exactly what the property above rejects.
#[test]
fn a_plan_that_ignores_occupancy_fails_the_assignment_invariant() {
    let stock = candidates(&[(1, Tier::Edge, 10, 5)]);
    let a = arrive(1, &stock, &none_taken).tenancy.unwrap().home;
    let b = arrive(2, &stock, &none_taken).tenancy.unwrap().home;
    assert_eq!(a, b);
}

#[test]
fn the_arrival_carries_the_tenancy_and_the_spawn_of_the_same_flat() {
    let stock = candidates(&[(8, Tier::Edge, 10, 5)]);
    let a = arrive(1, &stock, &none_taken);
    let t = a.tenancy.unwrap();
    assert_eq!(t.home, 8);
    assert_eq!(t.weekly_rent, 255);
    assert_eq!(a.spawn, (8, 0));
}

#[test]
fn a_full_stock_creates_the_character_on_the_street_without_a_tenancy() {
    let stock = candidates(&[(1, Tier::Edge, 10, 5)]);
    let occupied = |_: u64| true;
    let a = arrive(1, &stock, &occupied);
    assert!(a.tenancy.is_none());
    assert_eq!(a.spawn, (-1, -1), "the street cell the caller named");
}

#[test]
fn an_empty_district_still_plans_an_arrival() {
    let a = plan_arrival(1, Vec::new(), (3, 4));
    assert!(a.tenancy.is_none());
    assert_eq!(a.spawn, (3, 4));
}

// --- spawn: inside the flat, walkable, in the entry room -----------------

#[test]
fn the_spawn_is_a_walkable_cell_of_the_entry_room_clear_of_fixtures() {
    for seed in SEEDS {
        let (district, _cfg, d) = dwellings(seed);
        for dw in &d {
            let (_, _, interior) = district
                .interiors
                .laid()
                .find(|(p, _, _)| *p == dw.plot)
                .unwrap();
            let (x, y) = dw.home.spawn;
            let door = interior.entrance().unwrap();
            let room = &interior.rooms[door.room];
            assert!(room.rect.contains(x, y), "seed {seed} plot {}", dw.plot);
            assert!(
                !interior.fixtures.iter().any(|f| f.x == x && f.y == y),
                "seed {seed} plot {}: spawn on a fixture",
                dw.plot
            );
            assert!(
                !district.walkability(0).is_blocked(x, y),
                "seed {seed} plot {}: spawn on a blocked cell",
                dw.plot
            );
        }
    }
}

// --- starting possessions --------------------------------------------------

/// Every starting possession (the box and the agreement on it) has a world
/// form inside the let dwelling's footprint, clear of its fixtures.
fn kit_is_in_the_flat(plan: &KitPlan, d: &Dwelling, interior: &Interior) -> bool {
    [plan.box_cell, plan.letter_cell].iter().all(|&(x, y)| {
        d.footprint.contains(x, y) && !interior.fixtures.iter().any(|f| f.x == x && f.y == y)
    })
}

#[test]
fn inv_starting_possessions_are_in_the_flat() {
    for seed in SEEDS {
        let (district, _cfg, d) = dwellings(seed);
        for dw in &d {
            let (_, _, interior) = district
                .interiors
                .laid()
                .find(|(p, _, _)| *p == dw.plot)
                .unwrap();
            let plan = housing::plan_kit(&dw.home);
            assert!(
                kit_is_in_the_flat(&plan, dw, interior),
                "seed {seed} plot {}: a starting possession lies outside the flat",
                dw.plot
            );
            // The door keeps its clearance and the box is off the spawn.
            let door = interior.entrance().unwrap();
            let (bx, by) = plan.box_cell;
            assert!((bx - door.x).abs().max((by - door.y).abs()) > 1);
            assert_ne!(plan.box_cell, dw.home.spawn);
        }
    }
}

/// Negative control: a plan that drops a piece outside the footprint
/// fails the invariant.
#[test]
fn a_kit_dropped_outside_the_footprint_fails_the_possessions_invariant() {
    let (district, _cfg, d) = dwellings(1);
    let dw = &d[0];
    let (_, _, interior) = district
        .interiors
        .laid()
        .find(|(p, _, _)| *p == dw.plot)
        .unwrap();
    let mut plan = housing::plan_kit(&dw.home);
    plan.letter_cell = (dw.footprint.x1 + 5, dw.footprint.y1 + 5);
    assert!(!kit_is_in_the_flat(&plan, dw, interior));
}

// --- bounds: assignment at the district's largest dwelling count ----------

/// Assignment reads the open homes in rank order and stops at the end of
/// the first rank group: at the building ceiling it touches the group and
/// one more, never the stock.
#[test]
fn assignment_over_the_largest_stock_touches_only_the_cheapest_group() {
    let max = sim::table_bounds::TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "building")
        .unwrap()
        .max_rows;
    let mut stock: Vec<Home> = (0..max)
        .map(|id| Home {
            id,
            tier: Tier::Edge,
            density: 10,
            affluence: 5 + (id % 40) as i32,
            rent: 250,
            spawn: (0, 0),
            door: (0, 0),
            kit: (0, 0),
            area: 30,
        })
        .collect();
    stock.sort_by_key(|h| (h.rank(), h.id));
    let group = stock.iter().filter(|h| h.rank() == stock[0].rank()).count();
    let touched = std::cell::Cell::new(0usize);
    let open = stock
        .iter()
        .copied()
        .inspect(|_| touched.set(touched.get() + 1));
    let first = housing::plan_assign_ranked(5, open);
    assert!(matches!(first, Assignment::Edge(_)));
    assert!(
        touched.get() <= group + 1,
        "touched {} homes for a group of {group}",
        touched.get()
    );
    assert!(touched.get() < stock.len() / 10);
}

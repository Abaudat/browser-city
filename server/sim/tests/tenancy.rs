//! Story 7.1 (FR20, FR145): the first flat is a tenancy over a dwelling
//! the generator laid out, assigned by a pure plan from stable ids.
//! Everything here is `sim`; the reducers only read, call and write.

use std::collections::BTreeSet;

use sim::generated::defs;
use sim::generation::{District, GenerationConfig, GenerationContent, generate};
use sim::housing::{self, Assignment, Dwelling, Home, Tier};
use sim::identity::{CreatePlan, plan_arrival, plan_create};

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
        })
        .collect()
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
fn an_occupied_flat_is_never_assigned_twice() {
    let stock = candidates(&[(1, Tier::Edge, 10, 5), (2, Tier::Edge, 10, 5)]);
    let mut taken: BTreeSet<u64> = BTreeSet::new();
    for c in 0..2 {
        let occupied = |id: u64| taken.contains(&id);
        let Assignment::Edge(id) = housing::plan_assign(c, &stock, &occupied) else {
            panic!("expected an edge flat");
        };
        assert!(taken.insert(id), "flat {id} assigned twice");
    }
    let occupied = |id: u64| taken.contains(&id);
    assert_eq!(
        housing::plan_assign(9, &stock, &occupied),
        Assignment::NoVacancy
    );
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

#[test]
fn inv_tenancy_assigned_once() {
    let stock = candidates(&[(1, Tier::Edge, 10, 5), (2, Tier::Edge, 10, 5)]);
    assert_eq!(plan_create(None), CreatePlan::New);
    let a = plan_arrival(10, &stock, &none_taken);
    let t = a.tenancy.expect("a first arrival is a tenant");
    // A second create_character is the identity's no-op: no new arrival.
    assert_eq!(plan_create(Some(10)), CreatePlan::Existing(10));
    // Another character is never given the same flat.
    let occupied = |id: u64| id == t.home;
    let b = plan_arrival(11, &stock, &occupied);
    let tb = b.tenancy.expect("the other flat is free");
    assert_ne!(t.home, tb.home);
}

#[test]
fn the_arrival_carries_the_tenancy_and_the_spawn_of_the_same_flat() {
    let stock = candidates(&[(8, Tier::Edge, 10, 5)]);
    let a = plan_arrival(1, &stock, &none_taken);
    let t = a.tenancy.unwrap();
    assert_eq!(t.home, 8);
    assert_eq!(t.weekly_rent, 255);
    assert_eq!(a.spawn, (8, 0));
}

#[test]
fn a_full_stock_creates_the_character_on_the_street_without_a_tenancy() {
    let stock = candidates(&[(1, Tier::Edge, 10, 5)]);
    let occupied = |_: u64| true;
    let a = plan_arrival(1, &stock, &occupied);
    assert!(a.tenancy.is_none());
    assert_eq!(a.spawn, (1, 5), "the street door of the edgemost dwelling");
}

#[test]
fn an_empty_district_still_plans_an_arrival() {
    let a = plan_arrival(1, &[], &none_taken);
    assert!(a.tenancy.is_none());
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

#[test]
fn the_starting_cash_is_whole_denominations_that_sum_to_the_seed() {
    let pieces = housing::starting_pieces(defs::DENOMINATIONS, defs::BALANCE).unwrap();
    let total: u64 = pieces
        .iter()
        .map(|(item, n)| {
            let face = defs::DENOMINATIONS
                .iter()
                .find(|d| d.item_id == *item)
                .unwrap()
                .face_value;
            u64::from(face) * n
        })
        .sum();
    assert_eq!(total, 90);
}

/// The kit is a box standing in the entry room and the pieces it holds;
/// no possession lacks a world form inside the flat.
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
            let blocked = |x: i32, y: i32| district.walkability(0).is_blocked(x, y);
            let (bx, by) = housing::box_cell(dw.home.spawn, interior, &blocked)
                .unwrap_or_else(|| panic!("seed {seed} plot {}: no cell for the box", dw.plot));
            let entry = &interior.rooms[interior.entrance().unwrap().room];
            assert!(
                entry.rect.contains(bx, by),
                "seed {seed} plot {}: the box stands outside the entry room",
                dw.plot
            );
            assert_ne!((bx, by), dw.home.spawn);
            assert!(!interior.fixtures.iter().any(|f| f.x == bx && f.y == by));
            assert!(!blocked(bx, by));
        }
    }
}

// --- bounds: assignment at the district's largest dwelling count ----------

/// Assignment is one pass over the dwellings; at the building ceiling
/// (`building`'s `max_rows`) it still plans, deterministically, with every
/// flat but the last taken.
#[test]
fn assignment_over_the_largest_stock_is_one_deterministic_pass() {
    let max = sim::table_bounds::TABLE_BOUNDS
        .iter()
        .find(|b| b.accessor == "building")
        .unwrap()
        .max_rows;
    let stock: Vec<Home> = (0..max)
        .map(|id| Home {
            id,
            tier: if id % 3 == 0 { Tier::Edge } else { Tier::Inner },
            density: (id % 100) as i32,
            affluence: (id % 50) as i32,
            rent: 250,
            spawn: (0, 0),
            door: (0, 0),
            kit: (0, 0),
        })
        .collect();
    let last = max - 1;
    let occupied = |id: u64| id != last;
    let first = housing::plan_assign(5, &stock, &occupied);
    assert_eq!(first, Assignment::Fallback(last));
    assert_eq!(first, housing::plan_assign(5, &stock, &occupied));
}

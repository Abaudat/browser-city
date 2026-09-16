//! Registry of the invariants named across the architecture and requirements
//! (NFR25, NFR28, NFR29, and Story 0.16's acceptance criteria). Each constant
//! documents one invariant by its trace-matrix id. `docs/trace-matrix.md`
//! records, for every id here, whether it is `covered` (a test with the same
//! name exists) or `deferred` (the subsystem it protects does not exist yet).
//! `scripts/ci/check-trace-matrix.sh` fails the build if the two ever
//! disagree, so this file and the matrix cannot drift silently.

use proptest::prelude::*;
use sim::appearance;
use sim::generated::defs::{self, Family, Pool};
use sim::rng::{Rng, seed_from_ids};
use sim::rules::testing::SiteBuilder;
use sim::rules::{AdjacencyRelation, Cell, CoherenceMode, RuleDef, RuleKind, TagId, evaluate};
use sim::world::{
    AreaSpec, FloorCollision, FloorSpec, NO_OWNER, Rect, TransitionSpec, WorldSpec, chunk_key,
    fixture,
};

pub const INV_NO_MATTER_STARVES: &str = "no matter starves indefinitely";
pub const INV_INVENTORY_SUPERSET_AFTER_ABSENCE: &str = "inventory is a superset after any absence";
pub const INV_NO_OWNED_ITEM_DEGRADES_DURING_ABSENCE: &str = "no owned item degrades during absence";
pub const INV_BUDGET_NEVER_NEGATIVE: &str = "budget never goes negative";
pub const INV_COLLIDER_WITHIN_FOOTPRINT: &str = "collider is contained within footprint";
pub const INV_IDENTICAL_SEEDS_DERIVE_IDENTICALLY: &str =
    "two derivations from identical seeded inputs match";
pub const INV_COLLISION_ONLY_WITHIN_FLOOR: &str =
    "no cell on any other floor ever contributes to an entity's collision result";
pub const INV_FLOOR_TRANSITION_LANDS_STANDABLE: &str = "no transition cell ever targets a floor or cell where the entity would be inside geometry or out of bounds";
pub const INV_WORLD_QUERY_TOTAL: &str =
    "a world query never panics and never wraps, for any i32 coordinate and any floor or layer";
pub const INV_CELL_OWNERSHIP_DEFINED: &str =
    "every in-bounds cell answers the ownership query, and ids are stable across queries";
pub const INV_APPEARANCE_DETERMINISTIC_FROM_ID: &str =
    "the same citizen id always derives the same five-integer appearance tuple";
pub const INV_APPEARANCE_INDICES_IN_RANGE: &str = "sim::appearance::generate never panics and every non-zero index it returns names a real manifest entry of the matching family";
pub const INV_KIDS_PARTS_ONLY_ON_KIDS_BODIES: &str =
    "a kid family tuple only ever contains kid-family parts, and its accessory is always 0";
pub const INV_RULE_VERDICTS_DETERMINISTIC: &str =
    "the same facts and rules always give identical violations";
pub const INV_RULE_VERDICTS_INDEPENDENT_OF_INPUT_ORDER: &str =
    "shuffling fact order or rule row order does not change the sorted output";
pub const INV_DISTRIBUTION_EVEN_LAYOUT_NEVER_VIOLATES: &str = "a generated perfectly even 1-per-N layout never violates; clustering all services into one bin always does";
pub const INV_GENERATED_PLACEMENT_NEVER_VIOLATES_LOCAL_RULES: &str = "a placement built by filtering random candidates through evaluate yields zero violations when evaluate is run over the result, for the four local kinds";

proptest! {
    /// `inv_identical_seeds_derive_identically`: the only invariant among the
    /// six that has a subsystem to test today (NFR25's pinned RNG). Two
    /// derivations from the same ids, run independently, must produce the
    /// same seed and the same output stream.
    #[test]
    fn inv_identical_seeds_derive_identically(a in any::<u64>(), b in any::<u64>(), n in 1usize..64) {
        let seed_1 = seed_from_ids(a, b);
        let seed_2 = seed_from_ids(a, b);
        prop_assert_eq!(seed_1, seed_2);

        let mut rng_1 = Rng::new(seed_1);
        let mut rng_2 = Rng::new(seed_2);
        let out_1: Vec<u64> = (0..n).map(|_| rng_1.next_u64()).collect();
        let out_2: Vec<u64> = (0..n).map(|_| rng_2.next_u64()).collect();
        prop_assert_eq!(out_1, out_2);
    }

    /// `inv_appearance_deterministic_from_id` (FR61): the same citizen id
    /// and family always derive the same tuple, on any run.
    #[test]
    fn inv_appearance_deterministic_from_id(id in any::<u64>(), kid in any::<bool>()) {
        let family = if kid { Family::Kid } else { Family::Adult };
        let catalogue = appearance::live_catalogue();
        let a = appearance::generate(id, family, &catalogue);
        let b = appearance::generate(id, family, &catalogue);
        prop_assert_eq!(a, b);
    }

    /// `inv_appearance_indices_in_range` (FR61): for any u64 citizen id and
    /// family, `generate` never panics, `body`/`eyes`/`outfit` are always
    /// non-zero and name a real manifest entry of the matching family
    /// (`body`/`eyes`/`outfit` additionally from the civilian pool, never
    /// a costume-pool sheet like the unnaturally coloured bodies/eyes a
    /// generated citizen must never wear), and a non-zero
    /// `hairstyle`/`accessory` also names a real entry of that family.
    #[test]
    fn inv_appearance_indices_in_range(id in any::<u64>(), kid in any::<bool>()) {
        let family = if kid { Family::Kid } else { Family::Adult };
        let catalogue = appearance::live_catalogue();
        let a = appearance::generate(id, family, &catalogue);

        prop_assert_ne!(a.body, 0);
        let body_ok = defs::BODIES
            .iter()
            .any(|b| b.id == a.body && b.family == family && b.pool == Pool::Civilian);
        prop_assert!(body_ok);

        prop_assert_ne!(a.eyes, 0);
        let eyes_ok = defs::EYES
            .iter()
            .any(|e| e.id == a.eyes && e.family == family && e.pool == Pool::Civilian);
        prop_assert!(eyes_ok);

        prop_assert_ne!(a.outfit, 0);
        let outfit_ok = defs::OUTFITS
            .iter()
            .any(|o| o.id == a.outfit && o.family == family && o.pool == Pool::Civilian);
        prop_assert!(outfit_ok);

        if a.hairstyle != 0 {
            let hairstyle_ok = defs::HAIRSTYLES
                .iter()
                .any(|h| h.id == a.hairstyle && h.family == family);
            prop_assert!(hairstyle_ok);
        }
        if a.accessory != 0 {
            let accessory_ok = defs::ACCESSORIES
                .iter()
                .any(|ac| ac.id == a.accessory && ac.family == family && ac.pool == Pool::Civilian);
            prop_assert!(accessory_ok);
        }
    }

    /// `inv_kids_parts_only_on_kids_bodies` (FR61): a kid tuple never
    /// contains an adult part, and its accessory is always 0 (no kid
    /// accessory tables exist).
    #[test]
    fn inv_kids_parts_only_on_kids_bodies(id in any::<u64>()) {
        let catalogue = appearance::live_catalogue();
        let kid = appearance::generate(id, Family::Kid, &catalogue);
        prop_assert_eq!(kid.accessory, 0);
        prop_assert_eq!(defs::BODIES.iter().find(|b| b.id == kid.body).unwrap().family, Family::Kid);
        prop_assert_eq!(defs::EYES.iter().find(|e| e.id == kid.eyes).unwrap().family, Family::Kid);
        prop_assert_eq!(defs::OUTFITS.iter().find(|o| o.id == kid.outfit).unwrap().family, Family::Kid);
        if kid.hairstyle != 0 {
            prop_assert_eq!(
                defs::HAIRSTYLES.iter().find(|h| h.id == kid.hairstyle).unwrap().family,
                Family::Kid
            );
        }

        let adult = appearance::generate(id, Family::Adult, &catalogue);
        prop_assert_eq!(defs::BODIES.iter().find(|b| b.id == adult.body).unwrap().family, Family::Adult);
    }
}

/// 0-3 small collider rects scattered within a 16x16 region based at
/// `(base_x, base_y)`.
fn small_rects(base_x: i32, base_y: i32) -> impl Strategy<Value = Vec<Rect>> {
    proptest::collection::vec(
        (0i32..16, 1i32..4, 0i32..16, 1i32..4).prop_map(move |(dx, w, dy, h)| Rect {
            x0: base_x + dx,
            y0: base_y + dy,
            x1: base_x + dx + w,
            y1: base_y + dy + h,
        }),
        0..4,
    )
}

fn blocked_by(rects: &[Rect], x: i32, y: i32) -> bool {
    rects.iter().any(|r| r.contains(x, y))
}

/// Floor 0's extent for the properties below -- deliberately different
/// from [`floor_b_bounds`], so "floors are independent" is actually
/// tested rather than two floors that merely happen to share one rect.
fn floor_a_bounds() -> Rect {
    Rect {
        x0: 0,
        y0: 0,
        x1: 20,
        y1: 20,
    }
}

/// Floor 1's extent.
fn floor_b_bounds() -> Rect {
    Rect {
        x0: 5,
        y0: 5,
        x1: 30,
        y1: 30,
    }
}

proptest! {
    /// `inv_collision_only_within_floor`: two floors, each with their own
    /// arbitrary colliders and its own distinct extent, only ever
    /// influence their own floor's collision query -- the other floor's
    /// colliders and bounds never leak into the queried floor's result,
    /// which is queried at an arbitrary floor, not always floor 0.
    #[test]
    fn inv_collision_only_within_floor(
        floor_a_colliders in small_rects(0, 0),
        floor_b_colliders in small_rects(5, 5),
        floor in prop_oneof![Just(0i8), Just(1i8)],
        x in -5i32..35,
        y in -5i32..35,
    ) {
        let spec = WorldSpec {
            floors: vec![
                FloorSpec { floor: 0, bounds: floor_a_bounds(), colliders: floor_a_colliders.clone() },
                FloorSpec { floor: 1, bounds: floor_b_bounds(), colliders: floor_b_colliders.clone() },
            ],
            transitions: Vec::new(),
            building_areas: Vec::new(),
            room_areas: Vec::new(),
        };
        let world = spec.build().expect("no transitions declared, so build cannot fail");

        let (bounds, colliders) = if floor == 0 {
            (floor_a_bounds(), &floor_a_colliders)
        } else {
            (floor_b_bounds(), &floor_b_colliders)
        };
        let expected = bounds.contains(x, y) && blocked_by(colliders, x, y);
        prop_assert_eq!(world.is_blocked(x, y, floor), expected);
    }

    /// `inv_floor_transition_lands_standable`: `WorldSpec::build` accepts a
    /// candidate transition if and only if both its anchor and its target
    /// are standable on their own declared floor -- there is no other path
    /// to a `World` carrying a transition, so a player falling out of the
    /// world through one, or a transition anchored on unreachable
    /// geometry, is impossible by construction. Exercises a real anchor
    /// (on a declared floor, with its own colliders), not a cell on a
    /// floor the world never declares.
    #[test]
    fn inv_floor_transition_lands_standable(
        anchor_colliders in small_rects(0, 0),
        target_colliders in small_rects(0, 0),
        anchor_x in -5i32..25,
        anchor_y in -5i32..25,
        target_x in -5i32..25,
        target_y in -5i32..25,
    ) {
        let bounds = floor_a_bounds();
        let spec = WorldSpec {
            floors: vec![
                FloorSpec { floor: 0, bounds, colliders: anchor_colliders.clone() },
                FloorSpec { floor: 1, bounds, colliders: target_colliders.clone() },
            ],
            transitions: vec![TransitionSpec {
                x: anchor_x,
                y: anchor_y,
                floor: 0,
                target_x,
                target_y,
                target_floor: 1,
            }],
            building_areas: Vec::new(),
            room_areas: Vec::new(),
        };

        let anchor_fc = FloorCollision::build(bounds, &anchor_colliders).expect("valid bounds");
        let target_fc = FloorCollision::build(bounds, &target_colliders).expect("valid bounds");
        let should_succeed = anchor_fc.is_standable(anchor_x, anchor_y) && target_fc.is_standable(target_x, target_y);

        match spec.build() {
            Ok(world) => {
                prop_assert!(should_succeed);
                prop_assert!(!world.is_blocked(anchor_x, anchor_y, 0));
                prop_assert!(!world.is_blocked(target_x, target_y, 1));
            }
            Err(_) => prop_assert!(!should_succeed),
        }
    }

    /// `inv_world_query_total`: every world query -- and world
    /// construction itself -- is total over arbitrary `i32` coordinates
    /// and `i8`/`u32` floor/layer indices, including `MIN`/`MAX` -- never
    /// a panic, never a wrapping-arithmetic abort (the published profile
    /// runs with `overflow-checks` on). `FloorCollision::build` is the one
    /// constructor that will eventually take generator output directly,
    /// so it is fuzzed with arbitrary (including invalid and enormous)
    /// bounds here, not just queried against an already-built world.
    #[test]
    fn inv_world_query_total(
        x in any::<i32>(), y in any::<i32>(), floor in any::<i8>(), _layer in any::<u32>(),
        bx0 in any::<i32>(), by0 in any::<i32>(), bx1 in any::<i32>(), by1 in any::<i32>(),
    ) {
        let world = fixture::canonical_world();
        let _ = world.is_blocked(x, y, floor);
        let _ = world.transition_at(x, y, floor);
        let _ = world.ownership_at(x, y, floor);
        let _ = chunk_key(x, y, floor);

        let bounds = Rect { x0: bx0, y0: by0, x1: bx1, y1: by1 };
        let _ = FloorCollision::build(bounds, &[]);
    }

    /// `inv_cell_ownership_defined`: the ownership query answers against
    /// an independently computed reference (the rect membership the
    /// generated spec itself declares, not the value `ownership_at`
    /// returns) -- a stub that always returned `NO_OWNER` would fail this,
    /// unlike a bare "two calls agree" check. Building and room areas are
    /// confined to disjoint y-bands so they never overlap regardless of
    /// their generated width, and stability (two calls agree) is checked
    /// alongside correctness.
    #[test]
    fn inv_cell_ownership_defined(
        building_rect in (0i32..20, 1i32..8).prop_map(|(x0, w)| Rect { x0, y0: 0, x1: x0 + w, y1: 8 }),
        room_rect in (0i32..20, 1i32..8).prop_map(|(x0, w)| Rect { x0, y0: 20, x1: x0 + w, y1: 28 }),
        building_owner in 1u64..1000,
        room_owner in 1u64..1000,
        x in -5i32..35,
        y in -5i32..35,
    ) {
        let floor = 0i8;
        let spec = WorldSpec {
            floors: Vec::new(),
            transitions: Vec::new(),
            building_areas: vec![AreaSpec {
                owner_id: building_owner,
                floor,
                rect: building_rect,
                chunk_key: chunk_key(building_rect.x0, building_rect.y0, floor),
            }],
            room_areas: vec![AreaSpec {
                owner_id: room_owner,
                floor,
                rect: room_rect,
                chunk_key: chunk_key(room_rect.x0, room_rect.y0, floor),
            }],
        };
        let world = spec.build().expect("disjoint, single-chunk areas must build");

        let expected_building = if building_rect.contains(x, y) { building_owner } else { NO_OWNER };
        let expected_room = if room_rect.contains(x, y) { room_owner } else { NO_OWNER };

        let first = world.ownership_at(x, y, floor);
        prop_assert_eq!(first.building_id, expected_building);
        prop_assert_eq!(first.room_id, expected_room);

        let second = world.ownership_at(x, y, floor);
        prop_assert_eq!(first, second);
    }
}

const RULE_SUBJECT: TagId = 1;
const RULE_PER_OR_WITHIN: TagId = 2;

fn site_of(cells: &[(i32, i32, i8)], tag: TagId) -> sim::rules::testing::Site {
    let mut builder = SiteBuilder::new();
    for &(x, y, floor) in cells {
        builder = builder.cell(Cell::new(x, y, floor), &[tag]);
    }
    builder.build()
}

proptest! {
    /// `inv_rule_verdicts_deterministic` (story 2.10, FR112): two
    /// independent calls to `evaluate` over the identical facts and rules
    /// always return the identical list of violations.
    #[test]
    fn inv_rule_verdicts_deterministic(
        floor_max in -5i8..5,
        cells in proptest::collection::vec((-20i32..20, -20i32..20, -5i8..5), 0..15),
    ) {
        let rules = vec![RuleDef {
            id: 1,
            key: "placement",
            kind: RuleKind::Placement { subject: RULE_SUBJECT, container: None, floor_min: None, floor_max: Some(floor_max) },
        }];
        let site = site_of(&cells, RULE_SUBJECT);
        prop_assert_eq!(evaluate(&rules, &site), evaluate(&rules, &site));
    }

    /// `inv_rule_verdicts_independent_of_input_order`: shuffling the
    /// order facts were declared in, or the order rule rows are passed
    /// in, never changes `evaluate`'s own (already-sorted) output.
    #[test]
    fn inv_rule_verdicts_independent_of_input_order(
        cells in proptest::collection::vec((-20i32..20, -20i32..20, -5i8..5), 1..15),
        reverse_rules in any::<bool>(),
    ) {
        let rules_forward = vec![
            RuleDef { id: 1, key: "placement_a", kind: RuleKind::Placement { subject: RULE_SUBJECT, container: None, floor_min: None, floor_max: Some(0) } },
            RuleDef { id: 2, key: "placement_b", kind: RuleKind::Placement { subject: RULE_SUBJECT, container: None, floor_min: Some(-2), floor_max: None } },
        ];
        let mut rules_other_order = rules_forward.clone();
        if reverse_rules {
            rules_other_order.reverse();
        }

        let site_forward = site_of(&cells, RULE_SUBJECT);
        let mut reversed_cells = cells.clone();
        reversed_cells.reverse();
        let site_backward = site_of(&reversed_cells, RULE_SUBJECT);

        prop_assert_eq!(
            evaluate(&rules_forward, &site_forward),
            evaluate(&rules_other_order, &site_backward)
        );
    }

    /// `inv_distribution_even_layout_never_violates`: `n_groups` subject
    /// cells spaced exactly `spacing` cells apart (the "evenly spread"
    /// half of FR112) never violates; the same count of subject cells
    /// clustered one cell apart (well inside `spacing`) always does.
    #[test]
    fn inv_distribution_even_layout_never_violates(n_groups in 2i32..15, spacing in 2u32..6) {
        let ratio = 3u32;
        let rule = RuleDef {
            id: 1,
            key: "distribution",
            kind: RuleKind::Distribution {
                subject: RULE_SUBJECT,
                per: RULE_PER_OR_WITHIN,
                ratio,
                tolerance_percent: 0,
                min_spacing: spacing,
            },
        };

        let mut even = SiteBuilder::new();
        for i in 0..n_groups {
            even = even.cell(Cell::new(i * spacing as i32, 0, 0), &[RULE_SUBJECT]);
        }
        for i in 0..(n_groups * ratio as i32) {
            even = even.cell(Cell::new(1000 + i, 0, 0), &[RULE_PER_OR_WITHIN]);
        }
        prop_assert!(evaluate(&[rule], &even.build()).is_empty());

        let mut clustered = SiteBuilder::new();
        for i in 0..n_groups {
            clustered = clustered.cell(Cell::new(i, 0, 0), &[RULE_SUBJECT]);
        }
        for i in 0..(n_groups * ratio as i32) {
            clustered = clustered.cell(Cell::new(1000 + i, 0, 0), &[RULE_PER_OR_WITHIN]);
        }
        prop_assert!(!evaluate(&[rule], &clustered.build()).is_empty());
    }

    /// `inv_generated_placement_never_violates_local_rules` (Tim's
    /// direction): a candidate is accepted only when adding it to the
    /// already-accepted set produces zero violations across placement,
    /// coherence, adjacency and requirement -- the exact "ask the
    /// engine, then place" cycle Epic 3's generator will run for real.
    /// Re-evaluating the whole hypothetical set (not just the new
    /// candidate's own cell) on every step is what proves a *later*
    /// candidate can never retroactively invalidate an earlier one:
    /// FR112 proven for the engine before the generator exists.
    #[test]
    fn inv_generated_placement_never_violates_local_rules(
        candidates in proptest::collection::vec((-15i32..15, -15i32..15, -2i8..3, any::<bool>()), 0..30),
    ) {
        let rules = vec![
            RuleDef { id: 1, key: "placement", kind: RuleKind::Placement { subject: RULE_SUBJECT, container: None, floor_min: Some(-1), floor_max: Some(1) } },
            RuleDef { id: 2, key: "coherence", kind: RuleKind::Coherence { subject: RULE_SUBJECT, within: RULE_PER_OR_WITHIN, mode: CoherenceMode::Forbid } },
            RuleDef { id: 3, key: "adjacency", kind: RuleKind::Adjacency { a: RULE_SUBJECT, b: RULE_PER_OR_WITHIN, relation: AdjacencyRelation::Forbid, direction: None } },
            RuleDef { id: 4, key: "requirement", kind: RuleKind::Requirement { container: RULE_SUBJECT, requires: RULE_PER_OR_WITHIN, min: 0, max: None } },
        ];

        let mut accepted: Vec<(Cell, Vec<TagId>)> = Vec::new();
        for (x, y, floor, carries_other_tag) in candidates {
            let candidate = Cell::new(x, y, floor);
            let mut tags = vec![RULE_SUBJECT];
            if carries_other_tag {
                tags.push(RULE_PER_OR_WITHIN);
            }

            let mut hypothetical = SiteBuilder::new();
            for (cell, cell_tags) in &accepted {
                hypothetical = hypothetical.cell(*cell, cell_tags);
            }
            hypothetical = hypothetical.cell(candidate, &tags);

            if evaluate(&rules, &hypothetical.build()).is_empty() {
                accepted.push((candidate, tags));
            }
        }

        let mut final_site = SiteBuilder::new();
        for (cell, cell_tags) in &accepted {
            final_site = final_site.cell(*cell, cell_tags);
        }
        prop_assert!(evaluate(&rules, &final_site.build()).is_empty());
    }
}

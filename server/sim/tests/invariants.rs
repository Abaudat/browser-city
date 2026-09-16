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
use sim::rules::{
    AdjacencyRelation, AreaId, Cell, CoherenceMode, RuleDef, RuleKind, TagId, evaluate,
};
use sim::world::walkability::{
    WalkabilityGrid, enclosed_regions, erode, narrow_passages, player_body_subcells,
};
use sim::world::{
    AreaSpec, FloorCollision, FloorSpec, NO_OWNER, Rect, TransitionSpec, WorldSpec, cell_index,
    chunk_key, fixture,
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
pub const INV_DISTRIBUTION_EVEN_LAYOUT_NEVER_VIOLATES: &str = "a generated perfectly even 1-per-N layout never violates; clustering all services into one bin always does; and a layout that satisfies the minimum spacing while sitting in one corner of the site still violates the coverage bound";
pub const INV_RULE_VERDICTS_INVARIANT_UNDER_TAG_RELABELLING: &str = "consistently relabelling every tag id, across both the rules and the site, to six arbitrary distinct ids never changes which cells violate, over all five kinds, with areas and a non-vacuous requirement/distribution";
pub const INV_DOORWAY_GAP_AT_LEAST_BODY_WIDTH_IS_ONE_COMPONENT_UNDER_EROSION: &str = "a ring with a doorway gap at least the player body's own width is always a single connected component once the walkability grid is eroded by the body (FR128)";
pub const INV_SEALED_RING_YIELDS_EXACTLY_ONE_ENCLOSED_REGION: &str =
    "a ring with no gap at all always yields exactly one enclosed region (FR128)";
pub const INV_REMOVING_A_DOOR_NEVER_REDUCES_ENCLOSED_REGIONS: &str = "narrowing a ring's own doorway gap (down to and including closing it entirely) never reduces the number of reported enclosed regions (FR128)";
pub const INV_RING_OPEN_TO_ANY_WINDOW_EDGE_IS_NEVER_REPORTED: &str = "a ring's own interior, pushed flush against any one of the window's own four edges with no wall and no margin between them, is never reported by enclosed_regions or by narrow_passages, for a door narrower than the real player body (FR128)";

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

/// A fixed universe of six tag ids and two area ids the rule-engine
/// property tests below share, so a single relabelling (see
/// `inv_rule_verdicts_invariant_under_tag_relabelling`) can be applied
/// consistently across every kind. Never the manifest's own ids -- these
/// are the engine's own test vocabulary, disjoint from any real content.
const TAG_UNIVERSE: [TagId; 6] = [1, 2, 3, 4, 5, 6];
const AREA_A: AreaId = 1;
const AREA_B: AreaId = 2;

/// The two tags [`inv_distribution_even_layout_never_violates`] uses on
/// its own, single-kind fixture -- distinct from [`TAG_UNIVERSE`],
/// which the all-five-kinds properties share.
const RULE_SUBJECT: TagId = 101;
const RULE_PER_OR_WITHIN: TagId = 102;

/// One rule per kind, every tag field drawn from `tags` (normally
/// [`TAG_UNIVERSE`] itself, or a relabelling of it) -- `min: 1` and
/// `min_spacing > 0`/`max_distance > 0` deliberately, so Requirement and
/// Distribution are never vacuous (Quentin's direction, PR #294 cycle
/// 1).
fn five_rules(tags: [TagId; 6]) -> Vec<RuleDef> {
    let [t1, t2, t3, t4, t5, t6] = tags;
    vec![
        RuleDef {
            id: 1,
            key: "placement",
            kind: RuleKind::Placement {
                subject: t1,
                container: None,
                floor_min: Some(-3),
                floor_max: Some(3),
            },
        },
        RuleDef {
            id: 2,
            key: "distribution",
            kind: RuleKind::Distribution {
                subject: t2,
                per: t3,
                ratio: 2,
                tolerance_percent: 50,
                min_spacing: 3,
                max_distance: 10,
            },
        },
        RuleDef {
            id: 3,
            key: "coherence",
            kind: RuleKind::Coherence {
                subject: t4,
                within: t5,
                mode: CoherenceMode::Forbid,
            },
        },
        RuleDef {
            id: 4,
            key: "adjacency",
            kind: RuleKind::Adjacency {
                a: t1,
                b: t4,
                relation: AdjacencyRelation::Forbid,
                direction: None,
            },
        },
        RuleDef {
            id: 5,
            key: "requirement",
            kind: RuleKind::Requirement {
                container: t6,
                requires: t5,
                min: 1,
                max: None,
            },
        },
    ]
}

/// Builds a site from `(x, y, floor, tag_mask, area_mask)` facts: bit `i`
/// of `tag_mask` means the cell carries `tags[i]`; bit 0/1 of `area_mask`
/// means the cell sits in [`AREA_A`]/[`AREA_B`]. `tags` is normally
/// [`TAG_UNIVERSE`] or a relabelling of it -- passing a relabelling here
/// is how `inv_rule_verdicts_invariant_under_tag_relabelling` relabels
/// the site consistently with a relabelled rule set.
fn build_site(facts: &[(i32, i32, i8, u8, u8)], tags: [TagId; 6]) -> sim::rules::testing::Site {
    let mut builder = SiteBuilder::new();
    for &(x, y, floor, tag_mask, area_mask) in facts {
        let cell = Cell::new(x, y, floor);
        let cell_tags: Vec<TagId> = (0..6)
            .filter(|i| tag_mask & (1 << i) != 0)
            .map(|i| tags[i])
            .collect();
        if !cell_tags.is_empty() {
            builder = builder.cell(cell, &cell_tags);
        }
        if area_mask & 1 != 0 {
            builder = builder.area(cell, AREA_A);
        }
        if area_mask & 2 != 0 {
            builder = builder.area(cell, AREA_B);
        }
    }
    builder.build()
}

/// A strategy for `(x, y, floor, tag_mask, area_mask)` facts covering all
/// five kinds' subject/container/within/per tags and both areas.
fn facts_strategy(
    len: std::ops::Range<usize>,
) -> impl Strategy<Value = Vec<(i32, i32, i8, u8, u8)>> {
    proptest::collection::vec((-20i32..20, -20i32..20, -3i8..4, 0u8..64, 0u8..4), len)
}

/// A real shuffle (Quentin's direction, PR #294 cycle 1: "not
/// `reverse()`"): pairs each item with an independently generated key
/// and sorts by key, so the result is an arbitrary permutation of
/// `items`, not a fixed one.
fn shuffle<T: Clone>(items: &[T], keys: &[u32]) -> Vec<T> {
    let mut paired: Vec<(u32, T)> = keys.iter().copied().zip(items.iter().cloned()).collect();
    paired.sort_by_key(|(k, _)| *k);
    paired.into_iter().map(|(_, v)| v).collect()
}

proptest! {
    /// `inv_rule_verdicts_deterministic` (story 2.10, FR112): two
    /// independent calls to `evaluate` over the identical facts and
    /// rules -- all five kinds, areas included -- always return the
    /// identical list of violations.
    #[test]
    fn inv_rule_verdicts_deterministic(facts in facts_strategy(0..30)) {
        let rules = five_rules(TAG_UNIVERSE);
        let site = build_site(&facts, TAG_UNIVERSE);
        prop_assert_eq!(evaluate(&rules, &site), evaluate(&rules, &site));
    }

    /// `inv_rule_verdicts_independent_of_input_order`: a real shuffle of
    /// the order facts were declared in, or the order rule rows are
    /// passed in, never changes `evaluate`'s own (already-sorted,
    /// deduplicated) output -- all five kinds, areas included.
    #[test]
    fn inv_rule_verdicts_independent_of_input_order(
        (facts, fact_keys) in facts_strategy(1..30)
            .prop_flat_map(|facts| {
                let len = facts.len();
                (Just(facts), proptest::collection::vec(any::<u32>(), len))
            }),
        rule_keys in proptest::collection::vec(any::<u32>(), 5),
    ) {
        let rules = five_rules(TAG_UNIVERSE);
        let shuffled_rules = shuffle(&rules, &rule_keys);
        let shuffled_facts = shuffle(&facts, &fact_keys);

        let site = build_site(&facts, TAG_UNIVERSE);
        let shuffled_site = build_site(&shuffled_facts, TAG_UNIVERSE);

        prop_assert_eq!(
            evaluate(&rules, &site),
            evaluate(&shuffled_rules, &shuffled_site)
        );
    }

    /// `inv_rule_verdicts_invariant_under_tag_relabelling` (Quentin's
    /// direction, PR #294 cycles 1-2, replacing the tautological
    /// `inv_generated_placement_never_violates_local_rules`): the
    /// behavioural proof of AC3's "never a bespoke branch" that a grep
    /// guard cannot give -- `check-rule-engine-no-content-keys.sh` only
    /// catches a hardcoded *quoted key*, never a hardcoded *tag id*
    /// (`if subject == 7`, or `if subject == 42` for any id outside
    /// [`TAG_UNIVERSE`]). The replacement tag set is six *arbitrary*
    /// distinct `u32`s drawn from the full range, never a permutation of
    /// [`TAG_UNIVERSE`]'s own six small numbers -- a permutation alone
    /// would never exercise a branch hardcoded on an id above 6.
    /// Consistently relabelling every tag id, in both the rules and the
    /// site, must never change which cells violate: the engine's
    /// behaviour depends only on tag *equality*, never on any particular
    /// numeric id.
    #[test]
    fn inv_rule_verdicts_invariant_under_tag_relabelling(
        facts in facts_strategy(0..30),
        replacement_tags in proptest::collection::btree_set(any::<u32>(), 6),
    ) {
        let permuted_tags: [TagId; 6] = replacement_tags
            .into_iter()
            .collect::<Vec<TagId>>()
            .try_into()
            .unwrap();

        let original_rules = five_rules(TAG_UNIVERSE);
        let permuted_rules = five_rules(permuted_tags);

        let original_site = build_site(&facts, TAG_UNIVERSE);
        let permuted_site = build_site(&facts, permuted_tags);

        prop_assert_eq!(
            evaluate(&original_rules, &original_site),
            evaluate(&permuted_rules, &permuted_site)
        );
    }

    /// `inv_distribution_even_layout_never_violates`: `n_groups` subject
    /// cells spaced exactly `spacing` cells apart, each co-located with
    /// its own covering `per` cell (so coverage is never the binding
    /// constraint here), never violates. The same count clustered one
    /// cell apart (well inside `spacing`) always does. A third layout --
    /// subjects satisfying `min_spacing` but clustered in one corner
    /// while `per` cells sit far away -- always violates the coverage
    /// bound (Quentin's direction, PR #294 cycle 1): `min_spacing` alone
    /// cannot express "evenly spread" (AC2), only `max_distance` can.
    #[test]
    fn inv_distribution_even_layout_never_violates(n_groups in 2i32..15, spacing in 2u32..6) {
        let ratio = 1u32;
        let rule = RuleDef {
            id: 1,
            key: "distribution",
            kind: RuleKind::Distribution {
                subject: RULE_SUBJECT,
                per: RULE_PER_OR_WITHIN,
                ratio,
                tolerance_percent: 0,
                min_spacing: spacing,
                max_distance: spacing,
            },
        };

        let mut even = SiteBuilder::new();
        for i in 0..n_groups {
            let cell = Cell::new(i * spacing as i32, 0, 0);
            even = even
                .cell(cell, &[RULE_SUBJECT])
                .cell(cell, &[RULE_PER_OR_WITHIN]);
        }
        prop_assert!(evaluate(&[rule], &even.build()).is_empty());

        let mut clustered = SiteBuilder::new();
        for i in 0..n_groups {
            let cell = Cell::new(i, 0, 0);
            clustered = clustered
                .cell(cell, &[RULE_SUBJECT])
                .cell(cell, &[RULE_PER_OR_WITHIN]);
        }
        prop_assert!(!evaluate(&[rule], &clustered.build()).is_empty());

        // Same subject layout as `even` (satisfies min_spacing), but the
        // `per` cells sit far outside `max_distance` of every subject --
        // "evenly spread" fails even though the spacing floor alone
        // would have passed this exact subject placement.
        let mut corner = SiteBuilder::new();
        for i in 0..n_groups {
            corner = corner.cell(Cell::new(i * spacing as i32, 0, 0), &[RULE_SUBJECT]);
        }
        for i in 0..n_groups {
            corner = corner.cell(Cell::new(10_000 + i, 0, 0), &[RULE_PER_OR_WITHIN]);
        }
        prop_assert!(!evaluate(&[rule], &corner.build()).is_empty());
    }
}

// --- story 2.4: walkability (FR128) -----------------------------------

/// One cell's worth of sub-cells (`COLLIDER_SUBCELLS_PER_CELL`, never a
/// second literal 16).
const RING_CELL_SUBCELLS: i32 = defs::COLLIDER_SUBCELLS_PER_CELL;
/// An 8x6-cell ring, wall one cell thick, in sub-cells.
const RING_W: i32 = 8 * RING_CELL_SUBCELLS;
const RING_H: i32 = 6 * RING_CELL_SUBCELLS;
/// The north wall's own span, minus its two corner cells -- a gap here
/// never eats into a side wall.
const RING_WALL_X0: i32 = RING_CELL_SUBCELLS;
const RING_WALL_X1: i32 = RING_W - RING_CELL_SUBCELLS;

/// A rectangular ring (walls one cell thick, sub-cell resolution) with a
/// gap of `gap_width` sub-cells starting `gap_offset` sub-cells into the
/// north wall's own interior span -- `gap_width` 0 means a fully sealed
/// ring. The one fixture both new proptest invariants below share.
fn ring_with_gap(gap_offset: i32, gap_width: i32) -> WalkabilityGrid {
    let margin = RING_CELL_SUBCELLS;
    let bounds = Rect {
        x0: -margin,
        y0: -margin,
        x1: RING_W + margin,
        y1: RING_H + margin,
    };
    let mut colliders = vec![
        Rect {
            x0: 0,
            y0: 0,
            x1: RING_CELL_SUBCELLS,
            y1: RING_H,
        }, // west
        Rect {
            x0: RING_W - RING_CELL_SUBCELLS,
            y0: 0,
            x1: RING_W,
            y1: RING_H,
        }, // east
        Rect {
            x0: 0,
            y0: RING_H - RING_CELL_SUBCELLS,
            x1: RING_W,
            y1: RING_H,
        }, // south
    ];
    let gap_start = (RING_WALL_X0 + gap_offset).clamp(RING_WALL_X0, RING_WALL_X1);
    let gap_end = (gap_start + gap_width.max(0)).clamp(RING_WALL_X0, RING_WALL_X1);
    if gap_start > RING_WALL_X0 {
        colliders.push(Rect {
            x0: RING_WALL_X0,
            y0: 0,
            x1: gap_start,
            y1: RING_CELL_SUBCELLS,
        });
    }
    if gap_end < RING_WALL_X1 {
        colliders.push(Rect {
            x0: gap_end,
            y0: 0,
            x1: RING_WALL_X1,
            y1: RING_CELL_SUBCELLS,
        });
    }
    WalkabilityGrid::build(bounds, &colliders).expect("ring geometry is always valid")
}

/// A cell just outside the ring's own north wall, in the always-open
/// margin -- every `ring_with_gap` caller's own seed.
const RING_EXTERIOR_SEED: (i32, i32) = (-RING_CELL_SUBCELLS / 2, -RING_CELL_SUBCELLS / 2);

/// Quentin's direction, cycle 2: which of the window's own four sides a
/// [`ring_open_to_edge`] ring is pushed flush against.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Edge {
    North,
    East,
    South,
    West,
}

fn opposite_edge(edge: Edge) -> Edge {
    match edge {
        Edge::North => Edge::South,
        Edge::South => Edge::North,
        Edge::East => Edge::West,
        Edge::West => Edge::East,
    }
}

const EDGE_RING_W: i32 = 6 * RING_CELL_SUBCELLS;
const EDGE_RING_H: i32 = 4 * RING_CELL_SUBCELLS;

/// A wall segment `gap` sub-cells wide, centred over local span
/// `0..span_len`, split into (up to) two stub `Rect`s within the full
/// wall extent `[full_lo, full_hi)` on the cross axis -- shared by both
/// the horizontal (north/south) and vertical (east/west) wall builders
/// below, called with the axes swapped.
fn wall_stubs(full_lo: i32, full_hi: i32, span_len: i32, gap: i32) -> Vec<(i32, i32)> {
    let door_start = (span_len - gap) / 2;
    let door_end = door_start + gap;
    let mut stubs = Vec::new();
    if door_start > full_lo {
        stubs.push((full_lo, door_start));
    }
    if door_end < full_hi {
        stubs.push((door_end, full_hi));
    }
    stubs
}

/// A ring's interior (fixed size, `EDGE_RING_W x EDGE_RING_H`), pushed
/// flush against one of the window's own four edges: the wall on that
/// side is entirely omitted and `bounds` itself cropped to the
/// interior's own boundary there, no wall and no margin between them.
/// The other three sides keep a real wall and a generous margin, and the
/// door -- `gap` sub-cells wide -- sits in the wall directly opposite the
/// open edge, so the seed (in the margin beyond that door) must cross
/// the door to reach the interior at all. Quentin's direction, cycle 2:
/// the case that exposed the edge exemption's own bug, since an eroded
/// origin can only ever touch `bounds.x0`/`bounds.y0` directly, never
/// `bounds.x1 - 1`/`bounds.y1 - 1` -- pushing the ring against every one
/// of the four sides in turn is what a west-only fixture could not catch.
fn ring_open_to_edge(edge: Edge, gap: i32) -> (WalkabilityGrid, (i32, i32)) {
    let cell = RING_CELL_SUBCELLS;
    let margin = cell;
    let w = EDGE_RING_W;
    let h = EDGE_RING_H;
    let door_edge = opposite_edge(edge);

    let west_present = edge != Edge::West;
    let east_present = edge != Edge::East;
    let north_present = edge != Edge::North;
    let south_present = edge != Edge::South;

    let bounds = Rect {
        x0: if west_present { -cell - margin } else { 0 },
        x1: if east_present { w + cell + margin } else { w },
        y0: if north_present { -cell - margin } else { 0 },
        y1: if south_present { h + cell + margin } else { h },
    };

    let mut colliders = Vec::new();
    if west_present {
        if door_edge == Edge::West {
            for (y0, y1) in wall_stubs(-cell, h + cell, h, gap) {
                colliders.push(Rect {
                    x0: -cell,
                    y0,
                    x1: 0,
                    y1,
                });
            }
        } else {
            colliders.push(Rect {
                x0: -cell,
                y0: -cell,
                x1: 0,
                y1: h + cell,
            });
        }
    }
    if east_present {
        if door_edge == Edge::East {
            for (y0, y1) in wall_stubs(-cell, h + cell, h, gap) {
                colliders.push(Rect {
                    x0: w,
                    y0,
                    x1: w + cell,
                    y1,
                });
            }
        } else {
            colliders.push(Rect {
                x0: w,
                y0: -cell,
                x1: w + cell,
                y1: h + cell,
            });
        }
    }
    if north_present {
        if door_edge == Edge::North {
            for (x0, x1) in wall_stubs(-cell, w + cell, w, gap) {
                colliders.push(Rect {
                    x0,
                    y0: -cell,
                    x1,
                    y1: 0,
                });
            }
        } else {
            colliders.push(Rect {
                x0: -cell,
                y0: -cell,
                x1: w + cell,
                y1: 0,
            });
        }
    }
    if south_present {
        if door_edge == Edge::South {
            for (x0, x1) in wall_stubs(-cell, w + cell, w, gap) {
                colliders.push(Rect {
                    x0,
                    y0: h,
                    x1,
                    y1: h + cell,
                });
            }
        } else {
            colliders.push(Rect {
                x0: -cell,
                y0: h,
                x1: w + cell,
                y1: h + cell,
            });
        }
    }

    let grid = WalkabilityGrid::build(bounds, &colliders).expect("ring geometry is always valid");
    let seed = match door_edge {
        Edge::North => (w / 2, -cell - margin / 2),
        Edge::South => (w / 2, h + cell + margin / 2),
        Edge::East => (w + cell + margin / 2, h / 2),
        Edge::West => (-cell - margin / 2, h / 2),
    };
    (grid, seed)
}

/// `(gap_width, gap_offset)`, integer-only (NFR25: `sim` is
/// integer/fixed-point, and that discipline holds in its own test suite
/// too -- no `f64` fraction trick): `gap_width` ranges from the real
/// player body width up to the wall's own span, and `gap_offset` is
/// generated *after* it (`prop_flat_map`) so it always leaves the gap
/// fully inside the span.
fn gap_at_least_body_width_strategy() -> impl Strategy<Value = (i32, i32)> {
    let (body_w, _) = player_body_subcells(defs::BALANCE);
    let span = RING_WALL_X1 - RING_WALL_X0;
    (body_w..=span).prop_flat_map(move |gap_width| {
        let max_offset = span - gap_width;
        (Just(gap_width), 0..=max_offset)
    })
}

/// The number of 4-connected components `grid`'s own passable sub-cells
/// form, over its own declared bounds -- iterative, never recursive,
/// deterministic (raster scan order).
fn component_count(grid: &WalkabilityGrid) -> usize {
    let bounds = grid.bounds();
    let total = ((bounds.x1 - bounds.x0) as i64 * (bounds.y1 - bounds.y0) as i64) as usize;
    let mut visited = vec![false; total];
    let mut count = 0;
    let mut stack: Vec<(i32, i32)> = Vec::new();
    for y in bounds.y0..bounds.y1 {
        for x in bounds.x0..bounds.x1 {
            let idx = cell_index(bounds, x, y).unwrap();
            if visited[idx] || !grid.is_passable(x, y) {
                continue;
            }
            count += 1;
            visited[idx] = true;
            stack.clear();
            stack.push((x, y));
            while let Some((cx, cy)) = stack.pop() {
                for (nx, ny) in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)] {
                    if !bounds.contains(nx, ny) {
                        continue;
                    }
                    let nidx = cell_index(bounds, nx, ny).unwrap();
                    if !visited[nidx] && grid.is_passable(nx, ny) {
                        visited[nidx] = true;
                        stack.push((nx, ny));
                    }
                }
            }
        }
    }
    count
}

proptest! {
    /// `inv_doorway_gap_at_least_body_width_is_one_component_under_erosion`
    /// (FR128): for any gap at least the real, generated
    /// `movement.player_body_width_subcells` wide, anywhere within the
    /// north wall's own span, eroding the ring by the real player body
    /// always leaves exterior and interior joined into a single
    /// component -- never split, regardless of exactly where the gap
    /// sits.
    #[test]
    fn inv_doorway_gap_at_least_body_width_is_one_component_under_erosion(
        (gap_width, gap_offset) in gap_at_least_body_width_strategy(),
    ) {
        let (body_w, body_h) = player_body_subcells(defs::BALANCE);
        let grid = ring_with_gap(gap_offset, gap_width);
        let eroded = erode(&grid, body_w, body_h);
        prop_assert_eq!(component_count(&eroded), 1);
    }

    /// `inv_sealed_ring_yields_exactly_one_enclosed_region` (FR128): a
    /// ring with no gap at all -- whatever its (always-zero) gap
    /// position -- always reports exactly one enclosed region from any
    /// exterior seed.
    #[test]
    fn inv_sealed_ring_yields_exactly_one_enclosed_region(gap_offset in 0i32..(RING_WALL_X1 - RING_WALL_X0)) {
        let grid = ring_with_gap(gap_offset, 0);
        let findings = enclosed_regions(&grid, RING_EXTERIOR_SEED.0, RING_EXTERIOR_SEED.1).unwrap();
        prop_assert_eq!(findings.len(), 1);
    }

    /// `inv_removing_a_door_never_reduces_enclosed_regions` (Quentin's
    /// direction): narrowing a ring's own gap -- down to, and including,
    /// closing it entirely -- never *reduces* the number of reported
    /// enclosed regions from the same exterior seed.
    #[test]
    fn inv_removing_a_door_never_reduces_enclosed_regions(
        gap_offset in 0i32..(RING_WALL_X1 - RING_WALL_X0),
        wide_gap in 1i32..(RING_WALL_X1 - RING_WALL_X0),
        narrow_gap in 0i32..(RING_WALL_X1 - RING_WALL_X0),
    ) {
        let wide = wide_gap.max(narrow_gap);
        let narrow = wide_gap.min(narrow_gap);
        let wide_grid = ring_with_gap(gap_offset, wide);
        let narrow_grid = ring_with_gap(gap_offset, narrow);
        let wide_count = enclosed_regions(&wide_grid, RING_EXTERIOR_SEED.0, RING_EXTERIOR_SEED.1).unwrap().len();
        let narrow_count = enclosed_regions(&narrow_grid, RING_EXTERIOR_SEED.0, RING_EXTERIOR_SEED.1).unwrap().len();
        prop_assert!(narrow_count >= wide_count);
    }

    /// `inv_ring_open_to_any_window_edge_is_never_reported` (Tim's
    /// direction; parametrised over all four edges, Quentin's direction,
    /// cycle 2): a ring's own interior, pushed flush against any one of
    /// the window's own four edges with no wall and no margin between
    /// them, is never reported -- by `enclosed_regions`, and by
    /// `narrow_passages` too, using a door narrower than the real player
    /// body so `narrow_passages` has something it could wrongly report.
    /// The east/south cases are exactly what exposed this cycle's own
    /// edge-exemption bug (an eroded origin can only ever touch
    /// `bounds.x0`/`bounds.y0`, never `bounds.x1 - 1`/`bounds.y1 - 1`).
    #[test]
    fn inv_ring_open_to_any_window_edge_is_never_reported(
        edge in prop_oneof![
            Just(Edge::North),
            Just(Edge::East),
            Just(Edge::South),
            Just(Edge::West),
        ],
        gap in 1i32..player_body_subcells(defs::BALANCE).0,
    ) {
        let (body_w, body_h) = player_body_subcells(defs::BALANCE);
        let (grid, (seed_x, seed_y)) = ring_open_to_edge(edge, gap);
        let enclosed = enclosed_regions(&grid, seed_x, seed_y).unwrap();
        prop_assert!(enclosed.is_empty());
        let narrow = narrow_passages(&grid, seed_x, seed_y, body_w, body_h).unwrap();
        prop_assert!(narrow.is_empty());
    }
}

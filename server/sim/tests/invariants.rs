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
use sim::generation::{GenerationConfig, land_use, streets};
use sim::rng::{Rng, seed_from_ids};
use sim::rules::testing::SiteBuilder;
use sim::rules::{
    AdjacencyRelation, AreaId, Cell, CoherenceMode, Direction, NeighbourTerm, RuleDef, RuleKind,
    RuleSite, TagId, Violation,
};
use sim::world::walkability::{
    WalkabilityGrid, enclosed_regions, erode, narrow_passages, player_body_subcells,
};
use sim::world::{
    AreaSpec, FloorCollision, FloorSpec, NO_OWNER, Rect, TransitionSpec, WorldSpec, cell_index,
    chunk_key, fixture,
};

mod support;

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
pub const INV_ADJACENCY_FORBIDDEN_PAIR_IS_REPORTED_EXACTLY: &str = "a forbidden pair planted at a random position and orientation in an otherwise-clean grid is reported exactly once, naming both cells, and removing it again leaves zero violations";
pub const INV_ADJACENCY_DIRECTION_RESPECTED: &str = "a directional single-term alternative fires only in its own orientation, and mirroring the grid together with the term's own direction never changes the violation count";
pub const INV_GRAMMAR_ROTATE_INVARIANT: &str =
    "a rotate = true row's verdict is invariant under rotating the whole site by 90 degrees";
pub const INV_GRAMMAR_VERDICT_TOTAL: &str = "the committed grammar rows never panic over any random composition, including empty, disconnected or out-of-range sites, and the same input always gives the same verdict";
pub const INV_WELL_FORMED_ROOM_ACCEPTED: &str = "a closed wall ring with a floor interior and a real doorway on a random non-corner wall cell, at any size at or above the grammar minimum, is accepted";
pub const INV_SINGLE_MUTATION_REJECTED_WITH_ITS_REASON: &str = "starting from an accepted room, one mutation from a fixed table, at a random valid position, is always rejected with that mutation's own named reason and no other";
pub const INV_GRAMMAR_ACCEPTED_ROOM_IS_REACHABLE: &str = "every room the grammar accepts, rasterised from that same accepted site and eroded by the real player body, also passes 2.4's enclosed_regions and narrow_passages checks from an exterior seed -- the grammar and FR128's walkability invariant never disagree about whether a room is enterable";
pub const INV_DOORWAY_GAP_AT_LEAST_BODY_WIDTH_IS_ONE_COMPONENT_UNDER_EROSION: &str = "a ring with a doorway gap at least the player body's own width is always a single connected component once the walkability grid is eroded by the body (FR128)";
pub const INV_SEALED_RING_YIELDS_EXACTLY_ONE_ENCLOSED_REGION: &str =
    "a ring with no gap at all always yields exactly one enclosed region (FR128)";
pub const INV_REMOVING_A_DOOR_NEVER_REDUCES_ENCLOSED_REGIONS: &str = "narrowing a ring's own doorway gap (down to and including closing it entirely) never reduces the number of reported enclosed regions (FR128)";
pub const INV_RING_OPEN_TO_ANY_WINDOW_EDGE_IS_NEVER_REPORTED: &str = "a ring's own interior, pushed flush against any one of the window's own four edges with no wall and no margin between them, is never reported by enclosed_regions or by narrow_passages, for a door narrower than the real player body (FR128)";
pub const INV_GENERATION_TOTAL_NEVER_PANICS: &str = "generation is total: for any seed, both passes return a valid plan or a typed error, never a panic (FR110)";
pub const INV_GENERATION_ALL_FOUR_LAND_USES_PRESENT: &str = "pass 1's coarse grid is fully assigned (no unassigned cell) and every one of the four land uses appears at least once, for any seed (FR110)";
pub const INV_GENERATION_STREETS_CONNECTED_AND_NOT_STRANDED: &str = "pass 2's street graph is a single connected component, and every pass-1 region borders a street, for any seed (FR110)";
pub const INV_GENERATION_NO_DEAD_ENDS_AWAY_FROM_BOUNDARY: &str =
    "pass 2 never produces a degree-1 node away from the site boundary, for any seed (FR110, NFR8)";
pub const INV_GENERATION_DETOUR_RATIO_BOUNDED: &str = "over the deterministic node-pair sample, BFS network distance never exceeds max_detour_percent of Manhattan distance, for any seed (FR110)";
pub const INV_GENERATION_NOT_A_PERFECT_GRID: &str = "block width and height each take at least min_distinct_block_sizes distinct values, both junction kinds are present, and at least two street classes are present, for any seed (FR110, NFR8)";
pub const INV_GENERATION_EXACT_TILING: &str = "every site cell is covered by exactly one block or by at least one street, and no two blocks overlap, for any seed (FR110)";
pub const INV_GENERATION_INSTITUTIONAL_POCKETS_ARE_SMALL: &str = "every institutional region is at most two max-sized leaves' worth of coarse cells, for any seed -- several small pockets, never one slab (FR110, Artie's direction)";
pub const INV_GENERATION_INDUSTRIAL_NEVER_TOUCHES_COMMERCIAL: &str =
    "no industrial coarse cell is ever adjacent to a commercial one, for any seed (FR110)";
pub const INV_GENERATION_RESIDENTIAL_IS_THE_LARGEST_LAND_USE_BY_AREA: &str = "residential has more coarse cells than any other single land use, for any seed -- field-driven assignment (commercial at the peak, industrial one contiguous group, institutional the smallest leaves) structurally favours it over a blind weighted draw, but that only holds if something keeps checking it (FR110, Quentin's direction)";
pub const INV_GENERATION_P99_DETOUR_RATIO_BOUNDED: &str = "the 99th-percentile BFS-network-vs-Manhattan detour ratio, over one city's own sampled pairs, never exceeds p99_detour_percent, for any seed (FR110, Tim's direction)";
pub const INV_GENERATION_NO_STAGGERED_JUNCTIONS: &str = "no two junctions on the same street sit under junction_min_separation_cells apart unless they coincide, for any seed -- asserted at zero, a refused split rather than a measured ceiling (FR110, Tim's direction)";
pub const INV_GENERATION_MIN_BLOCK_DEPTH_IS_RESPECTED: &str =
    "every block is at least min_block_depth_cells on both axes, for any seed (FR110)";
pub const INV_GENERATION_ARTERIALS_ARE_CONTIGUOUS: &str = "every arterial line starts at its own near site edge with no gap, and at most one arterial line per city stops short of the far site edge (the T-termination), for any seed (FR110, Artie's direction)";
pub const INV_GENERATION_PERIPHERAL_BLOCKS_ARE_NOT_DEGENERATE: &str = "mean block area on the far side of the field's own median distance from the density peak is at least half the near side's, for any seed -- a real inversion, not the occasional close call (NFR8, Artie's direction)";

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
/// A tag neither `RULE_SUBJECT` nor `RULE_PER_OR_WITHIN` -- background
/// cells `inv_adjacency_forbidden_pair_is_reported_exactly` generates
/// carry only this, so none of them can ever interact with the rule
/// under test, whatever position they land on.
const UNRELATED_TAG: TagId = 103;

/// Builds a `'static` one-term-per-direction alternative set naming
/// `tag` -- the lowering `tools/defs-build` gives a direction-less `b`
/// row. `RuleKind::Adjacency::alternatives` is typed exactly like the
/// real generated `RULES` table it stands in for (`&'static [&'static
/// [NeighbourTerm]]`), so a proptest-driven fixture built from a
/// *runtime* tag id (never a `const`, so never rvalue-promotable) leaks
/// its own small allocation here instead -- acceptable in a short-lived
/// test process, never reachable from `sim`'s own published code.
fn any_direction_alternatives(tag: TagId) -> &'static [&'static [NeighbourTerm]] {
    let alts: Vec<&'static [NeighbourTerm]> = Direction::ALL
        .into_iter()
        .map(|direction| -> &'static [NeighbourTerm] {
            Box::leak(Box::new([NeighbourTerm {
                direction,
                tag,
                present: true,
            }]))
        })
        .collect();
    Box::leak(alts.into_boxed_slice())
}

/// A two-alternative, two-term-each pattern -- "`a` north of the subject
/// and `b` south of it, or `a` east and `b` west" -- the corner/doorway
/// shape story 2.9's grammar primitives actually use, built from runtime
/// tag ids the same leaked-`'static` way as [`any_direction_alternatives`]
/// (Quentin's direction: the relabelling invariant must exercise
/// multi-term, multi-alternative rows too, not only the single-term
/// any-direction lowering).
fn two_term_alternatives(a: TagId, b: TagId) -> &'static [&'static [NeighbourTerm]] {
    let alts: Vec<&'static [NeighbourTerm]> = vec![
        Box::leak(Box::new([
            NeighbourTerm {
                direction: Direction::North,
                tag: a,
                present: true,
            },
            NeighbourTerm {
                direction: Direction::South,
                tag: b,
                present: true,
            },
        ])),
        Box::leak(Box::new([
            NeighbourTerm {
                direction: Direction::East,
                tag: a,
                present: true,
            },
            NeighbourTerm {
                direction: Direction::West,
                tag: b,
                present: true,
            },
        ])),
    ];
    Box::leak(alts.into_boxed_slice())
}

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
                relation: AdjacencyRelation::Require,
                alternatives: two_term_alternatives(t4, t5),
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
        prop_assert_eq!(support::eval(&rules, &site), support::eval(&rules, &site));
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
            support::eval(&rules, &site),
            support::eval(&shuffled_rules, &shuffled_site)
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
            support::eval(&original_rules, &original_site),
            support::eval(&permuted_rules, &permuted_site)
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
        prop_assert!(support::eval(&[rule], &even.build()).is_empty());

        let mut clustered = SiteBuilder::new();
        for i in 0..n_groups {
            let cell = Cell::new(i, 0, 0);
            clustered = clustered
                .cell(cell, &[RULE_SUBJECT])
                .cell(cell, &[RULE_PER_OR_WITHIN]);
        }
        prop_assert!(!support::eval(&[rule], &clustered.build()).is_empty());

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
        prop_assert!(!support::eval(&[rule], &corner.build()).is_empty());
    }
}

// --- story 2.9: the adjacency grammar (FR119) ---------------------------

fn mirror_y(c: Cell) -> Cell {
    Cell::new(c.x, -c.y, c.floor)
}

fn rotate90(c: Cell) -> Cell {
    Cell::new(-c.y, c.x, c.floor)
}

/// Maps each violation's `(subject, other)` through `transform`, so a
/// symmetry invariant (mirror, rotate) can compare the transformed
/// *set* of violating cells/pairs rather than merely their count -- an
/// engine that ignored the transform's own axis entirely would still
/// match on count alone (Quentin's direction).
fn transformed_violation_set(
    violations: &[Violation],
    transform: impl Fn(Cell) -> Cell,
) -> std::collections::BTreeSet<(Cell, Option<Cell>)> {
    violations
        .iter()
        .map(|v| (transform(v.subject), v.other.map(&transform)))
        .collect()
}

const BUILDING_AREA: AreaId = 1;
const ROOM_AREA: AreaId = 2;

/// A closed `w` by `h` wall ring with a floor interior and a real
/// doorway at `(door_x, h - 1)` -- `door_x` always `1..w-1`, so it is
/// never a corner. Pavement sits immediately south of the door, a waste
/// bin somewhere inside (the pre-existing `walled_room_has_waste_bin`
/// row is a "subject has a role" row too -- see `support::grammar_rules`
/// 's own doc comment). Every area
/// [`support::grammar_rules`]'s own rows can ask about is populated,
/// exactly like `grammar.rs`'s own `well_formed_room_and_building`.
fn build_doored_room(w: i32, h: i32, door_x: i32) -> sim::rules::testing::Site {
    let wall = support::tag_id("wall");
    let wall_run = support::tag_id("wall_run");
    let floor = support::tag_id("floor");
    let threshold = support::tag_id("threshold");
    let entrance = support::tag_id("entrance");
    let pavement = support::tag_id("pavement");
    let waste = support::tag_id("waste");
    let door = Cell::new(door_x, h - 1, 0);

    let mut b = SiteBuilder::new();
    for x in 0..w {
        for y in 0..h {
            let cell = Cell::new(x, y, 0);
            let on_perimeter = x == 0 || y == 0 || x == w - 1 || y == h - 1;
            if cell == door {
                b = b
                    .cell(cell, &[threshold, wall_run, entrance])
                    .area(cell, BUILDING_AREA)
                    .area(cell, ROOM_AREA);
            } else if on_perimeter {
                b = b.cell(cell, &[wall, wall_run]).area(cell, BUILDING_AREA);
            } else {
                b = b
                    .cell(cell, &[floor])
                    .area(cell, BUILDING_AREA)
                    .area(cell, ROOM_AREA);
            }
        }
    }
    let waste_cell = Cell::new(1, 1, 0);
    b = b.cell(waste_cell, &[waste]).area(waste_cell, BUILDING_AREA);
    b = b.cell(Cell::new(door_x, h, 0), &[pavement]);
    b.build()
}

/// The sub-cell walkability grid *for `site`'s own cells* (Quentin's
/// direction, cycle 2: never derived from `(w, h, door_x)` alone, which
/// would still pass even if the grammar had just accepted a door-less
/// ring or a threshold tucked into a corner): every cell `site` itself
/// tags `wall` becomes a whole-cell collider, everything else stays
/// open. `w`/`h` size `bounds` only, wide enough to hold a seed outside
/// the ring and the pavement cell immediately south of the door.
fn walkability_grid_from_site(site: &sim::rules::testing::Site, w: i32, h: i32) -> WalkabilityGrid {
    let s = defs::COLLIDER_SUBCELLS_PER_CELL;
    let wall = support::tag_id("wall");
    let colliders: Vec<Rect> = site
        .subjects_in_area(None, wall)
        .iter()
        .map(|cell| Rect {
            x0: cell.x * s,
            y0: cell.y * s,
            x1: (cell.x + 1) * s,
            y1: (cell.y + 1) * s,
        })
        .collect();
    let margin = s;
    let bounds = Rect {
        x0: -margin,
        y0: -margin,
        x1: w * s + margin,
        y1: (h + 1) * s + margin,
    };
    WalkabilityGrid::build(bounds, &colliders).expect("room geometry is always valid")
}

/// The always-open sub-cell just outside a [`build_doored_room`]/
/// [`walkability_grid_from_site`] ring's own north-west corner -- every
/// caller's own exterior seed.
fn doored_room_exterior_seed() -> (i32, i32) {
    let s = defs::COLLIDER_SUBCELLS_PER_CELL;
    (-s / 2, -s / 2)
}

/// Proves [`walkability_grid_from_site`] has teeth (Quentin's direction,
/// cycle 2): fed a room with no door at all (`RoomMutation::NoDoor`'s own
/// shape, built directly here rather than importing the proptest-only
/// mutation table), it reports exactly the one enclosed region a sealed
/// ring must -- if this helper silently produced an always-open grid
/// regardless of `site`, this is the test that would catch it.
#[test]
fn walkability_grid_from_site_reports_one_enclosed_region_for_a_doorless_room() {
    let wall = support::tag_id("wall");
    let floor = support::tag_id("floor");
    let (w, h) = (6, 6);
    let mut b = SiteBuilder::new();
    for x in 0..w {
        for y in 0..h {
            let cell = Cell::new(x, y, 0);
            let on_perimeter = x == 0 || y == 0 || x == w - 1 || y == h - 1;
            if on_perimeter {
                b = b.cell(cell, &[wall]);
            } else {
                b = b.cell(cell, &[floor]);
            }
        }
    }
    let site = b.build();
    let grid = walkability_grid_from_site(&site, w, h);
    let seed = doored_room_exterior_seed();
    let enclosed = enclosed_regions(&grid, seed.0, seed.1).unwrap();
    assert_eq!(enclosed.len(), 1);
}

#[derive(Debug, Clone, Copy)]
enum RoomMutation {
    /// Drops the north wall's own cell at a random non-corner x --
    /// its two surviving neighbours are left with only one `wall_run`
    /// neighbour each, a free-standing stub (Artie's own named case).
    DropWallCell,
    /// Swaps one interior floor cell for bare ground.
    FloorTouchesGround,
    /// The door's own south wall stays wall instead of becoming
    /// pavement -- a doorway opening onto another wall (Artie's own
    /// named rejection case).
    DoorwayOpensOntoWall,
    /// The room has no threshold at all -- a fully closed ring.
    NoDoor,
    /// A real, well-formed doorway, but with no `entrance` tag -- an
    /// interior-shaped door that never reaches the exterior by name.
    NoEntrance,
    /// Standalone pair, translated to a random position: a floor cell
    /// directly against pavement, no threshold between them.
    FloorTouchesPavementDirectly,
    /// Standalone pair: a floor cell directly against road.
    FloorTouchesRoadDirectly,
    /// Standalone pair: a road cell directly against a wall.
    RoadTouchesWall,
    /// Standalone pair: a road cell directly against bare ground.
    RoadTouchesGround,
}

proptest! {
    /// `inv_adjacency_forbidden_pair_is_reported_exactly` (AC2): over a
    /// generated background of cells tagged with an unrelated third tag
    /// (so none of them can ever interact with the rule under test),
    /// planting exactly one forbidden neighbour, at a random position
    /// and in a random one of the four directions, reports exactly that
    /// pair -- the subject cell and the matched neighbour -- and nothing
    /// else. Removing the planted neighbour again (background kept)
    /// returns to zero violations.
    #[test]
    fn inv_adjacency_forbidden_pair_is_reported_exactly(
        background in proptest::collection::vec((-50i32..50, -50i32..50), 0..20),
        x in -50i32..50,
        y in -50i32..50,
        floor in -3i8..4,
        direction_idx in 0usize..4,
    ) {
        let direction = Direction::ALL[direction_idx];
        let subject_cell = Cell::new(x, y, floor);
        let other_cell = direction.step(subject_cell);
        prop_assume!(background.iter().all(|&(bx, by)| Cell::new(bx, by, floor) != subject_cell && Cell::new(bx, by, floor) != other_cell));
        let rule = RuleDef {
            id: 1,
            key: "forbid_pair",
            kind: RuleKind::Adjacency {
                a: RULE_SUBJECT,
                relation: AdjacencyRelation::Forbid,
                alternatives: any_direction_alternatives(RULE_PER_OR_WITHIN),
            },
        };

        let background_only = || {
            let mut b = SiteBuilder::new();
            for &(bx, by) in &background {
                // Neither tag the rule cares about -- these cells can
                // never interact with it, whatever their position.
                b = b.cell(Cell::new(bx, by, floor), &[UNRELATED_TAG]);
            }
            b
        };

        let clean = background_only().cell(subject_cell, &[RULE_SUBJECT]).build();
        prop_assert!(support::eval(&[rule], &clean).is_empty());

        let planted = background_only()
            .cell(subject_cell, &[RULE_SUBJECT])
            .cell(other_cell, &[RULE_PER_OR_WITHIN])
            .build();
        prop_assert_eq!(
            support::eval(&[rule], &planted),
            vec![Violation {
                rule_id: 1,
                subject: subject_cell,
                other: Some(other_cell),
            }]
        );

        // Removing the planted neighbour again (background kept)
        // returns to zero violations.
        let removed = background_only().cell(subject_cell, &[RULE_SUBJECT]).build();
        prop_assert!(support::eval(&[rule], &removed).is_empty());
    }

    /// `inv_adjacency_direction_respected`: a single-term directional
    /// alternative fires only in its own orientation. Mirroring the
    /// whole site north-south together with the rule's own direction
    /// (north becomes south) never changes the *set* of violating
    /// cells, mapped through the same mirror -- not merely how many
    /// there are, which an engine that ignored `direction` entirely
    /// would also get right by accident on a symmetric site.
    #[test]
    fn inv_adjacency_direction_respected(
        facts in proptest::collection::vec((-10i32..10, -10i32..10, 1u8..4), 0..20),
    ) {
        let mut site_builder = SiteBuilder::new();
        let mut mirrored_builder = SiteBuilder::new();
        for &(x, y, mask) in &facts {
            let cell = Cell::new(x, y, 0);
            let mut tags = Vec::new();
            if mask & 1 != 0 {
                tags.push(RULE_SUBJECT);
            }
            if mask & 2 != 0 {
                tags.push(RULE_PER_OR_WITHIN);
            }
            site_builder = site_builder.cell(cell, &tags);
            mirrored_builder = mirrored_builder.cell(mirror_y(cell), &tags);
        }
        let site = site_builder.build();
        let mirrored_site = mirrored_builder.build();

        let north_rule = RuleDef {
            id: 1,
            key: "north",
            kind: RuleKind::Adjacency {
                a: RULE_SUBJECT,
                relation: AdjacencyRelation::Require,
                alternatives: &[&[NeighbourTerm {
                    direction: Direction::North,
                    tag: RULE_PER_OR_WITHIN,
                    present: true,
                }]],
            },
        };
        let south_rule = RuleDef {
            id: 1,
            key: "south",
            kind: RuleKind::Adjacency {
                a: RULE_SUBJECT,
                relation: AdjacencyRelation::Require,
                alternatives: &[&[NeighbourTerm {
                    direction: Direction::South,
                    tag: RULE_PER_OR_WITHIN,
                    present: true,
                }]],
            },
        };

        let north_violations = support::eval(&[north_rule], &site);
        let south_violations = support::eval(&[south_rule], &mirrored_site);
        prop_assert_eq!(
            transformed_violation_set(&north_violations, mirror_y),
            transformed_violation_set(&south_violations, |c| c)
        );
    }

    /// `inv_grammar_rotate_invariant` (Tim's direction): every committed
    /// `rotate = true` row (`doorway_formed_between_walls`,
    /// `wall_is_part_of_a_straight_run_or_a_corner`) gives the same
    /// *set* of violating cells over any site and that same site
    /// rotated 90 degrees, mapped through the rotation -- over sites
    /// mixing wall, threshold, floor and pavement, so the doorway row's
    /// own rotation lowering is exercised too, not only the wall-only
    /// closure row.
    #[test]
    fn inv_grammar_rotate_invariant(
        cells in proptest::collection::vec((-6i32..6, -6i32..6, 0u8..4), 0..16),
        rule_key_idx in 0usize..2,
    ) {
        let rule_key = ["doorway_formed_between_walls", "wall_is_part_of_a_straight_run_or_a_corner"][rule_key_idx];
        let rule = support::rule(rule_key);
        let tag_keys = ["wall", "threshold", "floor", "pavement"];
        let tag_ids: Vec<TagId> = tag_keys.iter().map(|k| support::tag_id(k)).collect();

        let mut original = SiteBuilder::new();
        let mut rotated = SiteBuilder::new();
        for &(x, y, kind) in &cells {
            let cell = Cell::new(x, y, 0);
            let tag = tag_ids[kind as usize];
            original = original.cell(cell, &[tag]);
            rotated = rotated.cell(rotate90(cell), &[tag]);
        }

        let original_violations = support::eval(&[rule], &original.build());
        let rotated_violations = support::eval(&[rule], &rotated.build());
        prop_assert_eq!(
            transformed_violation_set(&original_violations, rotate90),
            transformed_violation_set(&rotated_violations, |c| c)
        );
    }

    /// `inv_grammar_verdict_total` (AC2/AC4): the committed grammar rows
    /// never panic over any random composition -- empty, disconnected,
    /// or with cells at wildly out-of-range coordinates -- and the same
    /// facts, inserted in a real shuffled order, always give the same
    /// verdict (NFR25) -- not merely the same in-memory value called
    /// twice, which proves nothing about order-independence.
    #[test]
    fn inv_grammar_verdict_total(
        (facts, shuffle_keys) in proptest::collection::vec((-1_000_000i32..1_000_000, -1_000_000i32..1_000_000, 0u8..128), 0..40)
            .prop_flat_map(|facts| {
                let len = facts.len();
                (Just(facts), proptest::collection::vec(any::<u32>(), len))
            }),
    ) {
        let tag_keys = ["wall", "floor", "threshold", "pavement", "road", "ground", "fixture"];
        let tag_ids: Vec<TagId> = tag_keys
            .iter()
            .map(|k| support::tag_id(k))
            .collect();
        let build = |ordered: &[(i32, i32, u8)]| {
            let mut builder = SiteBuilder::new();
            for &(x, y, mask) in ordered {
                let cell = Cell::new(x, y, 0);
                let tags: Vec<TagId> = (0..tag_ids.len())
                    .filter(|i| mask & (1 << i) != 0)
                    .map(|i| tag_ids[i])
                    .collect();
                if !tags.is_empty() {
                    builder = builder.cell(cell, &tags);
                }
            }
            builder.build()
        };
        let site = build(&facts);
        let shuffled_facts = shuffle(&facts, &shuffle_keys);
        let shuffled_site = build(&shuffled_facts);
        prop_assert_eq!(support::eval(defs::RULES, &site), support::eval(defs::RULES, &shuffled_site));
    }

    /// `inv_well_formed_room_accepted` (AC4): a closed wall ring with a
    /// floor interior and a real doorway on a random non-corner south
    /// wall cell, at any size at or above the grammar minimum, satisfies
    /// every row [`support::grammar_rules`] selects. A room with no door
    /// is covered as one of [`RoomMutation`]'s own cases below, never
    /// the only case tested.
    #[test]
    fn inv_well_formed_room_accepted(w in 5i32..10, h in 5i32..10, door_offset in 0u32..u32::MAX) {
        let door_x = 1 + (door_offset % (w - 2) as u32) as i32;
        let site = build_doored_room(w, h, door_x);
        prop_assert_eq!(support::eval(&support::grammar_rules(), &site), vec![]);
    }

    /// `inv_grammar_accepted_room_is_reachable` (Quentin's direction,
    /// cycles 1-2): every room [`inv_well_formed_room_accepted`] accepts
    /// also passes 2.4's own `enclosed_regions` and `narrow_passages`
    /// checks from an exterior seed -- the grammar and FR128's
    /// walkability invariant are never two truths that can drift apart.
    /// The collider grid is rasterised from the accepted site's own
    /// cells ([`walkability_grid_from_site`]), never independently from
    /// `(w, h, door_x)` alone, and eroded by the real, generated
    /// `movement.player_body_width_subcells` -- if that balance value
    /// ever grew past one cell, a grammar-accepted door would become
    /// impassable, and this is the assertion that would go red.
    #[test]
    fn inv_grammar_accepted_room_is_reachable(w in 5i32..10, h in 5i32..10, door_offset in 0u32..u32::MAX) {
        let door_x = 1 + (door_offset % (w - 2) as u32) as i32;
        let site = build_doored_room(w, h, door_x);
        prop_assert_eq!(support::eval(&support::grammar_rules(), &site), vec![]);

        let grid = walkability_grid_from_site(&site, w, h);
        let (body_w, body_h) = player_body_subcells(defs::BALANCE);
        let eroded = erode(&grid, body_w, body_h);
        let seed = doored_room_exterior_seed();
        let enclosed = enclosed_regions(&eroded, seed.0, seed.1).unwrap();
        prop_assert!(enclosed.is_empty());
        let narrow = narrow_passages(&grid, seed.0, seed.1, body_w, body_h).unwrap();
        prop_assert!(narrow.is_empty());
    }

    /// `inv_single_mutation_rejected_with_its_reason` (AC4): starting
    /// from an accepted room (or, for the four standalone pair cases, a
    /// two-cell site translated to a random position and facing a random
    /// one of the four directions), one mutation from [`RoomMutation`]
    /// -- drawn at a random valid position -- is always rejected, and
    /// the *exact* deduplicated set of rows it fires equals that
    /// mutation's own named set, evaluated against every committed
    /// grammar row (`support::grammar_rules()`), never just the one row
    /// under test (Quentin's direction, cycle 2: evaluating against only
    /// `[rule]` makes "rejected with *its* reason" a tautology, since no
    /// other row can fire). Where a bare floor/wall cell with no area
    /// also trips a Requirement row's own "container cell outside any
    /// area" case, that row is named in the expected set too, the same
    /// way `room_grammar_acceptance.rs`'s fixture already documents it.
    #[test]
    fn inv_single_mutation_rejected_with_its_reason(
        w in 6i32..10,
        h in 6i32..10,
        door_offset in 0u32..u32::MAX,
        drop_offset in 0u32..u32::MAX,
        floor_offset in 0u32..u32::MAX,
        dx in -50i32..50,
        dy in -50i32..50,
        direction_idx in 0usize..4,
        mutation in prop_oneof![
            Just(RoomMutation::DropWallCell),
            Just(RoomMutation::FloorTouchesGround),
            Just(RoomMutation::DoorwayOpensOntoWall),
            Just(RoomMutation::NoDoor),
            Just(RoomMutation::NoEntrance),
            Just(RoomMutation::FloorTouchesPavementDirectly),
            Just(RoomMutation::FloorTouchesRoadDirectly),
            Just(RoomMutation::RoadTouchesWall),
            Just(RoomMutation::RoadTouchesGround),
        ],
    ) {
        let direction = Direction::ALL[direction_idx];
        let door_x = 1 + (door_offset % (w - 2) as u32) as i32;
        let wall = support::tag_id("wall");
        let wall_run = support::tag_id("wall_run");
        let floor = support::tag_id("floor");
        let threshold = support::tag_id("threshold");
        let entrance = support::tag_id("entrance");
        let waste = support::tag_id("waste");
        let pavement = support::tag_id("pavement");
        let road = support::tag_id("road");
        let ground = support::tag_id("ground");
        let grammar = support::grammar_rules();

        // Shared by every room-scale mutation below: the same well-formed
        // room `build_doored_room` builds, but with one deliberate defect
        // -- `drop` removes a cell entirely, `ground_at` swaps one
        // interior floor cell for bare ground, `door_tags` replaces the
        // door cell's own tags (`[]` never reached -- every case below
        // gives it at least `wall`/`wall_run` or `threshold`/`wall_run`),
        // and `pavement_tag` replaces what sits immediately south of the
        // door. Area membership follows the tags actually placed, the
        // same way `build_doored_room` decides it.
        let build_room = |drop: Option<Cell>,
                           ground_at: Option<Cell>,
                           door_tags: &[TagId],
                           pavement_tag: TagId| {
            let door = Cell::new(door_x, h - 1, 0);
            let waste_cell = Cell::new(1, 1, 0);
            let mut b = SiteBuilder::new();
            for x in 0..w {
                for y in 0..h {
                    let cell = Cell::new(x, y, 0);
                    if Some(cell) == drop {
                        continue;
                    }
                    let on_perimeter = x == 0 || y == 0 || x == w - 1 || y == h - 1;
                    if cell == door {
                        b = b.cell(cell, door_tags).area(cell, BUILDING_AREA);
                        if door_tags.contains(&threshold) {
                            b = b.area(cell, ROOM_AREA);
                        }
                    } else if on_perimeter {
                        b = b.cell(cell, &[wall, wall_run]).area(cell, BUILDING_AREA);
                    } else if Some(cell) == ground_at {
                        b = b.cell(cell, &[ground]);
                    } else {
                        b = b
                            .cell(cell, &[floor])
                            .area(cell, BUILDING_AREA)
                            .area(cell, ROOM_AREA);
                    }
                }
            }
            if Some(waste_cell) != drop && Some(waste_cell) != ground_at {
                b = b.cell(waste_cell, &[waste]).area(waste_cell, BUILDING_AREA);
            }
            // Real pavement is never a Requirement container, so this
            // membership is inert for the normal case -- but the
            // `DoorwayOpensOntoWall` mutation turns this cell into
            // `wall`, which is, and a `wall` cell with no area at all
            // would be a second, unrelated Requirement violation
            // (`RuleKind::Requirement`'s own "outside any area" rule),
            // not the doorway/closure rejection this mutation is about.
            b = b
                .cell(Cell::new(door_x, h, 0), &[pavement_tag])
                .area(Cell::new(door_x, h, 0), BUILDING_AREA);
            b.build()
        };
        let door_tags = [threshold, wall_run, entrance];

        let (mutated_site, expected_keys): (_, Vec<&str>) = match mutation {
            RoomMutation::DropWallCell => {
                prop_assert!(support::eval(&grammar, &build_room(None, None, &door_tags, pavement)).is_empty());
                let drop_x = 1 + (drop_offset % (w - 2) as u32) as i32;
                let dropped = Cell::new(drop_x, 0, 0);
                (
                    build_room(Some(dropped), None, &door_tags, pavement),
                    vec!["wall_is_part_of_a_straight_run_or_a_corner"],
                )
            }
            RoomMutation::FloorTouchesGround => {
                prop_assert!(support::eval(&grammar, &build_room(None, None, &door_tags, pavement)).is_empty());
                let floor_x = 2 + (floor_offset % (w - 3).max(1) as u32) as i32;
                let ground_at = Cell::new(floor_x, 1, 0);
                (
                    build_room(None, Some(ground_at), &door_tags, pavement),
                    vec!["floor_never_touches_bare_ground"],
                )
            }
            // The stray wall cell south of the door (where pavement
            // should be) is itself a free-standing stub, and the door's
            // own `entrance` tag no longer opens onto pavement -- all
            // three are coupled to the same one deliberate defect, not
            // unrelated reasons.
            RoomMutation::DoorwayOpensOntoWall => (
                build_room(None, None, &door_tags, wall),
                vec![
                    "doorway_formed_between_walls",
                    "wall_is_part_of_a_straight_run_or_a_corner",
                    "entrance_opens_onto_pavement",
                ],
            ),
            // With no threshold at all, there is also no entrance --
            // the two Requirement rows are coupled by construction, not
            // two unrelated reasons.
            RoomMutation::NoDoor => (
                build_room(None, None, &[wall, wall_run], pavement),
                vec!["room_has_a_door", "building_has_an_entrance"],
            ),
            RoomMutation::NoEntrance => (
                build_room(None, None, &[threshold, wall_run], pavement),
                vec!["building_has_an_entrance"],
            ),
            // A bare floor cell carries no area, so `room_has_a_door`'s
            // own "container cell outside any area" case fires too --
            // named explicitly, not an unrelated reason.
            RoomMutation::FloorTouchesPavementDirectly => {
                let room = Cell::new(dx, dy, 0);
                let outside = direction.step(room);
                let site = SiteBuilder::new()
                    .cell(room, &[floor])
                    .cell(outside, &[pavement])
                    .build();
                (
                    site,
                    vec!["floor_never_touches_pavement_directly", "room_has_a_door"],
                )
            }
            RoomMutation::FloorTouchesRoadDirectly => {
                let room = Cell::new(dx, dy, 0);
                let outside = direction.step(room);
                let site = SiteBuilder::new()
                    .cell(room, &[floor])
                    .cell(outside, &[road])
                    .build();
                (
                    site,
                    vec!["floor_never_touches_road_directly", "room_has_a_door"],
                )
            }
            // A bare wall cell carries no area, so both of `wall`'s own
            // "container cell outside any area" Requirement rows fire
            // too (`building_has_an_entrance`, `walled_room_has_waste_
            // bin`), alongside its own missing `wall_run` neighbour
            // (`wall_is_part_of_a_straight_run_or_a_corner`) -- all
            // named alongside the pair this mutation is actually about.
            RoomMutation::RoadTouchesWall => {
                let street = Cell::new(dx, dy, 0);
                let facade = direction.step(street);
                let site = SiteBuilder::new()
                    .cell(street, &[road])
                    .cell(facade, &[wall])
                    .build();
                (
                    site,
                    vec![
                        "road_never_touches_wall",
                        "building_has_an_entrance",
                        "wall_is_part_of_a_straight_run_or_a_corner",
                        "walled_room_has_waste_bin",
                    ],
                )
            }
            RoomMutation::RoadTouchesGround => {
                let street = Cell::new(dx, dy, 0);
                let grass = direction.step(street);
                let site = SiteBuilder::new()
                    .cell(street, &[road])
                    .cell(grass, &[ground])
                    .build();
                (site, vec!["road_never_touches_ground"])
            }
        };

        let violations = support::eval(&grammar, &mutated_site);
        let mut actual_keys: Vec<&str> = violations
            .iter()
            .map(|v| grammar.iter().find(|r| r.id == v.rule_id).unwrap().key)
            .collect();
        actual_keys.sort_unstable();
        actual_keys.dedup();
        let mut expected: Vec<&str> = expected_keys;
        expected.sort_unstable();
        expected.dedup();
        prop_assert_eq!(actual_keys, expected);
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

// Story 3.2: land use and the street network (FR110). A case is a full
// 512x512 generation (both passes); `inv_generation_exact_tiling`, the
// priciest of these, rasterises the whole site into a dense per-cell
// grid on top of that. Quentin's direction, cycle 1: the original
// measurement here ("~90us/case") was wrong by two orders of magnitude,
// and the case-count pin that followed from it (64) was consequently far
// too low to find a real, rare defect -- corrected measurement (release,
// `cargo test --release`, this whole block, 4,096 cases across all eight
// properties): ~1.2ms/case, ~5s total. Under the unoptimised `test`
// profile `coverage` builds at its own job-level `PROPTEST_CASES=256`:
// ~5ms/case, ~1.3s total. Both are well inside their own job's budget at
// the *workflow's* own `PROPTEST_CASES` (4,096 for `test`, 256 for
// `coverage`), so this block inherits the ambient value like every other
// proptest in this file, rather than pinning its own -- the story-2.4
// coverage-timeout lesson does not apply here at this measured cost.
proptest! {

    /// `inv_generation_total_never_panics`.
    #[test]
    fn inv_generation_total_never_panics(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        // Reaching here without panicking is most of the property; a
        // handful of cheap structural reads on top prove the outputs are
        // not garbage.
        prop_assert!(lu.cols() > 0 && lu.rows() > 0);
        prop_assert!(!net.blocks().is_empty());
    }

    /// `inv_generation_all_four_land_uses_present`.
    #[test]
    fn inv_generation_all_four_land_uses_present(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        for cy in 0..lu.rows() {
            for cx in 0..lu.cols() {
                prop_assert!(lu.coarse_at(cx, cy).is_some());
            }
        }
        let present = land_use::uses_present(&lu);
        for u in land_use::LandUse::ALL {
            prop_assert!(present.contains(&u));
        }
    }

    /// `inv_generation_streets_connected_and_not_stranded`.
    #[test]
    fn inv_generation_streets_connected_and_not_stranded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let reachable = net.reachable_from_first_node().unwrap();
        prop_assert_eq!(reachable.len(), net.nodes().len());
        prop_assert!(net.stranded_regions(&lu).is_empty());
    }

    /// `inv_generation_no_dead_ends_away_from_boundary`.
    #[test]
    fn inv_generation_no_dead_ends_away_from_boundary(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        prop_assert!(net.dead_end_nodes().is_empty());
    }

    /// `inv_generation_detour_ratio_bounded` (Quentin's direction, cycle
    /// 2: two separate bounds, not one flat ratio -- an additive ceiling
    /// on every sampled pair's own overshoot, in world cells, since a
    /// ratio is dominated by a single jitter-driven jog at short range;
    /// a ratio ceiling only over pairs at least `detour_long_pair_cells`
    /// apart, where a ratio is what the estimator actually relies on).
    #[test]
    fn inv_generation_detour_ratio_bounded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let samples = net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES);
        for s in &samples {
            prop_assert!(
                s.excess_cells() <= cfg.max_detour_excess_cells as i64,
                "seed {seed}: {:?}-{:?} excess {} cells over {}", s.a, s.b, s.excess_cells(), cfg.max_detour_excess_cells
            );
            if s.manhattan >= cfg.detour_long_pair_cells as i64 {
                prop_assert!(
                    s.ratio_pct() <= cfg.max_detour_percent as i64,
                    "seed {seed}: {:?}-{:?} ratio {}% over {}%", s.a, s.b, s.ratio_pct(), cfg.max_detour_percent
                );
            }
        }
    }

    /// `inv_generation_p99_detour_ratio_bounded` (Tim's direction, cycle
    /// 2): `max_detour_percent` alone only bounds one city's own single
    /// worst pair, which stays green even if the *typical* case
    /// regressed -- the 99th percentile of this same sample is pinned
    /// separately.
    #[test]
    fn inv_generation_p99_detour_ratio_bounded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let samples = net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES);
        let p99 = streets::p99_ratio_pct(&samples);
        prop_assert!(
            p99 <= cfg.p99_detour_percent as i64,
            "seed {seed}: p99 detour ratio {p99}% over {}%", cfg.p99_detour_percent
        );
    }

    /// `inv_generation_no_staggered_junctions` (Tim's direction, cycle
    /// 2): a ceiling on a defect is not a guard -- `resolve_junction_
    /// position` now refuses any split that cannot land clean against
    /// the registry, so by induction no split this pass ever creates a
    /// junction under `junction_min_separation_cells` of another on the
    /// same street. Asserted at zero, not a measured ceiling.
    #[test]
    fn inv_generation_no_staggered_junctions(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let close = net.close_same_street_junction_pairs(cfg.min_block_depth_cells);
        prop_assert!(close.is_empty(), "seed {seed}: staggered junctions {close:?}");
    }

    /// `inv_generation_min_block_depth_is_respected` (Quentin's
    /// direction, cycle 2: moved from a fixed 0..8 sweep).
    #[test]
    fn inv_generation_min_block_depth_is_respected(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        for b in net.blocks() {
            prop_assert!(b.bounds.width() >= cfg.min_block_depth_cells as i64, "seed {seed}: block {:?} narrower than min_block_depth_cells", b.bounds);
            prop_assert!(b.bounds.height() >= cfg.min_block_depth_cells as i64, "seed {seed}: block {:?} shorter than min_block_depth_cells", b.bounds);
        }
    }

    /// `inv_generation_arterials_are_contiguous` (Quentin's direction,
    /// cycle 2: moved from a fixed 0..12 sweep; Artie's direction, cycle
    /// 2: at most one arterial line per city may stop short in a T, the
    /// rest reach the far site edge). Every arterial line, whatever its
    /// own far end, starts at its own near site edge with no gap.
    #[test]
    fn inv_generation_arterials_are_contiguous(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let site = net.site();
        let arterials: Vec<&streets::StreetEdge> = net.edges().iter().filter(|e| e.class == streets::StreetClass::Arterial).collect();
        prop_assert!(!arterials.is_empty());

        let mut short_lines = 0;
        for axis in [streets::Axis::Vertical, streets::Axis::Horizontal] {
            let (near, far) = match axis {
                streets::Axis::Vertical => (site.y0, site.y1),
                streets::Axis::Horizontal => (site.x0, site.x1),
            };
            let coords: std::collections::BTreeSet<i32> = arterials.iter().filter(|a| a.axis == axis).map(|a| a.coord).collect();
            for coord in coords {
                let mut spans: Vec<(i32, i32)> = arterials.iter().filter(|a| a.axis == axis && a.coord == coord).map(|a| (a.from, a.to)).collect();
                spans.sort();
                prop_assert_eq!(spans.first().unwrap().0, near, "seed {}: arterial axis={:?} coord={} does not start at its own near site edge", seed, axis, coord);
                for w in spans.windows(2) {
                    prop_assert_eq!(w[0].1, w[1].0, "seed {}: arterial axis={:?} coord={} has a gap between {:?}", seed, axis, coord, w);
                }
                if spans.last().unwrap().1 != far {
                    short_lines += 1;
                }
            }
        }
        prop_assert!(short_lines <= 1, "seed {seed}: {short_lines} arterial lines stop short of the far site edge, expected at most one (the T-termination)");
    }

    /// `inv_generation_peripheral_blocks_are_not_degenerate` (Artie's
    /// direction, cycle 1). Measured over 15,000 arbitrary seeds at this
    /// generator's committed values: median ratio 1.76x, worst observed
    /// 0.72x -- the AC's own "visibly larger" claim is a real, typical
    /// effect (region-forced splits near the density peak, added cycle
    /// 2 to close a stranded-region defect, occasionally shrink the near
    /// side below the far side for a specific city, honestly not
    /// eliminable without reopening that defect), not a universal one,
    /// so this proptest only pins the floor a total inversion would
    /// cross, with real margin below the measured worst case. Artie's
    /// own harder, cycle-2 bar (2x) is judged on the committed evidence
    /// seeds specifically (`peripheral_blocks_are_at_least_twice_
    /// central_ones_on_the_evidence_seeds` in `server/sim/src/
    /// generation/streets.rs`), lifted onto the same `StreetNetwork::
    /// mean_area_split_by_peak_distance` so the two never drift apart
    /// (Quentin's direction, cycle 2).
    #[test]
    fn inv_generation_peripheral_blocks_are_not_degenerate(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let Some((near_mean, far_mean)) = net.mean_area_split_by_peak_distance(&lu) else {
            return Ok(());
        };
        prop_assert!(
            far_mean * 2 >= near_mean,
            "seed {seed}: peripheral mean block area {far_mean} is far below central {near_mean}, a real inversion not the occasional close call"
        );
    }

    /// `inv_generation_not_a_perfect_grid` (Quentin's direction, cycle 1:
    /// moved from a fixed seed sweep -- block width/height variety, both
    /// junction kinds present, and at least two street classes present,
    /// over arbitrary seeds rather than one lucky one; cycle 2: lifted
    /// onto `StreetNetwork`'s own shared metric methods, same reason as
    /// the periphery test above).
    #[test]
    fn inv_generation_not_a_perfect_grid(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);

        let (widths, heights) = net.distinct_block_sizes();
        prop_assert!(widths as i64 >= cfg.min_distinct_block_sizes, "seed {seed}: only {widths} distinct widths");
        prop_assert!(heights as i64 >= cfg.min_distinct_block_sizes, "seed {seed}: only {heights} distinct heights");

        let (three, four) = net.junction_mix();
        prop_assert!(three > 0, "seed {seed}: no 3-way junctions");
        prop_assert!(four > 0, "seed {seed}: no 4-way junctions");

        let classes = net.street_classes_present();
        prop_assert!(classes.len() >= 2, "seed {seed}: only one street class present: {classes:?}");
    }

    /// `inv_generation_exact_tiling` (Tim's direction, cycle 1): every
    /// site cell is covered by exactly one block or by at least one
    /// street, and no two blocks overlap.
    #[test]
    fn inv_generation_exact_tiling(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let side = cfg.site_extent_cells as usize;
        let mut grid = vec![0u8; side * side];
        let idx = |x: i32, y: i32| (y as usize) * side + (x as usize);
        for b in net.blocks() {
            for y in b.bounds.y0..b.bounds.y1 {
                for x in b.bounds.x0..b.bounds.x1 {
                    let i = idx(x, y);
                    prop_assert_eq!(grid[i], 0, "seed {}: block/block overlap at ({},{})", seed, x, y);
                    grid[i] = 1;
                }
            }
        }
        for e in net.edges() {
            let r = e.rect();
            let (x0, y0) = (r.x0.max(0), r.y0.max(0));
            let (x1, y1) = (r.x1.min(cfg.site_extent_cells), r.y1.min(cfg.site_extent_cells));
            for y in y0..y1 {
                for x in x0..x1 {
                    let i = idx(x, y);
                    prop_assert_ne!(grid[i], 1, "seed {}: street overlaps a block at ({},{})", seed, x, y);
                    grid[i] = 2;
                }
            }
        }
        prop_assert!(grid.iter().all(|&v| v != 0), "seed {seed}: at least one cell has no ground at all");
    }

    /// `inv_generation_institutional_pockets_are_small` (Artie's
    /// direction, cycle 2: several small pockets, never one slab --
    /// "a school, a clinic and a town hall do not share a campus").
    /// Checked as an area bound rather than a leaf count directly: two
    /// institutional leaves adjacent to each other would already have
    /// merged into one region by `labeled_regions`' own flood fill (the
    /// same reason `assign_institutional`'s own non-adjacency check is
    /// enough to guarantee separate pockets never touch), so a region
    /// area over two max-sized leaves is exactly the "one big slab"
    /// regression this test exists to catch.
    #[test]
    fn inv_generation_institutional_pockets_are_small(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let max_pocket_cells = 2 * (cfg.land_use_max_leaf_cells as i64).pow(2);
        for r in lu.regions() {
            if r.use_ != land_use::LandUse::Institutional {
                continue;
            }
            prop_assert!(
                r.cell_count as i64 <= max_pocket_cells,
                "seed {seed}: institutional region {:?} is {} cells, over the two-max-leaf pocket bound {max_pocket_cells}", r.bounds, r.cell_count
            );
        }
    }

    /// `inv_generation_industrial_never_touches_commercial` (Artie's
    /// direction, cycle 1).
    #[test]
    fn inv_generation_industrial_never_touches_commercial(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let (regions, labels) = lu.labeled_regions();
        for (label, r) in regions.iter().enumerate() {
            if r.use_ != land_use::LandUse::Industrial {
                continue;
            }
            for cy in r.bounds.y0..r.bounds.y1 {
                for cx in r.bounds.x0..r.bounds.x1 {
                    if labels[(cy * lu.cols() + cx) as usize] != label as i32 {
                        continue;
                    }
                    for (nx, ny) in [(cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)] {
                        if let Some(cell) = lu.coarse_at(nx, ny) {
                            prop_assert_ne!(cell.use_, land_use::LandUse::Commercial, "seed {}: industrial touches commercial at ({},{})", seed, nx, ny);
                        }
                    }
                }
            }
        }
    }

    /// `inv_generation_residential_is_the_largest_land_use_by_area`
    /// (Quentin's direction, cycle 1): the balance keys are named
    /// "shares", and `target_counts` only ever claims a *district count*
    /// share -- with commercial and industrial each grown into a
    /// contiguous block and institutional deliberately taking the
    /// smallest leaves, an unweighted count share does not by itself
    /// guarantee an area share. What is asserted here, over arbitrary
    /// seeds, is the one thing the direction settled as the real
    /// minimum: residential reads as the city's own majority land use.
    #[test]
    fn inv_generation_residential_is_the_largest_land_use_by_area(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let mut counts = [0i64; 4];
        for cy in 0..lu.rows() {
            for cx in 0..lu.cols() {
                let idx = match lu.coarse_at(cx, cy).unwrap().use_ {
                    land_use::LandUse::Residential => 0,
                    land_use::LandUse::Commercial => 1,
                    land_use::LandUse::Industrial => 2,
                    land_use::LandUse::Institutional => 3,
                };
                counts[idx] += 1;
            }
        }
        let max_other = counts[1].max(counts[2]).max(counts[3]);
        prop_assert!(
            counts[0] > max_other,
            "seed {seed}: residential {} cells is not the largest use, counts={:?}", counts[0], counts
        );
    }
}

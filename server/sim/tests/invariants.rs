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
use sim::generation::{GenerationConfig, GenerationContent, envelopes, land_use, plots, streets};
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
pub const INV_GENERATION_INSTITUTIONAL_POCKETS_ARE_SMALL: &str = "at least institutional_min_pockets mutually non-adjacent (edge or corner) institutional components per site, none over institutional_max_pocket_share_percent of the site's own coarse-cell count, for any seed (FR110, Artie's direction)";
pub const INV_GENERATION_INDUSTRIAL_NEVER_TOUCHES_COMMERCIAL: &str =
    "no industrial coarse cell is ever adjacent to a commercial one, for any seed (FR110)";
pub const INV_GENERATION_RESIDENTIAL_IS_THE_LARGEST_LAND_USE_BY_AREA: &str = "residential has more coarse cells than any other single land use, for any seed -- field-driven assignment (commercial at the peak, industrial one contiguous group, institutional the smallest leaves) structurally favours it over a blind weighted draw, but that only holds if something keeps checking it (FR110, Quentin's direction)";
pub const INV_GENERATION_P99_DETOUR_RATIO_BOUNDED: &str = "the 99th-percentile BFS-network-vs-Manhattan detour ratio, over one city's own sampled pairs, never exceeds p99_detour_percent, for any seed (FR110, Tim's direction)";
pub const INV_GENERATION_NO_STAGGERED_JUNCTIONS: &str = "no two junctions on the same street sit under junction_min_separation_cells apart unless they coincide, for any seed -- asserted at zero, a refused split rather than a measured ceiling (FR110, Tim's direction)";
pub const INV_GENERATION_MIN_BLOCK_DEPTH_IS_RESPECTED: &str =
    "every block is at least min_block_depth_cells on both axes, for any seed (FR110)";
pub const INV_GENERATION_ARTERIALS_ARE_CONTIGUOUS: &str = "every arterial line starts at its own near site edge with no gap, and at most one arterial line per city stops short of the far site edge (the T-termination), for any seed (FR110, Artie's direction)";
pub const INV_GENERATION_PERIPHERAL_BLOCKS_ARE_NOT_DEGENERATE: &str = "mean block area in the bottom third of the density range is at least 0.7x the top third's, for any seed (NFR8, Tim's/Artie's direction)";
pub const INV_GENERATION_EVERY_PLOT_FRONTS_A_STREET: &str = "every non-open plot shares at least frontage_min_cells of edge length with a street-abutting side of its own block, for any seed (story 3.3 AC1, FR110)";
pub const INV_GENERATION_PLOTS_TILE_THEIR_BLOCK: &str = "every plot is inside its own block, no two plots overlap, and a block's own area minus its plots' summed area (the explicit remainder) is never negative, for any seed (story 3.3 AC1, FR110)";
pub const INV_GENERATION_ENVELOPE_SIZE_WITHIN_ITS_CLASS_BAND: &str = "every placed envelope's footprint is within its own land use's [min, max] band on both axes (the minimum interior plus the wall ring; the shared outer ceiling), for any seed (story 3.3 AC2/AC3, FR110, FR115)";
pub const INV_GENERATION_ENVELOPE_INSIDE_ITS_OWN_PLOT: &str = "every placed envelope's footprint is inside its own plot's bounds, and its own front matches that plot's front, for any seed (story 3.3 AC2, FR110)";
pub const INV_GENERATION_ENVELOPE_SIZES_ARE_VARIED: &str = "a district shows at least min_distinct_sizes distinct (along_face, depth) envelope footprint pairs, for any seed -- a city of identical boxes must not satisfy the mean band alone (story 3.3 AC3, NFR8)";
pub const INV_GENERATION_BUILDING_COUNT_WITHIN_TOLERANCE: &str = "at the committed config, generation succeeds (generate returns Ok -- District::check_building_count clears the per-seed band) for any seed (story 3.3 AC4, FR110)";
pub const INV_GENERATION_ENVELOPE_REJECTION_RATE_BOUNDED: &str = "the percent of attempted (non-open) plots rejected by the envelope pass never exceeds max_rejected_plot_percent, for any seed (story 3.3 AC4)";
pub const INV_GENERATION_ALL_FOUR_PASSES_NEVER_PANIC: &str = "inv_generation_total_never_panics extended to all four implemented passes: for any seed, generation reaches a plan or a typed error, never a panic, and pass 3 always produces at least one plot (story 3.3, FR110)";
pub const INV_GENERATION_ENVELOPE_MEAN_SIZE_MATCHES_THE_COMMITTED_BAND: &str = "pooled over the fixed seed range 0..256, the mean placed-envelope footprint width and depth each sit within their own committed +- tolerance band (story 3.3 AC3)";
pub const INV_GENERATION_OPEN_PLOT_PERCENT_BOUNDED: &str = "the percent of a district's plots that are open never exceeds max_open_percent_by_count, and their share of plotted area never exceeds max_open_percent_by_area, for any seed (story 3.3 AC1)";
pub const INV_GENERATION_UNPLOTTED_PERCENT_BOUNDED: &str = "the percent of every block's summed area that belongs to no plot at all never exceeds max_unplotted_percent, for any seed (story 3.3 AC1)";
pub const INV_GENERATION_BLOCK_SIDES_MATCHES_A_REAL_STREET_EDGE: &str = "for every block and side, block_sides equals whether some StreetEdge::rect() touches that side, for any seed (story 3.3 AC1, FR110)";
pub const INV_GENERATION_BLOCK_PLOTS_INDEPENDENT_OF_OTHER_BLOCKS: &str = "a block cut standalone yields the same plots as the same block cut inside the full city -- each block seeds its own stream from its own bounds, never its position in pass 2's list, for any seed (story 3.3, NFR25)";
pub const INV_GENERATION_ENVELOPE_INDEPENDENT_OF_OTHER_PLOTS: &str = "an envelope placed from its own plot alone equals the one placed inside the full run -- each plot seeds its own stream from its own bounds, never its position in the plot list, for any seed (story 3.3, NFR25)";
pub const INV_GENERATION_ENVELOPE_GAPS_ARE_ZERO_OR_AT_LEAST_TWO: &str = "between any two envelopes of the same block, whichever face each belongs to, the gap on either axis is never exactly 1 cell, for any seed (story 3.3 AC2)";
pub const INV_GENERATION_ENVELOPE_MEAN_SIZE_WITHIN_A_WEAK_PER_CITY_BAND: &str = "every single city's own mean placed-envelope footprint width and depth sit within a band MEAN_SIZE_WEAK_TOLERANCE_MULTIPLIER times the committed pooled tolerance, for any seed (story 3.3 AC3)";
pub const INV_GENERATION_OPEN_PLOTS_ARE_NEVER_SLIVERS: &str = "every open plot's short side clears open_min_side_cells, unless it is a whole block under one module on some axis (pass 2's own sliver), for any seed (story 3.3 AC1)";
pub const INV_GENERATION_NO_OPEN_PLOT_ON_A_BUILT_FACE_AT_HIGH_DENSITY: &str = "in a block at or above high_density_threshold, no open plot touches a street-abutting side that also holds a building, for any seed (story 3.3 AC1)";
pub const INV_GENERATION_PLOT_STATE_IS_CONSISTENT: &str = "a non-open plot always has a front -- the one illegal (open, front) combination never occurs, for any seed (story 3.3 AC1)";
pub const INV_GENERATION_BUILDING_COUNT_MEAN_MATCHES_THE_SCALE_BASELINE: &str = "pooled over the fixed seed range 0..256, the mean placed-building count sits within mean_count_tolerance_percent of the Scale Baseline target scaled to the site (story 3.3 AC4, NFR14)";
pub const INV_GENERATION_EVERY_ENVELOPE_HAS_EXACTLY_ONE_TYPE: &str = "pass 5 always produces exactly one type assignment per placed envelope, and every assigned id resolves in the committed content, for any seed (story 3.4 AC1, FR110)";
pub const INV_GENERATION_EVERY_PLACED_TYPE_MATCHES_ITS_OWN_LAND_USE_AND_DENSITY_BAND: &str = "every placed envelope's own assigned building type carries the plot's own land use, and the plot's density falls inside that type's own [density_min, density_max] band, for any seed (story 3.4 AC1, FR116)";
pub const INV_GENERATION_COMMITTED_RULES_HOLD_FOR_ANY_SEED: &str = "sim::rules::evaluate over the whole finished district's own DistrictSite, against the committed rule table, finds no violation, for any seed (story 3.4 AC1/AC2, FR112)";
pub const INV_GENERATION_REQUIRED_INSTITUTIONS_ARE_PRESENT_WHEN_THEIR_OWN_TARGET_IS_NONZERO: &str = "for every committed distribution row, whenever its own basis/ratio target is at least 1, the district places at least one subject, for any seed (story 3.4 AC2)";
pub const INV_GENERATION_WORKPLACE_COUNT_WITHIN_TOLERANCE: &str = "at the committed config, generation succeeds (generate returns Ok -- District::check_workplace_count clears the per-seed band) for any seed (story 3.4 AC4)";
pub const INV_GENERATION_WORKPLACE_COUNT_MEAN_MATCHES_THE_SCALE_BASELINE: &str = "pooled over the fixed seed range 0..256, the mean workplace count sits within workplace_mean_count_tolerance_percent of the Scale Baseline target scaled to the site (story 3.4 AC4, NFR14)";
pub const INV_GENERATION_PROFESSION_DEPTH_MATCHES_THE_SCALE_BASELINE: &str = "pooled over the fixed seed range 0..256, the mean count of professions held by at least min_employers_per_profession distinct placed workplaces sits within the committed tolerance of target_profession_count (story 3.4, GDD Scale Baseline)";
pub const INV_GENERATION_BUILDING_TYPE_INDEPENDENT_OF_ENVELOPE_ORDER: &str = "shuffling pass 4's own placed-envelope order and re-running pass 5 over the shuffled list never changes any envelope's own assigned type, for any seed (story 3.4, NFR25)";
pub const INV_GENERATION_NO_QUADRANT_LACKS_ITS_REQUIRED_SERVICES: &str = "pooled over the fixed seed range 0..256, for every distribution row a building type actually feeds, the pooled subjects placed across every site quadrant holding eligible land for its subject clears the pooled per-quadrant ratio/tolerance lower bound the site-wide Distribution check computes (story 3.4 AC3)";

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
//
// Story 3.3 (plot subdivision, the building envelope) extended this same
// block rather than opening a second one -- a case is now a full four-
// pass generation. Re-measured whole-block, all 24 `inv_generation_*`
// properties together: release/4,096 cases ~16s total (~0.16ms/case);
// unoptimised/256 cases (the `coverage` job's own level) ~5s total
// (~0.8ms/case). Both still comfortably inside their own job's budget,
// so no per-property case-count pin is needed here either.
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
        let samples = net.detour_samples(streets::DETOUR_P99_SAMPLE_MAX_NODES);
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
    /// direction, cycle 1; cycle 3: switched from a median-distance
    /// split to `StreetNetwork::mean_area_by_density_band`, density
    /// bands rather than a proxy for density -- Tim's direction, cycle
    /// 3). Measured over 5,000 arbitrary seeds at this generator's
    /// committed values: 4,997 have the periphery (low-density) mean
    /// strictly larger than the core (high-density) mean; the 3
    /// exceptions land within single-digit percent of parity (worst
    /// ratio 0.72x), real split-jitter noise rather than an inversion --
    /// `peripheral_low_band_floor_percent` is the margin that keeps all
    /// 5,000 green. This per-city floor alone cannot tell a healthy city
    /// from a density-blind one, though: a uniform grid pools to parity
    /// (1.0x), comfortably above 0.7x
    /// (`mean_area_by_density_band_reports_parity_for_a_uniform_grid` in
    /// `server/sim/src/generation/streets.rs` shows exactly this).
    /// `peripheral_blocks_pooled_ratio_exceeds_a_density_blind_floor`,
    /// below, is the guard that actually fails on that defect (Quentin's
    /// direction, cycle 4). Artie's own harder, cycle-2 bar (2x) is
    /// judged on the committed evidence seeds specifically
    /// (`peripheral_blocks_are_at_least_1_6x_central_ones_on_the_
    /// evidence_seeds` in `server/sim/src/generation/streets.rs`), kept
    /// on `mean_area_split_by_peak_distance` (Tim's direction, cycle 3:
    /// "keep it as is" -- the evidence-seed test is Artie's own bar, not
    /// this proptest's).
    #[test]
    fn inv_generation_peripheral_blocks_are_not_degenerate(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        // Density bands (bottom third vs top third of density_min..
        // density_max), not distance from the peak -- what `target_
        // block_size` actually reads (Tim's direction, cycle 3).
        let Some((low_mean, high_mean)) = net.mean_area_by_density_band(&lu, &cfg) else {
            return Ok(());
        };
        prop_assert!(
            low_mean * 100 >= high_mean * cfg.peripheral_low_band_floor_percent as i64,
            "seed {seed}: periphery (low-density) mean block area {low_mean} is well below core (high-density) {high_mean}"
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
    /// direction, cycle 3, replacing the weaker cycle-2 bound of the
    /// same name after three review cycles measured it was not enough):
    /// at least `institutional_min_pockets` mutually non-adjacent (edge
    /// or corner) institutional components per site, none over
    /// `institutional_max_pocket_share_percent` of the site's own
    /// coarse-cell count. The pocket-count half is a hard, zero-
    /// tolerance floor (`assign_institutional`'s own fallback pass
    /// guarantees it whenever any eligible leaf remains, verified at
    /// 15,000 arbitrary seeds); the area half carries a wider margin
    /// (6%, not the ~2.5% a single leaf cap alone would suggest) because
    /// that same fallback -- relaxing the small-leaf cap only when the
    /// strict pass alone could not reach the pocket-count floor --
    /// occasionally has to take a larger leaf than the strict cap would
    /// allow (measured worst case 2.34% over the same 15,000 seeds, well
    /// under the 6% ceiling's own margin). The pocket-count floor is the
    /// harder, more frequently re-raised requirement of the two; when
    /// they are ever in tension, the AC's own floor wins.
    #[test]
    fn inv_generation_institutional_pockets_are_small(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let total_coarse_cells = (lu.cols() as i64) * (lu.rows() as i64);
        let (regions, labels) = lu.labeled_regions();
        let inst_count = regions.iter().filter(|r| r.use_ == land_use::LandUse::Institutional).count();

        prop_assert!(
            inst_count as i64 >= cfg.institutional_min_pockets,
            "seed {seed}: only {inst_count} institutional components, expected at least {}", cfg.institutional_min_pockets
        );
        for r in regions.iter().filter(|r| r.use_ == land_use::LandUse::Institutional) {
            prop_assert!(
                r.cell_count as i64 * 100 <= total_coarse_cells * cfg.institutional_max_pocket_share_percent,
                "seed {seed}: institutional component {:?} is {} of {} coarse cells (over {}%)", r.bounds, r.cell_count, total_coarse_cells, cfg.institutional_max_pocket_share_percent
            );
        }
        // Real per-cell diagonal adjacency, not a bounding-box
        // approximation: two institutional leaves forming an L-shaped
        // pocket can have a bounding box that overlaps a neighbour's
        // without either pocket's own real cells ever touching it.
        for cy in 0..lu.rows() {
            for cx in 0..lu.cols() {
                let label = labels[(cy * lu.cols() + cx) as usize];
                if regions[label as usize].use_ != land_use::LandUse::Institutional {
                    continue;
                }
                for (nx, ny) in [
                    (cx - 1, cy - 1), (cx, cy - 1), (cx + 1, cy - 1),
                    (cx - 1, cy), (cx + 1, cy),
                    (cx - 1, cy + 1), (cx, cy + 1), (cx + 1, cy + 1),
                ] {
                    if nx < 0 || ny < 0 || nx >= lu.cols() || ny >= lu.rows() {
                        continue;
                    }
                    let other_label = labels[(ny * lu.cols() + nx) as usize];
                    if other_label != label && regions[other_label as usize].use_ == land_use::LandUse::Institutional {
                        prop_assert!(
                            false,
                            "seed {seed}: institutional cells ({cx},{cy}) and ({nx},{ny}) from different components touch"
                        );
                    }
                }
            }
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

// Story 3.3: plot subdivision and the building envelope (FR110, FR115).
// A case is a full 512x512 generation of all four passes.

/// The per-city mean-size band's own weak multiplier over the tight
/// pooled tolerance (`inv_generation_envelope_mean_size_matches_the_
/// committed_band` below): one city's own sample is noisier than the
/// pooled 256-seed one, so this property only ever catches a gross
/// regression (the mean collapsing toward the class minimum), never
/// tunes the mean itself -- an algorithm shape, not tunable content.
const MEAN_SIZE_WEAK_TOLERANCE_MULTIPLIER: i32 = 4;

proptest! {
    /// `inv_generation_every_plot_fronts_a_street`.
    #[test]
    fn inv_generation_every_plot_fronts_a_street(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let (net, pm) = (&d.streets, &d.plots);
        prop_assert!(!pm.plots().is_empty());
        let offenders = pm.landlocked_plots(net.blocks(), cfg.plot_frontage_min_cells);
        prop_assert!(offenders.is_empty(), "seed {seed}: landlocked plots {offenders:?}");
    }

    /// `inv_generation_plots_tile_their_block`.
    #[test]
    fn inv_generation_plots_tile_their_block(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let (net, pm) = (&d.streets, &d.plots);

        for p in pm.plots() {
            let b = net.blocks()[p.block as usize];
            prop_assert!(
                b.bounds.x0 <= p.bounds.x0 && p.bounds.x1 <= b.bounds.x1
                    && b.bounds.y0 <= p.bounds.y0 && p.bounds.y1 <= b.bounds.y1,
                "seed {seed}: plot {:?} escapes block {:?}", p.bounds, b.bounds
            );
        }
        // No two plots of the same block overlap -- grouped per block so
        // this stays linear in plot count overall rather than O(plots^2)
        // over the whole district.
        let mut by_block: std::collections::BTreeMap<u32, Vec<Rect>> = std::collections::BTreeMap::new();
        for p in pm.plots() {
            by_block.entry(p.block).or_default().push(p.bounds);
        }
        for (block_index, mut rects) in by_block {
            rects.sort_by_key(|r| (r.x0, r.y0));
            for i in 0..rects.len() {
                for j in (i + 1)..rects.len() {
                    let (a, b) = (rects[i], rects[j]);
                    let overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
                    prop_assert!(!overlap, "seed {seed}: plots {a:?} and {b:?} overlap in block {block_index}");
                }
            }
            let remainder = pm.remainder_cells(block_index, net.blocks()).unwrap();
            prop_assert!(remainder >= 0, "seed {seed}: block {block_index} has a negative remainder {remainder}");
        }
    }

    /// `inv_generation_open_plot_percent_bounded`: `open` is an escape
    /// hatch, not a free pass -- a generator that marks every awkward
    /// plot `open` must not still clear AC1's other properties.
    #[test]
    fn inv_generation_open_plot_percent_bounded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let pm = &d.plots;
        prop_assert!(
            pm.open_count_percent() <= cfg.plot_max_open_percent_by_count,
            "seed {seed}: {}% of plots are open, over max_open_percent_by_count {}",
            pm.open_count_percent(), cfg.plot_max_open_percent_by_count
        );
        prop_assert!(
            pm.open_area_percent() <= cfg.plot_max_open_percent_by_area,
            "seed {seed}: {}% of plot area is open, over max_open_percent_by_area {}",
            pm.open_area_percent(), cfg.plot_max_open_percent_by_area
        );
    }

    /// `inv_generation_unplotted_percent_bounded`: a deep block's own
    /// small, silent leftover must never grow into a district-wide void
    /// nothing checks.
    #[test]
    fn inv_generation_unplotted_percent_bounded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let (net, pm) = (&d.streets, &d.plots);
        prop_assert!(
            pm.unplotted_percent(net.blocks()) <= cfg.plot_max_unplotted_percent,
            "seed {seed}: {}% of block area is unplotted, over max_unplotted_percent {}",
            pm.unplotted_percent(net.blocks()), cfg.plot_max_unplotted_percent
        );
    }

    /// `inv_generation_block_sides_matches_a_real_street_edge`: `block_
    /// sides`'s own "not on the site boundary" argument, guarded rather
    /// than only argued -- for every block and side, it agrees with a
    /// real per-edge scan of `StreetNetwork::edges`.
    #[test]
    fn inv_generation_block_sides_matches_a_real_street_edge(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        for b in net.blocks() {
            let sides = sim::generation::block_sides(b.bounds, net.site());
            for side in sim::generation::Side::ALL {
                let touches = net.edges().iter().any(|e| block_edge_touches_street(b.bounds, e.rect(), side));
                prop_assert_eq!(
                    sides.get(side), touches,
                    "seed {}: block {:?} side {:?}: block_sides says {}, real scan says {}",
                    seed, b.bounds, side, sides.get(side), touches
                );
            }
        }
    }

    /// `inv_generation_block_plots_independent_of_other_blocks`: cutting
    /// one block standalone gives byte-identical plots to that same
    /// block cut inside the full city -- each block seeds its own stream
    /// from its own bounds, never its position in `streets.blocks()`, so
    /// adding a block to Epic 14's own grown city never reshuffles an
    /// existing one's own plots.
    #[test]
    fn inv_generation_block_plots_independent_of_other_blocks(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        prop_assume!(!net.blocks().is_empty());
        let block = net.blocks()[net.blocks().len() / 2];

        let full_pm = plots::run(seed, &lu, &net, &cfg); // generation-entry-point: allow
        let mut in_full: Vec<plots::Plot> = full_pm
            .plots()
            .iter()
            .filter(|p| net.blocks()[p.block as usize].bounds == block.bounds)
            .copied()
            .collect();

        let standalone_net = streets::StreetNetwork::test_fixture(net.site(), Vec::new(), vec![block]);
        let standalone_pm = plots::run(seed, &lu, &standalone_net, &cfg); // generation-entry-point: allow
        let mut standalone: Vec<plots::Plot> = standalone_pm.plots().to_vec();

        in_full.sort_by_key(|p| (p.bounds.y0, p.bounds.x0));
        standalone.sort_by_key(|p| (p.bounds.y0, p.bounds.x0));
        let normalise = |p: &plots::Plot| (p.bounds, p.front, p.land_use, p.density, p.open);
        let in_full_norm: Vec<_> = in_full.iter().map(normalise).collect();
        let standalone_norm: Vec<_> = standalone.iter().map(normalise).collect();
        prop_assert_eq!(in_full_norm, standalone_norm, "seed {}", seed);
    }

    /// `inv_generation_envelope_independent_of_other_plots`: an envelope
    /// placed from its own plot alone matches the one placed inside the
    /// full run -- each plot seeds its own stream from its own bounds,
    /// never its position in `plots.plots()`.
    #[test]
    fn inv_generation_envelope_independent_of_other_plots(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let pm = plots::run(seed, &lu, &net, &cfg); // generation-entry-point: allow
        let full = envelopes::run(seed, &pm, &cfg); // generation-entry-point: allow
        let pass_seed = seed_from_ids(seed, envelopes::PASS_ID);
        let row_bounds = envelopes::row_bounds_by_block_front(pm.plots());
        for (i, p) in pm.plots().iter().enumerate() {
            if p.open {
                continue;
            }
            let front = p.front.unwrap();
            let bounds = row_bounds[&(p.block, front)];
            let mut rng = Rng::new(seed_from_ids(pass_seed, sim::generation::rect_seed_key(p.bounds)));
            let alone = envelopes::place_one(p, i as u32, bounds, &mut rng, &cfg);
            let in_full = full.outcomes()[full.outcomes().iter().position(|o| match o {
                envelopes::EnvelopeOutcome::Placed(e) => e.plot == i as u32,
                envelopes::EnvelopeOutcome::Rejected { plot, .. } => *plot == i as u32,
            }).unwrap()];
            prop_assert_eq!(alone, in_full, "seed {}: plot index {}", seed, i);
        }
    }

    /// `inv_generation_envelope_size_within_its_class_band`: both bounds,
    /// both axes -- the floor (already the class minimum by construction,
    /// via `plots::run`'s own row depths) and the ceiling
    /// (`envelope_limits`'s own `max_*`), checked against the map
    /// [`sim::generation::plan`] always returns, independent of AC4's own
    /// count verdict (an outlier city is still worth inspecting).
    #[test]
    fn inv_generation_envelope_size_within_its_class_band(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let (pm, em) = (&d.plots, &d.envelopes);
        for e in em.envelopes() {
            let p = pm.plots()[e.plot as usize];
            let limits = cfg.envelope_limits(p.land_use);
            prop_assert!(e.along_face_cells() >= limits.min_width_cells as i64 && e.along_face_cells() <= limits.max_width_cells as i64, "seed {seed}: envelope {:?} width outside its own class band", e.footprint);
            prop_assert!(e.depth_cells() >= limits.min_depth_cells as i64 && e.depth_cells() <= limits.max_depth_cells as i64, "seed {seed}: envelope {:?} depth outside its own class band", e.footprint);
        }
    }

    /// `inv_generation_envelope_inside_its_own_plot`. Non-overlap between
    /// envelopes is not re-checked here: every envelope is contained in
    /// its own plot (this property), and plots are themselves mutually
    /// disjoint (`inv_generation_plots_tile_their_block`, and disjoint
    /// across blocks by `inv_generation_exact_tiling`'s own block-
    /// disjointness) -- envelopes are therefore disjoint by construction,
    /// never re-derived with an O(envelopes^2) scan
    /// (`envelope_footprints_from_two_different_plots_never_overlap`
    /// below pins this reasoning against a hand-built fixture).
    #[test]
    fn inv_generation_envelope_inside_its_own_plot(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let (pm, em) = (&d.plots, &d.envelopes);
        for e in em.envelopes() {
            let p = pm.plots()[e.plot as usize];
            prop_assert!(
                p.bounds.x0 <= e.footprint.x0 && e.footprint.x1 <= p.bounds.x1
                    && p.bounds.y0 <= e.footprint.y0 && e.footprint.y1 <= p.bounds.y1,
                "seed {seed}: envelope {:?} escapes plot {:?}", e.footprint, p.bounds
            );
            prop_assert_eq!(Some(e.front), p.front);
        }
    }

    /// `inv_generation_envelope_gaps_are_zero_or_at_least_two`: same-face
    /// neighbouring envelopes, and back-to-back rears, are either flush
    /// (party walls) or at least 2 cells apart -- never a 1-cell slit
    /// (Artie's own "must never be seen" row this story adds).
    #[test]
    fn inv_generation_envelope_gaps_are_zero_or_at_least_two(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let (pm, em) = (&d.plots, &d.envelopes);
        // Every pair of envelopes in one block, whichever face each
        // belongs to, on both axes: the rule is about what the player
        // sees -- a same-face neighbour, a back-to-back rear, a side-row
        // plot's own end against the row in front of it. Grouped by block
        // so this stays a per-block pairwise scan (blocks are small),
        // never an O(envelopes^2) scan over the whole district; two
        // blocks are always a street apart.
        let mut by_block: std::collections::BTreeMap<u32, Vec<Rect>> = std::collections::BTreeMap::new();
        for e in em.envelopes() {
            by_block.entry(pm.plots()[e.plot as usize].block).or_default().push(e.footprint);
        }
        for (block, envs) in by_block {
            for i in 0..envs.len() {
                for j in (i + 1)..envs.len() {
                    let (a, b) = (envs[i], envs[j]);
                    let x_overlap = a.x0.max(b.x0) < a.x1.min(b.x1);
                    let y_overlap = a.y0.max(b.y0) < a.y1.min(b.y1);
                    if x_overlap {
                        let gap = a.y0.max(b.y0) - a.y1.min(b.y1);
                        prop_assert!(gap != 1, "seed {seed}: block {block}: envelopes {a:?} and {b:?} are 1 cell apart on y");
                    }
                    if y_overlap {
                        let gap = a.x0.max(b.x0) - a.x1.min(b.x1);
                        prop_assert!(gap != 1, "seed {seed}: block {block}: envelopes {a:?} and {b:?} are 1 cell apart on x");
                    }
                }
            }
        }
    }

    /// `inv_generation_open_plots_are_never_slivers`: an open plot is a
    /// promise a later pass dresses it as a park, a yard or a car park --
    /// never a residue strip nobody can dress. Every open plot's short
    /// side clears `open_min_side_cells`, unless it is a whole block that
    /// no face could cut at all (a block under one module on both axes,
    /// pass 2's own sliver -- never a residue this pass hid inside a
    /// bigger block).
    #[test]
    fn inv_generation_open_plots_are_never_slivers(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        for p in d.plots.plots().iter().filter(|p| p.open) {
            let short = p.bounds.width().min(p.bounds.height());
            if short >= cfg.plot_open_min_side_cells as i64 {
                continue;
            }
            let block = d.streets.blocks()[p.block as usize].bounds;
            prop_assert!(p.bounds == block, "seed {seed}: open plot {:?} in block {block:?} has a short side of {short} and is not the whole block", p.bounds);
            let module = cfg.plot_width_min_cells[p.land_use as usize] as i64;
            prop_assert!(block.width() < module || block.height() < module, "seed {seed}: block {block:?} could have been cut yet is one whole open plot");
        }
    }

    /// `inv_generation_no_open_plot_on_a_built_face_at_high_density`: in a
    /// block at or above `high_density_threshold`, no open plot touches a
    /// street-abutting side of its own block that also holds a building
    /// -- never a hatched hole between two corner shops on a side street.
    #[test]
    fn inv_generation_no_open_plot_on_a_built_face_at_high_density(seed in any::<u64>()) {
        use sim::generation::Side;
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let touches = |p: Rect, block: Rect, side: Side| -> bool {
            match side {
                Side::North => p.y0 == block.y0,
                Side::South => p.y1 == block.y1,
                Side::West => p.x0 == block.x0,
                Side::East => p.x1 == block.x1,
            }
        };
        for (bi, b) in d.streets.blocks().iter().enumerate() {
            let sides = sim::generation::block_sides(b.bounds, d.plots.site());
            let in_block: Vec<_> = d.plots.plots().iter().filter(|p| p.block == bi as u32).collect();
            if in_block.iter().all(|p| p.density < cfg.plot_high_density_threshold) {
                continue;
            }
            for side in [Side::North, Side::South, Side::East, Side::West] {
                if !sides.get(side) {
                    continue;
                }
                let built = in_block.iter().any(|p| !p.open && touches(p.bounds, b.bounds, side));
                let open = in_block.iter().find(|p| p.open && touches(p.bounds, b.bounds, side));
                if let (true, Some(o)) = (built, open) {
                    prop_assert!(false, "seed {seed}: block {bi} side {side:?} holds a building and the open plot {:?}", o.bounds);
                }
            }
        }
    }

    /// `inv_generation_plot_state_is_consistent`: `Plot` carries its state
    /// twice (`open` and `front`), and exactly one of the four
    /// combinations is illegal -- a non-open plot with no front, which
    /// pass 4's own `expect` rests on never seeing.
    #[test]
    fn inv_generation_plot_state_is_consistent(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        for p in d.plots.plots() {
            prop_assert!(p.open || p.front.is_some(), "seed {seed}: non-open plot {:?} has no front", p.bounds);
        }
    }

    /// `inv_generation_envelope_sizes_are_varied` -- a city of identical
    /// boxes satisfies AC3's mean band too.
    #[test]
    fn inv_generation_envelope_sizes_are_varied(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let em = &d.envelopes;
        let sizes: std::collections::BTreeSet<(i64, i64)> = em.envelopes().map(|e| (e.along_face_cells(), e.depth_cells())).collect();
        prop_assert!(
            sizes.len() as i64 >= cfg.envelope_min_distinct_sizes,
            "seed {seed}: only {} distinct envelope sizes", sizes.len()
        );
    }

    /// `inv_generation_envelope_mean_size_within_a_weak_per_city_band`: a
    /// loose, per-arbitrary-seed companion to the tight pooled assertion
    /// below -- catches a gross regression (the mean collapsing toward
    /// the class minimum) on every seed, not just the fixed 0..256 range.
    #[test]
    fn inv_generation_envelope_mean_size_within_a_weak_per_city_band(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let em = &d.envelopes;
        let (mut sum_w, mut sum_d, mut n) = (0i64, 0i64, 0i64);
        for e in em.envelopes() {
            sum_w += e.along_face_cells();
            sum_d += e.depth_cells();
            n += 1;
        }
        prop_assume!(n > 0);
        let tol_w = (cfg.envelope_mean_width_tolerance_cells * MEAN_SIZE_WEAK_TOLERANCE_MULTIPLIER) as i64;
        let tol_d = (cfg.envelope_mean_depth_tolerance_cells * MEAN_SIZE_WEAK_TOLERANCE_MULTIPLIER) as i64;
        let (lo_w, hi_w) = (cfg.envelope_mean_width_cells as i64 - tol_w, cfg.envelope_mean_width_cells as i64 + tol_w);
        let (lo_d, hi_d) = (cfg.envelope_mean_depth_cells as i64 - tol_d, cfg.envelope_mean_depth_cells as i64 + tol_d);
        prop_assert!(sum_w >= lo_w * n && sum_w <= hi_w * n, "seed {seed}: per-city mean width {} outside weak band [{lo_w}, {hi_w}]", sum_w / n);
        prop_assert!(sum_d >= lo_d * n && sum_d <= hi_d * n, "seed {seed}: per-city mean depth {} outside weak band [{lo_d}, {hi_d}]", sum_d / n);
    }

    /// `inv_generation_building_count_within_tolerance`: a seed that trips
    /// AC4's own tolerance guard is a world that fails to create, so the
    /// acceptable failure rate over arbitrary seeds is engineered to be
    /// negligible (`count_tolerance_percent`'s own key comment states the
    /// sigma-based rule), not merely hoped for.
    #[test]
    fn inv_generation_building_count_within_tolerance(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let result = sim::generation::generate(seed, &cfg, &content);
        prop_assert!(result.is_ok(), "seed {seed}: {:?}", result.err());
    }

    /// `inv_generation_envelope_rejection_rate_bounded`.
    #[test]
    fn inv_generation_envelope_rejection_rate_bounded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let em = &d.envelopes;
        prop_assert!(
            em.rejected_percent() <= cfg.envelope_max_rejected_plot_percent,
            "seed {seed}: rejected {}%, over max_rejected_plot_percent {}", em.rejected_percent(), cfg.envelope_max_rejected_plot_percent
        );
    }

    /// `inv_generation_total_never_panics` extended to all four passes.
    #[test]
    fn inv_generation_all_four_passes_never_panic(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        // `generate` is the entry point under test here; the hand-chain
        // below is what must still yield plots when its count check errs.
        let _ = sim::generation::generate(seed, &cfg, &content);
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let pm = &d.plots;
        prop_assert!(!pm.plots().is_empty());
    }

    /// `inv_generation_every_envelope_has_exactly_one_type`: pass 5 always
    /// produces exactly one assignment per placed envelope, and every
    /// assigned id resolves in the committed content, for any seed
    /// (story 3.4 AC1, FR110).
    #[test]
    fn inv_generation_every_envelope_has_exactly_one_type(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        prop_assert_eq!(
            d.building_types.assignments().len(),
            d.envelopes.placed_count() as usize
        );
        for a in d.building_types.assignments() {
            prop_assert!(
                content.building_types.iter().any(|b| b.id == a.building_type),
                "seed {seed}: plot {} names unresolvable building type {}",
                a.plot, a.building_type
            );
        }
    }

    /// `inv_generation_every_placed_type_matches_its_own_land_use_and_density_band`
    /// (AC1, story 3.4): every placed envelope's own assigned building
    /// type carries the plot's own land use and its density falls inside
    /// the type's own `[density_min, density_max]` band -- the eligibility
    /// half of "coherent with its own neighbourhood", for any seed, never
    /// only the handful of fixed seeds `building_types.rs`'s own unit test
    /// covers.
    #[test]
    fn inv_generation_every_placed_type_matches_its_own_land_use_and_density_band(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        for a in d.building_types.assignments() {
            let plot = &d.plots.plots()[a.plot as usize];
            let def = by_id[&a.building_type];
            prop_assert!(
                def.land_uses[plot.land_use as usize],
                "seed {seed}: plot {} (use {:?}) got type {} which does not carry that land use",
                a.plot, plot.land_use, def.key
            );
            prop_assert!(
                plot.density >= def.density_min && plot.density <= def.density_max,
                "seed {seed}: plot {} density {} outside type {}'s own band [{}, {}]",
                a.plot, plot.density, def.key, def.density_min, def.density_max
            );
            let e = d.envelopes.envelopes().find(|e| e.plot == a.plot).unwrap();
            let interior_w = e.along_face_cells() - 2 * cfg.envelope_wall_thickness_cells as i64;
            let interior_d = e.depth_cells() - 2 * cfg.envelope_wall_thickness_cells as i64;
            prop_assert!(
                def.min_interior_width_cells as i64 <= interior_w
                    && def.min_interior_depth_cells as i64 <= interior_d,
                "seed {seed}: plot {} interior {interior_w}x{interior_d} is under type {}'s own minimum {}x{}",
                a.plot, def.key, def.min_interior_width_cells, def.min_interior_depth_cells
            );
        }
    }

    /// `inv_generation_committed_rules_hold_for_any_seed` (AC1/AC2, story
    /// 3.4, FR112): `sim::rules::evaluate` over the whole finished
    /// district's own `DistrictSite`, against the committed rule table,
    /// finds no violation, for any seed -- named explicitly (rather than
    /// only inferred from `generate` returning `Ok`, `inv_generation_
    /// building_count_within_tolerance`'s own job) so a coherence or
    /// distribution regression reads by its own name.
    #[test]
    fn inv_generation_committed_rules_hold_for_any_seed(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let result = d.check_rules(&content);
        prop_assert!(result.is_ok(), "seed {seed}: {:?}", result.err());
    }

    /// `inv_generation_required_institutions_are_present_when_their_own_target_is_nonzero`
    /// (AC2, story 3.4): for every distribution row this pass's own
    /// overrides can actually feed (its `per` tag is carried by at least
    /// one committed building type -- an earlier story's own street-
    /// furniture rule, say, is a different pass's own concern), read
    /// generically (never a literal building-type/tag key), the
    /// `basis / ratio` target is at least 1 for any seed (the balance
    /// comment only claims this over the fixed 0..256 range this test's
    /// own sibling pools over; here it is asserted for real, any seed),
    /// and the district actually places at least one subject -- an
    /// institution that cannot be placed is a typed error `check_rules`
    /// reports, but this invariant names AC2's own "the district holds
    /// every required kind" claim by itself, for any seed. Also AC2's
    /// own "shops and cafes" half: at least one placed type carries the
    /// `shop` tag and at least one carries `cafe`, read off `defs::TAGS`
    /// by key (a test file, never scanned by `check-generator-no-
    /// content-keys.sh`), not a `[[distribution]]` row -- neither is
    /// distributed, both are ordinary weighted fill.
    #[test]
    fn inv_generation_required_institutions_are_present_when_their_own_target_is_nonzero(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let mut tag_counts: std::collections::BTreeMap<TagId, u64> = std::collections::BTreeMap::new();
        for a in d.building_types.assignments() {
            for &t in by_id[&a.building_type].tags {
                *tag_counts.entry(t).or_insert(0) += 1;
            }
        }
        let mut dist_rows: Vec<sim::rules::DistributionRow> = content
            .rules
            .iter()
            .filter_map(|r| r.as_distribution())
            // Only this pass's own rows -- a row whose `per` tag no
            // committed building type ever carries (an earlier story's
            // own street-furniture rule, say) belongs to a different
            // pass entirely and is out of scope for a building-type
            // basis/target claim.
            .filter(|row| content.building_types.iter().any(|b| b.tags.contains(&row.per)))
            .collect();
        dist_rows.sort_by_key(|d| d.id);
        for row in &dist_rows {
            let basis = tag_counts.get(&row.per).copied().unwrap_or(0);
            let target = basis / (row.ratio.max(1) as u64);
            prop_assert!(
                target >= 1,
                "seed {seed}: rule {} has a basis of {basis} over ratio {}, giving target {target} < 1",
                row.key, row.ratio
            );
            let actual = tag_counts.get(&row.subject).copied().unwrap_or(0);
            prop_assert!(
                actual > 0,
                "seed {seed}: rule {} has target {target} but placed 0",
                row.key
            );
        }

        for &wanted in &["shop", "cafe"] {
            let tag_id = defs::TAGS
                .iter()
                .find(|t| t.key == wanted)
                .map(|t| t.id)
                .unwrap_or_else(|| panic!("committed tags must carry a '{wanted}' entry"));
            prop_assert!(
                tag_counts.get(&tag_id).copied().unwrap_or(0) > 0,
                "seed {seed}: no placed building carries the '{wanted}' tag",
            );
        }
    }

    /// `inv_generation_workplace_count_within_tolerance` (AC4, story 3.4):
    /// the same shape as `inv_generation_building_count_within_tolerance`
    /// -- `generate`'s own `check_workplace_count` clears the per-seed
    /// band, for any seed.
    #[test]
    fn inv_generation_workplace_count_within_tolerance(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let result = sim::generation::generate(seed, &cfg, &content);
        prop_assert!(result.is_ok(), "seed {seed}: {:?}", result.err());
    }

    /// `inv_generation_building_type_independent_of_envelope_order` (NFR25,
    /// story 3.4): shuffling pass 4's own placed-envelope order and
    /// re-running pass 5 over the shuffled list never changes any
    /// envelope's own assigned type -- each envelope's own draw is seeded
    /// from its own footprint bounds, never its position in the list.
    #[test]
    fn inv_generation_building_type_independent_of_envelope_order(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let original: std::collections::BTreeMap<u32, u32> = d
            .building_types
            .assignments()
            .iter()
            .map(|a| (a.plot, a.building_type))
            .collect();

        let mut outcomes: Vec<envelopes::EnvelopeOutcome> = d.envelopes.outcomes().to_vec();
        let mut shuffle_rng = Rng::new(seed_from_ids(seed, 0xB01D_7A9E));
        for i in (1..outcomes.len()).rev() {
            let j = (shuffle_rng.next_u64() % (i as u64 + 1)) as usize;
            outcomes.swap(i, j);
        }
        let shuffled_envelopes = envelopes::EnvelopeMap::test_fixture(outcomes);
        let shuffled = sim::generation::building_types::run(seed, &shuffled_envelopes, &d.plots, &d.streets, &cfg, &content); // generation-entry-point: allow
        for a in shuffled.assignments() {
            prop_assert_eq!(
                Some(&a.building_type),
                original.get(&a.plot),
                "seed {}: plot {}'s own draw moved when only envelope list order changed",
                seed, a.plot
            );
        }
    }
}

/// `inv_generation_no_quadrant_lacks_its_required_services` (AC3, story
/// 3.4, Quentin's/Tim's own pre-registered spec): pooled over the fixed
/// seed range 0..256 -- like this file's other Scale Baseline means, a
/// plain `#[test]`, never `proptest!` -- for every distribution row this
/// pass's own overrides can actually feed (its `per` tag is carried by
/// at least one committed building type -- read generically off
/// `RuleSet::iter()`/`as_distribution` and `content.building_types`,
/// never a key list in this test; a row like an earlier story's own
/// street-furniture rule, whose `per` tag no building type ever
/// carries, is a different pass's own concern and out of scope here),
/// summed across every site quadrant that holds at least one envelope
/// the row's own subject type's `land_uses` allows at all (a quadrant
/// with none is architecturally un-placeable for that subject -- land
/// use, an earlier story's own pass 3, is not quadrant-aware, so a real
/// dwelling population can share a quadrant with zero eligible land;
/// that periphery case is excluded, not required, per Derek's own
/// direction), the pooled subjects placed clears the pooled lower bound
/// `sim::rules::evaluate`'s own site-wide Distribution ratio check
/// computes per quadrant (`expected = per_in_quadrant / ratio`,
/// `required = expected - ceil(expected * tolerance_percent / 100)`) --
/// Tim's own formula, in the engine's own established shape, summed
/// rather than asserted per quadrant: a single seed's own single
/// quadrant is real min_spacing packing noise (measured,
/// `cargo run -p sim --release --example measure_quadrant_tolerance`,
/// PR #317 cycle 2: per-(seed, quadrant) deficits above the per-quadrant
/// floor run as high as 3-4 units on `welfare_office_present`/
/// `shelter_present`, the two tightest-ratio rows, out of ~11,600
/// samples each over 3,000 seeds -- a real property over one quadrant
/// at a time would eventually flake in CI on a random `proptest` case),
/// but the pooled sum comfortably clears it (measured, same run: pooled
/// actual/required over seeds 0..256 is ~1.21 for `welfare_office_
/// present` and ~1.17 for `shelter_present`) -- the same "weak, pooled
/// band over real per-instance variance" shape this file's own envelope-
/// size and Scale-Baseline-mean invariants already use, not a new
/// pattern. A quadrant's own bucket is derived independently of pass 5's
/// internal catchment field: each placed envelope's own footprint
/// centre, in doubled coordinates (so an even-width footprint's true
/// centre is exact, never rounded), floored against the doubled site
/// origin and doubled extent.
#[test]
fn inv_generation_no_quadrant_lacks_its_required_services() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let site = cfg.site();
    let extent = (cfg.building_type_catchment_extent_cells as i64).max(1);

    let mut dist_rows: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    dist_rows.sort_by_key(|d| d.id);

    let mut pooled_required: std::collections::BTreeMap<u32, u64> =
        dist_rows.iter().map(|r| (r.id, 0u64)).collect();
    let mut pooled_actual: std::collections::BTreeMap<u32, u64> =
        dist_rows.iter().map(|r| (r.id, 0u64)).collect();

    for seed in 0..256u64 {
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let mut quadrant_of: std::collections::BTreeMap<u32, (i64, i64)> =
            std::collections::BTreeMap::new();
        let mut land_use_present_in_q: std::collections::BTreeMap<(i64, i64), [bool; 4]> =
            std::collections::BTreeMap::new();
        for e in d.envelopes.envelopes() {
            let cx2 = e.footprint.x0 as i64 + e.footprint.x1 as i64;
            let cy2 = e.footprint.y0 as i64 + e.footprint.y1 as i64;
            let qx = (cx2 - 2 * site.x0 as i64).div_euclid(2 * extent);
            let qy = (cy2 - 2 * site.y0 as i64).div_euclid(2 * extent);
            quadrant_of.insert(e.plot, (qx, qy));
            let plot = &d.plots.plots()[e.plot as usize];
            land_use_present_in_q.entry((qx, qy)).or_insert([false; 4])[plot.land_use as usize] =
                true;
        }

        for row in &dist_rows {
            let subject_def = content
                .building_types
                .iter()
                .find(|b| b.tags.contains(&row.subject));
            let mut per_by_q: std::collections::BTreeMap<(i64, i64), u64> =
                std::collections::BTreeMap::new();
            let mut subj_by_q: std::collections::BTreeMap<(i64, i64), u64> =
                std::collections::BTreeMap::new();
            for a in d.building_types.assignments() {
                let def = by_id[&a.building_type];
                let q = quadrant_of[&a.plot];
                if def.tags.contains(&row.per) {
                    *per_by_q.entry(q).or_insert(0) += 1;
                }
                if def.tags.contains(&row.subject) {
                    *subj_by_q.entry(q).or_insert(0) += 1;
                }
            }
            let ratio = row.ratio.max(1) as u64;
            for (&q, &per_in_q) in &per_by_q {
                if let Some(subject_def) = subject_def {
                    let has_eligible_land = land_use_present_in_q.get(&q).is_some_and(|present| {
                        (0..4).any(|i| present[i] && subject_def.land_uses[i])
                    });
                    if !has_eligible_land {
                        continue;
                    }
                }
                let subjects_in_q = subj_by_q.get(&q).copied().unwrap_or(0);
                let expected = per_in_q / ratio;
                let tolerance = (expected * row.tolerance_percent as u64).div_ceil(100);
                let required = expected.saturating_sub(tolerance);
                *pooled_required.get_mut(&row.id).unwrap() += required;
                *pooled_actual.get_mut(&row.id).unwrap() += subjects_in_q;
            }
        }
    }

    for row in &dist_rows {
        let required = pooled_required[&row.id];
        let actual = pooled_actual[&row.id];
        assert!(
            actual >= required,
            "rule {}: pooled over seeds 0..256, placed {actual} subjects across every eligible quadrant but the pooled per-quadrant floor needs {required}",
            row.key
        );
    }
}

/// Companion to `inv_generation_no_quadrant_lacks_its_required_services`:
/// proves that invariant is not vacuously true by construction -- over
/// the fixed seed range 0..256, every distribution row it actually
/// checks (the same "`per` tag is carried by a committed building type"
/// relevance filter) has at least one seed/quadrant pair where
/// `per_in_quadrant > 0`, so the invariant's own lower bound is a real
/// check on a real placement at least once per row, never a `0 >= 0`
/// no-op every time.
#[test]
fn quadrant_floor_check_is_not_vacuous_over_seeds_0_to_256() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let site = cfg.site();
    let extent = (cfg.building_type_catchment_extent_cells as i64).max(1);

    let mut dist_rows: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    dist_rows.sort_by_key(|d| d.id);
    let mut exercised: std::collections::BTreeMap<u32, bool> =
        dist_rows.iter().map(|r| (r.id, false)).collect();

    for seed in 0..256u64 {
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let mut quadrant_of: std::collections::BTreeMap<u32, (i64, i64)> =
            std::collections::BTreeMap::new();
        for e in d.envelopes.envelopes() {
            let cx2 = e.footprint.x0 as i64 + e.footprint.x1 as i64;
            let cy2 = e.footprint.y0 as i64 + e.footprint.y1 as i64;
            let qx = (cx2 - 2 * site.x0 as i64).div_euclid(2 * extent);
            let qy = (cy2 - 2 * site.y0 as i64).div_euclid(2 * extent);
            quadrant_of.insert(e.plot, (qx, qy));
        }
        for row in &dist_rows {
            let mut per_by_q: std::collections::BTreeMap<(i64, i64), u64> =
                std::collections::BTreeMap::new();
            for a in d.building_types.assignments() {
                let def = by_id[&a.building_type];
                if def.tags.contains(&row.per) {
                    *per_by_q.entry(quadrant_of[&a.plot]).or_insert(0) += 1;
                }
            }
            if per_by_q.values().any(|&c| c > 0) {
                exercised.insert(row.id, true);
            }
        }
    }

    for row in &dist_rows {
        assert!(
            exercised[&row.id],
            "rule {} never had a single quadrant with a nonzero per-tag count over seeds 0..256 -- \
             the quadrant invariant is vacuous for this row",
            row.key
        );
    }
}

fn block_edge_touches_street(block: Rect, street: Rect, side: sim::generation::Side) -> bool {
    use sim::generation::Side;
    match side {
        Side::North => street.y1 == block.y0 && street.x0 < block.x1 && block.x0 < street.x1,
        Side::South => street.y0 == block.y1 && street.x0 < block.x1 && block.x0 < street.x1,
        Side::West => street.x1 == block.x0 && street.y0 < block.y1 && block.y0 < street.y1,
        Side::East => street.x0 == block.x1 && street.y0 < block.y1 && block.y0 < street.y1,
    }
}

/// The argmin and argmax seeds of the building-count distribution over
/// the committed harness's own 50,000-seed scan (`cargo run -p bounds
/// --release --bin measure-generation` prints both) -- copied from its
/// output, never hunted for, and re-taken whenever the harness is re-run
/// after a retune. Pinned so a generator change that shifts the
/// distribution fails deterministically, every run.
const PINNED_BUILDING_COUNT_SEEDS: [u64; 2] = [18_959, 33_799];

/// A handful of individually-measured seeds, pinned as fixed-seed tests
/// asserting `Ok` -- a generator change that shifts the building-count
/// distribution fails these deterministically, every run, rather than
/// only occasionally through the arbitrary-seed property above.
#[test]
fn building_count_holds_at_individually_measured_extreme_seeds() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    for seed in PINNED_BUILDING_COUNT_SEEDS {
        sim::generation::generate(seed, &cfg, &content)
            .unwrap_or_else(|e| panic!("pinned seed {seed} unexpectedly failed tolerance: {e}"));
    }
}

/// AC3's tight pooled mean-size assertion, over the fixed seed range
/// `0..256`, against the committed key +- tolerance.
#[test]
fn inv_generation_envelope_mean_size_matches_the_committed_band() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let (mut sum_w, mut sum_d, mut n) = (0i64, 0i64, 0i64);
    for seed in 0u64..256 {
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let em = &d.envelopes;
        for e in em.envelopes() {
            sum_w += e.along_face_cells();
            sum_d += e.depth_cells();
            n += 1;
        }
    }
    assert!(n > 0, "no envelope was placed over seeds 0..256");
    let lo_w = (cfg.envelope_mean_width_cells - cfg.envelope_mean_width_tolerance_cells) as i64;
    let hi_w = (cfg.envelope_mean_width_cells + cfg.envelope_mean_width_tolerance_cells) as i64;
    assert!(
        sum_w >= lo_w * n && sum_w <= hi_w * n,
        "pooled mean width {} is outside [{lo_w}, {hi_w}] (sum={sum_w}, n={n})",
        sum_w / n
    );
    let lo_d = (cfg.envelope_mean_depth_cells - cfg.envelope_mean_depth_tolerance_cells) as i64;
    let hi_d = (cfg.envelope_mean_depth_cells + cfg.envelope_mean_depth_tolerance_cells) as i64;
    assert!(
        sum_d >= lo_d * n && sum_d <= hi_d * n,
        "pooled mean depth {} is outside [{lo_d}, {hi_d}] (sum={sum_d}, n={n})",
        sum_d / n
    );
}

/// AC4's own pooled assertion, over the fixed seed range `0..256`: the
/// mean placed count sits within `mean_count_tolerance_percent` of the
/// Scale Baseline target scaled to the site -- the assertion that
/// actually tests the target, never merged with the per-seed wild-
/// deviation band. A generator that drifts fails this on every run.
#[test]
fn inv_generation_building_count_mean_matches_the_scale_baseline() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let site = cfg.site();
    let target = cfg.building_count_target(site.width() * site.height());
    let n: i64 = 256;
    let sum: i64 = (0..n as u64)
        .map(|seed| {
            sim::generation::plan(seed, &cfg, &content)
                .unwrap()
                .envelopes
                .placed_count()
        })
        .sum();
    let tol = target * cfg.envelope_mean_count_tolerance_percent / 100;
    assert!(
        sum >= (target - tol) * n && sum <= (target + tol) * n,
        "pooled mean count {} is outside [{}, {}] around the Scale Baseline target {target}",
        sum / n,
        target - tol,
        target + tol
    );
}

/// `inv_generation_workplace_count_mean_matches_the_scale_baseline` (AC4,
/// story 3.4): the same shape as `inv_generation_building_count_mean_
/// matches_the_scale_baseline`, over workplace count -- every placed
/// envelope whose own assigned type has at least one post.
#[test]
fn inv_generation_workplace_count_mean_matches_the_scale_baseline() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let site = cfg.site();
    let target = cfg.workplace_count_target(site.width() * site.height());
    let n: i64 = 256;
    let sum: i64 = (0..n as u64)
        .map(|seed| {
            let d = sim::generation::plan(seed, &cfg, &content).unwrap();
            d.building_types
                .assignments()
                .iter()
                .filter(|a| sim::generation::building_types::is_workplace(by_id[&a.building_type]))
                .count() as i64
        })
        .sum();
    let tol = target * cfg.workplace_mean_count_tolerance_percent / 100;
    assert!(
        sum >= (target - tol) * n && sum <= (target + tol) * n,
        "pooled mean workplace count {} is outside [{}, {}] around the Scale Baseline target {target}",
        sum / n,
        target - tol,
        target + tol
    );
}

/// `inv_generation_profession_depth_matches_the_scale_baseline` (story
/// 3.4, Tim's direction): pooled over the fixed seed range 0..256, the
/// mean count of distinct professions held by at least `min_employers_
/// per_profession` distinct placed workplaces (within one city) sits
/// within the committed tolerance of `target_profession_count` -- read
/// directly off `defs::BALANCE` (never threaded through
/// `GenerationConfig`: this is an invariant, not a `generate()`-time
/// verdict, Tim's own distinction).
#[test]
fn inv_generation_profession_depth_matches_the_scale_baseline() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let target = sim::balance::value(
        defs::BALANCE,
        "generation.building_types.target_profession_count",
    );
    let tolerance_pct = sim::balance::value(
        defs::BALANCE,
        "generation.building_types.profession_count_mean_tolerance_percent",
    );
    let min_employers = sim::balance::value(
        defs::BALANCE,
        "generation.building_types.min_employers_per_profession",
    ) as u64;

    let n: i64 = 256;
    let sum: i64 = (0..n as u64)
        .map(|seed| {
            let d = sim::generation::plan(seed, &cfg, &content).unwrap();
            let mut employers: std::collections::BTreeMap<&str, u64> =
                std::collections::BTreeMap::new();
            for a in d.building_types.assignments() {
                let def = by_id[&a.building_type];
                if sim::generation::building_types::is_workplace(def) {
                    for &p in def.professions {
                        *employers.entry(p).or_insert(0) += 1;
                    }
                }
            }
            employers.values().filter(|&&c| c >= min_employers).count() as i64
        })
        .sum();
    let tol = target * tolerance_pct / 100;
    assert!(
        sum >= (target - tol) * n && sum <= (target + tol) * n,
        "pooled mean profession depth {} is outside [{}, {}] around the target {target}",
        sum / n,
        target - tol,
        target + tol
    );
}

/// A hand-built negative fixture proving `inv_generation_envelope_inside_
/// its_own_plot`'s own non-overlap reasoning actually holds: two
/// envelopes built from two plots that do not themselves overlap never
/// overlap either, exercising `Envelope`/`Plot` directly rather than only
/// ever seeing real generator output.
#[test]
fn envelope_footprints_from_two_different_plots_never_overlap() {
    use sim::generation::{LandUse, Side};
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let row_bounds = Rect {
        x0: -1000,
        y0: -1000,
        x1: 1000,
        y1: 1000,
    };
    let left = plots::Plot {
        bounds: Rect {
            x0: 0,
            y0: 0,
            x1: 20,
            y1: 20,
        },
        block: 0,
        front: Some(Side::South),
        land_use: LandUse::Residential,
        density: cfg.plot_high_density_threshold,
        open: false,
    };
    let right = plots::Plot {
        bounds: Rect {
            x0: 20,
            y0: 0,
            x1: 40,
            y1: 20,
        },
        block: 0,
        front: Some(Side::South),
        land_use: LandUse::Residential,
        density: cfg.plot_high_density_threshold,
        open: false,
    };
    let mut rng_a = Rng::new(1);
    let mut rng_b = Rng::new(2);
    let a = envelopes::place_one(&left, 0, row_bounds, &mut rng_a, &cfg);
    let b = envelopes::place_one(&right, 1, row_bounds, &mut rng_b, &cfg);
    let (envelopes::EnvelopeOutcome::Placed(a), envelopes::EnvelopeOutcome::Placed(b)) = (a, b)
    else {
        panic!("both plots must fit their class minimum");
    };
    let overlap = a.footprint.x0 < b.footprint.x1
        && b.footprint.x0 < a.footprint.x1
        && a.footprint.y0 < b.footprint.y1
        && b.footprint.y0 < a.footprint.y1;
    assert!(!overlap, "{:?} and {:?} overlap", a.footprint, b.footprint);
}

/// A hand-built negative fixture proving `inv_generation_open_plot_
/// percent_bounded` can actually fail: a district where most plots are
/// marked `open` trips both the count and area ceilings.
#[test]
fn open_percent_fixtures_fail_a_district_of_mostly_open_plots() {
    use sim::generation::{LandUse, Side};
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let site = sim::generation::SiteBounds {
        x0: 0,
        y0: 0,
        x1: 512,
        y1: 512,
    };
    let open_plot = |i: i32| plots::Plot {
        bounds: Rect {
            x0: i * 20,
            y0: 0,
            x1: i * 20 + 20,
            y1: 20,
        },
        block: 0,
        front: None,
        land_use: LandUse::Residential,
        density: 50,
        open: true,
    };
    let real_plot = plots::Plot {
        bounds: Rect {
            x0: 200,
            y0: 100,
            x1: 220,
            y1: 120,
        },
        block: 0,
        front: Some(Side::South),
        land_use: LandUse::Residential,
        density: 50,
        open: false,
    };
    let mut fixture_plots: Vec<plots::Plot> = (0..9).map(open_plot).collect();
    fixture_plots.push(real_plot);
    let pm = plots::PlotMap::test_fixture(site, fixture_plots);
    assert!(pm.open_count_percent() > cfg.plot_max_open_percent_by_count);
    assert!(pm.open_area_percent() > cfg.plot_max_open_percent_by_area);
}

/// Assembles a minimal, hand-built [`sim::generation::District`] from
/// exactly the plots, envelope outcomes and type assignments a planted-
/// violation test needs -- `land_use` and `streets`' own edges are never
/// read by `check_rules` (it only ever builds a [`sim::generation::
/// DistrictSite`] off `envelopes`/`plots`/`streets`/`building_types`), so
/// they carry the smallest fixture that still type-checks.
fn planted_district(
    site: sim::generation::SiteBounds,
    plot_list: Vec<plots::Plot>,
    outcomes: Vec<sim::generation::EnvelopeOutcome>,
    assignments: Vec<sim::generation::TypeAssignment>,
    blocks: Vec<sim::generation::Block>,
) -> sim::generation::District {
    sim::generation::District {
        land_use: land_use::LandUseMap::test_fixture(
            site,
            512,
            1,
            1,
            0,
            0,
            vec![land_use::LandUseCell {
                use_: sim::generation::LandUse::Residential,
                density: 0,
            }],
        ),
        streets: streets::StreetNetwork::test_fixture(site, Vec::new(), blocks),
        plots: plots::PlotMap::test_fixture(site, plot_list),
        envelopes: envelopes::EnvelopeMap::test_fixture(outcomes),
        building_types: sim::generation::BuildingTypeMap::test_fixture(assignments),
    }
}

/// Quentin's direction (PR #317 cycle 2): a hand-built district per
/// constraint, proving `District::check_rules` reports each by its own
/// committed rule key -- the `.grid` examples already prove the engine
/// itself; nothing before this proved `DistrictSite` presents a *real
/// generated* district to it correctly. Two `depot`s well inside
/// `depot_present`'s own `min_spacing`, nothing else placed at all (so
/// the ratio check's own `basis` is 0 and stays silent) -- the reported
/// violation must name `depot_present`'s own rule id.
#[test]
fn check_rules_reports_a_planted_min_spacing_violation_by_its_own_rule_key() {
    use sim::generation::{LandUse, Side};
    let content = GenerationContent::committed();
    let site = sim::generation::SiteBounds {
        x0: 0,
        y0: 0,
        x1: 512,
        y1: 512,
    };
    let depot = content
        .building_types
        .iter()
        .find(|b| b.key == "depot")
        .expect("committed content carries a 'depot' building type");
    let row = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .find(|r| r.key == "depot_present")
        .expect("committed content carries a 'depot_present' distribution row");

    let footprints = [
        Rect {
            x0: 100,
            y0: 100,
            x1: 110,
            y1: 110,
        },
        Rect {
            x0: 112,
            y0: 100,
            x1: 122,
            y1: 110,
        },
    ];
    let plot_list: Vec<plots::Plot> = footprints
        .iter()
        .map(|&bounds| plots::Plot {
            bounds,
            block: 0,
            front: Some(Side::South),
            land_use: LandUse::Industrial,
            density: 50,
            open: false,
        })
        .collect();
    let outcomes: Vec<sim::generation::EnvelopeOutcome> = footprints
        .iter()
        .enumerate()
        .map(|(i, &footprint)| {
            sim::generation::EnvelopeOutcome::Placed(sim::generation::Envelope {
                plot: i as u32,
                footprint,
                front: Side::South,
            })
        })
        .collect();
    let assignments: Vec<sim::generation::TypeAssignment> = (0..footprints.len())
        .map(|i| sim::generation::TypeAssignment {
            plot: i as u32,
            building_type: depot.id,
        })
        .collect();
    let blocks = vec![sim::generation::Block { bounds: site }];
    let d = planted_district(site, plot_list, outcomes, assignments, blocks);

    let err = d
        .check_rules(&content)
        .expect_err("two depots well inside min_spacing must violate depot_present");
    match err {
        sim::generation::GenerationError::RuleViolations { first, .. } => {
            assert_eq!(
                first.rule_id, row.id,
                "the reported violation must name depot_present's own rule id"
            );
        }
        other => panic!("expected RuleViolations, got {other:?}"),
    }
}

/// Companion to the min-spacing test above: every committed distribution
/// row shares the same `per = "dwelling"` basis, and Distribution's own
/// coverage half (`max_distance`) flags *every* dwelling as uncovered
/// the moment a row's own subject count is zero -- so isolating one
/// missing institution means every *other* row must clear its own
/// ratio band and have at least one subject placed somewhere, not just
/// the targeted row's own absence. 300 `villa`s (so `depot_present`/
/// `council_present`/`hospital_present`, ratio 300, each expect 1 with a
/// tolerance-25% band of `[0, 2]`, and `welfare_office_present`, ratio
/// 60, expects 5 with a band of `[3, 7]`) plus one `depot`, one
/// `council`, one `hospital` and five `welfare_office`s, satisfying
/// every one of those four bands -- and zero `shelter`s at all, where
/// `shelter_present`'s own ratio 50 ⇒ expected 6, tolerance-25% band
/// `[4, 8]`, so 0 clears neither its own coverage nor its own ratio
/// lower bound. All `form_low`, one area, so the coherence row stays
/// silent too.
#[test]
fn check_rules_reports_a_planted_missing_institution_violation_by_its_own_rule_key() {
    use sim::generation::{LandUse, Side};
    let content = GenerationContent::committed();
    let site = sim::generation::SiteBounds {
        x0: 0,
        y0: 0,
        x1: 512,
        y1: 512,
    };
    let type_of = |key: &str| {
        content
            .building_types
            .iter()
            .find(|b| b.key == key)
            .unwrap_or_else(|| panic!("committed content carries a '{key}' building type"))
    };
    let row = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .find(|r| r.key == "shelter_present")
        .expect("committed content carries a 'shelter_present' distribution row");

    // 300 dwellings on a 20x15 grid, spaced 12 cells apart on each axis.
    let mut footprints = Vec::new();
    for row_i in 0..15i32 {
        for col in 0..20i32 {
            let x0 = col * 12;
            let y0 = row_i * 12;
            footprints.push(Rect {
                x0,
                y0,
                x1: x0 + 8,
                y1: y0 + 8,
            });
        }
    }
    let mut keys: Vec<&str> = vec!["villa"; footprints.len()];
    // One depot, one council, one hospital, five welfare_offices, placed
    // past the dwelling grid's own bottom edge, well spaced from each
    // other (min_spacing never enters this test's own scope).
    let extra_keys = [
        "depot",
        "council",
        "hospital",
        "welfare_office",
        "welfare_office",
        "welfare_office",
        "welfare_office",
        "welfare_office",
    ];
    for (i, &key) in extra_keys.iter().enumerate() {
        let x0 = (i as i32) * 60;
        let y0 = 400;
        footprints.push(Rect {
            x0,
            y0,
            x1: x0 + 8,
            y1: y0 + 8,
        });
        keys.push(key);
    }

    let plot_list: Vec<plots::Plot> = footprints
        .iter()
        .map(|&bounds| plots::Plot {
            bounds,
            block: 0,
            front: Some(Side::South),
            land_use: LandUse::Residential,
            density: 20,
            open: false,
        })
        .collect();
    let outcomes: Vec<sim::generation::EnvelopeOutcome> = footprints
        .iter()
        .enumerate()
        .map(|(i, &footprint)| {
            sim::generation::EnvelopeOutcome::Placed(sim::generation::Envelope {
                plot: i as u32,
                footprint,
                front: Side::South,
            })
        })
        .collect();
    let assignments: Vec<sim::generation::TypeAssignment> = keys
        .iter()
        .enumerate()
        .map(|(i, &key)| sim::generation::TypeAssignment {
            plot: i as u32,
            building_type: type_of(key).id,
        })
        .collect();
    let blocks = vec![sim::generation::Block { bounds: site }];
    let d = planted_district(site, plot_list, outcomes, assignments, blocks);

    let err = d
        .check_rules(&content)
        .expect_err("300 dwellings, every other institution present, and zero shelters must violate shelter_present");
    match err {
        sim::generation::GenerationError::RuleViolations { first, .. } => {
            assert_eq!(
                first.rule_id, row.id,
                "the reported violation must name shelter_present's own rule id"
            );
        }
        other => panic!("expected RuleViolations, got {other:?}"),
    }
}

/// Companion to the two tests above: a `condo_block` (`form_high`) and a
/// `villa` (`form_low`) sharing the same block -- `no_high_rise_within_
/// a_low_rise_block`'s own coherence violation, AC1.
#[test]
fn check_rules_reports_a_planted_coherence_violation_by_its_own_rule_key() {
    use sim::generation::{LandUse, Side};
    let content = GenerationContent::committed();
    let site = sim::generation::SiteBounds {
        x0: 0,
        y0: 0,
        x1: 512,
        y1: 512,
    };
    let villa = content
        .building_types
        .iter()
        .find(|b| b.key == "villa")
        .expect("committed content carries a 'villa' building type");
    let condo = content
        .building_types
        .iter()
        .find(|b| b.key == "condo_block")
        .expect("committed content carries a 'condo_block' building type");
    let row = content
        .rules
        .iter()
        .find(|r| r.key == "no_high_rise_within_a_low_rise_block")
        .expect(
            "committed content carries the 'no_high_rise_within_a_low_rise_block' coherence row",
        );

    let footprints = [
        Rect {
            x0: 100,
            y0: 100,
            x1: 110,
            y1: 110,
        },
        Rect {
            x0: 112,
            y0: 100,
            x1: 122,
            y1: 110,
        },
    ];
    // Same block on both, so both cells land in the same `AreaId`.
    let plot_list: Vec<plots::Plot> = footprints
        .iter()
        .map(|&bounds| plots::Plot {
            bounds,
            block: 0,
            front: Some(Side::South),
            land_use: LandUse::Residential,
            density: 50,
            open: false,
        })
        .collect();
    let outcomes: Vec<sim::generation::EnvelopeOutcome> = footprints
        .iter()
        .enumerate()
        .map(|(i, &footprint)| {
            sim::generation::EnvelopeOutcome::Placed(sim::generation::Envelope {
                plot: i as u32,
                footprint,
                front: Side::South,
            })
        })
        .collect();
    let assignments = vec![
        sim::generation::TypeAssignment {
            plot: 0,
            building_type: villa.id,
        },
        sim::generation::TypeAssignment {
            plot: 1,
            building_type: condo.id,
        },
    ];
    let blocks = vec![sim::generation::Block { bounds: site }];
    let d = planted_district(site, plot_list, outcomes, assignments, blocks);

    let err = d
        .check_rules(&content)
        .expect_err("a condo_block and a villa sharing one block must violate the coherence row");
    match err {
        sim::generation::GenerationError::RuleViolations { first, .. } => {
            assert_eq!(
                first.rule_id, row.id,
                "the reported violation must name no_high_rise_within_a_low_rise_block's own rule id"
            );
        }
        other => panic!("expected RuleViolations, got {other:?}"),
    }
}

/// Quentin's direction (PR #317 cycle 2): a hand-built envelope too
/// small for one committed-shaped type but not another, over its own
/// small two-type content table (never `GenerationContent::
/// committed()`, whose own `tools/defs-build` coverage check already
/// guarantees every real plot has a type that fits) -- proves
/// `building_types::run`'s own `min_interior_*_cells` eligibility check
/// is real, not read by nothing.
#[test]
fn a_too_small_envelope_never_draws_a_type_whose_own_minimum_interior_does_not_fit() {
    use sim::generation::{LandUse, Side};
    use sim::world::Rect;

    let c = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let wall = c.envelope_wall_thickness_cells;
    // Interior net exactly 6x6 -- fits `fixture_fits`, never
    // `fixture_too_big`.
    let width = 6 + 2 * wall;
    let depth = 6 + 2 * wall;
    let footprint = Rect {
        x0: 100,
        y0: 100,
        x1: 100 + width,
        y1: 100 + depth,
    };
    let plot = plots::Plot {
        bounds: footprint,
        block: 0,
        front: Some(Side::South),
        land_use: LandUse::Residential,
        density: 50,
        open: false,
    };
    let site = sim::generation::SiteBounds {
        x0: 0,
        y0: 0,
        x1: 512,
        y1: 512,
    };
    let pm = plots::PlotMap::test_fixture(site, vec![plot]);
    let em = envelopes::EnvelopeMap::test_fixture(vec![sim::generation::EnvelopeOutcome::Placed(
        sim::generation::Envelope {
            plot: 0,
            footprint,
            front: Side::South,
        },
    )]);
    let block = sim::generation::Block { bounds: footprint };
    let net = streets::StreetNetwork::test_fixture(site, Vec::new(), vec![block]);

    let fits = defs::BuildingTypeDef {
        id: 9001,
        key: "fixture_fits",
        tags: &[],
        land_uses: [true, false, false, false],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 6,
        min_interior_depth_cells: 6,
        weight: 1,
        requires_corner: false,
        density_affinity: 0,
        professions: &[],
    };
    let too_big = defs::BuildingTypeDef {
        id: 9002,
        key: "fixture_too_big",
        tags: &[],
        land_uses: [true, false, false, false],
        density_min: 0,
        density_max: 100,
        min_interior_width_cells: 20,
        min_interior_depth_cells: 20,
        weight: 1,
        requires_corner: false,
        density_affinity: 0,
        professions: &[],
    };
    let types = [fits, too_big];
    let content = GenerationContent {
        rules: sim::rules::RuleSet::for_test(&[]),
        building_types: &types,
    };

    for seed in 0..200u64 {
        let map = sim::generation::building_types::run(seed, &em, &pm, &net, &c, &content); // generation-entry-point: allow
        assert_eq!(map.assignments().len(), 1);
        assert_eq!(
            map.assignments()[0].building_type,
            fits.id,
            "seed {seed}: the too-small envelope must never draw the too-big type"
        );
    }
}

/// The guard `inv_generation_peripheral_blocks_are_not_degenerate` cannot
/// be, by its own doc comment: pooled over a fixed, non-random seed range
/// (deterministic -- never flaky, unlike a fresh `any::<u64>()` draw each
/// CI run), summed low-band mean area over summed high-band mean area
/// must clear `peripheral_pooled_min_ratio_percent` -- a density-blind
/// generator pools to ~100%, this one to ~241% (Quentin's direction,
/// cycle 4: "the only test that goes red if `subdivide` stops reading
/// density is a three-seed test tuned to one seed").
#[test]
fn peripheral_blocks_pooled_ratio_exceeds_a_density_blind_floor() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let (mut low_sum, mut high_sum) = (0i64, 0i64);
    for seed in 0u64..256 {
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        if let Some((low, high)) = net.mean_area_by_density_band(&lu, &cfg) {
            low_sum += low;
            high_sum += high;
        }
    }
    assert!(
        low_sum * 100 >= high_sum * cfg.peripheral_pooled_min_ratio_percent as i64,
        "pooled over seeds 0..256: low-band sum {low_sum} is under {}% of high-band sum {high_sum}",
        cfg.peripheral_pooled_min_ratio_percent
    );
}

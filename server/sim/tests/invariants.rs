//! Registry of the invariants named across the architecture and requirements
//! (NFR25, NFR28, NFR29, and Story 0.16's acceptance criteria). Each constant
//! documents one invariant by its trace-matrix id. `docs/trace-matrix.md`
//! records, for every id here, whether it is `covered` (a test with the same
//! name exists) or `deferred` (the subsystem it protects does not exist yet).
//! `scripts/ci/check-trace-matrix.sh` fails the build if the two ever
//! disagree, so this file and the matrix cannot drift silently.
//!
//! Reproducing a CI failure (NFR50): `ci.yml` runs every property from one
//! fixed `PROPTEST_RNG_SEED` and prints it with `PROPTEST_CASES`; locally,
//! `PROPTEST_RNG_SEED=<from the log> PROPTEST_CASES=<from the log> cargo
//! test -p sim --release --test invariants -- <property>` replays the same
//! cases. With a fixed RNG seed every property draws the same
//! `any::<u64>()` world seeds. An outlier found by `explore.yml` (fresh
//! seeds) is diagnosed to the pass that owns it and pinned as a plain
//! `#[test]`, never absorbed by widening a tolerance.

use proptest::prelude::*;
use proptest::test_runner::FileFailurePersistence;
use sim::appearance;
use sim::cadence;
use sim::generated::defs::{self, Family, Pool};
use sim::generation::{
    DistrictRecord, GenerationConfig, GenerationContent, GenerationError, RuleSetVersion, create,
    envelopes, land_use, plots, streets,
};
use sim::rng::{Rng, seed_from_ids};
use sim::routing::estimate::{Correction, Rates, estimate};
use sim::routing::{Point, TransportMode};
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

/// Where a failing property's case is written, relative to the package
/// root `cargo test` runs integration tests from -- the committed
/// `invariants.proptest-regressions`, replayed before any fresh case.
/// Proptest's default (`SourceParallel`) would write somewhere else for an
/// integration-test target; `the_proptest_persistence_path_is_the_committed_
/// regressions_file` holds this to the file.
const REGRESSIONS_PATH: &str = "tests/invariants.proptest-regressions";

/// The config every property in this file runs under: the default (so
/// `PROPTEST_CASES`/`PROPTEST_RNG_SEED` still apply) with persistence
/// pinned to [`REGRESSIONS_PATH`].
fn persisted() -> ProptestConfig {
    ProptestConfig {
        failure_persistence: Some(Box::new(FileFailurePersistence::Direct(REGRESSIONS_PATH))),
        ..ProptestConfig::default()
    }
}

/// A failing case is written to, and replayed from, the committed file: the
/// configured persistence reads exactly the `cc` entries committed there.
#[test]
fn the_proptest_persistence_path_is_the_committed_regressions_file() {
    let committed = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join(REGRESSIONS_PATH);
    let text = std::fs::read_to_string(&committed)
        .unwrap_or_else(|e| panic!("{} must exist: {e}", committed.display()));
    let committed_cases = text.lines().filter(|l| l.starts_with("cc ")).count();
    assert!(
        committed_cases > 0,
        "the committed file carries no cases to replay"
    );

    let config = persisted();
    let persistence = config
        .failure_persistence
        .expect("every property persists its failures");
    let replayed = persistence.load_persisted_failures2(Some(file!()));
    assert_eq!(
        replayed.len(),
        committed_cases,
        "the configured persistence must read the committed regressions file"
    );
}

pub const INV_NO_MATTER_STARVES: &str = "no matter starves indefinitely";
pub const INV_INVENTORY_SUPERSET_AFTER_ABSENCE: &str = "inventory is a superset after any absence";
pub const INV_NO_OWNED_ITEM_DEGRADES_DURING_ABSENCE: &str = "no owned item degrades during absence";
pub const INV_BUDGET_NEVER_NEGATIVE: &str = "budget never goes negative";
pub const INV_STOCK_IS_INDEPENDENT_PER_HOLDER: &str = "stock is independent per holder: any interleaving of stock operations leaves each holder exactly as replaying its own operations alone";
pub const INV_STOCK_MOVES_ONLY_BY_HAND: &str = "stock moves only by hand: across any interleaving of authored makes, consumptions and moves, every quantity change is a returned write naming a citizen and one of two causes, and each item's total changes only by what was made and consumed";
pub const INV_STOCK_MOVE_CONSERVES_QUANTITY: &str = "a stock move conserves quantity: the per-item sum across holders is unchanged by any sequence of moves, and a move the receiver refuses takes nothing from the giver";
pub const INV_CASH_PAYMENT_CONSERVES_EVERY_DENOMINATION: &str = "a cash payment conserves every denomination: after any payment outcome the count of each denomination across all holders is unchanged, a completed payment moves exactly the price of value from customer to till, and every other outcome moves nothing";
pub const INV_ACTOR_LOCATION_WRITTEN_ONLY_ON_CHUNK_CHANGE: &str = "actor_location is written only on a chunk or floor change: the planner returns no write for any move that keeps chunk and floor, and exactly one write, naming the chunk sim::world::chunk_key derives, for any move that changes either";
pub const INV_PLAYER_POSITION_IS_ONE_ROW_PER_PLAYER: &str = "Over any interleaving of position writes by any number of characters, the planned writes leave exactly one row per character that has written, equal to its last write, and no plan touches another character's row (FR138)";
pub const INV_PLAYER_POSITION_CHUNK_KEY_FOLLOWS_POSITION: &str = "Over any walk (negative coordinates, corner crossings, floor changes, teleports) the stored chunk_key of a player_position row equals sim::world::chunk_key of its stored position, and an out-of-range input produces no write (FR138)";
pub const INV_PLAYER_POSITION_PLANNING_NEVER_PANICS: &str = "Any i32 position and any i8 floor returns Ok or a typed Err and never wraps; a jump of any distance inside the addressable range is accepted, since FR137 forbids plausibility checks (NFR41)";
pub const INV_CHANGE_IS_REFUSED_ONLY_WHEN_THE_TILL_CANNOT_MAKE_IT: &str = "change is refused only when the till cannot make it: while the change due is under the bound a payment reports no change if and only if no combination of the pieces the till holds and what was just tendered sums to the change due, and the change chosen is the fewest pieces with ties to the larger denomination";
pub const INV_CASH_PLANNING_NEVER_PANICS: &str = "cash planning never panics: value_of, choose_change and plan_payment return Ok or a typed Err for any table, any lines, any tender and any price";
pub const INV_ITEM_INSTANCE_IN_EXACTLY_ONE_STATE: &str = "an item instance is in exactly one of its two states: any interleaving of place and hold moves leaves each instance in one form, never both, never neither";
pub const INV_IDENTITY_REACHES_AT_MOST_ONE_CHARACTER: &str = "an identity reaches at most one character: over any interleaving of create, link, repeated link, link-to-self and link-by-a-stranger, no identity maps to two characters and no plan remaps a mapped identity";
pub const INV_LINKING_NEVER_CHANGES_OR_ORPHANS_A_CHARACTER: &str = "linking never changes or orphans a character: a character's identity set only grows and never empties, and the character row is identical before and after any link, successful or refused";
pub const INV_IDENTITY_PLANNING_NEVER_PANICS: &str = "identity planning never panics: plan_create, plan_link, check_claim and credential return Ok or a typed Err for any input, a spent or expired claim and an issuer with no audience included";
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
pub const INV_EXISTING_CITY_NEVER_REGENERATES: &str = "an existing city is never regenerated: for any list of recorded districts in any order, with any seeds and any recorded versions -- equal to or different from this build's -- the generate-once gate refuses exactly when some recorded site shares a cell with the site and runs no generation; generation is reachable only from no overlapping record";
pub const INV_GENERATION_TOTAL_NEVER_PANICS: &str = "generation is total: for any seed, both passes return a valid plan or a typed error, never a panic (FR110)";
pub const INV_GENERATION_ALL_FOUR_LAND_USES_PRESENT: &str = "pass 1's coarse grid is fully assigned (no unassigned cell) and every one of the four land uses appears at least once, for any seed (FR110)";
pub const INV_GENERATION_STREETS_CONNECTED_AND_NOT_STRANDED: &str = "pass 2's street graph is a single connected component, and every pass-1 region borders a street, for any seed (FR110)";
pub const INV_GENERATION_NO_DEAD_ENDS_AWAY_FROM_BOUNDARY: &str =
    "pass 2 never produces a degree-1 node away from the site boundary, for any seed (FR110, NFR8)";
pub const INV_ESTIMATE_IS_A_METRIC: &str = "the routing estimate is zero exactly when two cells coincide, symmetric, and obeys the triangle inequality, for any three cells on one floor and any mode (FR131)";
pub const INV_ESTIMATE_IS_A_METRIC_ACROSS_FLOORS: &str = "the routing estimate obeys the triangle inequality across floors too, for any correction factor (FR131)";
pub const INV_ESTIMATE_IS_ORIGIN_INDEPENDENT: &str = "translating both endpoints by the same offset never changes the routing estimate, and no i32 coordinate panics or wraps (FR131)";
pub const INV_FASTER_MODE_NEVER_COSTS_MORE: &str = "a mode with a higher speed percent never returns a larger estimate, and a strictly smaller one over a non-zero distance when the percents differ enough to matter (FR131)";
pub const INV_FLOOR_PENALTY_IS_ADDITIVE_AND_FLAT: &str = "changing floor adds exactly floor_change_penalty_milliminutes per floor crossed, whatever the mode or the horizontal distance (FR131)";
pub const INV_GENERATION_MANHATTAN_BEATS_EUCLIDEAN: &str = "over a generated city's own sampled node pairs, Manhattan distance is a closer estimate of network distance than Euclidean, in total and on a clear majority of pairs (FR131)";
pub const INV_GENERATION_DETOUR_RATIO_BOUNDED: &str = "over the deterministic node-pair sample, BFS network distance never exceeds max(manhattan + max_detour_excess_cells, manhattan * max_detour_percent / 100), for any pair and any seed (FR110, story 15.10)";
pub const INV_GENERATION_NOT_A_PERFECT_GRID: &str = "block width and height each take at least min_distinct_block_sizes distinct values, both junction kinds are present, and at least two street classes are present, for any seed (FR110, NFR8)";
pub const INV_GENERATION_EXACT_TILING: &str = "every site cell is covered by exactly one block or by at least one street, and no two blocks overlap, for any seed (FR110)";
pub const INV_GENERATION_INSTITUTIONAL_POCKETS_ARE_SMALL: &str = "at least institutional_min_pockets mutually non-adjacent (edge or corner) institutional components per site, none over institutional_max_pocket_share_percent of the site's own coarse-cell count, for any seed (FR110, Artie's direction)";
pub const INV_GENERATION_INDUSTRIAL_NEVER_TOUCHES_COMMERCIAL: &str =
    "no industrial coarse cell is ever adjacent to a commercial one, for any seed (FR110)";
pub const INV_GENERATION_RESIDENTIAL_IS_THE_LARGEST_LAND_USE_BY_AREA: &str = "residential has more coarse cells than any other single land use, for any seed -- field-driven assignment (commercial at the peak, industrial one contiguous group, institutional the smallest leaves) structurally favours it over a blind weighted draw, but that only holds if something keeps checking it (FR110, Quentin's direction)";
pub const INV_GENERATION_LAND_USE_AREA_SHARE_WITHIN_TOLERANCE: &str = "each non-residential land use's area share of the site sits within share_tolerance_pct percentage points of its own share_*_pct key, for any seed -- the pass-1 guard for what the share keys mean (story 4.21, FR110)";
pub const INV_GENERATION_P99_DETOUR_RATIO_BOUNDED: &str = "the 99th-percentile BFS-network-vs-Manhattan detour ratio, over one city's own sampled pairs, never exceeds p99_detour_percent, for any seed (FR110, Tim's direction)";
pub const INV_GENERATION_NO_STAGGERED_JUNCTIONS: &str = "no two junctions on the same street sit under junction_min_separation_cells apart unless they coincide, for any seed -- asserted at zero, a refused split rather than a measured ceiling (FR110, Tim's direction)";
pub const INV_GENERATION_MIN_BLOCK_DEPTH_IS_RESPECTED: &str =
    "every block is at least min_block_depth_cells on both axes, for any seed (FR110)";
pub const INV_GENERATION_ARTERIALS_ARE_CONTIGUOUS: &str = "every arterial line starts at its own near site edge with no gap, and at most one arterial line per city stops short of the far site edge (the T-termination), for any seed (FR110, Artie's direction)";
pub const INV_GENERATION_AN_INSTITUTIONAL_REGION_IS_CARRIED_BY_A_BLOCK: &str = "for any seed, at least one pass-1 institutional region has a block whose own land use (majority area) is institutional -- the swallow rule keeps small regions from vanishing into a neighbour's block (story 4.22)";
pub const INV_GENERATION_PERIPHERAL_BLOCKS_ARE_NOT_DEGENERATE: &str = "mean block area in the bottom third of the density range is at least `peripheral_low_band_floor_percent` of the top third's, for any seed (NFR8, Tim's/Artie's direction)";
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
pub const INV_GENERATION_PROFESSION_DEPTH_NEVER_COLLAPSES_IN_ONE_CITY: &str = "for any seed, the count of professions held by at least min_employers_per_profession distinct placed workplaces in that one city never falls under the committed per-city floor (story 3.4 AC4)";
pub const INV_GENERATION_BARISTA_HAS_AT_LEAST_MIN_EMPLOYERS: &str = "for any seed, the barista profession (an FR14 launch job, posted only at cafes) is held by at least min_employers_per_profession distinct placed workplaces in that one city (story 15.9)";
pub const INV_GENERATION_BUILDING_TYPE_INDEPENDENT_OF_ENVELOPE_ORDER: &str = "shuffling pass 4's own placed-envelope order and re-running pass 5 over the shuffled list never changes any envelope's own assigned type, for any seed (story 3.4, NFR25)";
pub const INV_SCHEDULE_PHASE_PRESERVED: &str = "sim::cadence::next_target's returned target is always congruent to the origin passed in, modulo the period, for any origin/period/now (story 4.2)";
pub const INV_SCHEDULE_NEVER_TARGETS_PAST: &str = "sim::cadence::next_target's returned target is always strictly after now, for any reasonable-range origin/period/now (story 4.2)";
pub const INV_SCHEDULE_CATCH_UP_BOUNDED: &str = "sim::cadence::next_target, called with now a simulated week past the origin, returns instantly (no loop) with missed equal to the exact arithmetic gap in periods -- catch-up is bounded to one late fire, every skipped target is never separately dispatched (story 4.2)";
pub const INV_SCHEDULE_ARITH_TOTAL: &str = "sim::cadence::next_target never panics and never wraps, for any i64 origin/now (including i64::MIN/i64::MAX) and any positive period_ms (story 4.2, NFR41)";
pub const INV_SCHEDULE_NEVER_RETURNS_ITS_OWN_ORIGIN: &str = "sim::cadence::next_target's returned target is always strictly after origin, for any reasonable-range origin/period/now -- an early dispatch (now before origin) must never re-arm the already-due origin itself (story 4.2)";

proptest! {
    #![proptest_config(persisted())]
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
    #![proptest_config(persisted())]
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
                scope: sim::rules::DistributionScope::Site,
                reads: None,
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
    #![proptest_config(persisted())]
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
                scope: sim::rules::DistributionScope::Site,
                reads: None,
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
    #![proptest_config(persisted())]
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
                catchment: None,
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
    #![proptest_config(persisted())]
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

/// `inv_generation_detour_ratio_bounded`'s own predicate body, lifted out
/// so the proptest below and the pinned regression test
/// (`seed_8872365549107643721_holds_the_detour_ceilings`) call through
/// exactly the same bound rather than risk two copies of it drifting
/// apart (Quentin's direction, story 15.10). The comparison itself lives
/// in `streets::detour_bound_violation` (Derek's max()-contract, the
/// same function `measure_generation.rs`'s own detour-bounds sweep calls
/// -- one place, never two hand-written copies).
fn detour_bounds_hold(seed: u64, cfg: &GenerationConfig) -> Result<(), String> {
    let lu = land_use::run(seed, cfg.site(), cfg).unwrap();
    let net = streets::run(seed, &lu, cfg);
    let samples = net.detour_samples(streets::DETOUR_SAMPLE_MAX_NODES);
    if let Some(v) = streets::detour_bound_violation(&samples, cfg) {
        return Err(format!(
            "seed {seed}: {:?}-{:?} network {} over its own allowed {} (manhattan {}) -- \
             max_detour_excess_cells/max_detour_percent are measured values (see generation.\
             toml's own comments and docs/generation.md's street-network pass), not a bug in \
             your change unless it touches server/sim/src/generation/streets.rs or a \
             generation.streets.* key. To fix: add this seed to streets::PINNED_DETOUR_SEEDS \
             with its own exhaustive excess (`detour_samples(usize::MAX)`'s own worst pair), \
             then re-run `cargo run -p bounds --release --bin measure-generation` and \
             re-apply max_detour_excess_cells's own margin rule",
            v.a,
            v.b,
            v.network,
            v.detour_allowed(cfg),
            v.manhattan
        ));
    }
    Ok(())
}

proptest! {
    #![proptest_config(persisted())]

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

    /// `inv_generation_detour_ratio_bounded` (story 15.10, Derek's
    /// direction): one bound, not two, and no distance threshold of its
    /// own -- `network <= max(manhattan + max_detour_excess_cells,
    /// manhattan * max_detour_percent / 100)` for every sampled pair
    /// (`streets::detour_bound_violation`, the one function this, the
    /// pinned `seed_8872365549107643721_holds_the_detour_ceilings` test
    /// and the sweep all call through). Story 3.18's `detour_long_pair_
    /// cells` AND-with-threshold contract is gone: a value under the
    /// takeover distance (`GenerationConfig::detour_ratio_takeover_
    /// distance_cells`) was allowed *less* additive excess than a
    /// shorter pair, the seam seed `8872365549107643721` walked into,
    /// and no value of a separate threshold key could make it both
    /// non-redundant and coherent. Since exceeding the max() of two
    /// terms means exceeding both, a violation here is always also a
    /// violation of the additive-excess-alone check every sampled pair
    /// was already held to -- so the existing sweep's own 0 misses
    /// against `max_detour_excess_cells` (unconditional, every pair,
    /// 1,000,000 seeds, passes 1-2 only) already proves this contract's
    /// own miss count is 0 too, without a second million-seed run. See
    /// `defs/balance/generation.toml`'s `max_detour_percent` comment and
    /// `docs/generation.md`'s street-network pass for the full sweep.
    #[test]
    fn inv_generation_detour_ratio_bounded(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        if let Err(msg) = detour_bounds_hold(seed, &cfg) {
            prop_assert!(false, "{msg}");
        }
    }

    /// `inv_generation_p99_detour_ratio_bounded` (Tim's direction, cycle
    /// 2): `max_detour_percent` alone only bounds one city's own single
    /// worst pair, which stays green even if the *typical* case
    /// regressed -- the 99th percentile of this same sample is pinned
    /// separately. Measured directly (story 15.10, `measure-generation`'s
    /// own detour-bounds sweep, 1,000,000 seeds, passes 1-2 only, at this
    /// exact 64-node sample): 0 misses -- <= 0.000300% per seed (rule of
    /// three), a 4,096-case CI run failing at most 1.2213% of the time.
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

    /// `inv_generation_manhattan_beats_euclidean` (FR131, AC2): over real
    /// generated geometry, never a hand-drawn grid. Euclidean is an
    /// integer `isqrt`, so no float enters `sim`.
    #[test]
    fn inv_generation_manhattan_beats_euclidean(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let samples = net.detour_samples(streets::DETOUR_P99_SAMPLE_MAX_NODES);
        let (mut man_err, mut euc_err, mut man_wins, mut euc_wins) = (0i64, 0i64, 0usize, 0usize);
        for s in &samples {
            let dx = (s.a.0 as i64 - s.b.0 as i64).abs();
            let dy = (s.a.1 as i64 - s.b.1 as i64).abs();
            // Rounded to nearest: a floor would bias the comparison.
            let euclid = ((4 * (dx * dx + dy * dy)).isqrt() + 1) / 2;
            let (m, e) = ((s.network - s.manhattan).abs(), (s.network - euclid).abs());
            man_err += m;
            euc_err += e;
            man_wins += usize::from(m < e);
            euc_wins += usize::from(e < m);
        }
        prop_assert!(!samples.is_empty(), "seed {seed}: no sampled pairs");
        prop_assert!(
            man_err < euc_err,
            "seed {seed}: summed |network - manhattan| {man_err} is not under summed \
             |network - euclidean| {euc_err} over {} pairs", samples.len()
        );
        // Ties (axis-aligned pairs, where both agree) are neither side's win.
        prop_assert!(
            man_wins * 10 >= (man_wins + euc_wins) * 9,
            "seed {seed}: Manhattan closer on {man_wins} pairs, Euclidean on {euc_wins} -- \
             under the committed 90% of decided pairs"
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
    /// 3). Measured at `GENERATION_VERSION` 9 over 1,000,000 uniformly
    /// drawn seeds: none below the committed 60%; the worst is 80.4% --
    /// real split-jitter noise rather than an inversion
    /// (`peripheral_floor_clears_the_lowest_known_ratio_seeds` pins it).
    /// This per-city floor alone cannot tell a healthy city from a
    /// density-blind one, though: a uniform grid pools to parity (1.0x),
    /// comfortably above 0.6x
    /// (`mean_area_by_density_band_reports_parity_for_a_uniform_grid` in
    /// `server/sim/src/generation/streets.rs` shows exactly this).
    /// `peripheral_blocks_pooled_ratio_exceeds_a_density_blind_floor`,
    /// below, is the guard that actually fails on that defect (Quentin's
    /// direction, cycle 4). Artie's own harder bar (2x) is judged on the
    /// committed evidence seeds specifically
    /// (`peripheral_blocks_are_at_least_2x_central_ones_on_the_evidence_
    /// seeds` in `server/sim/src/generation/streets.rs`), on this same
    /// density-band metric.
    /// The property `streets::SWALLOW_MIN_REGION_SHARE_DENOM` exists for:
    /// a city with institutional land has at least one block that is
    /// institutional, or pass 5 can never place a council or hospital.
    /// Stronger claims do not hold -- about 2% of seeds lose *some* region
    /// of some use to a neighbour's majority, and that is the design (a
    /// block's use is decided by majority area). Without the rule 0.57% of
    /// seeds break this; with it 0 of 1,000,000 do. Pinned seeds:
    /// `institutional_regions_survive_on_seeds_that_lose_them_without_the_
    /// swallow_rule` in `server/sim/src/generation/streets.rs`.
    #[test]
    fn inv_generation_an_institutional_region_is_carried_by_a_block(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let institutional = lu
            .regions()
            .iter()
            .filter(|r| r.use_ == sim::generation::LandUse::Institutional)
            .count();
        let lost = net
            .regions_carried_by_no_block(&lu)
            .iter()
            .filter(|r| r.use_ == sim::generation::LandUse::Institutional)
            .count();
        prop_assert!(
            institutional == 0 || lost < institutional,
            "seed {seed}: all {institutional} institutional regions are carried by no block"
        );
    }

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

    /// `inv_generation_land_use_area_share_within_tolerance` (story 4.21):
    /// each non-residential use's area share sits within
    /// `share_tolerance_pct` points of its own `share_*_pct` key, checked
    /// at the pass that owns it rather than two passes downstream in the
    /// building and workplace counts. Measured miss rate (`measure-generation -- bands 1000000`, 1,000,000
    /// seeds, 2026-09-29): 0 misses; rule-of-three bound 0.000300% per seed,
    /// implied failure probability per fresh-seed 4,096-case run
    /// (`explore.yml`; `ci.yml`'s fixed seed cannot flake) <= 1.2213%.
    #[test]
    fn inv_generation_land_use_area_share_within_tolerance(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        prop_assert!(
            lu.share_band_violation(&cfg).is_none(),
            "seed {seed}: land-use share outside share_tolerance_pct: {:?} (commercial {}, industrial {}, institutional {} of {} coarse cells)",
            lu.share_band_violation(&cfg),
            lu.area_cells(land_use::LandUse::Commercial),
            lu.area_cells(land_use::LandUse::Industrial),
            lu.area_cells(land_use::LandUse::Institutional),
            lu.cols() * lu.rows()
        );
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

/// The body of `inv_generation_required_institutions_are_present_when_
/// their_own_target_is_nonzero` and of every seed pin: for each committed
/// distribution row a building type feeds, the district places its
/// subject whenever the row owes one -- a site row when `basis / ratio`
/// is at least one, a catchment row when some catchment's own basis is --
/// and `check_rules` holds. Rows and tags come from the committed
/// content, never from a literal.
fn assert_required_institutions(seed: u64) -> Result<(), String> {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let d = sim::generation::plan(seed, &cfg, &content).unwrap();
    let site = d.site(&content);
    let mut rows: Vec<sim::rules::DistributionRow> = content
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
    rows.sort_by_key(|d| d.id);
    for row in &rows {
        let per = site.subjects_in_area(None, row.per);
        let owed_somewhere = match row.scope {
            sim::rules::DistributionScope::Site => {
                sim::rules::distribution_target(per.len() as u64, row.ratio, row.tolerance_percent)
                    .0
                    >= 1
            }
            sim::rules::DistributionScope::Catchment { extent_cells } => {
                let mut by: std::collections::BTreeMap<(i32, i32), u64> = Default::default();
                for c in per {
                    *by.entry(sim::rules::catchment_of(c.x, c.y, extent_cells))
                        .or_insert(0) += 1;
                }
                // A scoped row owes at least one subject somewhere, for
                // every seed: asserted unconditionally.
                if !by.values().any(|&n| {
                    sim::rules::distribution_target(n, row.ratio, row.tolerance_percent).0 >= 1
                }) {
                    return Err(format!(
                        "seed {seed}: scoped rule {} owes nothing in any catchment",
                        row.key
                    ));
                }
                true
            }
        };
        if owed_somewhere && site.subjects_in_area(None, row.subject).is_empty() {
            return Err(format!(
                "seed {seed}: rule {} owes a subject but placed none",
                row.key
            ));
        }
    }
    d.check_rules(&content)
        .map_err(|e| format!("seed {seed}: check_rules is no longer Ok: {e:?}"))
}

/// The per-city mean-size band's own weak multiplier over the tight
/// pooled tolerance (`inv_generation_envelope_mean_size_matches_the_
/// committed_band` below): one city's own sample is noisier than the
/// pooled 256-seed one, so this property only ever catches a gross
/// regression (the mean collapsing toward the class minimum), never
/// tunes the mean itself -- an algorithm shape, not tunable content.
const MEAN_SIZE_WEAK_TOLERANCE_MULTIPLIER: i32 = 4;

proptest! {
    #![proptest_config(persisted())]
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

    /// `inv_existing_city_never_regenerates`: whatever the recorded
    /// districts say about their seeds and versions, `create` over a site
    /// any of them shares a cell with refuses -- checked against an
    /// independent cell-sharing oracle, for one to four records in any
    /// order with the overlapping one at any position.
    #[test]
    fn inv_existing_city_never_regenerates(
        rects in proptest::collection::vec(
            (-3000i32..3000, -3000i32..3000, 1i32..3000, 1i32..3000),
            1..5,
        ),
        seeds in proptest::collection::vec(any::<u64>(), 4),
        generation_version in any::<u32>(),
        rng_version in any::<u32>(),
        defs_version in "[a-z0-9]{0,12}",
        same_defs in any::<bool>(),
        new_seed in any::<u64>(),
    ) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let site = cfg.site();
        let existing: Vec<DistrictRecord> = rects
            .iter()
            .enumerate()
            .map(|(i, &(x, y, w, h))| DistrictRecord {
                seed: seeds[i],
                site: Rect { x0: x, y0: y, x1: x + w, y1: y + h },
                version: RuleSetVersion {
                    generation: generation_version,
                    rng: rng_version,
                    defs: if same_defs { defs::DEFS_VERSION.to_string() } else { defs_version.clone() },
                },
            })
            .collect();
        let shares_a_cell = |r: &Rect| {
            r.x0.max(site.x0) < r.x1.min(site.x1) && r.y0.max(site.y0) < r.y1.min(site.y1)
        };
        // Acceptance is exercised by `record.rs`'s own cases; only the
        // refusal is checked here, so a case costs no generation.
        if existing.iter().any(|r| shares_a_cell(&r.site)) {
            let r = create(&existing, new_seed, &cfg, &GenerationContent::committed());
            prop_assert!(
                matches!(r, Err(GenerationError::SiteAlreadyGenerated { .. })),
                "a record sharing a cell must refuse, got {:?}",
                r.map(|(rec, _)| rec)
            );
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
    /// sigma-based rule), not merely hoped for. Measured miss rate (`measure-generation -- bands 1000000`, 1,000,000
    /// seeds, 2026-09-29): 0 misses; rule-of-three bound 0.000300% per seed,
    /// implied failure probability per fresh-seed 4,096-case run
    /// (`explore.yml`; `ci.yml`'s fixed seed cannot flake) <= 1.2213%.
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
    /// (AC2): every guaranteed subject -- read off the committed
    /// `[[distribution]]` rows, never a key list -- is present for any
    /// seed. [`assert_required_institutions`] is the one body; the named
    /// seed pins below call the same function, so a pin cannot drift from
    /// the property. Shops are weighted fill, a likelihood and not a
    /// guarantee, and are not asserted here (`docs/generation.md`).
    #[test]
    fn inv_generation_required_institutions_are_present_when_their_own_target_is_nonzero(seed in any::<u64>()) {
        let verdict = assert_required_institutions(seed);
        prop_assert!(verdict.is_ok(), "{}", verdict.err().unwrap_or_default());
    }

    /// `inv_generation_workplace_count_within_tolerance` (AC4, story 3.4):
    /// the same shape as `inv_generation_building_count_within_tolerance`
    /// -- `generate`'s own `check_workplace_count` clears the per-seed
    /// band, for any seed. Measured miss rate (`measure-generation -- bands 1000000`, 1,000,000
    /// seeds, 2026-09-29): 0 misses; rule-of-three bound 0.000300% per seed,
    /// implied failure probability per fresh-seed 4,096-case run
    /// (`explore.yml`; `ci.yml`'s fixed seed cannot flake) <= 1.2213%.
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

    /// `inv_generation_profession_depth_never_collapses_in_one_city`
    /// (AC4, Quentin's direction, PR #317 cycle 2): the pooled mean
    /// `inv_generation_profession_depth_matches_the_scale_baseline`
    /// checks says nothing about any one city -- a weak, any-seed floor,
    /// the same sigma-margin shape `generation.envelopes.count_
    /// tolerance_percent` states, so a single unlucky city collapsing
    /// far below the pooled mean is caught too.
    #[test]
    fn inv_generation_profession_depth_never_collapses_in_one_city(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let min_employers = sim::balance::value(
            defs::BALANCE,
            "generation.building_types.min_employers_per_profession",
        ) as u64;
        let floor = sim::balance::value(
            defs::BALANCE,
            "generation.building_types.profession_count_per_city_min",
        );

        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let mut employers: std::collections::BTreeMap<&str, u64> = std::collections::BTreeMap::new();
        for a in d.building_types.assignments() {
            let def = by_id[&a.building_type];
            if sim::generation::building_types::is_workplace(def) {
                for &p in def.professions {
                    *employers.entry(p).or_insert(0) += 1;
                }
            }
        }
        let depth = employers.values().filter(|&&c| c >= min_employers).count() as i64;
        prop_assert!(
            depth >= floor,
            "seed {seed}: this city's own profession depth {depth} is under the committed per-city floor {floor}"
        );
    }

    /// `inv_generation_barista_has_at_least_min_employers` (story 15.9,
    /// Derek's/Quentin's direction): `barista` is an FR14 launch job and
    /// is posted only at cafes, so moving cafes onto `cafe_present` must
    /// never leave one city with a barista held by fewer than
    /// `min_employers_per_profession` distinct workplaces -- asserted per
    /// seed by name, never left to the pooled profession-depth check.
    #[test]
    fn inv_generation_barista_has_at_least_min_employers(seed in any::<u64>()) {
        let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
        let content = GenerationContent::committed();
        let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let min_employers = sim::balance::value(
            defs::BALANCE,
            "generation.building_types.min_employers_per_profession",
        ) as usize;
        let d = sim::generation::plan(seed, &cfg, &content).unwrap();
        let baristas = d
            .building_types
            .assignments()
            .iter()
            .filter(|a| by_id[&a.building_type].professions.contains(&"barista"))
            .count();
        prop_assert!(
            baristas >= min_employers,
            "seed {seed}: barista is held by {baristas} workplaces, under min_employers_per_profession {min_employers}"
        );
    }
}

/// Derek's direction (PR #317 cycle 2): "the AC says *a* depot, *a*
/// council building, *a* hospital" -- each of the three singleton-
/// shaped rows (high ratio, `per`-tag governed) resolves to exactly one
/// placed subject, site-wide, across the fixed seed range 0..256, never
/// two. Read generically by the same `ratio >=
/// MULTI_INSTANCE_RATIO_CEILING` split `the_quadrant_floor_is_not_
/// vacuous_for_every_multi_instance_row_over_seeds_0_to_256` uses, never
/// a key list.
#[test]
fn the_three_singleton_ratios_resolve_to_about_one_across_the_measured_seed_range() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();

    const MULTI_INSTANCE_RATIO_CEILING: u32 = 250;
    let mut dist_rows: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            row.ratio >= MULTI_INSTANCE_RATIO_CEILING
                && content
                    .building_types
                    .iter()
                    .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    dist_rows.sort_by_key(|d| d.id);
    assert!(
        !dist_rows.is_empty(),
        "no committed row is >= the singleton-ratio ceiling -- the ceiling itself needs re-deriving, not a silently vacuous test"
    );

    for row in &dist_rows {
        let ratio = row.ratio.max(1) as u64;
        let mut min_actual = u64::MAX;
        let mut max_actual = 0u64;
        for seed in 0..256u64 {
            let d = sim::generation::plan(seed, &cfg, &content).unwrap();
            let mut per = 0u64;
            let mut actual = 0u64;
            for a in d.building_types.assignments() {
                let def = by_id[&a.building_type];
                if def.tags.contains(&row.per) {
                    per += 1;
                }
                if def.tags.contains(&row.subject) {
                    actual += 1;
                }
            }
            let target = per / ratio;
            assert_eq!(
                target, 1,
                "seed {seed}: rule {} has a basis of {per} over ratio {ratio}, giving target {target} != 1 -- the ratio no longer resolves to a singleton across this seed range",
                row.key
            );
            min_actual = min_actual.min(actual);
            max_actual = max_actual.max(actual);
        }
        assert_eq!(
            (min_actual, max_actual),
            (1, 1),
            "rule {}: placed count ranges [{min_actual}, {max_actual}] over seeds 0..256, never consistently exactly one",
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

/// The argmin and argmax seeds of the building-count distribution at
/// `GENERATION_VERSION` 9: the band sweep's (`measure-generation`, 50,000
/// seeds: min 768 / max 1,002) and the plot/envelope scan's (min 778 / max
/// 990), copied from the harness's output, never hunted for, and
/// re-taken whenever the generator moves. A generator change that shifts
/// the distribution fails deterministically, every run.
const PINNED_BUILDING_COUNT_SEEDS: [u64; 4] = [
    18_227_589_722_137_138_881,
    6_786_936_242_335_454_667,
    11_805_315_485_014_167_829,
    11_123_925_265_906_853_341,
];

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

/// Each pinned seed's own worst *exhaustive* pair (`detour_samples(
/// usize::MAX)`, the population `max_detour_excess_cells` is actually
/// keyed against -- never the cheap `DETOUR_SAMPLE_MAX_NODES` sample,
/// which is `inv_generation_detour_ratio_bounded`'s own job), asserted
/// by **equality** against `streets::PINNED_DETOUR_SEEDS`'s own recorded
/// figure -- never just an upper bound, so a pass-2 or streets-key
/// change that moves a pinned seed's own worst pair goes red here
/// instead of leaving a stale number sitting silently in a toml comment
/// (Quentin's direction, story 3.18 cycle 1). Each worst pair is also
/// asserted to still end on a boundary exit -- degree 1, on the site's
/// own boundary, the ordinary way every street ends, not a special "T-
/// terminated dead-end spur" case (Tim's direction: that framing was
/// wrong -- see `docs/generation.md`'s street-network pass) -- so this
/// pins the mechanism each seed was kept for too.
#[test]
fn detour_excess_holds_at_pinned_boundary_exit_seeds() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    for (seed, expected_exhaustive_excess) in streets::PINNED_DETOUR_SEEDS {
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let samples = net.detour_samples(usize::MAX);
        let worst = samples
            .iter()
            .max_by_key(|s| s.excess_cells())
            .unwrap_or_else(|| panic!("pinned seed {seed} sampled no pairs at all"));
        assert_eq!(
            worst.excess_cells(),
            expected_exhaustive_excess,
            "pinned seed {seed}: exhaustive worst pair {:?}-{:?} now measures {} cells, not \
             the pinned {expected_exhaustive_excess} -- pass 2 or a generation.streets.* key \
             moved this seed; re-run `cargo run -p bounds --release --bin measure-generation`, \
             re-apply max_detour_excess_cells's own margin rule, and update this seed's own \
             row in streets::PINNED_DETOUR_SEEDS",
            worst.a,
            worst.b,
            worst.excess_cells(),
        );
        let on_a_boundary_exit = |n: (i32, i32)| net.degree(n) == 1 && net.is_on_boundary(n);
        assert!(
            on_a_boundary_exit(worst.a) || on_a_boundary_exit(worst.b),
            "pinned seed {seed}: worst pair {:?}-{:?} no longer ends on a boundary exit (degree \
             1, on the site boundary) -- the mechanism this seed was pinned for moved; \
             re-measure and re-pin",
            worst.a,
            worst.b
        );
    }
}

/// Story 15.10: seed `8872365549107643721` failed `inv_generation_
/// detour_ratio_bounded` on CI run 36388555866 (PR #349) -- the pair
/// `(152,0)-(393,18)`, Manhattan 259, had a 204% ratio against the old,
/// independently-set `max_detour_percent` (200%) while its network
/// distance sat well under `manhattan + max_detour_excess_cells`: the
/// old AND-with-threshold contract could allow *less* additive excess to a
/// pair a few cells past `detour_long_pair_cells` than to one a few cells
/// short of it. Fixed at the source (`streets::detour_bound_violation`'s
/// own max()-contract), never a re-scan of this one seed. Story 4.21's
/// area-share land use moved every pass-2 network, so that pair no longer
/// exists on this seed; the pin now asserts the seed still clears the
/// committed contract. It is an ordinary regression pin, not the seam's
/// guard: the seam is held at the function by `streets::tests::detour_bound_
/// violation_has_no_seam_at_the_takeover_distance`.
#[test]
fn seed_8872365549107643721_holds_the_detour_ceilings() {
    const SEED: u64 = 8872365549107643721;
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    detour_bounds_hold(SEED, &cfg).unwrap_or_else(|e| panic!("pinned seed {SEED}: {e}"));
}

/// Quentin's direction, story 3.18 cycle 1: `max_detour_excess_cells`'s
/// own margin rule (its own `generation.toml` comment: the largest
/// pinned exhaustive excess, times 1.25, rounded up to a multiple of 8,
/// never above the loosening guard) was prose in three files and
/// arithmetic in none. Applied here mechanically against the live
/// committed config, so a retune that quietly stops following its own
/// stated rule goes red rather than only reading wrong on review.
/// Integer arithmetic throughout (NFR28): `* 5` then a ceiling `/ 4` is
/// exactly `* 1.25` rounded up (never a float), then a ceiling `/ 8 *
/// 8` rounds up to the next multiple of 8.
#[test]
fn max_detour_excess_cells_matches_its_own_margin_rule() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let largest_pinned_exhaustive_excess = streets::PINNED_DETOUR_SEEDS
        .iter()
        .map(|&(_, excess)| excess)
        .max()
        .expect("PINNED_DETOUR_SEEDS is never empty");
    let times_1_25 = (largest_pinned_exhaustive_excess * 5 + 3) / 4;
    let expected = (times_1_25 + 7) / 8 * 8;
    assert_eq!(
        cfg.max_detour_excess_cells as i64, expected,
        "max_detour_excess_cells ({}) no longer matches its own margin rule -- the largest \
         pinned exhaustive excess ({largest_pinned_exhaustive_excess}) times 1.25, rounded up \
         to a multiple of 8, is {expected}; re-derive by hand from `measure-generation`'s own \
         output and update generation.toml's own key (or this test, if the rule itself \
         changed)",
        cfg.max_detour_excess_cells
    );
    assert!(
        cfg.max_detour_excess_cells as i64 <= cfg.detour_excess_loosening_guard(),
        "max_detour_excess_cells ({}) exceeds its own loosening guard ({}) -- from_balance \
         should already have refused this",
        cfg.max_detour_excess_cells,
        cfg.detour_excess_loosening_guard()
    );
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
        building_age: 50,
        affluence: 50,
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
        building_age: 50,
        affluence: 50,
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
        building_age: 50,
        affluence: 50,
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
        building_age: 50,
        affluence: 50,
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
            building_age: 50,
            affluence: 50,
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

/// Companion to the min-spacing test above: 400 `villa`s in one catchment
/// plus one `council`, one `hospital`, two `welfare_office`s and two
/// `shelter`s in the same catchment satisfy every row but one -- and zero
/// `depot`s: a whole-site row with no subject reports every dwelling
/// uncovered, so `depot_present` is the one row violated. (A catchment row
/// tolerates an empty catchment, its lower bound being 0; a site row never
/// tolerates an absent institution.) All `form_low`, one area, so the
/// coherence row stays silent too.
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
        .find(|r| r.key == "depot_present")
        .expect("committed content carries a 'depot_present' distribution row");

    // 400 dwellings on a 20x20 grid, spaced 12 cells apart on each axis.
    let mut footprints = Vec::new();
    for row_i in 0..20i32 {
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
    // One depot, one council, one hospital, two welfare_offices, placed
    // below the dwelling grid in the same catchment, well spaced from
    // each other (min_spacing never enters this test's own scope).
    let extra_keys = [
        "council",
        "hospital",
        "welfare_office",
        "welfare_office",
        "shelter",
        "shelter",
    ];
    for (i, &key) in extra_keys.iter().enumerate() {
        let x0 = (i as i32) * 60;
        let y0 = 244;
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
            building_age: 50,
            affluence: 50,
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
        .expect_err("400 dwellings, every other institution present, and zero depots must violate depot_present");
    match err {
        sim::generation::GenerationError::RuleViolations { first, .. } => {
            assert_eq!(
                first.rule_id, row.id,
                "the reported violation must name depot_present's own rule id"
            );
            assert_eq!(first.catchment, None, "a site row names no catchment");
        }
        other => panic!("expected RuleViolations, got {other:?}"),
    }
}

/// Story 4.21: seed `16021368561388801292` once failed
/// `inv_generation_workplace_count_within_tolerance` on CI: 539 workplaces
/// against a 171-514 band (about 6.5 sigma). Pass 5 was behaving as on any
/// seed; pass 1 had given commercial 33.3% of the site's coarse cells
/// against `share_commercial_pct = 18`, because the share keys were applied
/// to the count of BSP leaves rather than to their area. A plain,
/// non-random pin: it must hold under every property, and a `cc` entry in
/// `invariants.proptest-regressions` would pin the generator's RNG state,
/// not this world seed, so a strategy change would silently re-map it.
#[test]
fn seed_16021368561388801292_holds_its_commercial_share_and_workplace_band() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let content = GenerationContent::committed();
    let seed = 16021368561388801292u64;
    let d = sim::generation::generate(seed, &cfg, &content)
        .unwrap_or_else(|e| panic!("seed {seed}: generate is no longer Ok: {e:?}"));
    d.check_workplace_count(&cfg, &content)
        .unwrap_or_else(|e| panic!("seed {seed}: workplace count outside its band: {e:?}"));
    let lu = &d.land_use;
    assert_eq!(
        lu.share_band_violation(&cfg),
        None,
        "seed {seed}: a land-use share is outside share_tolerance_pct (commercial {} of {} cells)",
        lu.area_cells(land_use::LandUse::Commercial),
        lu.cols() * lu.rows()
    );
}

/// Seed pins for the missing-cafe flake: plain, non-random world seeds,
/// never `invariants.proptest-regressions` `cc` entries (a `cc` entry pins
/// the generator's RNG state, not the world seed, so a strategy change
/// would silently re-map it). Each calls the same body as the property.
/// `5671826158575195197` (174 cafe-eligible envelopes, no cafe drawn)
/// failed `master` before story 15.9 moved cafe onto `cafe_present`; the
/// other four were green on `master` when pinned and stay as guards.
#[test]
fn seed_5671826158575195197_places_a_cafe() {
    assert_required_institutions(5671826158575195197).unwrap();
}

#[test]
fn seed_18237087621053529407_places_a_cafe() {
    assert_required_institutions(18237087621053529407).unwrap();
}

#[test]
fn seed_10570461036942086058_places_a_cafe() {
    assert_required_institutions(10570461036942086058).unwrap();
}

#[test]
fn seed_5893400460575277432_places_a_cafe() {
    assert_required_institutions(5893400460575277432).unwrap();
}

#[test]
fn seed_6617268145519561593_places_a_cafe() {
    assert_required_institutions(6617268145519561593).unwrap();
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
            building_age: 50,
            affluence: 50,
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
        building_age: 50,
        affluence: 50,
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
        affluence_min: 0,
        affluence_max: 100,
        min_interior_width_cells: 6,
        min_interior_depth_cells: 6,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
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
        affluence_min: 0,
        affluence_max: 100,
        min_interior_width_cells: 20,
        min_interior_depth_cells: 20,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
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
/// generator pools to ~100%, this one to ~289% at `GENERATION_VERSION` 9
/// (Quentin's direction,
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

/// The lowest per-city ratios known at `GENERATION_VERSION` 9, pinned so
/// raising `peripheral_low_band_floor_percent` above them fails every run
/// rather than one in N. Low-band mean over high-band mean, the three
/// lowest of 1,000,000 seeds drawn through `seed_from_ids(0x5ca9, i)`
/// (per-city p1 167%, p5 195%, median 276%): seed 5955473505560313928,
/// 3086 / 3840 (80.4%); seed 12341508193973285094, 2347 / 2477 (94.7%);
/// seed 16477458686111781630, 2163 / 2272 (95.2%).
#[test]
fn peripheral_floor_clears_the_lowest_known_ratio_seeds() {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    for seed in [
        5955473505560313928u64,
        12341508193973285094,
        16477458686111781630,
    ] {
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let (low, high) = net
            .mean_area_by_density_band(&lu, &cfg)
            .expect("both density bands are populated for this seed");
        assert!(
            low * 100 >= high * cfg.peripheral_low_band_floor_percent as i64,
            "seed {seed}: low-band mean {low} is under {}% of high-band mean {high}",
            cfg.peripheral_low_band_floor_percent
        );
    }
}

/// What binds peripheral block size is density, not the pass-1 leaf
/// layout: pooled over the fixed seed range `0..256`, at most
/// `MAX_POOLED_CHOPPED_PERCENT` of the blocks in the bottom density third
/// may have an area at or under a quarter of their own local
/// `target_block_size` squared. A ratio cannot tell "periphery is small"
/// from "periphery is chopped"; this can. Measured with this same
/// counting rule pooled over 0..256: `GENERATION_VERSION` 8 (master at
/// `f6ad0570`, region-spanning rule) 7,458 of 9,761 blocks, 76%;
/// `GENERATION_VERSION` 9 1,886 of 5,600, 33%. 55 is midway between the
/// two, so the bound separates the generators rather than fitting the
/// newer one. Pooled rather than per city because the per-city share is
/// too wide to separate them (1,000,000 seeds at 9: median 33%, p99 67%,
/// max 88%). Not a balance key: only this test reads it.
#[test]
fn peripheral_blocks_pooled_chopped_share_stays_bounded() {
    const MAX_POOLED_CHOPPED_PERCENT: usize = 55;
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let (mut chopped_sum, mut total_sum) = (0usize, 0usize);
    for seed in 0u64..256 {
        let lu = land_use::run(seed, cfg.site(), &cfg).unwrap();
        let net = streets::run(seed, &lu, &cfg);
        let (chopped, total) = net.low_band_chopped_blocks(&lu, &cfg);
        chopped_sum += chopped;
        total_sum += total;
    }
    assert!(
        chopped_sum * 100 <= total_sum * MAX_POOLED_CHOPPED_PERCENT,
        "pooled over seeds 0..256: {chopped_sum} of {total_sum} low-density blocks are at or under a quarter of their own target's area, over {MAX_POOLED_CHOPPED_PERCENT}%"
    );
}

// Story 3.11: the travel-time estimator (FR131). A handful of integer ops
// per case, so 4,096 cases are pinned here rather than inherited.
fn rates() -> Rates {
    Rates::from_balance(defs::BALANCE)
}

fn arb_mode() -> impl Strategy<Value = TransportMode> {
    prop_oneof![
        Just(TransportMode::Walk),
        Just(TransportMode::Bike),
        Just(TransportMode::Transit)
    ]
}

fn arb_point() -> impl Strategy<Value = Point> {
    (any::<i32>(), any::<i32>(), any::<i8>()).prop_map(|(x, y, floor)| Point { x, y, floor })
}

fn arb_correction() -> impl Strategy<Value = Correction> {
    (Correction::MIN_PERCENT..=Correction::MAX_PERCENT)
        .prop_map(|p| Correction::percent(p).unwrap())
}

fn est(a: Point, b: Point, m: TransportMode) -> i64 {
    estimate(&rates(), a, b, m, Correction::NONE).0
}

fn est_c(a: Point, b: Point, m: TransportMode, c: Correction) -> i64 {
    estimate(&rates(), a, b, m, c).0
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 4096, ..persisted() })]

    /// `inv_estimate_is_a_metric`.
    #[test]
    fn inv_estimate_is_a_metric(
        a in arb_point(), b in arb_point(), c in arb_point(), m in arb_mode(),
        floor in any::<i8>(), k in arb_correction(),
    ) {
        let (a, b, c) = (Point { floor, ..a }, Point { floor, ..b }, Point { floor, ..c });
        prop_assert_eq!(est_c(a, b, m, k) == 0, a == b);
        prop_assert_eq!(est_c(a, b, m, k), est_c(b, a, m, k));
        prop_assert!(est_c(a, c, m, k) <= est_c(a, b, m, k) + est_c(b, c, m, k));
    }

    /// The triangle inequality across floors too: the correction is applied
    /// once, so the floor penalty rounds with the travel time.
    #[test]
    fn inv_estimate_is_a_metric_across_floors(
        a in arb_point(), b in arb_point(), c in arb_point(), m in arb_mode(), k in arb_correction(),
    ) {
        prop_assert!(est_c(a, c, m, k) <= est_c(a, b, m, k) + est_c(b, c, m, k));
    }

    /// `inv_estimate_is_origin_independent`.
    #[test]
    fn inv_estimate_is_origin_independent(
        a in arb_point(), b in arb_point(), dx in any::<i32>(), dy in any::<i32>(), m in arb_mode(),
        k in arb_correction(),
    ) {
        let shift = |p: Point| Point { x: p.x.wrapping_add(dx), y: p.y.wrapping_add(dy), ..p };
        // A wrapped shift is not a translation; only compare when neither moved out of i32.
        let ok = |p: Point| p.x.checked_add(dx).is_some() && p.y.checked_add(dy).is_some();
        est_c(a, b, m, k); // total for any input
        if ok(a) && ok(b) {
            prop_assert_eq!(est_c(a, b, m, k), est_c(shift(a), shift(b), m, k));
        }
    }

    /// `inv_faster_mode_never_costs_more`.
    #[test]
    fn inv_faster_mode_never_costs_more(
        a in arb_point(), b in arb_point(), m1 in arb_mode(), m2 in arb_mode(), k in arb_correction(),
    ) {
        let r = rates();
        let (fast, slow) = if r.percent(m1) >= r.percent(m2) { (m1, m2) } else { (m2, m1) };
        let (ef, es) = (est_c(a, b, fast, k), est_c(a, b, slow, k));
        prop_assert!(ef <= es);
        let manhattan = (a.x as i64 - b.x as i64).abs() + (a.y as i64 - b.y as i64).abs();
        // One cell already differs by tens of milliminutes between modes.
        if manhattan >= 1 && r.percent(fast) > r.percent(slow) {
            prop_assert!(ef < es);
        }
    }

    /// `inv_floor_penalty_is_additive_and_flat`.
    #[test]
    fn inv_floor_penalty_is_additive_and_flat(a in arb_point(), b in arb_point(), m in arb_mode(), f2 in any::<i8>()) {
        let same = Point { floor: a.floor, ..b };
        let other = Point { floor: f2, ..b };
        let floors = (a.floor as i64 - f2 as i64).abs();
        prop_assert_eq!(
            est(a, other, m) - est(a, same, m),
            floors * rates().floor_change_penalty_milliminutes
        );
    }
}

// --- Story 4.1: the in-city clock (FR1-FR3) ---------------------------------

pub const INV_CITY_TIME_DEPENDS_ONLY_ON_ELAPSED: &str = "the in-city delta between two instants is floor((t2-e)/k) - floor((t1-e)/k) whatever the epoch's own value, so in-city time advances exactly with elapsed real time at the fixed rate (FR1, FR3)";
pub const INV_CITY_TIME_CONVERSION_EXACT: &str = "the day/hour/minute decomposition round-trips to the total minute count for every instant, including before the epoch and beyond i32/u32 milliseconds, with every field in range and no panic (FR1)";
pub const INV_CITY_HOUR_DEPENDS_ONLY_ON_REAL_HOUR_PHASE: &str = "in-city time of day depends only on elapsed real milliseconds modulo one real hour, so the same real hh:mm on any two days gives the same in-city hour, while a session rotates through the day (FR1, FR2)";

/// Microsecond instants kept where two of them and an epoch cannot overflow
/// the plain `i64` reference arithmetic the oracle below uses.
const CLOCK_RANGE: i64 = 1 << 60;

proptest! {
    #![proptest_config(persisted())]
    /// `inv_city_time_depends_only_on_elapsed`.
    #[test]
    fn inv_city_time_depends_only_on_elapsed(
        e in -CLOCK_RANGE..CLOCK_RANGE,
        t1 in -CLOCK_RANGE..CLOCK_RANGE,
        t2 in -CLOCK_RANGE..CLOCK_RANGE,
    ) {
        let k = sim::time::REAL_MS_PER_CITY_MINUTE;
        let oracle = |t: i64| (t - e).div_euclid(1000).div_euclid(k);
        let delta = sim::time::city_time(e, t2, 1).total_minutes()
            - sim::time::city_time(e, t1, 1).total_minutes();
        prop_assert_eq!(delta, oracle(t2) - oracle(t1));
    }

    /// `inv_city_time_conversion_exact`.
    #[test]
    fn inv_city_time_conversion_exact(e in any::<i64>(), t in any::<i64>()) {
        let c = sim::time::city_time(e, t, 1);
        prop_assert!(c.hour < 24 && c.minute < 60 && c.weekday < 7);
        prop_assert!((c.real_ms_into_minute as i64) < sim::time::REAL_MS_PER_CITY_MINUTE);
        prop_assert_eq!(c.weekday as i64, c.day.rem_euclid(7));
        let elapsed_ms = (t as i128 - e as i128).div_euclid(1000);
        let rebuilt = c.total_minutes() as i128 * sim::time::REAL_MS_PER_CITY_MINUTE as i128
            + c.real_ms_into_minute as i128;
        prop_assert_eq!(rebuilt, elapsed_ms);
    }

    /// `inv_city_hour_depends_only_on_real_hour_phase`.
    #[test]
    fn inv_city_hour_depends_only_on_real_hour_phase(
        e in -CLOCK_RANGE..CLOCK_RANGE,
        t in 0i64..CLOCK_RANGE,
        days in 0i64..10_000,
    ) {
        let real_day_us = 24 * 3_600_000i64 * 1000;
        let a = sim::time::city_time(e, e + t, 1);
        let b = sim::time::city_time(e, e + t + days * real_day_us, 1);
        prop_assert_eq!((a.hour, a.minute, a.real_ms_into_minute), (b.hour, b.minute, b.real_ms_into_minute));
        // A 30-minute session crosses half the in-city day.
        let later = sim::time::city_time(e, e + t + 30 * 60 * 1_000_000, 1);
        let moved = (later.total_minutes() - a.total_minutes()) as i64;
        prop_assert_eq!(moved, 720);
    }
}

/// Fixture: catchment (0, 0) holds four dwellings and no commercial land,
/// catchment (1, 0) three well-spaced shop candidates and no dwellings;
/// returns how many shops pass 5 places under a row of the given scope.
fn starved_catchment_placed_shops(scope: sim::rules::DistributionScope) -> usize {
    const DWELLING_TAG: TagId = 9301;
    const SHOP_TAG: TagId = 9302;
    let dwelling_type = defs::BuildingTypeDef {
        id: 9401,
        key: "test_dwelling",
        tags: &[DWELLING_TAG],
        land_uses: [true, false, false, false],
        density_min: 0,
        density_max: 100,
        affluence_min: 0,
        affluence_max: 100,
        min_interior_width_cells: 4,
        min_interior_depth_cells: 4,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    };
    // `weight = 0`, exactly like the real `cafe` building type
    // (story 15.9): only the distribution row below ever assigns
    // this type, never the ordinary weighted fill.
    let shop_type = defs::BuildingTypeDef {
        id: 9402,
        key: "test_shop",
        tags: &[SHOP_TAG],
        land_uses: [false, true, false, false],
        density_min: 0,
        density_max: 100,
        affluence_min: 0,
        affluence_max: 100,
        min_interior_width_cells: 4,
        min_interior_depth_cells: 4,
        weight: 0,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &["test_clerk"],
    };
    // The ordinary fill's own baseline draw for every commercial
    // envelope -- `shop_type`'s own `weight = 0` means this is the
    // only real candidate the fill itself can ever pick, so every
    // commercial envelope not overridden onto `shop_type` stays
    // this type instead, the same as `general_retail` does for a
    // real, un-overridden commercial plot.
    let filler_type = defs::BuildingTypeDef {
        id: 9403,
        key: "test_filler",
        tags: &[],
        land_uses: [false, true, false, false],
        density_min: 0,
        density_max: 100,
        affluence_min: 0,
        affluence_max: 100,
        min_interior_width_cells: 4,
        min_interior_depth_cells: 4,
        weight: 1,
        requires_site: [false, false, false, false],
        prefers_site: [false, false, false, false],
        density_affinity: 0,
        professions: &[],
    };
    let building_types = [dwelling_type, shop_type, filler_type];
    let rules = [sim::rules::RuleDef {
        id: 9501,
        key: "test_shop_present",
        kind: sim::rules::RuleKind::Distribution {
            subject: SHOP_TAG,
            per: DWELLING_TAG,
            ratio: 2,
            tolerance_percent: 20,
            min_spacing: 1,
            max_distance: 2000,
            scope,
            reads: None,
        },
    }];
    let content = GenerationContent {
        rules: sim::rules::RuleSet::for_test(&rules),
        building_types: &building_types,
    };

    // Catchment (0, 0): 4 dwellings, no commercial land at all --
    // its own floor (4 / 2 = 2) already equals the whole site
    // target, but it cannot supply any of it itself.
    let mut plots = Vec::new();
    let mut outcomes = Vec::new();
    for i in 0..4i32 {
        let footprint = Rect {
            x0: i * 10,
            y0: 0,
            x1: i * 10 + 6,
            y1: 6,
        };
        plots.push(sim::generation::Plot {
            bounds: footprint,
            block: 0,
            front: Some(sim::generation::Side::South),
            land_use: sim::generation::LandUse::Residential,
            density: 20,
            building_age: 50,
            affluence: 50,
            open: false,
        });
        outcomes.push(sim::generation::EnvelopeOutcome::Placed(
            sim::generation::Envelope {
                plot: plots.len() as u32 - 1,
                footprint,
                front: sim::generation::Side::South,
            },
        ));
    }
    // Catchment (1, 0): no dwellings, 3 hard-eligible shop
    // candidates, well spaced from each other.
    for i in 0..3i32 {
        let footprint = Rect {
            x0: 300 + i * 20,
            y0: 0,
            x1: 300 + i * 20 + 6,
            y1: 6,
        };
        plots.push(sim::generation::Plot {
            bounds: footprint,
            block: 1,
            front: Some(sim::generation::Side::South),
            land_use: sim::generation::LandUse::Commercial,
            density: 20,
            building_age: 50,
            affluence: 50,
            open: false,
        });
        outcomes.push(sim::generation::EnvelopeOutcome::Placed(
            sim::generation::Envelope {
                plot: plots.len() as u32 - 1,
                footprint,
                front: sim::generation::Side::South,
            },
        ));
    }

    let site = sim::generation::SiteBounds {
        x0: 0,
        y0: 0,
        x1: 512,
        y1: 512,
    };
    let pm = plots::PlotMap::test_fixture(site, plots);
    let em = envelopes::EnvelopeMap::test_fixture(outcomes);
    let net = streets::StreetNetwork::test_fixture(
        site,
        Vec::new(),
        vec![
            sim::generation::Block {
                bounds: Rect {
                    x0: 0,
                    y0: 0,
                    x1: 256,
                    y1: 256,
                },
            },
            sim::generation::Block {
                bounds: Rect {
                    x0: 256,
                    y0: 0,
                    x1: 512,
                    y1: 256,
                },
            },
        ],
    );
    let c = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    let map = sim::generation::building_types::run(1, &em, &pm, &net, &c, &content); // generation-entry-point: allow
    map.assignments()
        .iter()
        .filter(|a| a.building_type == shop_type.id)
        .count()
}

/// A site row owes the whole district one target, placed wherever eligible
/// land is: the starved catchment's share comes from the other.
#[test]
fn a_site_row_places_its_target_from_whichever_catchment_holds_eligible_land() {
    assert_eq!(
        starved_catchment_placed_shops(sim::rules::DistributionScope::Site),
        2
    );
}

/// A catchment row owes each catchment its own share from its own land: a
/// starved catchment is left short, never padded from a neighbour
/// (`check_rules` reports it).
#[test]
fn a_catchment_row_never_pads_a_starved_catchment_from_a_neighbour() {
    assert_eq!(
        starved_catchment_placed_shops(sim::rules::DistributionScope::Catchment {
            extent_cells: 256
        }),
        0
    );
}

// --- story 4.2: the one scheduled-reducer repeat pattern (sim::cadence) --

proptest! {
    #![proptest_config(persisted())]
    /// `inv_schedule_phase_preserved`: whatever `origin`/`period_ms`/`now`
    /// are, the returned target is always exactly `origin + k * period_ms`
    /// microseconds for some integer `k` -- congruent to `origin` modulo
    /// the period, so chaining calls (each one's own `origin` is the
    /// previous call's `target`) can never drift off the grid the very
    /// first call established.
    #[test]
    fn inv_schedule_phase_preserved(
        origin in any::<i64>(),
        period_ms in 1i64..=1_000_000_000,
        now in any::<i64>(),
    ) {
        let (target, _missed) = cadence::next_target(origin, period_ms, 1, now);
        let period_micros = period_ms as i128 * 1000;
        let delta = target as i128 - origin as i128;
        prop_assert_eq!(delta.rem_euclid(period_micros), 0);
    }

    /// `inv_schedule_never_targets_past`: over a reasonable range (not the
    /// extremes `inv_schedule_arith_total` covers, where saturating
    /// arithmetic can no longer promise it), the returned target is
    /// always strictly after `now` -- a target already in the past can
    /// never be reinserted, so no back-to-back burst is possible.
    #[test]
    fn inv_schedule_never_targets_past(
        origin in -1_000_000_000_000i64..=1_000_000_000_000,
        period_ms in 1i64..=1_000_000_000,
        now in -1_000_000_000_000i64..=1_000_000_000_000,
    ) {
        let (target, _missed) = cadence::next_target(origin, period_ms, 1, now);
        prop_assert!(target > now);
    }

    /// `inv_schedule_never_returns_its_own_origin`: over the same
    /// reasonable range, the returned target is always strictly after
    /// `origin` too -- including when `now` lands before `origin` (an
    /// early dispatch, which nothing forbids): the origin itself is
    /// already due, so re-arming onto it would fire the same grid point
    /// twice.
    #[test]
    fn inv_schedule_never_returns_its_own_origin(
        origin in -1_000_000_000_000i64..=1_000_000_000_000,
        period_ms in 1i64..=1_000_000_000,
        now in -1_000_000_000_000i64..=1_000_000_000_000,
    ) {
        let (target, _missed) = cadence::next_target(origin, period_ms, 1, now);
        prop_assert!(target > origin);
    }

    /// `inv_schedule_catch_up_bounded`: seeded a simulated week behind (a
    /// pause far longer than any real cadence period), the call still
    /// returns in O(1) -- no loop for a proptest time budget to catch,
    /// exactly Quentin's own point -- with `missed` equal to the exact
    /// arithmetic gap in whole periods, and the returned target itself is
    /// still the very next grid point after `now`, never a burst of
    /// intermediate ones.
    #[test]
    fn inv_schedule_catch_up_bounded(
        origin in -1_000_000_000_000i64..=1_000_000_000_000,
        period_ms in 1i64..=100_000,
    ) {
        const ONE_WEEK_MICROS: i64 = 7 * 24 * 60 * 60 * 1_000_000;
        let now = origin + ONE_WEEK_MICROS;
        let (target, missed) = cadence::next_target(origin, period_ms, 1, now);
        let period_micros = period_ms as i128 * 1000;
        let expected_missed = (ONE_WEEK_MICROS as i128).div_euclid(period_micros);
        prop_assert_eq!(missed as i128, expected_missed);
        prop_assert!(target > now);
        prop_assert!((target as i128 - now as i128) <= period_micros);
    }

    /// `inv_schedule_arith_total` (NFR41): never panics, never wraps, for
    /// any `i64` origin/now -- including `i64::MIN`/`i64::MAX` -- and any
    /// positive `period_ms`. The published profile runs with
    /// `overflow-checks` on, so a wrapping bug here would abort the
    /// module's own heartbeat every period, forever.
    #[test]
    fn inv_schedule_arith_total(
        origin in any::<i64>(),
        period_ms in 1i64..=i64::MAX,
        now in any::<i64>(),
    ) {
        let _ = cadence::next_target(origin, period_ms, 1, now);
    }
}

/// A deterministic supplement to `inv_schedule_arith_total`'s randomised
/// coverage: the exact extreme combinations (not merely "probably hit
/// eventually" by `any::<i64>()`), pinned so they are never dropped by a
/// future change to proptest's own case count.
#[test]
fn schedule_next_target_at_the_extremes_never_panics() {
    for &origin in &[i64::MIN, i64::MAX, 0] {
        for &now in &[i64::MIN, i64::MAX, 0] {
            for &period_ms in &[1i64, cadence::MIN_PERIOD_MS, i64::MAX] {
                let _ = cadence::next_target(origin, period_ms, 1, now);
            }
        }
    }
}

// --- Story 4.3: time control (FR163) -----------------------------------------

pub const INV_JUMP_PRESERVES_CITY_TIME_ARITHMETIC: &str = "for any epoch, any positive jump and any now, city_time(jumped_epoch, now) equals city_time(epoch, now + delta) field for field, never panicking or wrapping, over the whole i64 range (FR163, NFR41)";
pub const INV_JUMP_NEVER_DROPS_A_FIRE: &str = "for any cadence origin, period and jumped interval, the skipped grid points sim::cadence counts equal a brute-force enumeration of them, in ascending city-minute order, and a target the cadence had already passed is never counted (FR163)";
pub const INV_MULTIPLIER_SWITCH_IS_CONTINUOUS: &str = "at the instant a multiplier changes the whole city minute is unchanged, and thereafter exactly k city minutes elapse per k new-speed minutes, so switching speeds back and forth never moves the clock backward or skips a minute (FR163)";

/// Every valid clock multiplier (`sim::time::validate_speed`).
fn valid_speeds() -> Vec<u32> {
    (1..=sim::time::MAX_CLOCK_SPEED)
        .filter(|&s| sim::time::validate_speed(s).is_ok())
        .collect()
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_jump_preserves_city_time_arithmetic`.
    #[test]
    fn inv_jump_preserves_city_time_arithmetic(
        epoch in any::<i64>(),
        now in any::<i64>(),
        minutes in 1u32..=sim::time::MAX_JUMP_CITY_MINUTES,
        speed_at in 0usize..11,
    ) {
        let speeds = valid_speeds();
        let speed = speeds[speed_at % speeds.len()];
        let jumped = sim::time::jumped_epoch(epoch, minutes, speed);
        let delta = minutes as i128 * sim::time::micros_per_city_minute(speed) as i128;
        // Only where nothing saturates: the reference arithmetic is exact.
        prop_assume!(epoch as i128 - delta >= i64::MIN as i128);
        prop_assume!(now as i128 + delta <= i64::MAX as i128);
        prop_assert_eq!(
            sim::time::city_time(jumped, now, speed),
            sim::time::city_time(epoch, (now as i128 + delta) as i64, speed)
        );
    }

    /// `inv_jump_preserves_city_time_arithmetic`: totality at the extremes.
    #[test]
    fn jump_arithmetic_is_total(epoch in any::<i64>(), now in any::<i64>(), minutes in any::<u32>(), speed in any::<u32>()) {
        let jumped = sim::time::jumped_epoch(epoch, minutes, speed);
        let _ = sim::time::city_time(jumped, now, speed);
        let _ = sim::time::reanchor(epoch, now, speed, minutes);
    }

    /// `inv_jump_never_drops_a_fire`. The pending target is drawn from
    /// the whole range a live row can hold: long past `now` (already due,
    /// undispatched) through well ahead of it.
    #[test]
    fn inv_jump_never_drops_a_fire(
        origin in -1_000_000_000i64..1_000_000_000,
        period_minutes in 1i64..=60,
        speed_at in 0usize..11,
        now_offset in -10_000_000i64..200_000_000,
        pending in 1i64..=400,
        jump_minutes in 1i64..=2_000,
    ) {
        let speeds = valid_speeds();
        let speed = speeds[speed_at % speeds.len()];
        let period_ms = cadence::period_ms(period_minutes);
        let now = origin + now_offset;
        let jump_micros = jump_minutes * sim::time::micros_per_city_minute(speed);
        let plan = cadence::replay_plan(
            origin, &[(period_ms, pending as i128)], speed, now, jump_micros, u64::MAX,
        )
        .expect("no cap");
        // Brute force: every grid point from the pending one, up to the
        // jumped-to instant.
        let mut expected = Vec::new();
        let mut index = pending;
        while cadence::grid_point(origin, period_ms, speed, index) <= now + jump_micros {
            expected.push(index);
            index += 1;
        }
        let got: Vec<i64> = plan.iter().map(|r| r.index).collect();
        prop_assert_eq!(&got, &expected);
        prop_assert!(plan.windows(2).all(|w| w[0].city_minute < w[1].city_minute));
    }

    /// The minute a replayed tick is handed is the minute the live tick for
    /// the same grid point is handed.
    #[test]
    fn replayed_and_live_ticks_get_the_same_city_minute(
        origin in -1_000_000_000_000i64..1_000_000_000_000,
        period_minutes in 1i64..=60,
        speed_at in 0usize..11,
        index in 1i64..=5_000,
    ) {
        let speeds = valid_speeds();
        let speed = speeds[speed_at % speeds.len()];
        let period_ms = cadence::period_ms(period_minutes);
        let at = cadence::grid_point(origin, period_ms, speed, index);
        let live = cadence::city_minute_of(origin, speed, at);
        let plan = cadence::replay_plan(
            origin, &[(period_ms, index as i128)], speed, at, 0, u64::MAX,
        )
        .expect("no cap");
        prop_assert_eq!(plan.len(), 1);
        prop_assert_eq!(plan[0].city_minute, live);
        prop_assert_eq!(live, index * period_minutes);
    }

    /// The merged plan across cadences is ordered and its size is the sum
    /// of the parts.
    #[test]
    fn jump_plan_is_ordered_across_cadences(
        a in 1i64..=30, b in 1i64..=30, jump_minutes in 1i64..=1_000,
    ) {
        let (pa, pb) = (cadence::period_ms(a), cadence::period_ms(b));
        let jump = jump_minutes * sim::time::REAL_MS_PER_CITY_MINUTE * 1000;
        let both = cadence::replay_plan(0, &[(pa, 1), (pb, 1)], 1, 0, jump, u64::MAX).expect("no cap");
        let one = cadence::replay_plan(0, &[(pa, 1)], 1, 0, jump, u64::MAX).expect("no cap");
        let two = cadence::replay_plan(0, &[(pb, 1)], 1, 0, jump, u64::MAX).expect("no cap");
        prop_assert_eq!(both.len(), one.len() + two.len());
        prop_assert!(both.windows(2).all(|w| (w[0].city_minute, w[0].cadence) <= (w[1].city_minute, w[1].cadence)));
    }

    /// `inv_multiplier_switch_is_continuous`.
    #[test]
    fn inv_multiplier_switch_is_continuous(
        epoch in -CLOCK_RANGE..CLOCK_RANGE,
        // Small enough that a 100x -> 1x switch's epoch does not saturate i64.
        now_offset in 0i64..(1 << 50),
        from_at in 0usize..11,
        to_at in 0usize..11,
        k in 1i64..=500,
    ) {
        let speeds = valid_speeds();
        let (from, to) = (speeds[from_at % speeds.len()], speeds[to_at % speeds.len()]);
        let now = epoch + now_offset;
        let reanchored = sim::time::reanchor(epoch, now, from, to);
        let before = sim::time::city_time(epoch, now, from);
        let at = sim::time::city_time(reanchored, now, to);
        prop_assert_eq!((before.day, before.hour, before.minute), (at.day, at.hour, at.minute));
        // Thereafter exactly k minutes per k new-speed minutes.
        let step = sim::time::micros_per_city_minute(to);
        let later = sim::time::city_time(reanchored, now + k * step, to);
        prop_assert_eq!(later.total_minutes(), at.total_minutes() + k);
        // Never backward, and never more than one minute in one microsecond.
        let next = sim::time::city_time(reanchored, now + 1, to);
        prop_assert!(next.total_minutes() - at.total_minutes() <= 1 && next.total_minutes() >= at.total_minutes());
        // And back again is continuous too.
        let back = sim::time::reanchor(reanchored, now, to, from);
        prop_assert_eq!(sim::time::city_time(back, now, from).total_minutes(), before.total_minutes());
    }
}

/// Story 6.2 (FR87): holders across all five kinds, including two business
/// instances (sharing one brand and one building, neither of which is part
/// of a holder) and one numeric id under every kind.
fn stock_holders() -> Vec<sim::stock::HolderRef> {
    use sim::codes::holder_kind as k;
    let pairs = [
        (k::BUSINESS, 1),
        (k::BUSINESS, 2),
        (k::BUSINESS, 7),
        (k::CITIZEN, 1),
        (k::CITIZEN, 7),
        (k::VEHICLE, 7),
        (k::BUILDING, 7),
        (k::MUNICIPAL_FACILITY, 7),
    ];
    pairs
        .into_iter()
        .map(|(kind, id)| sim::stock::HolderRef::new(kind, id).unwrap())
        .collect()
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_stock_is_independent_per_holder`: the oracle is an independent
    /// per-holder map replayed alone, never the ledger checked against
    /// itself; the ledger keeps one row per (holder, item) and none at zero.
    #[test]
    fn inv_stock_is_independent_per_holder(
        ops in proptest::collection::vec(
            (
                0usize..8,
                0u32..5,
                any::<bool>(),
                prop_oneof![0u64..20, Just(u64::MAX), (u64::MAX - 10)..=u64::MAX],
            ),
            0..80,
        )
    ) {
        use std::collections::BTreeMap;
        use sim::author::{Author, Cause};
        use sim::stock::{Made, plan_consume, plan_make};
        use support::stock_ledger::Ledger;

        let make = Author::new(1, Cause::ProcedureStep).unwrap();
        let eat = Author::new(2, Cause::Consumption).unwrap();
        let holders = stock_holders();
        let mut ledger = Ledger::default();
        for &(h, item, deposit, amount) in &ops {
            let holder = holders[h];
            if deposit {
                // An overflow is refused whole: nothing is written.
                if let Ok(Made::Done(w)) = plan_make(ledger.lines(), make, holder, item, amount) {
                    ledger.apply(&w);
                }
            } else {
                let w = plan_consume(ledger.lines(), eat, holder, item, amount).unwrap();
                ledger.apply(&w.write);
            }
        }

        for (i, &holder) in holders.iter().enumerate() {
            // Five items are ever used, well under the line ceiling.
            let mut model: BTreeMap<u32, u64> = BTreeMap::new();
            for &(_, item, deposit, amount) in ops.iter().filter(|o| o.0 == i) {
                let held = model.get(&item).copied().unwrap_or(0);
                let next = if deposit {
                    held.checked_add(amount).unwrap_or(held)
                } else {
                    held.saturating_sub(amount)
                };
                if next == 0 {
                    model.remove(&item);
                } else {
                    model.insert(item, next);
                }
            }
            let mut actual: BTreeMap<u32, u64> = BTreeMap::new();
            for line in ledger.lines().iter().filter(|l| l.holder == holder) {
                prop_assert!(line.quantity > 0, "a stored line is never zero");
                prop_assert!(
                    actual.insert(line.item_id, line.quantity).is_none(),
                    "two rows for one (holder, item)"
                );
            }
            prop_assert_eq!(actual, model);
        }
    }
}

/// One authored stock operation of a generated sequence. The cause is
/// drawn independently of the verb, so a consumption is also driven into a
/// make and a move, and a procedure step into a take.
#[derive(Debug, Clone, Copy)]
struct StockOp {
    /// 0 make, 1 consume, 2 up-to transfer, 3 exact transfer, 4 a lot of
    /// two lines moved in full or not at all.
    verb: u8,
    consumption: bool,
    from: usize,
    to: usize,
    item: u32,
    amount: u64,
    /// The second line of a lot.
    item2: u32,
    amount2: u64,
    citizen: u64,
}

impl StockOp {
    /// The lot a verb-4 operation moves: its two lines, the second
    /// overriding the first when they name one item, zero lines left out.
    fn lot(&self) -> std::collections::BTreeMap<u32, u64> {
        let mut lot = std::collections::BTreeMap::new();
        lot.insert(self.item, self.amount);
        lot.insert(self.item2, self.amount2);
        lot.retain(|_, q| *q > 0);
        lot
    }
}

fn stock_op() -> impl Strategy<Value = StockOp> {
    let amount = || prop_oneof![0u64..20, Just(u64::MAX), (u64::MAX - 10)..=u64::MAX];
    (
        (0u8..5, any::<bool>(), 0usize..8, 0usize..8),
        (0u32..6, amount()),
        (0u32..6, amount()),
        1u64..5,
    )
        .prop_map(
            |((verb, consumption, from, to), (item, amount), (item2, amount2), citizen)| StockOp {
                verb,
                consumption,
                from,
                to,
                item,
                amount,
                item2,
                amount2,
                citizen,
            },
        )
}

fn stock_op_author(op: &StockOp) -> sim::author::Author {
    use sim::author::{Author, Cause};
    let cause = if op.consumption {
        Cause::Consumption
    } else {
        Cause::ProcedureStep
    };
    Author::new(op.citizen, cause).unwrap()
}

/// A non-empty starting ledger: (holder, item, quantity) triples, one per
/// (holder, item), and in a share of cases one holder at the line ceiling
/// on items outside the generated range (so a new line is refused there).
fn stock_start() -> impl Strategy<Value = (Vec<(usize, u32, u64)>, Option<usize>)> {
    (
        proptest::collection::vec(
            (
                0usize..8,
                0u32..6,
                prop_oneof![1u64..50, Just(u64::MAX), (u64::MAX - 10)..=u64::MAX],
            ),
            1..12,
        ),
        proptest::option::of(0usize..8),
    )
}

fn stock_start_ledger(
    start: &(Vec<(usize, u32, u64)>, Option<usize>),
) -> support::stock_ledger::Ledger {
    use sim::stock::StockLine;
    let holders = stock_holders();
    let mut lines: Vec<StockLine> = Vec::new();
    let push = |lines: &mut Vec<StockLine>, holder, item, quantity| {
        if lines
            .iter()
            .any(|l| l.holder == holder && l.item_id == item)
        {
            return;
        }
        let row_id = lines.len() as u64 + 1;
        lines.push(StockLine {
            row_id,
            holder,
            item_id: item,
            quantity,
        });
    };
    for &(h, item, quantity) in &start.0 {
        push(&mut lines, holders[h], item, quantity);
    }
    if let Some(h) = start.1 {
        for item in 100..100 + sim::stock::MAX_LINES_PER_HOLDER as u32 {
            push(&mut lines, holders[h], item, 1);
        }
    }
    support::stock_ledger::Ledger::from_lines(lines)
}

type StockModel = std::collections::BTreeMap<(sim::stock::HolderRef, u32), u64>;

/// What an operation must come to, computed from the model alone (never
/// from the ledger or the code under test).
struct StockExpect {
    err: Option<sim::stock::StockError>,
    taken: u64,
    no_room: bool,
    /// Rows the operation changes: 0, 1 (make, consume) or 2 (move).
    changed: usize,
}

fn stock_expect(
    model: &StockModel,
    op: &StockOp,
    holders: &[sim::stock::HolderRef],
) -> StockExpect {
    use sim::stock::{MAX_LINES_PER_HOLDER, StockError};
    let (from, to) = (holders[op.from], holders[op.to]);
    let q = |h, item| model.get(&(h, item)).copied().unwrap_or(0);
    let lines = |h| model.keys().filter(|k| k.0 == h).count();
    // Whether `amount` more of the item fits at `h`: Err on overflow,
    // Ok(false) with no room for a new line.
    let fits = |h, amount: u64| -> Result<bool, StockError> {
        if amount == 0 {
            return Ok(true);
        }
        let held = q(h, op.item);
        if held.checked_add(amount).is_none() {
            return Err(StockError::QuantityOverflow);
        }
        Ok(held > 0 || lines(h) < MAX_LINES_PER_HOLDER)
    };
    let none = |err| StockExpect {
        err,
        taken: 0,
        no_room: false,
        changed: 0,
    };
    match op.verb {
        0 if op.consumption => none(Some(StockError::CauseNotPermitted)),
        0 => match fits(from, op.amount) {
            Err(e) => none(Some(e)),
            Ok(false) => StockExpect {
                no_room: true,
                ..none(None)
            },
            Ok(true) => StockExpect {
                taken: op.amount,
                changed: usize::from(op.amount > 0),
                ..none(None)
            },
        },
        1 => {
            let taken = op.amount.min(q(from, op.item));
            StockExpect {
                taken,
                changed: usize::from(taken > 0),
                ..none(None)
            }
        }
        _ if op.consumption => none(Some(StockError::CauseNotPermitted)),
        4 => {
            let lot = op.lot();
            if from == to || lot.is_empty() {
                return none(None);
            }
            if lot.iter().any(|(&i, &want)| q(from, i) < want) {
                return none(None);
            }
            let new_lines = lot.keys().filter(|&&i| q(to, i) == 0).count();
            if lines(to) + new_lines > MAX_LINES_PER_HOLDER {
                return StockExpect {
                    no_room: true,
                    ..none(None)
                };
            }
            if lot
                .iter()
                .any(|(&i, &want)| q(to, i).checked_add(want).is_none())
            {
                return none(Some(StockError::QuantityOverflow));
            }
            StockExpect {
                taken: lot.values().fold(0u64, |a, &b| a.wrapping_add(b)),
                changed: 2 * lot.len(),
                ..none(None)
            }
        }
        verb => {
            let held = q(from, op.item);
            let give = if verb == 3 {
                if held >= op.amount { op.amount } else { 0 }
            } else {
                op.amount.min(held)
            };
            if from == to || give == 0 {
                return none(None);
            }
            match fits(to, give) {
                Err(e) => none(Some(e)),
                Ok(false) => StockExpect {
                    no_room: true,
                    ..none(None)
                },
                Ok(true) => StockExpect {
                    taken: give,
                    changed: 2,
                    ..none(None)
                },
            }
        }
    }
}

/// What the code under test returned for an operation.
struct StockRun {
    taken: u64,
    no_room: bool,
    remaining: Option<u64>,
    writes: Vec<sim::stock::Write>,
}

fn stock_run(
    lines: &[sim::stock::StockLine],
    op: &StockOp,
    holders: &[sim::stock::HolderRef],
) -> Result<StockRun, sim::stock::StockError> {
    use sim::stock::{
        Made, plan_consume, plan_make, plan_transfer, plan_transfer_all, plan_transfer_exact,
    };
    let (from, to) = (holders[op.from], holders[op.to]);
    let by = stock_op_author(op);
    match op.verb {
        0 => plan_make(lines, by, from, op.item, op.amount).map(|m| match m {
            Made::Done(w) => StockRun {
                taken: if w.plan() == sim::stock::Plan::Nothing {
                    0
                } else {
                    op.amount
                },
                no_room: false,
                remaining: None,
                writes: vec![w],
            },
            Made::NoRoom(_) => StockRun {
                taken: 0,
                no_room: true,
                remaining: None,
                writes: vec![],
            },
        }),
        1 => plan_consume(lines, by, from, op.item, op.amount).map(|w| StockRun {
            taken: w.taken,
            no_room: false,
            remaining: Some(w.remaining),
            writes: vec![w.write],
        }),
        4 => {
            let lot = op.lot();
            plan_transfer_all(lines, by, from, to, &lot).map(|t| StockRun {
                taken: if t.writes.is_empty() {
                    0
                } else {
                    lot.values().fold(0u64, |a, &b| a.wrapping_add(b))
                },
                no_room: t.no_room.is_some(),
                remaining: None,
                writes: t.writes,
            })
        }
        verb => {
            let t = if verb == 2 {
                plan_transfer(lines, by, from, to, op.item, op.amount)
            } else {
                plan_transfer_exact(lines, by, from, to, op.item, op.amount)
            }?;
            Ok(StockRun {
                taken: t.taken,
                no_room: t.no_room.is_some(),
                remaining: Some(t.remaining),
                writes: t.writes.map(|w| w.to_vec()).unwrap_or_default(),
            })
        }
    }
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_stock_moves_only_by_hand` (FR89): a long interleaving of
    /// authored makes, consumptions and moves under either cause. The
    /// oracle is a map built only by replaying the returned writes onto the
    /// starting ledger, an expectation computed from that map alone, and a
    /// per-item total moved only by what was made and consumed -- it never
    /// reads the ledger to check the ledger. Checked after every operation.
    #[test]
    fn inv_stock_moves_only_by_hand(
        start in stock_start(),
        ops in proptest::collection::vec(stock_op(), 0..120),
    ) {
        use std::collections::BTreeMap;
        use sim::stock::Plan;

        let holders = stock_holders();
        let mut ledger = stock_start_ledger(&start);
        let mut model: StockModel = ledger
            .lines()
            .iter()
            .map(|l| ((l.holder, l.item_id), l.quantity))
            .collect();
        let mut totals: BTreeMap<u32, u128> = BTreeMap::new();
        for (&(_, item), &q) in &model {
            *totals.entry(item).or_default() += q as u128;
        }

        for op in &ops {
            let want = stock_expect(&model, op, &holders);
            let got = stock_run(ledger.lines(), op, &holders);
            let run = match (want.err, got) {
                (Some(e), got) => {
                    prop_assert_eq!(got.err(), Some(e));
                    continue;
                }
                (None, Err(e)) => return Err(TestCaseError::fail(format!("unexpected error {e:?}"))),
                (None, Ok(run)) => run,
            };

            prop_assert_eq!(run.taken, want.taken);
            prop_assert_eq!(run.no_room, want.no_room);
            if let Some(remaining) = run.remaining {
                let before = model.get(&(holders[op.from], op.item)).copied().unwrap_or(0);
                let expected_after = if op.from == op.to && op.verb >= 2 { before } else { before - run.taken };
                prop_assert_eq!(remaining, expected_after);
            }

            // Every returned write names exactly the author the call was
            // made with, whether or not it changes a row.
            let author = stock_op_author(op);
            let mut changed = 0;
            for w in &run.writes {
                prop_assert_eq!(w.author(), author);
                prop_assert_ne!(w.author().citizen_id(), 0);
                let key = (w.holder(), w.item_id());
                match w.plan() {
                    Plan::Insert { quantity } | Plan::Update { quantity, .. } => {
                        model.insert(key, quantity);
                        changed += 1;
                    }
                    Plan::Delete { .. } => {
                        model.remove(&key);
                        changed += 1;
                    }
                    Plan::Nothing => {}
                }
                ledger.apply(w);
            }
            prop_assert_eq!(changed, want.changed);

            let total = totals.entry(op.item).or_default();
            match op.verb {
                0 => *total += run.taken as u128,
                1 => *total -= run.taken as u128,
                _ => {}
            }

            let mut actual: StockModel = BTreeMap::new();
            for l in ledger.lines() {
                prop_assert!(l.quantity > 0, "a stored line is never zero");
                prop_assert!(
                    actual.insert((l.holder, l.item_id), l.quantity).is_none(),
                    "two rows for one (holder, item)"
                );
            }
            prop_assert_eq!(&actual, &model);
            let mut sums: BTreeMap<u32, u128> = BTreeMap::new();
            for (&(_, item), &q) in &actual {
                *sums.entry(item).or_default() += q as u128;
            }
            prop_assert_eq!(sums, totals.iter().filter(|(_, v)| **v != 0).map(|(k, v)| (*k, *v)).collect::<BTreeMap<_, _>>());
        }
    }

    /// `inv_stock_move_conserves_quantity`: any sequence of moves leaves the
    /// per-item sum across holders unchanged; the giver loses exactly what
    /// the receiver gains and exactly what the move reports taken; and a
    /// move the receiver refuses takes nothing from the giver.
    #[test]
    fn inv_stock_move_conserves_quantity(
        start in stock_start(),
        ops in proptest::collection::vec(stock_op(), 0..120),
    ) {
        use std::collections::BTreeMap;

        let holders = stock_holders();
        let mut ledger = stock_start_ledger(&start);
        let sum = |l: &support::stock_ledger::Ledger| {
            let mut m: BTreeMap<u32, u128> = BTreeMap::new();
            for line in l.lines() {
                *m.entry(line.item_id).or_default() += line.quantity as u128;
            }
            m
        };
        let before = sum(&ledger);
        for op in ops.iter().filter(|o| o.verb >= 2) {
            let (from, to) = (holders[op.from], holders[op.to]);
            let model: StockModel = ledger
                .lines()
                .iter()
                .map(|l| ((l.holder, l.item_id), l.quantity))
                .collect();
            let want = stock_expect(&model, op, &holders);
            if op.verb == 4 {
                match stock_run(ledger.lines(), op, &holders) {
                    Err(e) => prop_assert_eq!(Some(e), want.err),
                    Ok(run) => {
                        prop_assert_eq!(want.err, None);
                        prop_assert_eq!(run.taken, want.taken);
                        prop_assert_eq!(run.no_room, want.no_room);
                        let lot = op.lot();
                        let before_lot: Vec<(u64, u64)> = lot
                            .keys()
                            .map(|&i| (ledger.quantity(from, i), ledger.quantity(to, i)))
                            .collect();
                        for w in &run.writes {
                            ledger.apply(w);
                        }
                        if run.writes.is_empty() {
                            // A refused or empty lot takes nothing from anyone.
                            let after: Vec<(u64, u64)> = lot
                                .keys()
                                .map(|&i| (ledger.quantity(from, i), ledger.quantity(to, i)))
                                .collect();
                            prop_assert_eq!(after, before_lot);
                        } else {
                            for (&i, &(giver, receiver)) in lot.keys().zip(before_lot.iter()) {
                                prop_assert_eq!(ledger.quantity(from, i), giver - lot[&i]);
                                prop_assert_eq!(ledger.quantity(to, i), receiver + lot[&i]);
                            }
                        }
                    }
                }
                prop_assert_eq!(sum(&ledger), before.clone());
                continue;
            }
            let (giver, receiver) = (ledger.quantity(from, op.item), ledger.quantity(to, op.item));
            let run = match stock_run(ledger.lines(), op, &holders) {
                Err(e) => {
                    prop_assert_eq!(Some(e), want.err);
                    prop_assert_eq!(sum(&ledger), before.clone());
                    continue;
                }
                Ok(run) => run,
            };
            prop_assert_eq!(want.err, None);
            prop_assert_eq!(run.taken, want.taken);
            prop_assert_eq!(run.no_room, want.no_room);
            for w in &run.writes {
                ledger.apply(w);
            }
            if from != to {
                prop_assert_eq!(ledger.quantity(from, op.item), giver - run.taken);
                prop_assert_eq!(ledger.quantity(to, op.item), receiver + run.taken);
                prop_assert_eq!(run.remaining, Some(ledger.quantity(from, op.item)));
            } else {
                prop_assert_eq!(ledger.quantity(from, op.item), giver);
            }
            if run.no_room {
                prop_assert!(run.writes.is_empty() && ledger.quantity(from, op.item) == giver);
            }
            prop_assert_eq!(sum(&ledger), before.clone());
        }
    }
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_item_instance_in_exactly_one_state` (FR95): the driver applies
    /// each `plan_move` as the plan says -- one delete and one insert across
    /// forms -- to two separate form maps; the oracle is the last target
    /// requested per instance.
    #[test]
    fn inv_item_instance_in_exactly_one_state(
        ops in proptest::collection::vec(
            (0u64..4, any::<bool>(), 0i32..6, 0..sim::item_instance::OFFSET_SUBCELLS, 0..sim::item_instance::MAX_GRID_EXTENT),
            0..80,
        )
    ) {
        use std::collections::BTreeMap;
        use sim::codes::container_kind;
        use sim::item_instance::{ContainerRef, Form, Held, MovePlan, Placed, Placement, plan_move};

        let mut placed: BTreeMap<u64, Placement> = BTreeMap::new();
        let mut held: BTreeMap<u64, Placement> = BTreeMap::new();
        let mut last: BTreeMap<u64, Placement> = BTreeMap::new();
        for &(id, to_world, x, off, slot) in &ops {
            let target = if to_world {
                Placement::Placed(Placed::new(x, 0, 0, (off, off), 0).unwrap())
            } else {
                let c = ContainerRef::new(container_kind::OBJECT, 1 + x as u64).unwrap();
                Placement::Held(Held::new(c, (slot, slot), 0).unwrap())
            };
            match last.get(&id).copied() {
                None => {
                    match target.form() {
                        Form::Placed => placed.insert(id, target),
                        Form::Held => held.insert(id, target),
                    };
                }
                Some(current) => match plan_move(current, target) {
                    MovePlan::Cross { delete, insert } => {
                        let (from, into) = match delete {
                            Form::Placed => (&mut placed, &mut held),
                            Form::Held => (&mut held, &mut placed),
                        };
                        prop_assert!(from.remove(&id).is_some(), "FR95: the delete hits the form being left");
                        prop_assert!(into.insert(id, insert).is_none(), "FR95: the insert lands in the form being entered");
                    }
                    MovePlan::Within(p) => {
                        let map = match p.form() { Form::Placed => &mut placed, Form::Held => &mut held };
                        prop_assert!(map.insert(id, p).is_some(), "FR95: an in-place update replaces a row");
                    }
                    MovePlan::Nothing => {}
                },
            }
            last.insert(id, target);
            for (&i, &want) in &last {
                let in_placed = placed.get(&i);
                let in_held = held.get(&i);
                prop_assert!(in_placed.is_some() != in_held.is_some(), "FR95: instance {} is in exactly one form", i);
                prop_assert_eq!(in_placed.or(in_held).copied(), Some(want));
            }
        }
    }
}

/// Story 6.8 (FR92): a generated denomination set (never the committed
/// one), three holders -- a till, a customer and a bystander, or in a share
/// of cases one holder on both sides of the counter -- and a payment drawn
/// from the customer's own wallet. Some payments are built so that their
/// change is a sub-multiset of the till and the tender, and some holders
/// are filled with other lines to the ceiling or one or two short of it, so completed, short-of-change, short-of-tender,
/// exact and no-room cases all occur unfiltered.
#[derive(Debug, Clone)]
struct CashCase {
    /// Face values, largest first, unique.
    faces: Vec<u32>,
    till: Vec<u64>,
    customer: Vec<u64>,
    bystander: Vec<u64>,
    /// Per denomination, how much of the wallet is tendered.
    pick: Vec<u64>,
    /// Per denomination, how much of till-and-tender the change is built from.
    sub_pick: Vec<u64>,
    /// Asks for one piece more than held, of the first kind.
    overdraw: bool,
    price_kind: u8,
    price_pick: u64,
    till_junk: usize,
    customer_junk: usize,
    same_holder: bool,
}

fn cash_case() -> impl Strategy<Value = CashCase> {
    let faces = prop_oneof![
        5 => proptest::collection::hash_set(1u32..=30, 2..=4),
        3 => proptest::collection::hash_set(300u32..=sim::generated::defs::MAX_FACE_VALUE, 2..=4),
    ];
    faces.prop_flat_map(|set| {
        let mut faces: Vec<u32> = set.into_iter().collect();
        faces.sort_unstable();
        faces.reverse();
        let n = faces.len();
        let quantities = move || proptest::collection::vec(0u64..=6, n);
        let sparse = move || {
            proptest::collection::vec(prop_oneof![1 => Just(0u64), 1 => 1u64..=6], n)
        };
        let junk = || prop_oneof![2 => Just(0usize), 6 => Just(1usize), 1 => 2usize..=3];
        (
            (
                Just(faces),
                quantities(),
                sparse(),
                quantities(),
                proptest::collection::vec(any::<u64>(), n),
                proptest::collection::vec(any::<u64>(), n),
            ),
            (
                prop_oneof![9 => Just(false), 1 => Just(true)],
                prop_oneof![1 => Just(0u8), 1 => Just(1u8), 4 => Just(2u8), 1 => Just(3u8), 5 => Just(4u8), 4 => Just(5u8)],
                any::<u64>(),
                junk(),
                junk(),
                prop_oneof![24 => Just(false), 1 => Just(true)],
            ),
        )
            .prop_map(
                |(
                    (faces, till, customer, bystander, pick, sub_pick),
                    (overdraw, price_kind, price_pick, till_junk, customer_junk, same_holder),
                )| CashCase {
                    faces,
                    till,
                    customer,
                    bystander,
                    pick,
                    sub_pick,
                    overdraw,
                    price_kind,
                    price_pick,
                    till_junk,
                    customer_junk,
                    same_holder,
                },
            )
    })
}

const CASH_ITEM_BASE: u32 = 200;
const CASH_JUNK_BASE: u32 = 1000;

fn cash_denoms(faces: &[u32]) -> Vec<sim::generated::defs::Denomination> {
    faces
        .iter()
        .enumerate()
        .map(|(i, &face_value)| sim::generated::defs::Denomination {
            item_id: CASH_ITEM_BASE + i as u32,
            face_value,
        })
        .collect()
}

type CashLot = std::collections::BTreeMap<u32, u64>;

fn cash_lot(quantities: &[u64]) -> CashLot {
    quantities
        .iter()
        .enumerate()
        .filter(|&(_, &q)| q > 0)
        .map(|(i, &q)| (CASH_ITEM_BASE + i as u32, q))
        .collect()
}

/// `(till, customer, bystander)`; the customer is the till when the case
/// has one holder on both sides.
fn cash_holders(case: &CashCase) -> [sim::stock::HolderRef; 3] {
    use sim::codes::holder_kind as k;
    let till = sim::stock::HolderRef::new(k::BUSINESS, 1).unwrap();
    let customer = if case.same_holder {
        till
    } else {
        sim::stock::HolderRef::new(k::CITIZEN, 1).unwrap()
    };
    [
        till,
        customer,
        sim::stock::HolderRef::new(k::BUSINESS, 2).unwrap(),
    ]
}

fn cash_ledger(case: &CashCase) -> support::stock_ledger::Ledger {
    use sim::author::{Author, Cause};
    use sim::stock::{Made, plan_make};
    let by = Author::new(1, Cause::ProcedureStep).unwrap();
    let [till, customer, bystander] = cash_holders(case);
    let mut ledger = support::stock_ledger::Ledger::default();
    let wallets = [
        (till, &case.till),
        (customer, &case.customer),
        (bystander, &case.bystander),
    ];
    for (holder, quantities) in wallets {
        for (item, quantity) in cash_lot(quantities) {
            let Made::Done(w) = plan_make(ledger.lines(), by, holder, item, quantity).unwrap()
            else {
                panic!("a handful of lines always has room")
            };
            ledger.apply(&w);
        }
    }
    for (holder, fill) in [(till, case.till_junk), (customer, case.customer_junk)] {
        // 0 leaves the holder alone; 1 to 3 fill it to the ceiling, or one or
        // two lines short of it.
        let used = ledger.lines().iter().filter(|l| l.holder == holder).count();
        let junk = if fill == 0 {
            0
        } else {
            sim::stock::MAX_LINES_PER_HOLDER.saturating_sub(used + fill - 1)
        };
        for i in 0..junk as u32 {
            // A holder that is full stops there: that is the point.
            if let Made::Done(w) =
                plan_make(ledger.lines(), by, holder, CASH_JUNK_BASE + i, 1).unwrap()
            {
                ledger.apply(&w);
            }
        }
    }
    ledger
}

fn cash_junk_at(ledger: &support::stock_ledger::Ledger, h: sim::stock::HolderRef) -> usize {
    ledger
        .lines()
        .iter()
        .filter(|l| l.holder == h && l.item_id >= CASH_JUNK_BASE)
        .count()
}

/// The tender and the price this case asks for, from the customer's wallet.
fn cash_ask(case: &CashCase, ledger: &support::stock_ledger::Ledger) -> (CashLot, u64) {
    let [till, customer, _] = cash_holders(case);
    let mut tender = CashLot::new();
    for i in 0..case.faces.len() {
        let item = CASH_ITEM_BASE + i as u32;
        let held = ledger.quantity(customer, item);
        let mut count = case.pick[i] % (held + 1);
        if case.overdraw && i == 0 {
            count = held + 1;
        }
        if count > 0 {
            tender.insert(item, count);
        }
    }
    let face = |item: u32| u64::from(case.faces[(item - CASH_ITEM_BASE) as usize]);
    let value: u64 = tender.iter().map(|(&item, &q)| q * face(item)).sum();
    let smallest = tender.keys().map(|&item| face(item)).min().unwrap_or(1);
    let built_change: u64 = (0..case.faces.len())
        .map(|i| {
            let item = CASH_ITEM_BASE + i as u32;
            let pool = ledger.quantity(till, item) + tender.get(&item).copied().unwrap_or(0);
            (case.sub_pick[i] % (pool + 1)) * face(item)
        })
        .sum();
    let price = match case.price_kind {
        0 => value,
        1 => value.saturating_sub(case.price_pick % smallest),
        2 => value.saturating_sub(case.price_pick % 50),
        3 => value + 1 + case.price_pick % 5,
        5 => value.saturating_sub(
            u64::from(sim::generated::defs::MAX_FACE_VALUE) + case.price_pick % 100,
        ),
        _ => value - built_change.min(value),
    };
    (tender, price)
}

fn cash_authors() -> (sim::author::Author, sim::author::Author) {
    use sim::author::{Author, Cause};
    (
        Author::new(9, Cause::ProcedureStep).unwrap(),
        Author::new(10, Cause::ProcedureStep).unwrap(),
    )
}

/// Past the bound the hand-back is the engine's, so the oracle stays the
/// plain one: whether any sub-multiset of the till and the whole tender
/// sums to the whole due. A completed payment implies one exists (the
/// pieces handed back plus the change are such a sub-multiset).
fn cash_past_the_bound_feasible(
    case: &CashCase,
    ledger: &support::stock_ledger::Ledger,
    tender: &CashLot,
    price: u64,
) -> bool {
    let [till, _, _] = cash_holders(case);
    let face = |item: u32| u64::from(case.faces[(item - CASH_ITEM_BASE) as usize]);
    let due = tender.iter().map(|(&i, &q)| q * face(i)).sum::<u64>() - price;
    let pool: Vec<u64> = (0..case.faces.len())
        .map(|i| {
            let item = CASH_ITEM_BASE + i as u32;
            ledger.quantity(till, item) + tender.get(&item).copied().unwrap_or(0)
        })
        .collect();
    cash_oracle(&case.faces, &pool, due).is_some()
}

/// What the model alone says a case must come to: the brute-force oracle
/// over the till and what was just tendered, then the final line counts.
fn cash_expected(
    case: &CashCase,
    ledger: &support::stock_ledger::Ledger,
    tender: &CashLot,
    price: u64,
) -> sim::cash::Payment {
    use sim::cash::{Payment, Side};
    let [till, customer, _] = cash_holders(case);
    if case.same_holder {
        return Payment::SameHolder;
    }
    let face = |item: u32| u64::from(case.faces[(item - CASH_ITEM_BASE) as usize]);
    let value: u64 = tender.iter().map(|(&i, &q)| q * face(i)).sum();
    if let Some((&item_id, _)) = tender
        .iter()
        .find(|&(&i, &q)| q > ledger.quantity(customer, i))
    {
        return Payment::TenderNotHeld { item_id };
    }
    if value < price {
        return Payment::TenderBelowPrice;
    }
    let due = value - price;
    if due >= u64::from(sim::generated::defs::MAX_FACE_VALUE) {
        // Past the bound the outcome is checked by `cash_past_the_bound`.
        return Payment::TenderTooLarge;
    }
    let n = case.faces.len();
    let item = |i: usize| CASH_ITEM_BASE + i as u32;
    let tendered = |i: usize| tender.get(&item(i)).copied().unwrap_or(0);
    let pool: Vec<u64> = (0..n)
        .map(|i| ledger.quantity(till, item(i)) + tendered(i))
        .collect();
    let Some(change) = cash_oracle(&case.faces, &pool, due) else {
        return Payment::NoChange;
    };
    let till_lines = cash_junk_at(ledger, till) + (0..n).filter(|&i| pool[i] > change[i]).count();
    if till_lines > sim::stock::MAX_LINES_PER_HOLDER {
        return Payment::NoRoom(Side::Till);
    }
    let customer_lines = cash_junk_at(ledger, customer)
        + (0..n)
            .filter(|&i| ledger.quantity(customer, item(i)) + change[i] > tendered(i))
            .count();
    if customer_lines > sim::stock::MAX_LINES_PER_HOLDER {
        return Payment::NoRoom(Side::Customer);
    }
    Payment::Paid {
        change: cash_lot(&change),
        writes: Vec::new(),
    }
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_cash_payment_conserves_every_denomination`: after applying the
    /// returned writes, each denomination's count summed across all holders
    /// is unchanged (counts, not value: value alone lets a note turn into
    /// coins); the bystander is untouched; a completed payment moves
    /// exactly the price from customer to till; any other outcome leaves
    /// the ledger as it was; what leaves the customer is authored by the
    /// customer and what leaves the till by the cashier, both procedure
    /// steps; one row per (holder, item), none at zero, none past the
    /// ceiling -- with holders that hold up to 63 other lines in a share of
    /// cases, so the ceiling is met. Mutations that turn it red: drop the
    /// change transfer; swap the two authors; count any touched line as
    /// freed in `without_emptied`; delete the room check in
    /// `plan_transfer_all`.
    #[test]
    fn inv_cash_payment_conserves_every_denomination(case in cash_case()) {
        use sim::cash::{Payment, plan_payment, value_of};
        use sim::stock::MAX_LINES_PER_HOLDER;

        let denoms = cash_denoms(&case.faces);
        let [till, customer, bystander] = cash_holders(&case);
        let mut ledger = cash_ledger(&case);
        let start: Vec<_> = ledger.lines().to_vec();
        let (tender, price) = cash_ask(&case, &ledger);
        let (by_customer, by_cashier) = cash_authors();

        let value_at = |ledger: &support::stock_ledger::Ledger, h| {
            let lot: CashLot = ledger.lines().iter().filter(|l| l.holder == h && l.item_id < CASH_JUNK_BASE)
                .map(|l| (l.item_id, l.quantity)).collect();
            value_of(&lot, &denoms).unwrap()
        };
        let (till_before, customer_before) = (value_at(&ledger, till), value_at(&ledger, customer));
        let counts = |ledger: &support::stock_ledger::Ledger| -> Vec<u64> {
            (0..denoms.len() as u32)
                .map(|i| ledger.lines().iter().filter(|l| l.item_id == CASH_ITEM_BASE + i).map(|l| l.quantity).sum())
                .collect()
        };
        let counts_before = counts(&ledger);

        let outcome = plan_payment(
            &start,
            sim::cash::Party { holder: customer, by: by_customer },
            sim::cash::Party { holder: till, by: by_cashier },
            &tender,
            price,
            &denoms,
        )
        .unwrap();
        match &outcome {
            Payment::Paid { writes, .. } => {
                for w in writes {
                    prop_assert!(w.holder() != bystander, "the bystander is never written");
                    prop_assert_eq!(w.author().cause(), sim::author::Cause::ProcedureStep);
                    // Direction: the item's net movement at the till.
                    let item = w.item_id();
                    let at_till = |l: &support::stock_ledger::Ledger| l.quantity(till, item);
                    let before = start.iter().find(|l| l.holder == till && l.item_id == item).map_or(0, |l| l.quantity);
                    let mut probe = support::stock_ledger::Ledger::from_lines(start.clone());
                    for x in writes { probe.apply(x); }
                    let after = at_till(&probe);
                    let want = if after > before { by_customer } else { by_cashier };
                    prop_assert_eq!(w.author(), want, "item {}", item);
                    ledger.apply(w);
                }
                prop_assert_eq!(value_at(&ledger, till), till_before + price);
                prop_assert_eq!(value_at(&ledger, customer), customer_before - price);
            }
            _ => prop_assert_eq!(ledger.lines(), &start[..]),
        }
        prop_assert_eq!(counts(&ledger), counts_before);
        let of = |h| -> Vec<_> { ledger.lines().iter().filter(|l| l.holder == h).map(|l| (l.item_id, l.quantity)).collect() };
        let bystander_start: Vec<_> = start.iter().filter(|l| l.holder == bystander).map(|l| (l.item_id, l.quantity)).collect();
        prop_assert_eq!(of(bystander), bystander_start);
        for h in [till, customer, bystander] {
            let mut items: Vec<u32> = ledger.lines().iter().filter(|l| l.holder == h).map(|l| l.item_id).collect();
            let rows = items.len();
            items.sort_unstable();
            items.dedup();
            prop_assert_eq!(rows, items.len(), "one row per (holder, item)");
            prop_assert!(rows <= MAX_LINES_PER_HOLDER);
        }
        prop_assert!(ledger.lines().iter().all(|l| l.quantity > 0), "no zero row");
    }
}

/// The best combination of the held pieces that sums to `amount` by the
/// contract: fewest pieces, then more of the larger denomination. Brute
/// force over every sub-multiset, the oracle for `choose_change`.
fn cash_oracle(faces: &[u32], held: &[u64], amount: u64) -> Option<Vec<u64>> {
    fn walk(
        faces: &[u32],
        held: &[u64],
        k: usize,
        left: u64,
        picked: &mut Vec<u64>,
        best: &mut Option<Vec<u64>>,
    ) {
        if k == faces.len() {
            if left == 0 {
                let better = match best {
                    None => true,
                    Some(b) => {
                        let (np, bp): (u64, u64) = (picked.iter().sum(), b.iter().sum());
                        np < bp || (np == bp && *picked > *b)
                    }
                };
                if better {
                    *best = Some(picked.clone());
                }
            }
            return;
        }
        for c in 0..=held[k] {
            if c * u64::from(faces[k]) > left {
                break;
            }
            picked.push(c);
            walk(
                faces,
                held,
                k + 1,
                left - c * u64::from(faces[k]),
                picked,
                best,
            );
            picked.pop();
        }
    }
    let mut best = None;
    walk(faces, held, 0, amount, &mut Vec::new(), &mut best);
    best
}

/// Runs a case: the outcome, and what the model says it must be.
fn cash_run(case: &CashCase) -> (sim::cash::Payment, sim::cash::Payment) {
    let denoms = cash_denoms(&case.faces);
    let [till, customer, _] = cash_holders(case);
    let ledger = cash_ledger(case);
    let (tender, price) = cash_ask(case, &ledger);
    let (by_customer, by_cashier) = cash_authors();
    let outcome = sim::cash::plan_payment(
        ledger.lines(),
        sim::cash::Party {
            holder: customer,
            by: by_customer,
        },
        sim::cash::Party {
            holder: till,
            by: by_cashier,
        },
        &tender,
        price,
        &denoms,
    )
    .unwrap();
    (outcome, cash_expected(case, &ledger, &tender, price))
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_change_is_refused_only_when_the_till_cannot_make_it`: against a
    /// brute-force oracle over every sub-multiset of what the till holds
    /// *and what was just tendered* (tendered cash counts as available for
    /// change), the payment reports "no change" if and only if no
    /// sub-multiset sums to the change due, while the change due is under
    /// `MAX_FACE_VALUE`. Past it the outcome is never `NoChange` (that says the
    /// till is short): it is `TenderTooLarge` or a completed payment, and a
    /// completed payment implies the plain oracle finds an answer for the whole
    /// due -- the oracle is not taught the hand-back. The change chosen is the
    /// oracle's: fewest pieces, ties to the larger denomination; every lot
    /// `choose_change` returns moves through `plan_transfer_all` with no
    /// shortfall. The room outcomes are checked against the final line
    /// counts. Mutation that turns it red: swap in largest-first greedy.
    #[test]
    fn inv_change_is_refused_only_when_the_till_cannot_make_it(
        case in cash_case(),
        amount in 0u64..=60,
    ) {
        use sim::cash::{Payment, choose_change};

        let denoms = cash_denoms(&case.faces);
        let [till, customer, _] = cash_holders(&case);
        let ledger = cash_ledger(&case);

        let held: Vec<u64> = (0..case.faces.len() as u32).map(|i| ledger.quantity(till, CASH_ITEM_BASE + i)).collect();
        let want = cash_oracle(&case.faces, &held, amount);
        let money: CashLot = ledger
            .lines()
            .iter()
            .filter(|l| l.holder == till && l.item_id < CASH_JUNK_BASE)
            .map(|l| (l.item_id, l.quantity))
            .collect();
        let chosen = choose_change(&money, amount, &denoms).unwrap();
        let got = chosen.as_ref().map(|lot| {
            (0..case.faces.len() as u32)
                .map(|i| lot.get(&(CASH_ITEM_BASE + i)).copied().unwrap_or(0))
                .collect::<Vec<u64>>()
        });
        prop_assert_eq!(got, want);
        if let Some(lot) = chosen {
            let by = cash_authors().0;
            if till != customer {
                let moved = sim::stock::plan_transfer_all(ledger.lines(), by, till, customer, &lot).unwrap();
                prop_assert!(moved.short.is_none(), "a chosen change is held");
            }
        }

        // The payment-level classification, from the model alone.
        let (outcome, expected) = cash_run(&case);
        match (&outcome, &expected) {
            (Payment::Paid { change: a, .. }, Payment::Paid { change: b, .. }) => prop_assert_eq!(a, b),
            // Past the bound: never "the till is short"; a completed payment
            // implies the plain oracle finds an answer for the whole due.
            (_, Payment::TenderTooLarge) => {
                prop_assert!(outcome != Payment::NoChange);
                if matches!(outcome, Payment::Paid { .. }) {
                    let ledger = cash_ledger(&case);
                    let (tender, price) = cash_ask(&case, &ledger);
                    prop_assert!(cash_past_the_bound_feasible(&case, &ledger, &tender, price));
                }
            }
            _ => prop_assert_eq!(outcome, expected),
        }
    }
}

/// A deterministic walk over the generator (fixed RNG, no proptest seed):
/// a property over a generator that silently stops reaching a branch is
/// decoration, so every branch has a minimum share.
#[test]
fn the_cash_generator_reaches_every_branch() {
    use proptest::strategy::{Strategy, ValueTree};
    use proptest::test_runner::{Config, RngAlgorithm, TestRng, TestRunner};
    use sim::cash::{Payment, Side};

    const CASES: usize = 4096;
    let mut runner = TestRunner::new_with_rng(
        Config::default(),
        TestRng::from_seed(RngAlgorithm::ChaCha, &[7u8; 32]),
    );
    let strategy = cash_case();
    let (mut paid_with_change, mut multi_kind, mut no_change) = (0usize, 0usize, 0usize);
    let (mut room_till, mut room_customer, mut same_holder) = (0usize, 0usize, 0usize);
    let (mut too_large, mut paid_past_bound) = (0usize, 0usize);
    for _ in 0..CASES {
        let case = strategy.new_tree(&mut runner).unwrap().current();
        let (outcome, expected) = cash_run(&case);
        paid_past_bound += usize::from(
            expected == Payment::TenderTooLarge && matches!(outcome, Payment::Paid { .. }),
        );
        match outcome {
            Payment::Paid { change, .. } => {
                paid_with_change += usize::from(!change.is_empty());
                multi_kind += usize::from(change.len() > 1);
            }
            Payment::NoChange => no_change += 1,
            Payment::TenderTooLarge => too_large += 1,
            Payment::NoRoom(Side::Till) => room_till += 1,
            Payment::NoRoom(Side::Customer) => room_customer += 1,
            Payment::SameHolder => same_holder += 1,
            Payment::TenderBelowPrice | Payment::TenderNotHeld { .. } => {}
        }
    }
    // Whole-number percentages: sim is integer-only.
    eprintln!(
        "counts: change {paid_with_change} multi {multi_kind} none {no_change} till {room_till} cust {room_customer} large {too_large} paidpast {paid_past_bound}"
    );
    let percent = |n: usize| n * 100 / CASES;
    for (name, n, at_least) in [
        ("paid with change", paid_with_change, 20),
        ("multi-kind change", multi_kind, 5),
        ("no change", no_change, 10),
        ("no room at the till", room_till, 2),
        ("no room at the customer", room_customer, 2),
        ("past the bound, refused", too_large, 2),
        ("past the bound, paid", paid_past_bound, 2),
    ] {
        assert!(
            percent(n) >= at_least,
            "{name}: {}% under {at_least}%",
            percent(n)
        );
    }
    assert!(same_holder > 0, "a holder paying itself never occurs");
}

/// Any table, lines, tender and price: the three public functions of
/// `sim::cash` return `Ok` or a typed `Err`, never panic. Faces cover the
/// whole `u32` range, including 0, duplicates and values far over the cap;
/// quantities reach `u64::MAX`.
/// A table of `(item, face)`, lines of `(holder, item, quantity)`, a tender, a
/// change amount, a price and whether one holder is on both sides.
type TotalityCase = (
    Vec<(u32, u32)>,
    Vec<(u8, u32, u64)>,
    Vec<(u32, u64)>,
    u64,
    u64,
    bool,
);

fn totality_case() -> impl Strategy<Value = TotalityCase> {
    let qty = || {
        prop_oneof![
            0u64..20,
            Just(u64::MAX),
            (u64::MAX - 10)..=u64::MAX,
            any::<u64>()
        ]
    };
    let face = || prop_oneof![0u32..40, 900u32..1100, Just(u32::MAX), any::<u32>()];
    (
        proptest::collection::vec((0u32..6, face()), 0..7),
        proptest::collection::vec((0u8..3, 0u32..7, qty()), 0..14),
        proptest::collection::vec((0u32..7, qty()), 0..6),
        prop_oneof![0u64..2000, Just(u64::MAX), any::<u64>()],
        prop_oneof![0u64..3000, any::<u64>()],
        any::<bool>(),
    )
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_cash_planning_never_panics`: `value_of`, `choose_change` and
    /// `plan_payment` are total over every argument their signatures take.
    #[test]
    fn inv_cash_planning_never_panics(
        (table, lines, tender, amount, price, same_holder) in totality_case(),
    ) {
        use sim::author::{Author, Cause};
        use sim::cash::{Party, choose_change, plan_payment, value_of};
        use sim::codes::holder_kind as k;
        use sim::generated::defs::Denomination;
        use sim::stock::{HolderRef, StockLine};

        let denoms: Vec<Denomination> = table
            .iter()
            .map(|&(item, face_value)| Denomination { item_id: item, face_value })
            .collect();
        let till = HolderRef::new(k::BUSINESS, 1).unwrap();
        let customer = if same_holder { till } else { HolderRef::new(k::CITIZEN, 1).unwrap() };
        let holders = [till, customer, HolderRef::new(k::BUSINESS, 2).unwrap()];
        let mut stock: Vec<StockLine> = Vec::new();
        for &(h, item, quantity) in &lines {
            let holder = holders[h as usize];
            if !stock.iter().any(|l| l.holder == holder && l.item_id == item) {
                stock.push(StockLine { row_id: stock.len() as u64 + 1, holder, item_id: item, quantity });
            }
        }
        let lot: CashLot = tender.iter().copied().collect();
        let held: CashLot = stock.iter().filter(|l| l.holder == till).map(|l| (l.item_id, l.quantity)).collect();
        let by = Author::new(1, Cause::ProcedureStep).unwrap();

        let _ = value_of(&lot, &denoms);
        let _ = choose_change(&held, amount, &denoms);
        let _ = plan_payment(
            &stock,
            Party { holder: customer, by },
            Party { holder: till, by },
            &lot,
            price,
            &denoms,
        );
    }
}

// Story 4.5 (FR141-FR143): which character an identity reaches. The plans are
// `sim::identity`'s; the model applies them the way the reducers do.

proptest! {
    #![proptest_config(persisted())]
    /// `inv_identity_reaches_at_most_one_character`
    #[test]
    fn inv_identity_reaches_at_most_one_character(ops in prop::collection::vec(support::identity_model::op(), 0..60)) {
        use sim::identity::{LinkError, LinkPlan, plan_link};
        use support::identity_model::Model;
        let mut m = Model::default();
        for o in &ops {
            let _ = m.apply(o);
            for (&i, &c) in &m.mapping {
                prop_assert!(
                    m.characters.contains_key(&c),
                    "identity {i} maps to a missing character"
                );
            }
        }
        for (a, b) in (0u8..6).flat_map(|a| (0u8..6).map(move |b| (a, b))) {
            if let (Some(x), Some(y)) = (m.mapping.get(&a), m.mapping.get(&b)) {
                let p = plan_link(Some(*x), Some(*y));
                prop_assert!(
                    p == Ok(LinkPlan::AlreadyLinked) || p == Err(LinkError::DifferentCharacters)
                );
            }
        }
    }

    /// `inv_linking_never_changes_or_orphans_a_character`
    #[test]
    fn inv_linking_never_changes_or_orphans_a_character(
        ops in prop::collection::vec(support::identity_model::op(), 0..60)
    ) {
        use support::identity_model::{Model, Op};
        let mut m = Model::default();
        for o in &ops {
            let before_chars = m.characters.clone();
            let before_sets = m.identity_sets();
            let _ = m.apply(o);
            if matches!(o, Op::Link(..)) {
                prop_assert_eq!(&m.characters, &before_chars);
            }
            let after_sets = m.identity_sets();
            for (c, set) in &before_sets {
                let now = after_sets.get(c);
                prop_assert!(now.is_some_and(|n| n.is_superset(set) && !n.is_empty()));
            }
        }
    }

    /// `inv_identity_planning_never_panics`
    #[test]
    fn inv_identity_planning_never_panics(
        a in prop::option::of(any::<u64>()),
        b in prop::option::of(any::<u64>()),
        now in any::<i64>(),
        exp in prop::option::of(any::<i64>()),
        issuer in ".{0,12}",
        aud in prop::collection::vec(".{0,8}", 0..4),
        rows in prop::collection::vec((any::<u64>(), ".{0,12}", ".{0,8}"), 0..4),
    ) {
        use sim::identity::{IssuerRow, check_claim, credential, plan_create, plan_link};
        let _ = plan_create(a);
        let _ = plan_link(a, b);
        let _ = check_claim(exp, now);
        let accepted: Vec<IssuerRow> = rows
            .iter()
            .map(|(id, i, c)| IssuerRow {
                issuer_id: *id,
                issuer: i.clone(),
                client_id: c.clone(),
            })
            .collect();
        let aud: Vec<&str> = aud.iter().map(String::as_str).collect();
        let _ = credential(&issuer, &aud, &accepted);
    }
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_actor_location_written_only_on_chunk_change` (FR136): the pure
    /// planner is the only thing deciding whether `actor_location` is
    /// rewritten, and it derives the chunk itself -- from the position,
    /// never from a key the caller supplies.
    #[test]
    fn inv_actor_location_written_only_on_chunk_change(
        (x0, y0, f0, x1, y1, f1) in (
            prop_oneof![any::<i32>(), -70i32..70, Just(i32::MIN), Just(i32::MAX)],
            prop_oneof![any::<i32>(), -70i32..70, Just(i32::MIN), Just(i32::MAX)],
            -1i8..=7,
            prop_oneof![any::<i32>(), -70i32..70, Just(i32::MIN), Just(i32::MAX)],
            prop_oneof![any::<i32>(), -70i32..70, Just(i32::MIN), Just(i32::MAX)],
            -1i8..=7,
        ),
        near in any::<bool>(),
    ) {
        use sim::actor_location::{Placement, plan_move};
        use sim::world::{CHUNK_SIZE, chunk_key};

        // Half the cases stay in the same chunk by construction.
        let (x1, y1) = if near {
            let cx = x0.div_euclid(CHUNK_SIZE) as i64 * CHUNK_SIZE as i64;
            let cy = y0.div_euclid(CHUNK_SIZE) as i64 * CHUNK_SIZE as i64;
            (
                (cx + (x1 as i64).rem_euclid(CHUNK_SIZE as i64)) as i32,
                (cy + (y1 as i64).rem_euclid(CHUNK_SIZE as i64)) as i32,
            )
        } else {
            (x1, y1)
        };
        let here = Placement { chunk_key: chunk_key(x0, y0, f0), floor: f0 };
        let there = Placement { chunk_key: chunk_key(x1, y1, f1), floor: f1 };

        // An actor with no row yet always gets exactly one write.
        prop_assert_eq!(plan_move(None, x0, y0, f0), Some(here));
        match plan_move(Some(here), x1, y1, f1) {
            None => prop_assert_eq!(here, there, "a move that changed chunk or floor wrote nothing"),
            Some(w) => {
                prop_assert_ne!(here, there, "a move inside one chunk and floor wrote a row");
                prop_assert_eq!(w, there);
            }
        }
    }
}

proptest! {
    #![proptest_config(persisted())]
    /// `inv_player_position_is_one_row_per_player` (FR138): a model of the
    /// table (a map keyed by character) driven only by `plan_position`.
    #[test]
    fn inv_player_position_is_one_row_per_player(
        writes in proptest::collection::vec(
            (0u64..5, -2000i32..2000, -2000i32..2000, -1i8..=7, any::<u8>(), any::<u8>()),
            0..60,
        ),
    ) {
        use sim::player_position::{Write, plan_position};
        use std::collections::BTreeMap;

        let mut table: BTreeMap<u64, sim::player_position::PositionRow> = BTreeMap::new();
        let mut last: BTreeMap<u64, (i32, i32, i8, u8, u8)> = BTreeMap::new();
        for (who, x, y, floor, fx, fy) in writes {
            let before = table.clone();
            let plan = plan_position(table.contains_key(&who), x, y, floor, fx, fy);
            let row = match plan {
                Ok(Write::Insert(r)) => {
                    prop_assert!(!before.contains_key(&who), "inserted over an existing row");
                    r
                }
                Ok(Write::Update(r)) => {
                    prop_assert!(before.contains_key(&who), "updated a row that is not there");
                    r
                }
                Err(e) => return Err(TestCaseError::fail(format!("in-range write refused: {e:?}"))),
            };
            table.insert(who, row);
            last.insert(who, (x, y, floor, fx, fy));
            for (other, r) in &before {
                if *other != who {
                    prop_assert_eq!(table.get(other), Some(r), "a write touched another character's row");
                }
            }
        }
        prop_assert_eq!(table.len(), last.len());
        for (who, (x, y, floor, fx, fy)) in last {
            let r = table.get(&who).expect("a row per writer");
            prop_assert_eq!((r.x, r.y, r.floor, r.frac_x, r.frac_y), (x, y, floor, fx, fy));
        }
    }

    /// `inv_player_position_chunk_key_follows_position` (FR138): walks that
    /// mostly stay in range, cross chunk edges and floors, with out-of-range
    /// inputs mixed in. A write is accepted exactly when the floor and both
    /// cells are addressable; an accepted one stores the chunk its position
    /// is in, and is an update exactly when the character already has a row.
    #[test]
    fn inv_player_position_chunk_key_follows_position(
        steps in proptest::collection::vec(
            (
                prop_oneof![
                    6 => -70i32..70,
                    1 => any::<i32>(),
                    1 => Just(i32::MIN),
                    1 => Just(sim::player_position::CELL_MAX + 1),
                    1 => Just(sim::player_position::CELL_MIN - 1),
                ],
                prop_oneof![
                    6 => -70i32..70,
                    1 => any::<i32>(),
                    1 => Just(sim::player_position::CELL_MAX),
                ],
                prop_oneof![8 => -1i8..=7, 1 => any::<i8>()],
            ),
            1..40,
        ),
    ) {
        use sim::generated::defs::{MAX_FLOOR, MIN_FLOOR};
        use sim::player_position::{CELL_MAX, CELL_MIN, Write, plan_position};
        use sim::world::chunk_key;

        let mut exists = false;
        for (x, y, floor) in steps {
            let addressable = (MIN_FLOOR..=MAX_FLOOR).contains(&(floor as i32))
                && (CELL_MIN..=CELL_MAX).contains(&x)
                && (CELL_MIN..=CELL_MAX).contains(&y);
            let plan = plan_position(exists, x, y, floor, 0, 0);
            prop_assert_eq!(plan.is_ok(), addressable, "accepted exactly when addressable");
            if let Ok(w) = plan {
                let (Write::Insert(r) | Write::Update(r)) = w;
                prop_assert_eq!(matches!(w, Write::Update(_)), exists);
                prop_assert_eq!(r.chunk_key, chunk_key(x, y, floor));
                exists = true;
            }
        }
    }

    /// `inv_player_position_planning_never_panics` (NFR41, FR137).
    #[test]
    fn inv_player_position_planning_never_panics(
        x in prop_oneof![any::<i32>(), Just(i32::MIN), Just(i32::MAX)],
        y in prop_oneof![any::<i32>(), Just(i32::MIN), Just(i32::MAX)],
        floor in any::<i8>(),
        fx in any::<u8>(),
        fy in any::<u8>(),
        jump in any::<i32>(),
    ) {
        use sim::player_position::plan_position;
        let _ = plan_position(false, x, y, floor, fx, fy);

        // A jump of any distance between two addressable cells is accepted.
        use sim::player_position::{CELL_MAX, CELL_MIN};
        let a = (jump as i64).clamp(CELL_MIN as i64, CELL_MAX as i64) as i32;
        prop_assert!(plan_position(true, a, a, 0, fx, fy).is_ok());
    }
}

#[test]
fn player_position_refuses_an_out_of_range_floor_and_cell() {
    use sim::generated::defs::{MAX_FLOOR, MIN_FLOOR};
    use sim::player_position::{CELL_MAX, CELL_MIN, PositionError, plan_position};
    assert_eq!(
        plan_position(false, 0, 0, (MAX_FLOOR + 1) as i8, 0, 0),
        Err(PositionError::FloorOutOfRange)
    );
    assert_eq!(
        plan_position(false, 0, 0, (MIN_FLOOR - 1) as i8, 0, 0),
        Err(PositionError::FloorOutOfRange)
    );
    assert_eq!(
        plan_position(false, CELL_MAX + 1, 0, 0, 0, 0),
        Err(PositionError::CellOutOfRange)
    );
    assert_eq!(
        plan_position(false, 0, CELL_MIN - 1, 0, 0, 0),
        Err(PositionError::CellOutOfRange)
    );
    assert!(plan_position(false, CELL_MAX, CELL_MIN, MAX_FLOOR as i8, 255, 255).is_ok());
}

#[test]
fn player_position_walk_across_chunk_edges_and_floors_updates_and_crosses() {
    use sim::player_position::{Write, plan_position};
    let walk = [
        (-1, 0, 0),
        (0, 0, 0),
        (31, 5, 0),
        (32, 5, 0),
        (32, 5, -1),
        (-33, -40, 7),
    ];
    let mut exists = false;
    let (mut updates, mut crossings) = (0, 0);
    let mut last = None;
    for (x, y, f) in walk {
        let w = plan_position(exists, x, y, f, 0, 0).expect("in range");
        let (Write::Insert(r) | Write::Update(r)) = w;
        updates += usize::from(matches!(w, Write::Update(_)));
        crossings += usize::from(last.is_some_and(|k| k != r.chunk_key));
        last = Some(r.chunk_key);
        exists = true;
    }
    assert_eq!(updates, walk.len() - 1);
    assert_eq!(crossings, 4, "four chunk or floor changes along the walk");
}

//! The stamp a measured generation block carries: the `GENERATION_VERSION`
//! and a fingerprint of every input a sweep reads (the `generation.*`
//! balance rows, the rule rows and the building types). A retune moves
//! generated output without a version bump, so the version alone cannot
//! tell a stale block from a current one.
//!
//! [`MEASURED_BLOCKS`] is the one registry of blocks: `measure-generation`
//! prints each header through [`stamp`], and [`check_doc`] holds
//! `docs/generation.md` to the registry.

use sim::generated::defs::{
    BalanceSeed, BuildingTypeDef, RoomTypeDef, TagDef, TagPlacement, TagStructure,
};
use sim::generation::GenerationContent;
use sim::rules::RuleDef;

/// `.github/workflows/ci.yml`'s top-level `PROPTEST_CASES` (a test pins
/// the two together).
pub const CI_PROPTEST_CASES: u32 = 4096;

/// The text every proptest-gated ceiling's report carries; a `Proptest`
/// block's pasted output must contain it.
pub const IMPLIED_CASES_MARKER: &str = "implied 4096-case";

/// Which kind of figure a block backs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BlockKind {
    /// Per-seed bounds proptest draws arbitrary seeds against: the block
    /// carries the miss rate and the implied CI failure probability.
    Proptest,
    /// Pooled or fixed-seed figures: deterministic facts, no miss rate.
    FixedSeed,
}

/// One measured block of `docs/generation.md`.
#[derive(Debug, Clone, Copy)]
pub struct MeasuredBlock {
    /// The label its stamp line starts with.
    pub label: &'static str,
    /// The `measure-generation` subcommand that prints it (empty: the
    /// default run).
    pub subcommand: &'static str,
    /// The arguments the pasted block was run with (a seed count).
    pub rerun_args: &'static str,
    pub kind: BlockKind,
    /// The `defs::BALANCE` keys the block's figures bound.
    pub ceilings: &'static [&'static str],
}

impl MeasuredBlock {
    /// The command that regenerates this block.
    pub fn rerun_command(&self) -> String {
        let mut command = String::from("cargo run -p bounds --release --bin measure-generation");
        if !self.subcommand.is_empty() {
            command.push_str(" -- ");
            command.push_str(self.subcommand);
            if !self.rerun_args.is_empty() {
                command.push(' ');
                command.push_str(self.rerun_args);
            }
        }
        command
    }
}

pub const DETOUR_SWEEP: MeasuredBlock = MeasuredBlock {
    label: "detour-bounds sweep",
    subcommand: "detour",
    rerun_args: "1000000",
    kind: BlockKind::Proptest,
    ceilings: &[
        "generation.streets.max_detour_percent",
        "generation.streets.max_detour_excess_cells",
        "generation.streets.p99_detour_fill_percent",
        "generation.streets.peripheral_low_band_floor_percent",
    ],
};

pub const BAND_SWEEP: MeasuredBlock = MeasuredBlock {
    label: "band sweep",
    subcommand: "bands",
    rerun_args: "1000000",
    kind: BlockKind::Proptest,
    ceilings: &[
        "generation.land_use.share_tolerance_pct",
        "generation.envelopes.count_tolerance_percent",
        "generation.building_types.workplace_count_tolerance_percent",
        "generation.neighbourhood.busy_screen_min_citizens",
        "generation.neighbourhood.quiet_edge_max_percent_of_core",
        "generation.neighbourhood.legibility_min_shop_mix_percent",
        "generation.neighbourhood.legibility_pole_shop_mix_percent",
        "generation.neighbourhood.legibility_min_distance_percent",
        "generation.neighbourhood.legible_step",
        "generation.neighbourhood.min_corners",
        "generation.neighbourhood.min_apart_neighbourhoods",
        "generation.neighbourhood.min_home_cells",
        "generation.land_use.institutional_min_pockets",
        "generation.land_use.institutional_max_pocket_share_percent",
        "generation.building_types.profession_count_per_city_min",
        "generation.land_use.share_commercial_pct",
        "generation.land_use.share_industrial_pct",
        "generation.land_use.share_institutional_pct",
    ],
};

pub const EXHAUSTIVE_LOOP: MeasuredBlock = MeasuredBlock {
    label: "exhaustive loop",
    subcommand: "",
    rerun_args: "",
    kind: BlockKind::FixedSeed,
    ceilings: &[
        "generation.streets.max_detour_excess_cells",
        "generation.plots.max_open_percent_by_count",
        "generation.plots.max_open_percent_by_area",
        "generation.plots.max_unplotted_percent",
        "generation.envelopes.max_rejected_plot_percent",
        "generation.envelopes.target_count_per_million_cells",
        "generation.envelopes.mean_count_tolerance_percent",
        "generation.envelopes.mean_width_cells",
        "generation.envelopes.mean_width_tolerance_cells",
        "generation.envelopes.mean_depth_cells",
        "generation.envelopes.mean_depth_tolerance_cells",
        "generation.building_types.target_workplaces_per_million_cells",
        "generation.building_types.workplace_mean_count_tolerance_percent",
        "generation.building_types.target_profession_count",
        "generation.building_types.profession_count_mean_tolerance_percent",
        "generation.building_types.min_employers_per_profession",
    ],
};

pub const REGION_LOSS_SWEEP: MeasuredBlock = MeasuredBlock {
    label: "region-loss sweep",
    subcommand: "regions",
    rerun_args: "1000000",
    kind: BlockKind::Proptest,
    ceilings: &[],
};

pub const ROWS_SWEEP: MeasuredBlock = MeasuredBlock {
    label: "rows sweep",
    subcommand: "rows",
    rerun_args: "1000000",
    kind: BlockKind::Proptest,
    ceilings: &[],
};

pub const POOLED_EVIDENCE: MeasuredBlock = MeasuredBlock {
    label: "pooled evidence",
    subcommand: "pooled",
    rerun_args: "",
    kind: BlockKind::FixedSeed,
    ceilings: &[
        "generation.streets.peripheral_pooled_min_ratio_percent",
        "generation.catchment_floor_min_bite_percent",
        "generation.neighbourhood.shuttered_bottom_third_min_percent",
        "generation.neighbourhood.quiet_edge_pooled_max_percent_of_core",
        "generation.neighbourhood.busy_core_over_city_min_percent",
        "generation.neighbourhood.nfr15a_screen_citizens_tenths",
        "generation.neighbourhood.nfr15a_tolerance_percent",
        "generation.streets.thin_strip_long_side_percent",
    ],
};

pub const INTERIORS_SWEEP: MeasuredBlock = MeasuredBlock {
    label: "interiors sweep",
    subcommand: "interiors",
    rerun_args: "",
    kind: BlockKind::FixedSeed,
    ceilings: &[
        "generation.interiors.min_enterable_count",
        "generation.interiors.max_rejected_percent",
        "generation.interiors.enterable_target_percent",
        "generation.interiors.enterable_target_tolerance_percent",
    ],
};

/// Every block `docs/generation.md` carries a stamped copy of.
pub const MEASURED_BLOCKS: &[MeasuredBlock] = &[
    DETOUR_SWEEP,
    BAND_SWEEP,
    EXHAUSTIVE_LOOP,
    ROWS_SWEEP,
    REGION_LOSS_SWEEP,
    POOLED_EVIDENCE,
    INTERIORS_SWEEP,
];

const AUTHORED: &str = "authored input, not a measured ceiling";
const TUNED: &str = "authored knob tuned against a figure in a stamped block, not itself a ceiling";
const ASSERTED: &str =
    "asserted directly by a deterministic fixed-seed or content test on every run";

/// Every `generation.*` balance key that is in no block's `ceilings`, with
/// the reason it is not a measured ceiling. A new generation key is in
/// exactly one of the two places or the build is red.
pub const NOT_MEASURED: &[(&str, &str)] = &[
    ("generation.interiors.max_layout_attempts", AUTHORED),
    ("generation.interiors.max_room_aspect", AUTHORED),
    (
        "generation.interiors.dwelling_min_enterable_percent",
        ASSERTED,
    ),
    ("generation.interiors.shop_min_enterable_percent", ASSERTED),
    ("generation.interiors.cafe_min_enterable_percent", ASSERTED),
    (
        "generation.interiors.back_room_min_enterable_percent",
        ASSERTED,
    ),
    ("generation.interiors.max_kind_share_percent", ASSERTED),
    (
        "generation.envelopes.commercial_min_interior_depth_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.commercial_min_interior_width_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.industrial_min_interior_depth_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.industrial_min_interior_width_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.institutional_min_interior_depth_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.institutional_min_interior_width_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.residential_min_interior_depth_cells",
        AUTHORED,
    ),
    (
        "generation.envelopes.residential_min_interior_width_cells",
        AUTHORED,
    ),
    ("generation.land_use.min_leaf_cells", AUTHORED),
    (
        "generation.neighbourhood.desirability_state_floor",
        AUTHORED,
    ),
    (
        "generation.neighbourhood.max_end_stranded_professions",
        ASSERTED,
    ),
    (
        "generation.neighbourhood.min_patch_span_viewports",
        AUTHORED,
    ),
    (
        "generation.neighbourhood.position_independence_max_distance_percent",
        ASSERTED,
    ),
    (
        "generation.streets.max_street_splits_per_superblock",
        AUTHORED,
    ),
    ("generation.catchment_extent_cells", AUTHORED),
    ("generation.envelopes.max_depth_cells", AUTHORED),
    ("generation.envelopes.max_width_cells", AUTHORED),
    ("generation.envelopes.min_distinct_sizes", TUNED),
    ("generation.envelopes.side_gap_periphery_cells", AUTHORED),
    ("generation.envelopes.size_trim_max_cells", AUTHORED),
    ("generation.envelopes.wall_thickness_cells", AUTHORED),
    ("generation.land_use.coarse_cell_size_cells", AUTHORED),
    ("generation.land_use.density_max", AUTHORED),
    ("generation.land_use.density_min", AUTHORED),
    ("generation.land_use.density_peak_offset_max_pct", AUTHORED),
    ("generation.land_use.density_peak_offset_min_pct", AUTHORED),
    ("generation.land_use.max_leaf_cells", AUTHORED),
    ("generation.land_use.max_recursion_depth", AUTHORED),
    ("generation.land_use.share_residential_pct", AUTHORED),
    ("generation.land_use.split_jitter_pct", AUTHORED),
    ("generation.neighbourhood.affluence_max", AUTHORED),
    ("generation.neighbourhood.affluence_min", AUTHORED),
    ("generation.neighbourhood.building_age_max", AUTHORED),
    ("generation.neighbourhood.building_age_min", AUTHORED),
    ("generation.neighbourhood.building_age_spread", AUTHORED),
    ("generation.neighbourhood.citizens_per_dwelling", AUTHORED),
    ("generation.neighbourhood.citizens_per_post", AUTHORED),
    ("generation.neighbourhood.dwelling_tag_id", AUTHORED),
    ("generation.neighbourhood.extreme_share_percent", AUTHORED),
    ("generation.neighbourhood.legibility_min_shops", AUTHORED),
    ("generation.neighbourhood.pole_min_share_percent", ASSERTED),
    ("generation.neighbourhood.poor_band_max", AUTHORED),
    ("generation.neighbourhood.state_weight_affluence", AUTHORED),
    ("generation.neighbourhood.state_weight_age", AUTHORED),
    ("generation.neighbourhood.viewport_height_cells", AUTHORED),
    ("generation.neighbourhood.viewport_width_cells", AUTHORED),
    ("generation.plots.commercial_row_depth_cells", AUTHORED),
    ("generation.plots.commercial_width_max_cells", AUTHORED),
    ("generation.plots.commercial_width_min_cells", AUTHORED),
    ("generation.plots.frontage_min_cells", AUTHORED),
    ("generation.plots.high_density_threshold", AUTHORED),
    ("generation.plots.industrial_row_depth_cells", AUTHORED),
    ("generation.plots.industrial_width_max_cells", AUTHORED),
    ("generation.plots.industrial_width_min_cells", AUTHORED),
    ("generation.plots.institutional_row_depth_cells", AUTHORED),
    ("generation.plots.institutional_width_max_cells", AUTHORED),
    ("generation.plots.institutional_width_min_cells", AUTHORED),
    ("generation.plots.max_core_depth_cells", AUTHORED),
    ("generation.plots.max_core_depth_periphery_cells", AUTHORED),
    ("generation.plots.open_min_side_cells", AUTHORED),
    ("generation.plots.residential_row_depth_cells", AUTHORED),
    ("generation.plots.residential_width_max_cells", AUTHORED),
    ("generation.plots.residential_width_min_cells", AUTHORED),
    ("generation.plots.setback_periphery_cells", AUTHORED),
    ("generation.site_extent_cells", AUTHORED),
    ("generation.streets.arterial_count_ew_max", AUTHORED),
    ("generation.streets.arterial_count_ew_min", AUTHORED),
    ("generation.streets.arterial_count_ns_max", AUTHORED),
    ("generation.streets.arterial_count_ns_min", AUTHORED),
    ("generation.streets.arterial_jitter_pct", AUTHORED),
    ("generation.streets.arterial_width_cells", AUTHORED),
    ("generation.streets.block_size_max_cells", TUNED),
    ("generation.streets.block_size_min_cells", TUNED),
    ("generation.streets.junction_min_separation_cells", AUTHORED),
    ("generation.streets.lane_width_cells", AUTHORED),
    ("generation.streets.max_block_depth_max_cells", TUNED),
    ("generation.streets.max_block_depth_min_cells", TUNED),
    ("generation.streets.max_lane_splits", AUTHORED),
    ("generation.streets.max_recursion_depth", AUTHORED),
    ("generation.streets.min_block_depth_cells", TUNED),
    ("generation.streets.min_distinct_block_sizes", TUNED),
    ("generation.streets.split_jitter_pct", AUTHORED),
    ("generation.streets.street_width_cells", AUTHORED),
];

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

/// One canonical line per `BuildingTypeDef`. The struct is destructured
/// exhaustively (no `..`): a new codegen field fails to compile here until
/// someone decides whether it is hashed.
fn building_type_line(t: &BuildingTypeDef) -> String {
    let BuildingTypeDef {
        id,
        key,
        tags,
        land_uses,
        density_min,
        density_max,
        affluence_min,
        affluence_max,
        min_interior_width_cells,
        min_interior_depth_cells,
        weight,
        requires_site,
        prefers_site,
        density_affinity,
        professions,
        rooms,
        optional_rooms,
    } = *t;
    fn join<T: ToString>(items: &[T]) -> String {
        items
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join(",")
    }
    fn flags(items: &[bool]) -> String {
        items
            .iter()
            .map(|&b| if b { "1" } else { "0" })
            .collect::<Vec<_>>()
            .join("")
    }
    format!(
        "building_type.{id}:{key}:tags={}:land_uses={}:density={density_min}..{density_max}:affluence={affluence_min}..{affluence_max}:min_interior={min_interior_width_cells}x{min_interior_depth_cells}:weight={weight}:requires_site={}:prefers_site={}:density_affinity={density_affinity}:professions={}:rooms={}:optional_rooms={}\n",
        join(tags),
        flags(&land_uses),
        flags(&requires_site),
        flags(&prefers_site),
        join(professions),
        join(rooms),
        join(optional_rooms),
    )
}

/// One canonical line per `RoomTypeDef`, destructured exhaustively.
fn room_type_line(t: &RoomTypeDef) -> String {
    let RoomTypeDef {
        id,
        key,
        tags,
        access,
        rear,
        min_width_cells,
        min_depth_cells,
        weight,
    } = *t;
    let tags = tags
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let rear = rear.map_or_else(
        || "-".to_string(),
        |r| r.iter().map(u32::to_string).collect::<Vec<_>>().join(","),
    );
    format!(
        "room_type.{id}:{key}:tags={tags}:access={access}:rear={rear}:min={min_width_cells}x{min_depth_cells}:weight={weight}\n"
    )
}

/// One canonical line per `TagDef`, destructured exhaustively.
fn tag_line(t: &TagDef) -> String {
    let TagDef {
        id,
        key,
        role,
        structure,
        placement,
    } = *t;
    let role = role.map_or_else(
        || "-".to_string(),
        |r| {
            r.layers
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",")
        },
    );
    let structure = structure.map_or("-", |s| match s {
        TagStructure::Wall => "wall",
        TagStructure::WallRun => "wall_run",
        TagStructure::Floor => "floor",
        TagStructure::Threshold => "threshold",
        TagStructure::Entrance => "entrance",
        TagStructure::Pavement => "pavement",
        TagStructure::Fixture => "fixture",
    });
    let placement = placement.map_or("-", |p| match p {
        TagPlacement::WallBacked => "wall_backed",
        TagPlacement::FreeStanding => "free_standing",
        TagPlacement::WallMounted => "wall_mounted",
        TagPlacement::FacingDoor => "facing_door",
    });
    format!("tag.{id}:{key}:role={role}:structure={structure}:placement={placement}\n")
}

/// FNV-1a (64-bit) over the sorted canonical lines of every input the
/// generator reads: the `generation.*` balance rows, every rule row of
/// `content.rules` and every building type of `content`. Row order and
/// non-`generation.` balance rows do not matter.
pub fn inputs_fingerprint(balance: &[BalanceSeed], content: &GenerationContent) -> u64 {
    let rule_lines: Vec<String> = content.rules.iter().map(RuleDef::canonical_line).collect();
    fingerprint_of(
        balance,
        &rule_lines,
        content.building_types,
        content.room_types,
        content.tags,
    )
}

fn fingerprint_of(
    balance: &[BalanceSeed],
    rule_lines: &[String],
    building_types: &[BuildingTypeDef],
    room_types: &[RoomTypeDef],
    tags: &[TagDef],
) -> u64 {
    let mut lines: Vec<String> = balance
        .iter()
        .filter(|r| r.key.starts_with("generation."))
        .map(|r| format!("balance.{}={}\n", r.key, r.value))
        .collect();
    lines.extend(rule_lines.iter().map(|l| format!("rule.{l}\n")));
    lines.extend(building_types.iter().map(building_type_line));
    lines.extend(room_types.iter().map(room_type_line));
    lines.extend(tags.iter().map(tag_line));
    lines.sort_unstable();
    let mut hash = FNV_OFFSET;
    for byte in lines.iter().flat_map(|l| l.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// The fingerprint of the committed inputs.
pub fn current_fingerprint() -> u64 {
    inputs_fingerprint(
        sim::generated::defs::BALANCE,
        &GenerationContent::committed(),
    )
}

/// `<label> at GENERATION_VERSION=<n> fingerprint=<16 hex>` -- the one
/// printer; [`parse_stamp`] is its inverse.
pub fn render_stamp(block: &MeasuredBlock, version: u32, fingerprint: u64) -> String {
    format!(
        "{} at GENERATION_VERSION={version} fingerprint={fingerprint:016x}",
        block.label
    )
}

/// The stamp of `block` at the committed version and inputs.
pub fn stamp(block: &MeasuredBlock) -> String {
    render_stamp(
        block,
        sim::generation::GENERATION_VERSION,
        current_fingerprint(),
    )
}

/// `(label, version, fingerprint hex)` of a stamp line, read from the
/// start of `line`.
pub fn parse_stamp(line: &str) -> Option<(&str, u32, &str)> {
    let (label, rest) = line.split_once(" at GENERATION_VERSION=")?;
    let (version, rest) = rest.split_once(" fingerprint=")?;
    let hex_len = rest.chars().take_while(char::is_ascii_hexdigit).count();
    if hex_len == 0 {
        return None;
    }
    Some((label, version.parse().ok()?, &rest[..hex_len]))
}

/// One proptest ceiling's miss count, rate and the failure probability a
/// [`CI_PROPTEST_CASES`]-case run implies (`1 - (1 - p)^cases`); with zero
/// misses, the rule-of-three bound (`3 / n` per seed) as well, since zero
/// observed misses is a bound, not a zero rate. Every proptest sweep
/// prints its ceilings through this one function.
pub fn ceiling_report(name: &str, count: u64, seeds: &[u64], n: u64) -> String {
    let rate = count as f64 / n as f64;
    let implied = 1.0 - (1.0 - rate).powi(CI_PROPTEST_CASES as i32);
    let mut out = format!(
        "  {name}: {count} of {n} misses (rate {:.6}%), {IMPLIED_CASES_MARKER} CI failure probability {:.6}%, offending seeds: {seeds:?}",
        rate * 100.0,
        implied * 100.0
    );
    if count == 0 {
        let bound = 3.0 / n as f64;
        let implied_bound = 1.0 - (1.0 - bound).powi(CI_PROPTEST_CASES as i32);
        out.push_str(&format!(
            "\n    zero observed misses over {n} seeds is a bound, not a zero rate -- rule-of-three upper bound on the per-seed miss probability: {:.6}% ({IMPLIED_CASES_MARKER} CI failure probability <= {:.4}%)",
            bound * 100.0,
            implied_bound * 100.0
        ));
    }
    out
}

/// What a doc violates.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ViolationKind {
    StaleVersion,
    StaleFingerprint,
    MissingBlock,
    UnregisteredLabel,
    UnstampedQuote,
    DisagreeingStamps,
    StampOutsideFence,
    MissingCeilingReport,
}

/// One violation, naming the block it concerns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Violation {
    pub kind: ViolationKind,
    /// The block's label (the line's, for an unregistered label; the
    /// nearest enclosing stamp's, or empty, for an unstamped quote).
    pub block: String,
    pub message: String,
}

/// Whether `line` has `GENERATION_VERSION` followed (past backticks,
/// spaces and `=`) by a digit.
pub fn quotes_a_version(line: &str) -> bool {
    const NEEDLE: &str = "GENERATION_VERSION";
    let mut rest = line;
    while let Some(at) = rest.find(NEEDLE) {
        rest = &rest[at + NEEDLE.len()..];
        let after = rest.trim_start_matches(['`', ' ', '=']);
        if after.starts_with(|c: char| c.is_ascii_digit()) {
            return true;
        }
    }
    false
}

/// Whether a comment line (`//`, `///`, `//!` or `#`) restates a
/// measurement: a seed count (`1,000,000 seeds`, `15,000 arbitrary seeds`,
/// `50,000-seed`, `of 3,000 seeds`, `seeds 0..256`) or a
/// `measured minimum|maximum|min|max <n>` figure. Figures live only in
/// stamped blocks; a comment names the block.
pub fn comment_restates_a_measurement(line: &str) -> bool {
    let t = line.trim_start();
    let comment = if let Some(at) = t.find("//") {
        &t[at..]
    } else if t.starts_with('#') {
        t
    } else {
        return false;
    };
    let words: Vec<&str> = comment.split_whitespace().collect();
    let trim = |w: &str| -> String { w.trim_matches(|c: char| "()`.;:,".contains(c)).to_string() };
    let numeric = |w: &str| trim(w).starts_with(|c: char| c.is_ascii_digit());
    // A seed count: digits, commas and underscores only, at least 100.
    let count = |w: &str| {
        let t = trim(w);
        let t = t.strip_suffix("-seed").unwrap_or(&t);
        !t.is_empty()
            && t.chars()
                .all(|c| c.is_ascii_digit() || c == ',' || c == '_')
            && t.replace([',', '_'], "")
                .parse::<u64>()
                .is_ok_and(|n| n >= 100)
    };
    const ADJECTIVES: [&str; 6] = [
        "mixed",
        "arbitrary",
        "random",
        "drawn",
        "uniformly",
        "genuinely",
    ];
    for (i, w) in words.iter().enumerate() {
        let bare = trim(w);
        // `50,000-seed`, `1,000,000-seed`
        if bare.ends_with("-seed") && count(&bare) {
            return true;
        }
        if bare == "seeds" {
            // `<n> [adjectives] seeds`
            let mut j = i;
            while j > 0 && ADJECTIVES.contains(&trim(words[j - 1]).as_str()) {
                j -= 1;
            }
            if j > 0 && count(words[j - 1]) {
                return true;
            }
            // `seeds 0..256`, `seeds 0..=255`
            if words
                .get(i + 1)
                .is_some_and(|n| numeric(n) && n.contains(".."))
            {
                return true;
            }
        }
        // `measured minimum 19`, `measured max 88`
        if bare == "measured"
            && words.get(i + 1).is_some_and(|m| {
                ["minimum", "maximum", "min", "max", "worst"].contains(&trim(m).as_str())
            })
            && words.get(i + 2).is_some_and(|n| numeric(n))
        {
            return true;
        }
    }
    false
}

/// Holds `text` (`docs/generation.md`) to `registry` at `version` and
/// `fingerprint`: every registered block has a stamp inside a fenced code
/// block, every stamp's label is registered, no two stamps of one label
/// disagree, every stamp is current, a `Proptest` block carries its
/// implied-CI-failure line, and no other line quotes a
/// `GENERATION_VERSION` number. Reports every violation.
pub fn check_doc(
    text: &str,
    registry: &[MeasuredBlock],
    version: u32,
    fingerprint: u64,
) -> Vec<Violation> {
    let want_fp = format!("{fingerprint:016x}");
    let mut out = Vec::new();
    // (label, version, fingerprint, fence-contents-as-text)
    let mut stamps: Vec<(String, u32, String, String)> = Vec::new();
    let mut fence: Option<Vec<&str>> = None;
    let mut fence_stamps: Vec<usize> = Vec::new();
    let finish = |lines: Vec<&str>,
                  idx: &mut Vec<usize>,
                  stamps: &mut Vec<(String, u32, String, String)>| {
        let body = lines.join("\n");
        for &i in idx.iter() {
            stamps[i].3 = body.clone();
        }
        idx.clear();
    };
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("```") {
            match fence.take() {
                Some(lines) => finish(lines, &mut fence_stamps, &mut stamps),
                None => fence = Some(Vec::new()),
            }
            continue;
        }
        if let Some((label, v, hex)) = parse_stamp(trimmed) {
            if fence.is_some() {
                fence_stamps.push(stamps.len());
                stamps.push((label.to_string(), v, hex.to_string(), String::new()));
            } else {
                out.push(Violation {
                    kind: ViolationKind::StampOutsideFence,
                    block: label.to_string(),
                    message: format!(
                        "`{label}` stamp is outside a fenced code block -- a stamp is pasted raw sweep output, never hand-typed"
                    ),
                });
            }
        } else if quotes_a_version(trimmed) {
            out.push(Violation {
                kind: ViolationKind::UnstampedQuote,
                block: String::new(),
                message: format!(
                    "a figure is quoted against a GENERATION_VERSION number outside a stamped block: `{trimmed}` -- state only current figures, in a stamped block"
                ),
            });
        }
        if let Some(lines) = fence.as_mut() {
            lines.push(line);
        }
    }
    if let Some(lines) = fence.take() {
        finish(lines, &mut fence_stamps, &mut stamps);
    }

    for (label, v, hex, body) in &stamps {
        let Some(block) = registry.iter().find(|b| b.label == label) else {
            out.push(Violation {
                kind: ViolationKind::UnregisteredLabel,
                block: label.clone(),
                message: format!(
                    "`{label}` is not in MEASURED_BLOCKS -- register it, or fix the label"
                ),
            });
            continue;
        };
        let rerun = block.rerun_command();
        if *v != version {
            out.push(Violation {
                kind: ViolationKind::StaleVersion,
                block: label.clone(),
                message: format!(
                    "`{label}` is stale: VERSION moved (measured at {v}, generator at {version}) -- re-run `{rerun}` and re-state every figure it backs"
                ),
            });
        }
        if *hex != want_fp {
            out.push(Violation {
                kind: ViolationKind::StaleFingerprint,
                block: label.clone(),
                message: format!(
                    "`{label}` is stale: the generation-inputs FINGERPRINT moved (measured under {hex}, now {want_fp}) -- a balance row, rule row or building type was retuned; re-run `{rerun}` and re-state every figure it backs"
                ),
            });
        }
        if block.kind == BlockKind::Proptest && !body.contains(IMPLIED_CASES_MARKER) {
            out.push(Violation {
                kind: ViolationKind::MissingCeilingReport,
                block: label.clone(),
                message: format!(
                    "`{label}` is a proptest-gated block and its pasted output has no `{IMPLIED_CASES_MARKER}` line -- paste `{rerun}` verbatim"
                ),
            });
        }
    }
    for block in registry {
        let found: Vec<_> = stamps.iter().filter(|s| s.0 == block.label).collect();
        if found.is_empty() {
            out.push(Violation {
                kind: ViolationKind::MissingBlock,
                block: block.label.to_string(),
                message: format!(
                    "`{}` has no `{} at GENERATION_VERSION=<n> fingerprint=<hex>` line in a fenced block -- paste `{}`'s output",
                    block.label,
                    block.label,
                    block.rerun_command()
                ),
            });
        }
        if found
            .iter()
            .any(|s| (s.1, &s.2) != (found[0].1, &found[0].2))
        {
            out.push(Violation {
                kind: ViolationKind::DisagreeingStamps,
                block: block.label.to_string(),
                message: format!(
                    "`{}` is stamped more than once and the stamps disagree -- re-run `{}` and paste one block",
                    block.label,
                    block.rerun_command()
                ),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use sim::generation::GenerationContent;

    fn row(key: &'static str, value: i64) -> BalanceSeed {
        BalanceSeed {
            key,
            value,
            min: 0,
            max: 1000,
        }
    }

    fn rows() -> Vec<BalanceSeed> {
        vec![
            row("generation.streets.max_detour_percent", 200),
            row("generation.land_use.min_leaf_cells", 4),
            row("citizen.bar_decay.rest", 10),
        ]
    }

    fn fp(balance: &[BalanceSeed], content: &GenerationContent) -> u64 {
        inputs_fingerprint(balance, content)
    }

    #[test]
    fn changes_when_a_streets_value_changes() {
        let c = GenerationContent::committed();
        let mut changed = rows();
        changed[0].value = 201;
        assert_ne!(fp(&rows(), &c), fp(&changed, &c));
    }

    #[test]
    fn changes_when_a_land_use_value_changes() {
        let c = GenerationContent::committed();
        let mut changed = rows();
        changed[1].value = 5;
        assert_ne!(fp(&rows(), &c), fp(&changed, &c));
    }

    #[test]
    fn ignores_row_order() {
        let c = GenerationContent::committed();
        let mut reordered = rows();
        reordered.reverse();
        assert_eq!(fp(&rows(), &c), fp(&reordered, &c));
    }

    #[test]
    fn ignores_a_non_generation_key() {
        let c = GenerationContent::committed();
        let mut changed = rows();
        changed[2].value = 99;
        assert_eq!(fp(&rows(), &c), fp(&changed, &c));
    }

    #[test]
    fn changes_when_a_rule_row_changes() {
        let c = GenerationContent::committed();
        let lines: Vec<String> = c.rules.iter().map(RuleDef::canonical_line).collect();
        assert!(!lines.is_empty());
        let mut changed = lines.clone();
        changed[0].push('!');
        assert_ne!(
            fingerprint_of(&rows(), &lines, c.building_types, c.room_types, c.tags),
            fingerprint_of(&rows(), &changed, c.building_types, c.room_types, c.tags)
        );
        assert_eq!(
            fp(&rows(), &c),
            fingerprint_of(&rows(), &lines, c.building_types, c.room_types, c.tags)
        );
    }

    #[test]
    fn changes_when_a_building_type_changes() {
        let base = GenerationContent::committed();
        let mut types: Vec<BuildingTypeDef> = base.building_types.to_vec();
        types[0].weight += 1;
        let changed = GenerationContent {
            rules: base.rules,
            building_types: &types,
            room_types: base.room_types,
            tags: base.tags,
        };
        assert_ne!(fp(&rows(), &base), fp(&rows(), &changed));
    }

    #[test]
    fn stamp_renders_label_version_and_sixteen_hex_digits() {
        let s = stamp(&DETOUR_SWEEP);
        assert!(s.starts_with("detour-bounds sweep at GENERATION_VERSION="));
        assert_eq!(s.rsplit('=').next().unwrap().len(), 16);
    }

    #[test]
    fn the_printed_stamp_parses_back_to_the_same_version_and_fingerprint() {
        for block in MEASURED_BLOCKS {
            let printed = render_stamp(block, 10, 0xdead_beef_0123_4567);
            let line = format!("{printed}: 5 seeds");
            assert_eq!(
                parse_stamp(&line),
                Some((block.label, 10, "deadbeef01234567")),
                "{}",
                block.label
            );
        }
    }

    const V: u32 = 10;
    const F: u64 = 0xabcd;

    fn stamped(block: &MeasuredBlock, v: u32, fingerprint: u64) -> String {
        let report = if block.kind == BlockKind::Proptest {
            format!("\n  x: 0 of 5 misses, {IMPLIED_CASES_MARKER} CI failure probability 0%")
        } else {
            String::new()
        };
        format!(
            "```text\n{}: 5 seeds{report}\n```\n",
            render_stamp(block, v, fingerprint)
        )
    }

    fn doc_of(blocks: &[MeasuredBlock]) -> String {
        blocks.iter().map(|b| stamped(b, V, F)).collect()
    }

    fn kinds(vs: &[Violation]) -> Vec<(ViolationKind, String)> {
        vs.iter().map(|v| (v.kind, v.block.clone())).collect()
    }

    #[test]
    fn a_current_doc_has_no_violations() {
        assert_eq!(
            check_doc(&doc_of(MEASURED_BLOCKS), MEASURED_BLOCKS, V, F),
            vec![]
        );
    }

    #[test]
    fn a_stale_version_names_the_block() {
        let doc = doc_of(MEASURED_BLOCKS).replace(
            &render_stamp(&ROWS_SWEEP, V, F),
            &render_stamp(&ROWS_SWEEP, V - 1, F),
        );
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        assert_eq!(
            kinds(&vs),
            vec![(ViolationKind::StaleVersion, "rows sweep".to_string())]
        );
        assert!(vs[0].message.contains("rows sweep"));
        assert!(vs[0].message.contains(&ROWS_SWEEP.rerun_command()));
    }

    #[test]
    fn a_stale_fingerprint_names_the_block() {
        let doc = doc_of(MEASURED_BLOCKS).replace(
            &render_stamp(&BAND_SWEEP, V, F),
            &render_stamp(&BAND_SWEEP, V, F + 1),
        );
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        assert_eq!(
            kinds(&vs),
            vec![(ViolationKind::StaleFingerprint, "band sweep".to_string())]
        );
        assert!(vs[0].message.contains("band sweep"));
    }

    #[test]
    fn a_registered_block_missing_from_the_doc_is_named() {
        let doc = doc_of(&MEASURED_BLOCKS[1..]);
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        assert_eq!(
            kinds(&vs),
            vec![(ViolationKind::MissingBlock, DETOUR_SWEEP.label.to_string())]
        );
    }

    #[test]
    fn an_unregistered_label_is_named() {
        let mut doc = doc_of(MEASURED_BLOCKS);
        doc.push_str("```text\nmystery sweep at GENERATION_VERSION=10 fingerprint=00ab\n```\n");
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        assert_eq!(
            kinds(&vs),
            vec![(
                ViolationKind::UnregisteredLabel,
                "mystery sweep".to_string()
            )]
        );
    }

    #[test]
    fn an_unstamped_generation_version_quote_fails() {
        for quote in [
            "76% at `GENERATION_VERSION` 8, 33% at 9.",
            "Measured at GENERATION_VERSION=9: 2.65x.",
            "at `GENERATION_VERSION`=9 the floor held",
        ] {
            let doc = format!("{}\n{quote}\n", doc_of(MEASURED_BLOCKS));
            let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
            assert_eq!(vs.len(), 1, "{quote}");
            assert_eq!(vs[0].kind, ViolationKind::UnstampedQuote, "{quote}");
            assert!(vs[0].message.contains(quote.trim()), "{quote}");
        }
    }

    #[test]
    fn a_mention_of_the_constant_without_a_number_is_not_a_quote() {
        let doc = format!(
            "{}\nBumping `GENERATION_VERSION` turns the stamps red.\n",
            doc_of(MEASURED_BLOCKS)
        );
        assert_eq!(check_doc(&doc, MEASURED_BLOCKS, V, F), vec![]);
    }

    #[test]
    fn two_stamps_of_one_label_that_disagree_are_named() {
        let mut doc = doc_of(MEASURED_BLOCKS);
        doc.push_str(&stamped(&DETOUR_SWEEP, V, F + 7));
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        let k = kinds(&vs);
        assert!(k.contains(&(
            ViolationKind::DisagreeingStamps,
            DETOUR_SWEEP.label.to_string()
        )));
        assert!(k.contains(&(
            ViolationKind::StaleFingerprint,
            DETOUR_SWEEP.label.to_string()
        )));
    }

    #[test]
    fn a_stamp_in_prose_is_rejected() {
        let doc = format!(
            "{}\n{}\n",
            doc_of(MEASURED_BLOCKS),
            render_stamp(&ROWS_SWEEP, V, F)
        );
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        assert_eq!(
            kinds(&vs),
            vec![(ViolationKind::StampOutsideFence, "rows sweep".to_string())]
        );
    }

    #[test]
    fn a_proptest_block_without_its_implied_case_line_is_named() {
        let doc = doc_of(MEASURED_BLOCKS).replace(IMPLIED_CASES_MARKER, "elided");
        let vs = check_doc(&doc, MEASURED_BLOCKS, V, F);
        assert!(
            vs.iter()
                .all(|v| v.kind == ViolationKind::MissingCeilingReport)
        );
        let names: Vec<&str> = vs.iter().map(|v| v.block.as_str()).collect();
        let expected: Vec<&str> = MEASURED_BLOCKS
            .iter()
            .filter(|b| b.kind == BlockKind::Proptest)
            .map(|b| b.label)
            .collect();
        assert_eq!(names, expected);
    }

    #[test]
    fn the_ceiling_report_prints_the_implied_line_and_the_zero_miss_bound() {
        let zero = ceiling_report("x", 0, &[], 1_000_000);
        assert!(zero.contains(IMPLIED_CASES_MARKER));
        assert!(zero.contains("rule-of-three"));
        let some = ceiling_report("x", 2, &[1, 2], 1_000_000);
        assert!(some.contains(IMPLIED_CASES_MARKER));
        assert!(!some.contains("rule-of-three"));
    }

    #[test]
    fn every_registered_ceiling_key_exists_in_the_balance_table() {
        for block in MEASURED_BLOCKS {
            for key in block.ceilings {
                assert!(
                    sim::generated::defs::BALANCE.iter().any(|r| r.key == *key),
                    "`{}` registers ceiling `{key}`, which is not a balance key",
                    block.label
                );
            }
        }
    }

    #[test]
    fn the_implied_marker_names_the_ci_case_count() {
        assert!(IMPLIED_CASES_MARKER.contains(&CI_PROPTEST_CASES.to_string()));
    }

    #[test]
    fn every_generation_key_is_a_measured_ceiling_or_listed_as_not_measured() {
        for r in sim::generated::defs::BALANCE
            .iter()
            .filter(|r| r.key.starts_with("generation."))
        {
            let measured = MEASURED_BLOCKS
                .iter()
                .filter(|b| b.ceilings.contains(&r.key))
                .count();
            let listed = NOT_MEASURED.iter().filter(|(k, _)| *k == r.key).count();
            assert!(
                (measured >= 1) != (listed >= 1) && listed <= 1,
                "`{}` must be in a block's `ceilings` or in NOT_MEASURED, not both and not neither (found {measured} blocks + {listed} listings)",
                r.key
            );
        }
    }

    #[test]
    fn not_measured_names_only_real_generation_keys_with_a_reason() {
        for (key, reason) in NOT_MEASURED {
            assert!(
                sim::generated::defs::BALANCE.iter().any(|r| r.key == *key),
                "NOT_MEASURED lists `{key}`, which is not a balance key"
            );
            assert!(!reason.is_empty(), "`{key}` has no reason");
        }
    }

    #[test]
    fn changes_with_every_field_of_a_building_type() {
        let base = GenerationContent::committed();
        let t = *base
            .building_types
            .iter()
            .find(|t| !t.tags.is_empty() && !t.professions.is_empty())
            .expect("a type with tags and professions");
        let line = building_type_line(&t);
        static OTHER_TAGS: [u32; 2] = [1, 2];
        static OTHER_PROFESSIONS: [&str; 1] = ["zzz"];
        let flip = |a: [bool; 4]| [!a[0], a[1], a[2], a[3]];
        let mutants: Vec<(&str, BuildingTypeDef)> = vec![
            ("id", BuildingTypeDef { id: t.id + 1, ..t }),
            ("key", BuildingTypeDef { key: "zzz", ..t }),
            (
                "tags",
                BuildingTypeDef {
                    tags: &OTHER_TAGS,
                    ..t
                },
            ),
            (
                "land_uses",
                BuildingTypeDef {
                    land_uses: flip(t.land_uses),
                    ..t
                },
            ),
            (
                "density_min",
                BuildingTypeDef {
                    density_min: t.density_min + 1,
                    ..t
                },
            ),
            (
                "density_max",
                BuildingTypeDef {
                    density_max: t.density_max + 1,
                    ..t
                },
            ),
            (
                "affluence_min",
                BuildingTypeDef {
                    affluence_min: t.affluence_min + 1,
                    ..t
                },
            ),
            (
                "affluence_max",
                BuildingTypeDef {
                    affluence_max: t.affluence_max + 1,
                    ..t
                },
            ),
            (
                "min_interior_width_cells",
                BuildingTypeDef {
                    min_interior_width_cells: t.min_interior_width_cells + 1,
                    ..t
                },
            ),
            (
                "min_interior_depth_cells",
                BuildingTypeDef {
                    min_interior_depth_cells: t.min_interior_depth_cells + 1,
                    ..t
                },
            ),
            (
                "weight",
                BuildingTypeDef {
                    weight: t.weight + 1,
                    ..t
                },
            ),
            (
                "requires_site",
                BuildingTypeDef {
                    requires_site: flip(t.requires_site),
                    ..t
                },
            ),
            (
                "prefers_site",
                BuildingTypeDef {
                    prefers_site: flip(t.prefers_site),
                    ..t
                },
            ),
            (
                "density_affinity",
                BuildingTypeDef {
                    density_affinity: t.density_affinity + 1,
                    ..t
                },
            ),
            (
                "professions",
                BuildingTypeDef {
                    professions: &OTHER_PROFESSIONS,
                    ..t
                },
            ),
            (
                "rooms",
                BuildingTypeDef {
                    rooms: &OTHER_TAGS,
                    ..t
                },
            ),
            (
                "optional_rooms",
                BuildingTypeDef {
                    optional_rooms: &OTHER_TAGS,
                    ..t
                },
            ),
        ];
        for (field, m) in mutants {
            assert_ne!(
                line,
                building_type_line(&m),
                "field `{field}` is not hashed"
            );
        }
    }

    #[test]
    fn changes_with_every_field_of_a_room_type_and_a_tag() {
        let base = GenerationContent::committed();
        let r = base.room_types[0];
        let line = room_type_line(&r);
        static OTHER: [u32; 2] = [1, 2];
        let mutants: Vec<(&str, RoomTypeDef)> = vec![
            ("id", RoomTypeDef { id: r.id + 1, ..r }),
            ("key", RoomTypeDef { key: "zzz", ..r }),
            ("tags", RoomTypeDef { tags: &OTHER, ..r }),
            (
                "access",
                RoomTypeDef {
                    access: r.access + 1,
                    ..r
                },
            ),
            (
                "rear",
                RoomTypeDef {
                    rear: if r.rear.is_some() { None } else { Some(&OTHER) },
                    ..r
                },
            ),
            (
                "min_width_cells",
                RoomTypeDef {
                    min_width_cells: r.min_width_cells + 1,
                    ..r
                },
            ),
            (
                "min_depth_cells",
                RoomTypeDef {
                    min_depth_cells: r.min_depth_cells + 1,
                    ..r
                },
            ),
            (
                "weight",
                RoomTypeDef {
                    weight: r.weight + 1,
                    ..r
                },
            ),
        ];
        for (field, m) in mutants {
            assert_ne!(
                line,
                room_type_line(&m),
                "room type field `{field}` is not hashed"
            );
        }
        let t = *base
            .tags
            .iter()
            .find(|t| t.placement.is_some())
            .expect("a placed tag");
        let line = tag_line(&t);
        let mutants: Vec<(&str, TagDef)> = vec![
            ("id", TagDef { id: t.id + 1, ..t }),
            ("key", TagDef { key: "zzz", ..t }),
            (
                "role",
                TagDef {
                    role: Some(sim::generated::defs::RoleDef { layers: &OTHER }),
                    ..t
                },
            ),
            (
                "structure",
                TagDef {
                    structure: Some(TagStructure::Wall),
                    ..t
                },
            ),
            (
                "placement",
                TagDef {
                    placement: None,
                    ..t
                },
            ),
        ];
        for (field, m) in mutants {
            assert_ne!(line, tag_line(&m), "tag field `{field}` is not hashed");
        }
    }

    #[test]
    fn a_comment_restating_a_seed_count_or_a_measured_extreme_is_flagged() {
        for line in [
            "# Verified at 15,000 arbitrary seeds: zero seeds land under this floor.",
            "    /// measured worst case 2.34% over the same 15,000 seeds, well",
            "/// of the harness 50,000 mixed seeds, the top three",
            "# the 1,000,000-seed mean is 350.3 (+2.1%).",
            "// Over 600,000 seeds the minimum is 43.",
            "# Pooled over seeds 0..256, a commercial core screen",
            "# differ by at least this percent (measured minimum 11 over 4096 seeds).",
            "# above the average (measured min 19 for a core).",
        ] {
            assert!(comment_restates_a_measurement(line), "{line}");
        }
    }

    #[test]
    fn a_comment_without_a_figure_or_a_non_comment_line_is_not_flagged() {
        for line in [
            "# Figures are in the `band sweep` block of `docs/generation.md`.",
            "// seeds are drawn through seed_from_ids",
            "    let seeds = 1_000_000;",
            "        \"over 1,000,000 seeds\"",
            "/// The lowest ratio is measured per seed.",
        ] {
            assert!(!comment_restates_a_measurement(line), "{line}");
        }
    }

    #[test]
    fn registry_labels_are_unique() {
        for (i, a) in MEASURED_BLOCKS.iter().enumerate() {
            assert!(MEASURED_BLOCKS[i + 1..].iter().all(|b| b.label != a.label));
        }
    }
}

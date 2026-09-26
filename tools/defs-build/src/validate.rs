//! Stage 2 of `parse, validate, emit`: cross-file and cross-kind checks a
//! single file's own parse can never catch -- duplicate ids/keys, dangling
//! references, and out-of-range balance values -- plus the conversion from
//! [`RawDefs`] (spans, one entry per file) to the plain [`Defs`]
//! [`crate::emit`] reads. Pure over an already-parsed tree; no filesystem
//! access.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use crate::codes::CodeTables;
use crate::error::DefsError;
use crate::model::*;
use crate::naming::{is_dotted_snake_case, is_snake_case};

/// A def key's own value must be snake_case (`docs/architecture.md`'s
/// naming table: "Data keys -- snake_case, matches Rust") -- distinct
/// from a file name's stem, which is kebab-case and checked in
/// `parse.rs`. Tim's direction: this is the check that keeps a key
/// permanently wrong the moment `check-defs-ids-append-only.sh` pins it.
fn check_key_format<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    for e in entries {
        if !is_snake_case(&e.key().value) {
            return Err(DefsError::new(
                e.path(),
                e.key().line,
                e.key().col,
                format!(
                    "invalid {kind} key '{}' -- keys must be snake_case (lowercase letters, digits, single underscores)",
                    e.key().value
                ),
            ));
        }
    }
    Ok(())
}

/// A balance key is dotted snake_case, every segment held to the same
/// rule as any other kind's key.
fn check_balance_key_format(entries: &[BalanceEntry]) -> Result<(), DefsError> {
    for e in entries {
        if !is_dotted_snake_case(&e.key.value) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "invalid balance key '{}' -- keys must be dotted snake_case, each segment lowercase letters, digits and single underscores",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

/// Story 2.6, Artie's direction: `defs/atlas/page-groups.toml`'s own
/// `theme -> group` table, validated separately from [`validate`]'s main
/// `Defs` tree -- it feeds the atlas packer alone, never an emitted
/// artefact, so it never needs a place on [`Defs`] itself. A theme
/// declared twice (even to the same group) is refused by name: one row
/// per theme, always.
pub fn validate_page_groups(raw: &RawDefs) -> Result<BTreeMap<String, String>, DefsError> {
    let mut table = BTreeMap::new();
    let mut first_seen: HashMap<&str, &PageGroupEntry> = HashMap::new();
    for entry in &raw.page_groups {
        if let Some(prev) = first_seen.get(entry.theme.value.as_str()) {
            return Err(DefsError::new(
                &entry.path,
                entry.theme.line,
                entry.theme.col,
                format!(
                    "theme '{}' already has a page_group row at {}:{}:{}",
                    entry.theme.value,
                    prev.path.display(),
                    prev.theme.line,
                    prev.theme.col
                ),
            ));
        }
        if entry
            .group
            .value
            .starts_with(crate::model::CHARACTER_GROUP_PREFIX)
        {
            return Err(DefsError::new(
                &entry.path,
                entry.group.line,
                entry.group.col,
                format!(
                    "theme '{}' maps to group '{}', which starts with '{}' -- that prefix is reserved for character-part groups the packer names itself, never a page_group row",
                    entry.theme.value,
                    entry.group.value,
                    crate::model::CHARACTER_GROUP_PREFIX
                ),
            ));
        }
        first_seen.insert(entry.theme.value.as_str(), entry);
        table.insert(entry.theme.value.clone(), entry.group.value.clone());
    }
    if !table.values().any(|g| g == ATLAS_SHARED_GROUP) {
        return Err(DefsError::new(
            "defs/atlas/page-groups.toml",
            0,
            0,
            format!(
                "no theme maps to '{ATLAS_SHARED_GROUP}' -- the shared group every street scene binds is a structural requirement, not a convention; map at least one theme to it"
            ),
        ));
    }
    Ok(table)
}

fn check_id_key_dupes<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    let mut seen_ids: HashMap<u32, &T> = HashMap::new();
    let mut seen_keys: HashMap<&str, &T> = HashMap::new();
    for e in entries {
        if let Some(prev) = seen_ids.get(&e.id().value) {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "duplicate {kind} id {} -- first declared at {}:{}:{}",
                    e.id().value,
                    prev.path().display(),
                    prev.id().line,
                    prev.id().col
                ),
            ));
        }
        seen_ids.insert(e.id().value, e);

        if let Some(prev) = seen_keys.get(e.key().value.as_str()) {
            return Err(DefsError::new(
                e.path(),
                e.key().line,
                e.key().col,
                format!(
                    "duplicate {kind} key '{}' -- first declared at {}:{}:{}",
                    e.key().value,
                    prev.path().display(),
                    prev.key().line,
                    prev.key().col
                ),
            ));
        }
        seen_keys.insert(e.key().value.as_str(), e);
    }
    Ok(())
}

/// Like [`check_id_key_dupes`], but over a mixed slice of trait objects --
/// the one place five otherwise-distinct entry kinds (placement,
/// distribution, coherence, adjacency, requirement) share a single id/key
/// namespace ("rule"), so a generic `&[T]` signature cannot express the
/// check (Tim's direction: rule rows share one `sim::generated::defs::
/// RULES` table, not five).
fn check_rule_id_key_dupes(entries: &[&dyn IdKeyEntry]) -> Result<(), DefsError> {
    let mut seen_ids: HashMap<u32, &dyn IdKeyEntry> = HashMap::new();
    let mut seen_keys: HashMap<&str, &dyn IdKeyEntry> = HashMap::new();
    for &e in entries {
        if let Some(prev) = seen_ids.get(&e.id().value) {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "duplicate rule id {} -- first declared at {}:{}:{}",
                    e.id().value,
                    prev.path().display(),
                    prev.id().line,
                    prev.id().col
                ),
            ));
        }
        seen_ids.insert(e.id().value, e);

        if let Some(prev) = seen_keys.get(e.key().value.as_str()) {
            return Err(DefsError::new(
                e.path(),
                e.key().line,
                e.key().col,
                format!(
                    "duplicate rule key '{}' -- first declared at {}:{}:{}",
                    e.key().value,
                    prev.path().display(),
                    prev.key().line,
                    prev.key().col
                ),
            ));
        }
        seen_keys.insert(e.key().value.as_str(), e);
    }
    Ok(())
}

fn check_balance_key_dupes(entries: &[BalanceEntry]) -> Result<(), DefsError> {
    let mut seen: HashMap<&str, &BalanceEntry> = HashMap::new();
    for e in entries {
        if let Some(prev) = seen.get(e.key.value.as_str()) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "duplicate balance key '{}' -- first declared at {}:{}:{}",
                    e.key.value,
                    prev.path.display(),
                    prev.key.line,
                    prev.key.col
                ),
            ));
        }
        seen.insert(e.key.value.as_str(), e);
    }
    Ok(())
}

fn check_recipe_item_refs(
    recipes: &[RecipeEntry],
    item_keys: &BTreeSet<&str>,
) -> Result<(), DefsError> {
    for r in recipes {
        for input in &r.inputs {
            if !item_keys.contains(input.as_str()) {
                return Err(DefsError::new(
                    &r.path,
                    r.key.line,
                    r.key.col,
                    format!(
                        "recipe '{}' names unknown item '{input}' in inputs",
                        r.key.value
                    ),
                ));
            }
        }
        for output in &r.outputs {
            if !item_keys.contains(output.as_str()) {
                return Err(DefsError::new(
                    &r.path,
                    r.key.line,
                    r.key.col,
                    format!(
                        "recipe '{}' names unknown item '{output}' in outputs",
                        r.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn check_chain_profession_refs(
    chains: &[ChainEntry],
    profession_keys: &BTreeSet<&str>,
) -> Result<(), DefsError> {
    for c in chains {
        for link in &c.links {
            if !profession_keys.contains(link.as_str()) {
                return Err(DefsError::new(
                    &c.path,
                    c.key.line,
                    c.key.col,
                    format!(
                        "chain '{}' names unknown profession '{link}' in links",
                        c.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Story 3.4 (FR116): resolves one building type's own `tags` against the
/// declared tag set -- the same shape [`resolve_object_tags`] already
/// uses, decoupled from that entry's own shape the same way.
fn resolve_building_type_tags(
    path: &std::path::Path,
    key: &Located<String>,
    tags: &[String],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<u32>, DefsError> {
    let mut ids = Vec::with_capacity(tags.len());
    for name in tags {
        match tag_ids.get(name.as_str()) {
            Some(&id) => ids.push(id),
            None => {
                let accepted: Vec<&str> = tag_ids.keys().copied().collect();
                return Err(DefsError::new(
                    path,
                    key.line,
                    key.col,
                    format!(
                        "building type '{}' names unknown tag '{}' -- accepted tags are [{}]",
                        key.value,
                        name,
                        accepted.join(", ")
                    ),
                ));
            }
        }
    }
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

fn check_building_type_tags(
    entries: &[BuildingTypeEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<(), DefsError> {
    for e in entries {
        resolve_building_type_tags(&e.path, &e.key, &e.tags, tag_ids)?;
    }
    Ok(())
}

/// A profession key named on a building type's own `professions` list
/// must already exist in `defs/professions/`, exactly like
/// [`check_chain_profession_refs`] -- unknown key = defs-build error
/// (Tim's direction), never a silently-skipped post. Zero headcount is
/// refused too: a post nobody staffs is not a post.
fn check_building_type_profession_refs(
    entries: &[BuildingTypeEntry],
    profession_keys: &BTreeSet<&str>,
) -> Result<(), DefsError> {
    for e in entries {
        for profession in &e.professions {
            if !profession_keys.contains(profession.as_str()) {
                return Err(DefsError::new(
                    &e.path,
                    e.key.line,
                    e.key.col,
                    format!(
                        "building type '{}' names unknown profession '{profession}' in professions",
                        e.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Every cross-key range a single field's own declared range cannot
/// express (story 3.4): `density_min <= density_max`, at least one
/// `land_uses` entry (an unplaceable type is a defs-authoring bug, never
/// silently generated nowhere) and a strictly positive minimum interior
/// on both axes (zero would mean "any envelope holds it", which is never
/// intended).
fn check_building_type_ranges(entries: &[BuildingTypeEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.density_min > e.density_max {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "building type '{}' has density_min ({}) greater than density_max ({})",
                    e.key.value, e.density_min, e.density_max
                ),
            ));
        }
        if e.land_uses.is_empty() {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "building type '{}' names no land_uses -- it could never be placed",
                    e.key.value
                ),
            ));
        }
        if e.min_interior_width_cells == 0 || e.min_interior_depth_cells == 0 {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "building type '{}' has a zero minimum interior dimension",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

/// Story 3.4 (PR #317 cycle 2, Quentin's/Tim's direction): a defs-
/// authoring gap must fail `defs-build`, never panic in the published
/// module -- and the three conditions the fill step's own eligibility
/// (`building_types::hard_eligible`) needs *jointly*, never as three
/// independent existence checks (cycle 1's own bug: a band covered only
/// by a `requires_site`-restricted or oversized type passed every
/// separate check and still aborted world creation, the exact shape the
/// `hospital` regression this cycle found). For every land use and every
/// density in `generation.land_use.density_min..density_max`, at least
/// one `weight > 0` type must, at once: carry no `requires_site`
/// restriction (the only site contexts `check_building_type_density_
/// coverage` can prove exist on *every* envelope of a given land use and
/// density -- a corner or a given street tier is never guaranteed),
/// cover that density, and fit that land use's own smallest envelope
/// (`generation.envelopes.{use}_min_interior_width_cells`/
/// `_depth_cells`). A no-op when `entries` is empty (nothing to cover)
/// or -- like `find_tile_size_px` -- when the generation balance keys
/// are not present at all (a fixture with no generation config to check
/// against).
fn check_building_type_density_coverage(
    entries: &[BuildingTypeEntry],
    balance: &[BalanceEntry],
) -> Result<(), DefsError> {
    if entries.is_empty() {
        return Ok(());
    }
    let get = |key: &str| -> Option<i64> {
        balance
            .iter()
            .find(|b| b.key.value == key)
            .map(|b| b.value.value)
    };
    let (Some(density_min), Some(density_max)) = (
        get("generation.land_use.density_min"),
        get("generation.land_use.density_max"),
    ) else {
        return Ok(());
    };

    const LAND_USES: [(usize, &str); 4] = [
        (0, "residential"),
        (1, "commercial"),
        (2, "industrial"),
        (3, "institutional"),
    ];
    let first = &entries[0];
    for &(idx, use_name) in &LAND_USES {
        let (Some(min_w), Some(min_d)) = (
            get(&format!(
                "generation.envelopes.{use_name}_min_interior_width_cells"
            )),
            get(&format!(
                "generation.envelopes.{use_name}_min_interior_depth_cells"
            )),
        ) else {
            continue;
        };
        let fill_rows: Vec<&BuildingTypeEntry> = entries
            .iter()
            .filter(|e| e.weight > 0 && e.land_uses.iter().any(|u| u.index() == idx))
            .collect();
        if fill_rows.is_empty() {
            return Err(DefsError::new(
                &first.path,
                first.key.line,
                first.key.col,
                format!("no weight > 0 building type is eligible for land use '{use_name}' at all"),
            ));
        }
        for density in density_min..=density_max {
            let jointly_eligible = fill_rows.iter().any(|e| {
                e.requires_site.is_empty()
                    && density >= e.density_min as i64
                    && density <= e.density_max as i64
                    && (e.min_interior_width_cells as i64) <= min_w
                    && (e.min_interior_depth_cells as i64) <= min_d
            });
            if !jointly_eligible {
                return Err(DefsError::new(
                    &first.path,
                    first.key.line,
                    first.key.col,
                    format!(
                        "no weight > 0 building type with no site-context restriction covers land use '{use_name}' at density {density} and fits its own smallest envelope ({min_w}x{min_d} interior) -- a defs-authoring gap the fill step would hit on a real seed"
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Story 3.4 (PR #317 cycle 2, Quentin's direction): the same joint-
/// eligibility question, asked of every committed `[[distribution]]`
/// row's own subject -- a type distribution places is never filtered
/// by the ordinary fill's own `weight > 0` gate, so `check_building_
/// type_density_coverage` above never sees it. If a subject type's own
/// minimum interior fits none of its own declared land uses' smallest
/// envelope, it is structurally unplaceable everywhere -- a `defs-build`
/// failure by name, never a `GenerationError::RuleViolations` on
/// whichever rare seed first tries to place it. A no-op when there are
/// no rows, no building types, or (like the check above) the generation
/// balance keys are not present at all.
fn check_distribution_subject_fits_its_own_land_use(
    building_types: &[BuildingTypeEntry],
    distributions: &[DistributionEntry],
    balance: &[BalanceEntry],
) -> Result<(), DefsError> {
    if distributions.is_empty() || building_types.is_empty() {
        return Ok(());
    }
    let get = |key: &str| -> Option<i64> {
        balance
            .iter()
            .find(|b| b.key.value == key)
            .map(|b| b.value.value)
    };
    const LAND_USE_NAMES: [&str; 4] = ["residential", "commercial", "industrial", "institutional"];

    for row in distributions {
        let subject_types: Vec<&BuildingTypeEntry> = building_types
            .iter()
            .filter(|b| b.tags.iter().any(|t| t == &row.subject.value))
            .collect();
        if subject_types.is_empty() {
            // An unresolved tag reference is a different, already-
            // checked failure (rule tag resolution below); nothing to
            // ask a fit question about here.
            continue;
        }
        let fits_somewhere = subject_types.iter().any(|b| {
            b.land_uses.iter().any(|u| {
                let use_name = LAND_USE_NAMES[u.index()];
                let (Some(min_w), Some(min_d)) = (
                    get(&format!(
                        "generation.envelopes.{use_name}_min_interior_width_cells"
                    )),
                    get(&format!(
                        "generation.envelopes.{use_name}_min_interior_depth_cells"
                    )),
                ) else {
                    // No config to check this land use against --
                    // never fail on an absent balance key.
                    return true;
                };
                (b.min_interior_width_cells as i64) <= min_w
                    && (b.min_interior_depth_cells as i64) <= min_d
            })
        });
        if !fits_somewhere {
            return Err(DefsError::new(
                &row.path,
                row.key.line,
                row.key.col,
                format!(
                    "distribution row '{}' names subject '{}', but every building type carrying that tag has a minimum interior too large for every land use it declares -- structurally unplaceable on any envelope",
                    row.key.value, row.subject.value
                ),
            ));
        }
    }
    Ok(())
}

// --- tags and rules (story 2.10, FR111/FR112) -------------------------------
//
// The rule engine's only vocabulary: a tag reference (an object's `tags`,
// or a rule row's own subject/container/per/within/a/b/requires field)
// resolves against `defs/tags/*.toml`'s own declared set here, exactly
// like `resolve_object_layer` resolves a `layer` name against the codes
// golden -- an undeclared name is refused, naming the accepted set.

/// Decoupled from any one entry shape (`path`/`key`/`tags` passed
/// explicitly) so both the raw, unlowered object list (`check_object_
/// tags`) and the lowered list (the final `ObjectDef` assembly) can call
/// it -- lowering never touches `tags`, so the two always resolve
/// identically anyway.
fn resolve_object_tags(
    path: &std::path::Path,
    key: &Located<String>,
    tags: &[String],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<u32>, DefsError> {
    let mut ids = Vec::with_capacity(tags.len());
    for name in tags {
        match tag_ids.get(name.as_str()) {
            Some(&id) => ids.push(id),
            None => {
                let accepted: Vec<&str> = tag_ids.keys().copied().collect();
                return Err(DefsError::new(
                    path,
                    key.line,
                    key.col,
                    format!(
                        "object '{}' names unknown tag '{}' -- accepted tags are [{}]",
                        key.value,
                        name,
                        accepted.join(", ")
                    ),
                ));
            }
        }
    }
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

fn check_object_tags(
    entries: &[ObjectEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<(), DefsError> {
    for e in entries {
        resolve_object_tags(&e.path, &e.key, &e.tags, tag_ids)?;
    }
    Ok(())
}

/// Resolves one rule row's own tag reference (`subject`, `container`,
/// `per`, `within`, `a`, `b`, `requires`) against the declared tag set,
/// naming the rule's own key and the offending field in the error --
/// never a literal object/def key past this function.
fn resolve_rule_tag(
    loc: &Located<String>,
    path: &std::path::Path,
    rule_key: &str,
    field: &str,
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<u32, DefsError> {
    match tag_ids.get(loc.value.as_str()) {
        Some(&id) => Ok(id),
        None => {
            let accepted: Vec<&str> = tag_ids.keys().copied().collect();
            Err(DefsError::new(
                path,
                loc.line,
                loc.col,
                format!(
                    "rule '{rule_key}' names unknown tag '{}' in {field} -- accepted tags are [{}]",
                    loc.value,
                    accepted.join(", ")
                ),
            ))
        }
    }
}

fn check_placement_floor_range(entries: &[PlacementEntry]) -> Result<(), DefsError> {
    for e in entries {
        if let (Some(min), Some(max)) = (e.floor_min, e.floor_max)
            && min > max
        {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "placement rule '{}' has floor_min {min} greater than floor_max {max}",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

/// FR112's "roughly one per N, evenly spread" needs a strictly positive
/// ratio and a strictly positive tolerance percent -- a distribution rule
/// with either at zero or negative is a malformed row, not a valid "one
/// per zero" or "zero tolerance" (Quentin's direction: named failure
/// fixtures for both).
fn check_distribution_ranges(entries: &[DistributionEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.ratio.value <= 0 {
            return Err(DefsError::new(
                &e.path,
                e.ratio.line,
                e.ratio.col,
                format!(
                    "distribution rule '{}' has ratio {} -- ratio must be a positive integer",
                    e.key.value, e.ratio.value
                ),
            ));
        }
        if e.tolerance_percent.value <= 0 {
            return Err(DefsError::new(
                &e.path,
                e.tolerance_percent.line,
                e.tolerance_percent.col,
                format!(
                    "distribution rule '{}' has tolerance_percent {} -- tolerance_percent must be a positive integer",
                    e.key.value, e.tolerance_percent.value
                ),
            ));
        }
        // AC2's "evenly spread" coverage bound (Quentin's direction, PR
        // #294 cycle 1): a zero-cell coverage radius can never be
        // satisfied by anything but a `per` cell placed exactly on a
        // `subject` cell, which is not "spread" at all -- refused here,
        // never a silently-vacuous row.
        if e.max_distance.value == 0 {
            return Err(DefsError::new(
                &e.path,
                e.max_distance.line,
                e.max_distance.col,
                format!(
                    "distribution rule '{}' has max_distance 0 -- max_distance must be a positive integer",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

fn check_requirement_range(entries: &[RequirementEntry]) -> Result<(), DefsError> {
    for e in entries {
        if let Some(max) = e.max
            && max < e.min
        {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "requirement rule '{}' has max {max} below min {}",
                    e.key.value, e.min
                ),
            ));
        }
    }
    Ok(())
}

fn build_placement_rules(
    entries: &[PlacementEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<RuleDef>, DefsError> {
    entries
        .iter()
        .map(|e| {
            let subject = resolve_rule_tag(&e.subject, &e.path, &e.key.value, "subject", tag_ids)?;
            let container = match &e.container {
                Some(loc) => Some(resolve_rule_tag(
                    loc,
                    &e.path,
                    &e.key.value,
                    "container",
                    tag_ids,
                )?),
                None => None,
            };
            Ok(RuleDef {
                id: e.id.value,
                key: e.key.value.clone(),
                kind: RuleKindDef::Placement {
                    subject,
                    container,
                    floor_min: e.floor_min,
                    floor_max: e.floor_max,
                },
            })
        })
        .collect()
}

fn build_distribution_rules(
    entries: &[DistributionEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<RuleDef>, DefsError> {
    entries
        .iter()
        .map(|e| {
            let subject = resolve_rule_tag(&e.subject, &e.path, &e.key.value, "subject", tag_ids)?;
            let per = resolve_rule_tag(&e.per, &e.path, &e.key.value, "per", tag_ids)?;
            Ok(RuleDef {
                id: e.id.value,
                key: e.key.value.clone(),
                kind: RuleKindDef::Distribution {
                    subject,
                    per,
                    ratio: e.ratio.value as u32,
                    tolerance_percent: e.tolerance_percent.value as u32,
                    min_spacing: e.min_spacing,
                    max_distance: e.max_distance.value,
                },
            })
        })
        .collect()
}

fn build_coherence_rules(
    entries: &[CoherenceEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<RuleDef>, DefsError> {
    entries
        .iter()
        .map(|e| {
            let subject = resolve_rule_tag(&e.subject, &e.path, &e.key.value, "subject", tag_ids)?;
            let within = resolve_rule_tag(&e.within, &e.path, &e.key.value, "within", tag_ids)?;
            Ok(RuleDef {
                id: e.id.value,
                key: e.key.value.clone(),
                kind: RuleKindDef::Coherence {
                    subject,
                    within,
                    mode: e.mode,
                },
            })
        })
        .collect()
}

/// One 90-degree clockwise rotation (north faces east, and so on --
/// `sim::rules::Direction::ALL`'s own order): the `rotate = true`
/// lowering applies this 0..4 times per alternative.
fn rotate_direction(d: RawDirection) -> RawDirection {
    match d {
        RawDirection::North => RawDirection::East,
        RawDirection::East => RawDirection::South,
        RawDirection::South => RawDirection::West,
        RawDirection::West => RawDirection::North,
    }
}

/// The lowercase key an error message quotes back -- the same spelling
/// `direction = "..."` is authored with in TOML.
fn direction_key(d: RawDirection) -> &'static str {
    match d {
        RawDirection::North => "north",
        RawDirection::East => "east",
        RawDirection::South => "south",
        RawDirection::West => "west",
    }
}

fn resolve_neighbour_term(
    term: &RawNeighbourTerm,
    path: &std::path::Path,
    rule_key: &str,
    line: usize,
    col: usize,
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<NeighbourTermDef, DefsError> {
    match tag_ids.get(term.tag.as_str()) {
        Some(&id) => Ok(NeighbourTermDef {
            direction: term.direction,
            tag: id,
            present: term.present,
        }),
        None => {
            let accepted: Vec<&str> = tag_ids.keys().copied().collect();
            Err(DefsError::new(
                path,
                line,
                col,
                format!(
                    "adjacency rule '{rule_key}' names unknown tag '{}' in alternatives -- accepted tags are [{}]",
                    term.tag,
                    accepted.join(", ")
                ),
            ))
        }
    }
}

/// Canonicalises one lowered alternative set: sorts each alternative's
/// own terms, then sorts and deduplicates the alternative list itself --
/// so two rows that mean the same neighbourhood pattern (authored in a
/// different term/alternative order, or arrived at via a different
/// `rotate` path) always lower to byte-identical generated text, and so
/// `evaluate`'s own behaviour (already alternative-order-independent)
/// never depends on it either.
fn canonicalise_alternatives(mut alts: Vec<Vec<NeighbourTermDef>>) -> Vec<Vec<NeighbourTermDef>> {
    for alt in &mut alts {
        alt.sort();
        alt.dedup();
    }
    alts.sort();
    alts.dedup();
    alts
}

fn build_adjacency_rules(
    entries: &[AdjacencyEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<RuleDef>, DefsError> {
    entries
        .iter()
        .map(|e| {
            let a = resolve_rule_tag(&e.a, &e.path, &e.key.value, "a", tag_ids)?;
            let alternatives = match (&e.b, &e.alternatives) {
                (Some(_), Some(_)) | (None, None) => {
                    return Err(DefsError::new(
                        &e.path,
                        e.key.line,
                        e.key.col,
                        format!(
                            "adjacency rule '{}' must set exactly one of 'b' or 'alternatives'",
                            e.key.value
                        ),
                    ));
                }
                (Some(b_loc), None) => {
                    if e.rotate {
                        return Err(DefsError::new(
                            &e.path,
                            e.key.line,
                            e.key.col,
                            format!(
                                "adjacency rule '{}' sets 'rotate' but 'rotate' only applies to 'alternatives'",
                                e.key.value
                            ),
                        ));
                    }
                    let b = resolve_rule_tag(b_loc, &e.path, &e.key.value, "b", tag_ids)?;
                    match e.direction {
                        Some(direction) => vec![vec![NeighbourTermDef {
                            direction,
                            tag: b,
                            present: true,
                        }]],
                        None => [
                            RawDirection::North,
                            RawDirection::East,
                            RawDirection::South,
                            RawDirection::West,
                        ]
                        .into_iter()
                        .map(|direction| {
                            vec![NeighbourTermDef {
                                direction,
                                tag: b,
                                present: true,
                            }]
                        })
                        .collect(),
                    }
                }
                (None, Some(raw_alts)) => {
                    if e.direction.is_some() {
                        return Err(DefsError::new(
                            &e.path,
                            e.key.line,
                            e.key.col,
                            format!(
                                "adjacency rule '{}' sets 'direction' but 'direction' only applies to 'b'",
                                e.key.value
                            ),
                        ));
                    }
                    if raw_alts.is_empty() {
                        return Err(DefsError::new(
                            &e.path,
                            e.key.line,
                            e.key.col,
                            format!(
                                "adjacency rule '{}' declares an empty 'alternatives' list",
                                e.key.value
                            ),
                        ));
                    }
                    let mut resolved: Vec<Vec<NeighbourTermDef>> = Vec::new();
                    for raw_alt in raw_alts {
                        if raw_alt.is_empty() {
                            return Err(DefsError::new(
                                &e.path,
                                e.key.line,
                                e.key.col,
                                format!(
                                    "adjacency rule '{}' declares an empty alternative in 'alternatives'",
                                    e.key.value
                                ),
                            ));
                        }
                        let mut terms = Vec::with_capacity(raw_alt.len());
                        for term in raw_alt {
                            terms.push(resolve_neighbour_term(
                                term,
                                &e.path,
                                &e.key.value,
                                e.key.line,
                                e.key.col,
                                tag_ids,
                            )?);
                        }
                        // A dead alternative: two terms naming the same
                        // direction and tag with opposite `present` can
                        // never both hold, so the alternative can never
                        // match anything (Tim's direction).
                        for i in 0..terms.len() {
                            for j in (i + 1)..terms.len() {
                                if terms[i].direction == terms[j].direction
                                    && terms[i].tag == terms[j].tag
                                    && terms[i].present != terms[j].present
                                {
                                    let tag_key = tag_ids
                                        .iter()
                                        .find(|&(_, &id)| id == terms[i].tag)
                                        .map(|(key, _)| *key)
                                        .unwrap_or("<unknown tag>");
                                    return Err(DefsError::new(
                                        &e.path,
                                        e.key.line,
                                        e.key.col,
                                        format!(
                                            "adjacency rule '{}' has a dead alternative -- it names '{tag_key}' to the {} twice, once present and once absent, so it can never match",
                                            e.key.value,
                                            direction_key(terms[i].direction),
                                        ),
                                    ));
                                }
                            }
                        }
                        if e.rotate {
                            let mut rotated = terms.clone();
                            for _ in 0..3 {
                                rotated = rotated
                                    .iter()
                                    .map(|t| NeighbourTermDef {
                                        direction: rotate_direction(t.direction),
                                        tag: t.tag,
                                        present: t.present,
                                    })
                                    .collect();
                                resolved.push(rotated.clone());
                            }
                        }
                        resolved.push(terms);
                    }
                    resolved
                }
            };
            // A `Forbid` row's own violating pair must be unambiguous
            // (Tim's direction): every alternative is exactly one
            // `present: true` term.
            if e.relation == RawAdjacencyRelation::Forbid
                && alternatives
                    .iter()
                    .any(|alt| alt.len() != 1 || !alt[0].present)
            {
                return Err(DefsError::new(
                    &e.path,
                    e.key.line,
                    e.key.col,
                    format!(
                        "adjacency rule '{}' is a 'forbid' row but names an alternative that is not a single present tag -- a forbid row's violating pair must be unambiguous",
                        e.key.value
                    ),
                ));
            }
            Ok(RuleDef {
                id: e.id.value,
                key: e.key.value.clone(),
                kind: RuleKindDef::Adjacency {
                    a,
                    relation: e.relation,
                    alternatives: canonicalise_alternatives(alternatives),
                },
            })
        })
        .collect()
}

/// The direction pointing the opposite way (north <-> south, east <->
/// west) -- swapping which of a `Forbid` row's two tags is the subject
/// only makes sense together with this flip: "a never has b to its
/// north" is "b never has a to its south", never "...to its north".
fn opposite_direction(d: RawDirection) -> RawDirection {
    match d {
        RawDirection::North => RawDirection::South,
        RawDirection::South => RawDirection::North,
        RawDirection::East => RawDirection::West,
        RawDirection::West => RawDirection::East,
    }
}

/// A `Forbid` row's own physical constraint, independent of which of the
/// two tags is the row's own subject: each alternative (already
/// guaranteed a single `present: true` term) becomes `(lo, hi,
/// direction as seen from lo)`. When the subject is the smaller id it
/// already is `lo` and the direction is kept as authored; when the
/// subject is the larger id the tags swap and the direction flips to
/// its opposite (see [`opposite_direction`]); when the two tags are
/// equal, the only remaining freedom is that same subject swap, so the
/// direction is normalised to whichever of itself and its opposite
/// sorts first by `RawDirection`'s own declaration order -- north and
/// south collapse together, and separately east and west, but a north
/// row never collapses onto an east one.
fn forbid_canonical_pairs(
    a: u32,
    alternatives: &[Vec<NeighbourTermDef>],
) -> BTreeSet<(u32, u32, RawDirection)> {
    alternatives
        .iter()
        .map(|alt| {
            let term = alt[0];
            match a.cmp(&term.tag) {
                std::cmp::Ordering::Less => (a, term.tag, term.direction),
                std::cmp::Ordering::Greater => (term.tag, a, opposite_direction(term.direction)),
                std::cmp::Ordering::Equal => {
                    let d = term.direction.min(opposite_direction(term.direction));
                    (a, term.tag, d)
                }
            }
        })
        .collect()
}

/// One `Forbid` row's own canonical constraint set (see
/// [`forbid_canonical_pairs`]) paired with its own key, so a later row
/// can be compared against every one already seen.
type ForbidCanonical<'a> = (BTreeSet<(u32, u32, RawDirection)>, &'a str);

/// Tim's direction: `road`/`floor` and `floor`/`road` (two `Forbid` rows
/// with subjects swapped) flag the same pair twice under two names --
/// refuse a second row whose lowered constraint set (up to swapping
/// subjects) already exists, or is a subset of one already seen (or the
/// reverse): a single-direction row already covered by an any-direction
/// row of the same pair is just as redundant as an exact duplicate.
fn check_no_symmetric_forbid_duplicates(
    entries: &[AdjacencyEntry],
    rules: &[RuleDef],
) -> Result<(), DefsError> {
    let mut seen: Vec<ForbidCanonical> = Vec::new();
    for (entry, rule) in entries.iter().zip(rules.iter()) {
        let RuleKindDef::Adjacency {
            a,
            relation,
            alternatives,
        } = &rule.kind
        else {
            continue;
        };
        if *relation != RawAdjacencyRelation::Forbid {
            continue;
        }
        let canonical = forbid_canonical_pairs(*a, alternatives);
        for (prev_canonical, prev_key) in &seen {
            if canonical.is_subset(prev_canonical) || prev_canonical.is_subset(&canonical) {
                return Err(DefsError::new(
                    &entry.path,
                    entry.key.line,
                    entry.key.col,
                    format!(
                        "adjacency rule '{}' forbids a tag pair and direction already forbidden by '{prev_key}' (the same tag pair, up to swapping which one is the subject, and up to direction) -- keep one",
                        entry.key.value
                    ),
                ));
            }
        }
        seen.push((canonical, &rule.key));
    }
    Ok(())
}

fn build_requirement_rules(
    entries: &[RequirementEntry],
    tag_ids: &BTreeMap<&str, u32>,
) -> Result<Vec<RuleDef>, DefsError> {
    entries
        .iter()
        .map(|e| {
            let container =
                resolve_rule_tag(&e.container, &e.path, &e.key.value, "container", tag_ids)?;
            let requires =
                resolve_rule_tag(&e.requires, &e.path, &e.key.value, "requires", tag_ids)?;
            Ok(RuleDef {
                id: e.id.value,
                key: e.key.value.clone(),
                kind: RuleKindDef::Requirement {
                    container,
                    requires,
                    min: e.min,
                    max: e.max,
                },
            })
        })
        .collect()
}

// --- archetypes (story 2.3, AC3): authoring-time classification, lowered
// away between parse and every existing geometry check -----------------

/// An archetype key's own value is snake_case, same rule as any other
/// kind's key (`check_key_format`) -- written by hand rather than reusing
/// that generic helper because an archetype carries no `id` and so
/// cannot implement [`IdKeyEntry`].
fn check_archetype_key_format(entries: &[ArchetypeEntry]) -> Result<(), DefsError> {
    for e in entries {
        if !is_snake_case(&e.key.value) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "invalid archetype key '{}' -- keys must be snake_case (lowercase letters, digits, single underscores)",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

/// An archetype has no `id`, so it shares no numeric namespace with
/// anything else -- but its own key must still be unique among
/// archetypes (Tim's direction: "the archetype's own key", named once).
fn check_archetype_key_dupes(entries: &[ArchetypeEntry]) -> Result<(), DefsError> {
    let mut seen: HashMap<&str, &ArchetypeEntry> = HashMap::new();
    for e in entries {
        if let Some(prev) = seen.get(e.key.value.as_str()) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "duplicate archetype key '{}' -- first declared at {}:{}:{}",
                    e.key.value,
                    prev.path.display(),
                    prev.key.line,
                    prev.key.col
                ),
            ));
        }
        seen.insert(e.key.value.as_str(), e);
    }
    Ok(())
}

/// Whatever an archetype can prove about itself, with no object in hand
/// (Quentin's direction: "an archetype whose collider does not fit its
/// own footprint refused by archetype name"). An archetype carries no
/// `width`, so `collider_inset.left`/`right` can only ever be checked
/// once applied to a real object's own footprint (`check_object_colliders`
/// on the lowered entry, naming the object); only the vertical extent
/// (`top`/`bottom` against the archetype's own `height`, when it
/// declares one) is knowable here.
fn check_archetype_self_consistency(entries: &[ArchetypeEntry]) -> Result<(), DefsError> {
    for a in entries {
        if a.height.is_none() && a.collider_inset.is_none() {
            return Err(DefsError::new(
                &a.path,
                a.key.line,
                a.key.col,
                format!(
                    "archetype '{}' supplies neither height nor collider_inset -- an archetype must supply at least one",
                    a.key.value
                ),
            ));
        }
        if let Some(h) = &a.height {
            if h.value == 0 {
                return Err(DefsError::new(
                    &a.path,
                    h.line,
                    h.col,
                    format!(
                        "archetype '{}' declares height 0 -- every object occupies at least one cell",
                        a.key.value
                    ),
                ));
            }
            if h.value as i64 > MAX_FOOTPRINT_CELLS {
                return Err(DefsError::new(
                    &a.path,
                    h.line,
                    h.col,
                    format!(
                        "archetype '{}' height {} exceeds MAX_FOOTPRINT_CELLS ({MAX_FOOTPRINT_CELLS})",
                        a.key.value, h.value
                    ),
                ));
            }
        }
        if let Some(inset) = &a.collider_inset {
            let c = inset.value;
            if c.left < 0 || c.top < 0 || c.right < 0 || c.bottom < 0 {
                return Err(DefsError::new(
                    &a.path,
                    inset.line,
                    inset.col,
                    format!(
                        "archetype '{}' collider_inset ({}, {}, {}, {}) has a negative inset -- left/top/right/bottom must each be 0 or more",
                        a.key.value, c.left, c.top, c.right, c.bottom
                    ),
                ));
            }
            if let Some(h) = &a.height {
                let max_y = h.value as i64 * COLLIDER_SUBCELLS_PER_CELL;
                if c.top as i64 + c.bottom as i64 >= max_y {
                    return Err(DefsError::new(
                        &a.path,
                        inset.line,
                        inset.col,
                        format!(
                            "archetype '{}' collider_inset does not fit its own footprint -- top {} + bottom {} leaves no room within height {} cell(s) ({max_y} sub-cells)",
                            a.key.value, c.top, c.bottom, h.value
                        ),
                    ));
                }
            }
        }
    }
    Ok(())
}

/// Story 2.3 (Tim's direction, cycle 1): the lowered shape every
/// `check_object_*` geometry check and the final `ObjectDef` assembly
/// take -- `height` is a plain `u32` (never `Option`), and there is no
/// `archetype` field, so an object that has not gone through
/// [`lower_object`] is a compile error at every one of those call
/// sites, not a runtime `.expect()` away from one.
#[derive(Debug)]
struct LoweredObjectEntry {
    path: std::path::PathBuf,
    id: Located<u32>,
    key: Located<String>,
    name: Located<String>,
    layer: Located<String>,
    sprite: Located<RawSpriteRect>,
    width: u32,
    height: u32,
    collider: Option<Located<RawColliderRect>>,
    interact_at: Option<Located<RawColliderRect>>,
    window: bool,
    tags: Vec<String>,
}

/// Turns an archetype's own `collider_inset` into a concrete
/// [`RawColliderRect`] once a real object's `width` and resolved
/// `height` are known -- `left`/`top` from the footprint's own
/// north-west corner, `right`/`bottom` inset from its south-east corner,
/// exactly like every hand-authored `collider` already is.
fn collider_from_inset(inset: RawColliderInset, width: u32, height: u32) -> RawColliderRect {
    let max_x = width as i64 * COLLIDER_SUBCELLS_PER_CELL;
    let max_y = height as i64 * COLLIDER_SUBCELLS_PER_CELL;
    RawColliderRect {
        x0: inset.left,
        y0: inset.top,
        x1: (max_x - inset.right as i64) as i32,
        y1: (max_y - inset.bottom as i64) as i32,
    }
}

/// Shared by [`lower_object`] (the archetype-derived path, checked
/// immediately so it can be reported at the right location -- Tim's
/// direction, cycle 1) and [`check_object_colliders`] (the
/// hand-authored path): `None` when `c` has positive area and fits
/// inside `width x height`'s own footprint, sub-cells; otherwise the
/// English fragment describing which of the two it failed, so both
/// callers render the exact same wording for the exact same defect.
fn collider_geometry_error(c: RawColliderRect, width: u32, height: u32) -> Option<String> {
    if (c.x1 as i64) <= (c.x0 as i64) || (c.y1 as i64) <= (c.y0 as i64) {
        return Some("has zero or negative area".to_string());
    }
    let max_x = width as i64 * COLLIDER_SUBCELLS_PER_CELL;
    let max_y = height as i64 * COLLIDER_SUBCELLS_PER_CELL;
    if (c.x0 as i64) < 0 || (c.y0 as i64) < 0 || (c.x1 as i64) > max_x || (c.y1 as i64) > max_y {
        return Some(format!(
            "does not fit inside its footprint (0, 0)-({max_x}, {max_y}) sub-cells"
        ));
    }
    None
}

/// Story 2.3 (AC1/AC3): resolves one object's own `height`/`collider`
/// against its optional `archetype` reference -- the one place any
/// archetype is ever applied. Every field downstream (`check_object_*`,
/// the final `ObjectDef` assembly) sees a plain, fully-resolved
/// [`LoweredObjectEntry`], exactly as if it had never named an archetype
/// (Tim's direction: no second copy of any existing check for the
/// archetype path).
fn lower_object(
    e: &ObjectEntry,
    archetypes: &BTreeMap<&str, &ArchetypeEntry>,
) -> Result<LoweredObjectEntry, DefsError> {
    let archetype = match &e.archetype {
        None => None,
        Some(loc) => match archetypes.get(loc.value.as_str()) {
            Some(&a) => Some(a),
            None => {
                let accepted: Vec<&str> = archetypes.keys().copied().collect();
                return Err(DefsError::new(
                    &e.path,
                    loc.line,
                    loc.col,
                    format!(
                        "object '{}' names unknown archetype '{}' -- accepted archetypes are [{}]",
                        e.key.value,
                        loc.value,
                        accepted.join(", ")
                    ),
                ));
            }
        },
    };

    let height = match (e.height, archetype.and_then(|a| a.height.as_ref())) {
        (Some(h), None) => h,
        (None, Some(h)) => h.value,
        (Some(_), Some(_)) => {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' declares its own height and names archetype '{}' which also supplies height -- exactly one source is allowed",
                    e.key.value,
                    e.archetype
                        .as_ref()
                        .expect("archetype present in this branch")
                        .value
                ),
            ));
        }
        (None, None) => {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' declares no height, and either names no archetype or names one with no height of its own -- exactly one source is required",
                    e.key.value
                ),
            ));
        }
    };

    let collider = match (
        &e.collider,
        archetype.and_then(|a| a.collider_inset.as_ref()),
    ) {
        (Some(c), None) => Some(c.clone()),
        (None, Some(inset)) => {
            let c = collider_from_inset(inset.value, e.width, height);
            // Checked right here, not deferred to `check_object_colliders`
            // (Tim's direction, cycle 1): the archetype's own file/line
            // (`inset.line`/`inset.col`) names a location in
            // `defs/archetypes/`, not in this object's own file, so a
            // misfit reported there would point outside the file the
            // error is about. Reported instead at the object's own
            // `archetype = "..."` line, naming both.
            let archetype_key = &e
                .archetype
                .as_ref()
                .expect("archetype present in this branch")
                .value;
            let archetype_loc = e.archetype.as_ref().expect("checked above");
            if let Some(problem) = collider_geometry_error(c, e.width, height) {
                return Err(DefsError::new(
                    &e.path,
                    archetype_loc.line,
                    archetype_loc.col,
                    format!(
                        "object '{}' collider ({}, {})-({}, {}) from archetype '{archetype_key}' {problem}",
                        e.key.value, c.x0, c.y0, c.x1, c.y1
                    ),
                ));
            }
            Some(Located::at(c, archetype_loc.line, archetype_loc.col))
        }
        (Some(_), Some(_)) => {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' declares its own collider and names archetype '{}' which also supplies a collider -- exactly one source is allowed",
                    e.key.value,
                    e.archetype
                        .as_ref()
                        .expect("archetype present in this branch")
                        .value
                ),
            ));
        }
        (None, None) => None,
    };

    Ok(LoweredObjectEntry {
        path: e.path.clone(),
        id: e.id.clone(),
        key: e.key.clone(),
        name: e.name.clone(),
        layer: e.layer.clone(),
        sprite: e.sprite.clone(),
        width: e.width,
        height,
        collider,
        interact_at: e.interact_at.clone(),
        window: e.window,
        tags: e.tags.clone(),
    })
}

/// Runs [`lower_object`] over every entry, in order -- the tree
/// `check_object_footprint_cap` onward, and the final `ObjectDef`
/// assembly, are all given this lowered list instead of `raw.objects`.
fn lower_objects(
    entries: &[ObjectEntry],
    archetypes: &BTreeMap<&str, &ArchetypeEntry>,
) -> Result<Vec<LoweredObjectEntry>, DefsError> {
    entries
        .iter()
        .map(|e| lower_object(e, archetypes))
        .collect()
}

/// FR128's containment rule: a declared `collider` must have positive
/// area and must fit entirely inside the object's own footprint, sized
/// `width*COLLIDER_SUBCELLS_PER_CELL x height*COLLIDER_SUBCELLS_PER_CELL`
/// sub-cells (Tim's direction, story 1.8). Widened to `i64` throughout
/// inside [`collider_geometry_error`] so no combination of `i32` collider
/// bounds can overflow the comparison. Quentin's direction: both
/// rectangles, collider and footprint, in the same unit (sub-cells) and a
/// fixed order, so the two are comparable by eye rather than one being
/// `WxH cells`.
///
/// Story 2.4 AC3's "collider within sprite bounds" needs no separate
/// check here: `check_object_sprite_matches_footprint` already fixes the
/// sprite to exactly the footprint's own extent (`w == width *
/// tile_size_px`, `h >= height * tile_size_px`, upward overhang only), so
/// a collider contained in the footprint is always contained in the
/// sprite -- a collider outside the sprite is therefore always outside
/// the footprint, and is refused right here, by this same check, never a
/// duplicate one.
fn check_object_colliders(entries: &[LoweredObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        let Some(collider) = &e.collider else {
            continue;
        };
        let c = collider.value;
        if let Some(problem) = collider_geometry_error(c, e.width, e.height) {
            return Err(DefsError::new(
                &e.path,
                collider.line,
                collider.col,
                format!(
                    "object '{}' collider ({}, {})-({}, {}) {problem}",
                    e.key.value, c.x0, c.y0, c.x1, c.y1
                ),
            ));
        }
    }
    Ok(())
}

/// FR128's other half (story 2.4): absence of a collider is walkability,
/// but that absence must be *declared* -- every object either blocks (a
/// `collider`) or is explicitly walkable (the [`UNDERFOOT_TAG_KEY`] tag),
/// never neither (a colliderless prop nobody thought about) and never
/// both (contradictory metadata: an object cannot block and be
/// explicitly walkable at once). Checked last among the object checks,
/// after every other object-level rejection has already had its own
/// chance to fire on a malformed row for its own reason -- this is the
/// generic catch-all, not a specific geometry check.
fn check_object_walkability_tag(entries: &[LoweredObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        let is_underfoot = e.tags.iter().any(|t| t == UNDERFOOT_TAG_KEY);
        match (&e.collider, is_underfoot) {
            (None, false) => {
                return Err(DefsError::new(
                    &e.path,
                    e.key.line,
                    e.key.col,
                    format!(
                        "object '{}' has no collider and is not tagged '{UNDERFOOT_TAG_KEY}' -- every prop either blocks (a collider) or is explicitly walkable (the '{UNDERFOOT_TAG_KEY}' tag); add one",
                        e.key.value
                    ),
                ));
            }
            (Some(_), true) => {
                return Err(DefsError::new(
                    &e.path,
                    e.key.line,
                    e.key.col,
                    format!(
                        "object '{}' declares both a collider and the '{UNDERFOOT_TAG_KEY}' tag -- an object cannot both block and be explicitly walkable",
                        e.key.value
                    ),
                ));
            }
            _ => {}
        }
    }
    Ok(())
}

/// An object on a flat-pass layer (rank below `FIRST_POOL_RANK`) lies flat
/// on the ground: it must be tagged [`UNDERFOOT_TAG_KEY`] (no vertical
/// extent means nothing to collide with -- one direction only, an
/// `underfoot` object on a pool layer is fine) and its sprite must not
/// overhang upward (`h == height * tile_size_px` exactly).
fn check_object_flat_layers(
    entries: &[LoweredObjectEntry],
    tile_size_px: u32,
    code_tables: &CodeTables,
) -> Result<(), DefsError> {
    for e in entries {
        if !code_tables.is_flat_layer(&e.layer.value) {
            continue;
        }
        if !e.tags.iter().any(|t| t == UNDERFOOT_TAG_KEY) {
            return Err(DefsError::new(
                &e.path,
                e.layer.line,
                e.layer.col,
                format!(
                    "object '{}' is on flat-pass layer '{}' but is not tagged '{UNDERFOOT_TAG_KEY}' -- an object lying flat on the ground has nothing to collide with",
                    e.key.value, e.layer.value
                ),
            ));
        }
        let expected_h = e.height * tile_size_px;
        if e.sprite.value.h != expected_h {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' is on flat-pass layer '{}' so its sprite height {} must equal its footprint height {} * tile_size_px {tile_size_px} ({expected_h}px) exactly -- a flat object never overhangs",
                    e.key.value, e.layer.value, e.sprite.value.h, e.height
                ),
            ));
        }
    }
    Ok(())
}

/// Story 2.9 (AC1, FR119): a role tag's own `layers` list must name real,
/// non-deprecated layers -- exactly the same two refusals an object's own
/// `layer` field gets (`resolve_object_layer`), since a role that could
/// never legally sit anywhere is not a role at all.
fn check_tag_role_layers(tags: &[TagEntry], code_tables: &CodeTables) -> Result<(), DefsError> {
    let layer_codes = code_tables.set("layer");
    for t in tags {
        let Some(role) = &t.role else { continue };
        if role.layers.is_empty() {
            return Err(DefsError::new(
                &t.path,
                t.key.line,
                t.key.col,
                format!(
                    "tag '{}' declares a role with no layers -- a role with nowhere to sit is not a role",
                    t.key.value
                ),
            ));
        }
        for layer in &role.layers {
            if crate::codes::DEPRECATED_LAYER_NAMES.contains(&layer.as_str()) {
                return Err(DefsError::new(
                    &t.path,
                    t.key.line,
                    t.key.col,
                    format!(
                        "tag '{}' role names deprecated layer '{layer}' -- a deprecated layer may never be placed on",
                        t.key.value
                    ),
                ));
            }
            if !layer_codes.contains_key(layer) {
                let accepted: Vec<&str> = layer_codes.keys().map(|s| s.as_str()).collect();
                return Err(DefsError::new(
                    &t.path,
                    t.key.line,
                    t.key.col,
                    format!(
                        "tag '{}' role names unknown layer '{layer}' -- accepted layers are [{}]",
                        t.key.value,
                        accepted.join(", ")
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// Story 2.9 (AC1, FR119): every object carries exactly one role tag in
/// its ordinary `tags` list -- zero (an unclassified tile, "a build
/// error, not a silent default", Artie's direction) or two (an ambiguous
/// one) are both refused by object key, never a second `role` field
/// (Tim's direction) -- and that role's own `layers` list must include
/// the object's own layer. Checked last among the object checks, after
/// `check_object_walkability_tag` -- every more specific object-level
/// rejection above gets its own chance to fire first (same reasoning as
/// that check's own placement).
fn check_object_roles(entries: &[LoweredObjectEntry], tags: &[TagEntry]) -> Result<(), DefsError> {
    let roles_by_key: BTreeMap<&str, &RawRole> = tags
        .iter()
        .filter_map(|t| t.role.as_ref().map(|r| (t.key.value.as_str(), r)))
        .collect();
    for e in entries {
        let role_tags: Vec<&str> = e
            .tags
            .iter()
            .map(|s| s.as_str())
            .filter(|k| roles_by_key.contains_key(k))
            .collect();
        if role_tags.len() != 1 {
            let accepted: Vec<&str> = roles_by_key.keys().copied().collect();
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' carries {} role tag(s) ({}) -- exactly one is required (the declared role tags are [{}])",
                    e.key.value,
                    role_tags.len(),
                    role_tags.join(", "),
                    accepted.join(", ")
                ),
            ));
        }
        let role_key = role_tags[0];
        let role = roles_by_key[role_key];
        if !role.layers.iter().any(|l| l == &e.layer.value) {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' has role '{role_key}' but layer '{}' is not among that role's allowed layers [{}]",
                    e.key.value,
                    e.layer.value,
                    role.layers.join(", ")
                ),
            ));
        }
    }
    Ok(())
}

/// FR148's reach rules (Tim's direction, story 1.9). A declared
/// `interact_at` must have positive area, must not reach further than
/// [`INTERACT_AT_MAX_REACH_CELLS`] beyond its own footprint on any side,
/// and -- when the object also declares a `collider` -- must not lie
/// entirely inside it, because a player can never stand inside a
/// collider, so such a rect could never be reached. Widened to `i64`
/// throughout, exactly like the collider check, so no combination of
/// `i32` bounds can overflow a comparison.
fn check_object_interact_at(entries: &[LoweredObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        let Some(interact_at) = &e.interact_at else {
            continue;
        };
        let r = interact_at.value;
        if (r.x1 as i64) <= (r.x0 as i64) || (r.y1 as i64) <= (r.y0 as i64) {
            return Err(DefsError::new(
                &e.path,
                interact_at.line,
                interact_at.col,
                format!(
                    "object '{}' interact_at ({}, {})-({}, {}) has zero or negative area",
                    e.key.value, r.x0, r.y0, r.x1, r.y1
                ),
            ));
        }

        let reach = INTERACT_AT_MAX_REACH_CELLS * COLLIDER_SUBCELLS_PER_CELL;
        let max_x = e.width as i64 * COLLIDER_SUBCELLS_PER_CELL;
        let max_y = e.height as i64 * COLLIDER_SUBCELLS_PER_CELL;
        if (r.x0 as i64) < -reach
            || (r.y0 as i64) < -reach
            || (r.x1 as i64) > max_x + reach
            || (r.y1 as i64) > max_y + reach
        {
            return Err(DefsError::new(
                &e.path,
                interact_at.line,
                interact_at.col,
                format!(
                    "object '{}' interact_at ({}, {})-({}, {}) reaches further than {INTERACT_AT_MAX_REACH_CELLS} cell(s) beyond its own {}x{} footprint",
                    e.key.value, r.x0, r.y0, r.x1, r.y1, e.width, e.height
                ),
            ));
        }

        if let Some(collider) = &e.collider {
            let c = collider.value;
            let inside = (r.x0 as i64) >= (c.x0 as i64)
                && (r.y0 as i64) >= (c.y0 as i64)
                && (r.x1 as i64) <= (c.x1 as i64)
                && (r.y1 as i64) <= (c.y1 as i64);
            if inside {
                return Err(DefsError::new(
                    &e.path,
                    interact_at.line,
                    interact_at.col,
                    format!(
                        "object '{}' interact_at ({}, {})-({}, {}) lies entirely inside its own collider ({}, {})-({}, {}) -- it could never be reached",
                        e.key.value, r.x0, r.y0, r.x1, r.y1, c.x0, c.y0, c.x1, c.y1
                    ),
                ));
            }
        }
    }
    Ok(())
}

fn check_object_names(entries: &[ObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.name.value.trim().is_empty() {
            return Err(DefsError::new(
                &e.path,
                e.name.line,
                e.name.col,
                format!("object '{}' has an empty name", e.key.value),
            ));
        }
    }
    Ok(())
}

/// Resolves one object's authored `layer` name against the codes golden's
/// own `name -> code` map (Tim's direction: resolved at build time, never
/// at runtime) -- refusing an unknown or deprecated name, naming the
/// object and the accepted set.
fn resolve_object_layer(e: &ObjectEntry, code_tables: &CodeTables) -> Result<u32, DefsError> {
    let layer_codes = code_tables.set("layer");
    if crate::codes::DEPRECATED_LAYER_NAMES.contains(&e.layer.value.as_str()) {
        return Err(DefsError::new(
            &e.path,
            e.layer.line,
            e.layer.col,
            format!(
                "object '{}' names deprecated layer '{}' -- a deprecated layer may never be placed on",
                e.key.value, e.layer.value
            ),
        ));
    }
    match layer_codes.get(&e.layer.value) {
        Some(&code) => Ok(code),
        None => {
            let accepted: Vec<&str> = layer_codes.keys().map(|s| s.as_str()).collect();
            Err(DefsError::new(
                &e.path,
                e.layer.line,
                e.layer.col,
                format!(
                    "object '{}' names unknown layer '{}' -- accepted layers are [{}]",
                    e.key.value,
                    e.layer.value,
                    accepted.join(", ")
                ),
            ))
        }
    }
}

fn check_object_layers(entries: &[ObjectEntry], code_tables: &CodeTables) -> Result<(), DefsError> {
    for e in entries {
        resolve_object_layer(e, code_tables)?;
    }
    Ok(())
}

/// Splits `path` on `/`, collapsing a `.` segment and resolving a `..`
/// segment against the stack of real segments already seen -- so
/// `ModernTileset/../client/x.png` cannot present as rooted under
/// `ModernTileset/` just because the literal string starts with it
/// (Quentin's direction, cycle 2). A `..` with nothing left to pop marks
/// the whole path as escaped, encoded as a leading `../` on the result
/// (never silently absorbed): that can never match any real root's own
/// prefix check, which is what makes an over-`..`'d path fail the root
/// check below rather than slip through.
fn normalize_sheet_path(path: &str) -> String {
    let mut stack: Vec<&str> = Vec::new();
    let mut escaped = false;
    for comp in path.split('/') {
        match comp {
            "" | "." => continue,
            ".." => {
                if stack.pop().is_none() {
                    escaped = true;
                }
            }
            other => stack.push(other),
        }
    }
    if escaped {
        format!("../{}", stack.join("/"))
    } else {
        stack.join("/")
    }
}

/// Whether `path` lives under `allowed_root` once normalised -- an empty
/// `allowed_root` (this crate's own unit/integration tests, which name
/// fixture sheets that live nowhere near `ModernTileset/`) always passes,
/// since every string starts with the empty string; the real binary
/// always passes [`SPRITE_SHEET_ALLOWED_ROOT`].
fn sheet_is_under_root(path: &str, allowed_root: &str) -> bool {
    normalize_sheet_path(path).starts_with(allowed_root)
}

/// A `sprite.sheet` must live under `allowed_root` (Quentin's direction,
/// cycle 2: enforced, not merely a CI-filter convention) -- checked
/// before any real file is ever read, so this is a structural, cheap
/// rejection, unlike the sheet-exists/sheet-bounds checks below it.
fn check_object_sprite_sheet_root(
    entries: &[ObjectEntry],
    allowed_root: &str,
) -> Result<(), DefsError> {
    for e in entries {
        let sheet = &e.sprite.value.sheet;
        if !sheet_is_under_root(sheet, allowed_root) {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite sheet '{sheet}' is not under the allowed root '{allowed_root}'",
                    e.key.value
                ),
            ));
        }
    }
    Ok(())
}

/// A sprite's own sheet must have had its `IHDR` dimensions read
/// (`sheet_dims`, exactly like an appearance part's `sheet`), and the
/// rect must lie entirely inside it, and have positive area.
fn check_object_sprite_sheets(
    entries: &[ObjectEntry],
    sheet_dims: &BTreeMap<String, (u32, u32)>,
) -> Result<(), DefsError> {
    for e in entries {
        let sprite = &e.sprite.value;
        let Some(&(sheet_w, sheet_h)) = sheet_dims.get(&sprite.sheet) else {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' names sheet '{}' but its dimensions were never read",
                    e.key.value, sprite.sheet
                ),
            ));
        };
        if sprite.w == 0 || sprite.h == 0 {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite rect has zero width or height",
                    e.key.value
                ),
            ));
        }
        let x1 = sprite.x as u64 + sprite.w as u64;
        let y1 = sprite.y as u64 + sprite.h as u64;
        if x1 > sheet_w as u64 || y1 > sheet_h as u64 {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite rect ({}, {})-({x1}, {y1}) does not fit inside sheet '{}' ({sheet_w}x{sheet_h}px)",
                    e.key.value, sprite.x, sprite.y, sprite.sheet
                ),
            ));
        }
    }
    Ok(())
}

/// FR126's decomposition reads per-cell sub-rects from the sprite, so the
/// sprite must agree with the footprint exactly (Tim's direction):
/// `w == width * tile_size_px` exactly (an object never overhangs
/// sideways -- that overhang was refused at mount time before this story;
/// now it is refused here, at authoring time), `h` a whole multiple of
/// `tile_size_px`, and `h >= height * tile_size_px` (a tall prop may
/// overhang upward, never downward -- bottom-anchored).
fn check_object_sprite_matches_footprint(
    entries: &[LoweredObjectEntry],
    tile_size_px: u32,
) -> Result<(), DefsError> {
    for e in entries {
        let sprite = &e.sprite.value;
        let expected_w = e.width * tile_size_px;
        if sprite.w != expected_w {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite width {} does not equal its footprint width {} * tile_size_px {tile_size_px} ({expected_w}px)",
                    e.key.value, sprite.w, e.width
                ),
            ));
        }
        if sprite.h % tile_size_px != 0 {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite height {} is not a whole multiple of tile_size_px {tile_size_px}",
                    e.key.value, sprite.h
                ),
            ));
        }
        let min_h = e.height * tile_size_px;
        if sprite.h < min_h {
            return Err(DefsError::new(
                &e.path,
                e.sprite.line,
                e.sprite.col,
                format!(
                    "object '{}' sprite height {} is shorter than its footprint height {} * tile_size_px {tile_size_px} ({min_h}px)",
                    e.key.value, sprite.h, e.height
                ),
            ));
        }
    }
    Ok(())
}

/// FR127's cap, checked on `width` and `height` independently (Tim's
/// direction) -- the error names the object and its size, and directs the
/// author to compose the structure from multiple objects (the acceptance
/// criterion's own sentence).
/// Story 6.1: an item's `unit` names a real `sim::codes::unit`, its
/// `bulk` is a footprint of 1..=`MAX_FOOTPRINT_CELLS` cells per axis (FR94:
/// the world's own footprint, unchanged), and its shelf life is bounded.
/// Each refusal points at the offending value.
fn check_item_fields(items: &[ItemEntry], code_tables: &CodeTables) -> Result<(), DefsError> {
    for i in items {
        let at =
            |line: usize, col: usize, message: String| DefsError::new(&i.path, line, col, message);
        if code_tables.get("unit", &i.unit.value).is_none() {
            let accepted: Vec<&str> = code_tables.set("unit").keys().map(|s| s.as_str()).collect();
            return Err(at(
                i.unit.line,
                i.unit.col,
                format!(
                    "item '{}' names unknown unit '{}' -- accepted: {}",
                    i.key.value,
                    i.unit.value,
                    accepted.join(", ")
                ),
            ));
        }
        for (axis, v) in [("width", &i.bulk_width), ("height", &i.bulk_height)] {
            if v.value == 0 {
                return Err(at(
                    v.line,
                    v.col,
                    format!(
                        "item '{}' bulk {axis} of 0 -- every item occupies at least one cell",
                        i.key.value
                    ),
                ));
            }
            if v.value as i64 > MAX_FOOTPRINT_CELLS {
                return Err(at(
                    v.line,
                    v.col,
                    format!(
                        "item '{}' bulk {axis} {} exceeds MAX_FOOTPRINT_CELLS ({MAX_FOOTPRINT_CELLS})",
                        i.key.value, v.value
                    ),
                ));
            }
        }
        if i.shelf_life_minutes.value > MAX_SHELF_LIFE_MINUTES {
            return Err(at(
                i.shelf_life_minutes.line,
                i.shelf_life_minutes.col,
                format!(
                    "item '{}' shelf_life_minutes {} exceeds MAX_SHELF_LIFE_MINUTES ({MAX_SHELF_LIFE_MINUTES})",
                    i.key.value, i.shelf_life_minutes.value
                ),
            ));
        }
    }
    Ok(())
}

fn check_object_footprint_cap(entries: &[LoweredObjectEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.width == 0 || e.height == 0 {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' has a footprint width or height of 0 -- every object occupies at least one cell",
                    e.key.value
                ),
            ));
        }
        if e.width as i64 > MAX_FOOTPRINT_CELLS {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' footprint width {} exceeds MAX_FOOTPRINT_CELLS ({MAX_FOOTPRINT_CELLS}) -- compose the structure from multiple objects",
                    e.key.value, e.width
                ),
            ));
        }
        if e.height as i64 > MAX_FOOTPRINT_CELLS {
            return Err(DefsError::new(
                &e.path,
                e.key.line,
                e.key.col,
                format!(
                    "object '{}' footprint height {} exceeds MAX_FOOTPRINT_CELLS ({MAX_FOOTPRINT_CELLS}) -- compose the structure from multiple objects",
                    e.key.value, e.height
                ),
            ));
        }
    }
    Ok(())
}

/// `render.tile_size_px` is a balance key like any other (`defs/balance/
/// render.toml`), read from the already-parsed tree -- never a literal
/// here. `None` when the tree declares no such key; `validate` turns that
/// into a hard error the moment the tree also declares an object (a tree
/// with objects but no `render.tile_size_px` cannot check FR126's sprite
/// agreement at all).
fn find_tile_size_px(balance: &[BalanceEntry]) -> Option<u32> {
    balance
        .iter()
        .find(|b| b.key.value == crate::model::RENDER_TILE_SIZE_PX_KEY)
        .map(|b| b.value.value as u32)
}

/// Id `0` is never issued for any appearance part kind -- it is the
/// runtime sentinel for "no layer" (legal only for a generated
/// hairstyle/accessory *value*, never for a declared def), so a declared
/// id of `0` here is always a mistake, not a valid entry.
fn check_appearance_id_not_zero<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    for e in entries {
        if e.id().value == 0 {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "{kind} '{}' declares id 0 -- 0 is reserved as the runtime \"no layer\" sentinel and is never a declared id",
                    e.key().value
                ),
            ));
        }
    }
    Ok(())
}

/// A body/eyes/hairstyle/outfit/accessory id is stored as `u16`
/// (`sim::appearance::Appearance` and the `citizen` schema columns): an
/// id above 65535 would silently truncate into a different part, so it
/// is rejected here rather than at the cast.
const APPEARANCE_ID_MAX: u32 = u16::MAX as u32;

fn check_appearance_id_u16<T: IdKeyEntry>(entries: &[T], kind: &str) -> Result<(), DefsError> {
    for e in entries {
        if e.id().value > APPEARANCE_ID_MAX {
            return Err(DefsError::new(
                e.path(),
                e.id().line,
                e.id().col,
                format!(
                    "{kind} '{}' declares id {} which does not fit in a u16 (max {APPEARANCE_ID_MAX})",
                    e.key().value,
                    e.id().value
                ),
            ));
        }
    }
    Ok(())
}

/// A layout is only ever shared within one family, so every part sheet's
/// `(animation, direction, frame)` cells must fit inside its own family's
/// declared grid -- checked against the sheet's own `IHDR` dimensions
/// (`sheet_dims`, read by `fsio` from the real file), never assumed from
/// a byte count or a vendor's own claim.
fn layout_for_family(
    layouts: &[AppearanceLayoutEntry],
    family: Family,
) -> Option<&AppearanceLayoutEntry> {
    layouts.iter().find(|l| l.family.value == family)
}

/// The part-agnostic fields [`check_sheet_fits_layout`] needs -- bundled so
/// that function stays under clippy's argument-count lint despite naming a
/// path, a span, a kind, a key, a family and a sheet all independently.
struct SheetCheck<'a> {
    path: &'a std::path::Path,
    line: usize,
    col: usize,
    kind: &'a str,
    key: &'a str,
    family: Family,
    sheet: &'a str,
}

fn check_sheet_fits_layout(
    part: SheetCheck<'_>,
    layouts: &[AppearanceLayoutEntry],
    sheet_dims: &BTreeMap<String, (u32, u32)>,
    allowed_root: &str,
) -> Result<(), DefsError> {
    let SheetCheck {
        path,
        line,
        col,
        kind,
        key,
        family,
        sheet,
    } = part;
    if !sheet_is_under_root(sheet, allowed_root) {
        return Err(DefsError::new(
            path,
            line,
            col,
            format!(
                "{kind} '{key}' sheet '{sheet}' is not under the allowed root '{allowed_root}'"
            ),
        ));
    }
    let Some(layout) = layout_for_family(layouts, family) else {
        return Err(DefsError::new(
            path,
            line,
            col,
            format!(
                "{kind} '{key}' declares family '{}' but no [[appearance_layout]] entry declares that family",
                family.as_str()
            ),
        ));
    };
    let Some(&(width, height)) = sheet_dims.get(sheet) else {
        return Err(DefsError::new(
            path,
            line,
            col,
            format!("{kind} '{key}' names sheet '{sheet}' but its dimensions were never read"),
        ));
    };
    if !layout.accepted_sizes.value.contains(&(width, height)) {
        let accepted: Vec<String> = layout
            .accepted_sizes
            .value
            .iter()
            .map(|(w, h)| format!("{w}x{h}"))
            .collect();
        return Err(DefsError::new(
            path,
            line,
            col,
            format!(
                "{kind} '{key}' sheet '{sheet}' is {width}x{height}px but family '{}' only accepts [{}]",
                family.as_str(),
                accepted.join(", ")
            ),
        ));
    }
    Ok(())
}

/// Exactly one `[[appearance_layout]]` per family (a layout is shared
/// *within* a family, so two competing layouts for the same family would
/// make "the" family layout ambiguous), a non-empty `directions` and
/// `accepted_sizes` list, and every declared row fits inside every
/// declared accepted size -- a layout that names a size too small for its
/// own grid is a defs-authoring mistake, not something to catch only once
/// a sheet happens to use that size.
fn check_one_layout_per_family(layouts: &[AppearanceLayoutEntry]) -> Result<(), DefsError> {
    let mut seen: HashMap<Family, &AppearanceLayoutEntry> = HashMap::new();
    // Story 2.7, AC1(e) (Tim's direction): every family's own strip is
    // packed at the *same* cell size -- a character-part page group mixing
    // strips of different cell sizes would need per-part page arithmetic
    // the packer never does. Every `[[appearance_layout]]` must therefore
    // declare the same `cell_width`/`cell_height` as the first one, failing
    // by layout key.
    if let Some(first) = layouts.first() {
        for l in &layouts[1..] {
            if l.cell_width != first.cell_width || l.cell_height != first.cell_height {
                return Err(DefsError::new(
                    &l.path,
                    l.key.line,
                    l.key.col,
                    format!(
                        "appearance_layout '{}' declares cell size {}x{}px but '{}' already declared {}x{}px -- every layout must share one cell size",
                        l.key.value,
                        l.cell_width,
                        l.cell_height,
                        first.key.value,
                        first.cell_width,
                        first.cell_height
                    ),
                ));
            }
        }
    }
    for l in layouts {
        if let Some(prev) = seen.get(&l.family.value) {
            return Err(DefsError::new(
                &l.path,
                l.family.line,
                l.family.col,
                format!(
                    "appearance_layout '{}' declares family '{}' but '{}' already declared it -- exactly one layout per family",
                    l.key.value,
                    l.family.value.as_str(),
                    prev.key.value
                ),
            ));
        }
        seen.insert(l.family.value, l);
        if l.directions.is_empty() {
            return Err(DefsError::new(
                &l.path,
                l.key.line,
                l.key.col,
                format!("appearance_layout '{}' declares no directions", l.key.value),
            ));
        }
        if l.accepted_sizes.value.is_empty() {
            return Err(DefsError::new(
                &l.path,
                l.accepted_sizes.line,
                l.accepted_sizes.col,
                format!(
                    "appearance_layout '{}' declares no accepted_sizes",
                    l.key.value
                ),
            ));
        }
        for r in &l.rows {
            if r.frames_per_direction == 0 {
                return Err(DefsError::new(
                    &l.path,
                    l.key.line,
                    l.key.col,
                    format!(
                        "appearance_layout '{}' row '{}' declares 0 frames_per_direction",
                        l.key.value, r.animation
                    ),
                ));
            }
        }
        let num_directions = l.directions.len() as u32;
        let needed_width = l
            .rows
            .iter()
            .map(|r| r.frames_per_direction * num_directions * l.cell_width)
            .max()
            .unwrap_or(0);
        let needed_height = l
            .rows
            .iter()
            .map(|r| (r.row + 1) * l.cell_height)
            .max()
            .unwrap_or(0);
        for &(width, height) in &l.accepted_sizes.value {
            if width < needed_width || height < needed_height {
                return Err(DefsError::new(
                    &l.path,
                    l.accepted_sizes.line,
                    l.accepted_sizes.col,
                    format!(
                        "appearance_layout '{}' declares accepted size {width}x{height}px but its own grid needs at least {needed_width}x{needed_height}px",
                        l.key.value
                    ),
                ));
            }
        }
    }
    Ok(())
}

/// A `[[uniform]]` is a fixed, permanent override for one profession's
/// outfit and/or accessory layer -- never a pool, never re-derived.
/// Every reference is validated exactly like a `chain`'s profession
/// links: the profession must exist, the override must name something
/// real, and whatever it names must actually be reserved for role use
/// (`pool = "role_only"`) on the adult family -- never a civilian part
/// (which would make it indistinguishable from a
/// random roll) and never a costume (dead content with no role to wear
/// it).
fn check_uniforms(
    uniforms: &[UniformEntry],
    profession_keys: &BTreeSet<&str>,
    outfits: &[OutfitEntry],
    accessories: &[AccessoryEntry],
) -> Result<(), DefsError> {
    let mut seen_profession: HashMap<&str, &UniformEntry> = HashMap::new();
    for u in uniforms {
        if !profession_keys.contains(u.profession.value.as_str()) {
            return Err(DefsError::new(
                &u.path,
                u.profession.line,
                u.profession.col,
                format!(
                    "uniform '{}' names unknown profession '{}'",
                    u.key.value, u.profession.value
                ),
            ));
        }
        if let Some(prev) = seen_profession.get(u.profession.value.as_str()) {
            return Err(DefsError::new(
                &u.path,
                u.profession.line,
                u.profession.col,
                format!(
                    "uniform '{}' duplicates profession '{}' already covered by uniform '{}' -- exactly one uniform per profession",
                    u.key.value, u.profession.value, prev.key.value
                ),
            ));
        }
        seen_profession.insert(u.profession.value.as_str(), u);

        if u.outfit.is_none() && u.accessory.is_none() {
            return Err(DefsError::new(
                &u.path,
                u.key.line,
                u.key.col,
                format!(
                    "uniform '{}' overrides neither outfit nor accessory -- a uniform overriding nothing is meaningless",
                    u.key.value
                ),
            ));
        }

        if let Some(outfit_key) = &u.outfit {
            let found = outfits.iter().find(|o| &o.key.value == outfit_key);
            match found {
                None => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names unknown outfit '{outfit_key}'",
                            u.key.value
                        ),
                    ));
                }
                Some(o) if o.family.value != Family::Adult || o.pool.value != Pool::RoleOnly => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names outfit '{outfit_key}' which is not an adult role_only outfit",
                            u.key.value
                        ),
                    ));
                }
                Some(_) => {}
            }
        }

        if let Some(accessory_key) = &u.accessory {
            let found = accessories.iter().find(|a| &a.key.value == accessory_key);
            match found {
                None => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names unknown accessory '{accessory_key}'",
                            u.key.value
                        ),
                    ));
                }
                Some(a) if a.family.value != Family::Adult || a.pool.value != Pool::RoleOnly => {
                    return Err(DefsError::new(
                        &u.path,
                        u.key.line,
                        u.key.col,
                        format!(
                            "uniform '{}' names accessory '{accessory_key}' which is not an adult role_only accessory",
                            u.key.value
                        ),
                    ));
                }
                Some(_) => {}
            }
        }
    }
    Ok(())
}

fn check_balance_range(entries: &[BalanceEntry]) -> Result<(), DefsError> {
    for e in entries {
        if e.value.value < e.min || e.value.value > e.max {
            return Err(DefsError::new(
                &e.path,
                e.value.line,
                e.value.col,
                format!(
                    "balance '{}' value {} is out of its own declared range [{}, {}]",
                    e.key.value, e.value.value, e.min, e.max
                ),
            ));
        }
    }
    Ok(())
}

/// Runs every cross-file/cross-kind check and returns the plain [`Defs`]
/// tree, sorted by key within each kind (Tim's direction: byte-stable
/// output regardless of file-read order). Stops at the first violation --
/// "no partial output" is a property of when `emit` is called (only after
/// this returns `Ok`), not of collecting every error at once.
///
/// `sheet_dims` carries the `(width, height)` `fsio::read_png_dims` read
/// from every appearance part's own `sheet` file -- validation never
/// touches the filesystem itself (Quentin's direction), so a caller with
/// no appearance parts in its tree (every test fixture but story 1.10's
/// own) passes an empty map.
pub fn validate(
    raw: &RawDefs,
    sheet_dims: &BTreeMap<String, (u32, u32)>,
    code_tables: &CodeTables,
    sprite_sheet_allowed_root: &str,
) -> Result<Defs, DefsError> {
    check_key_format(&raw.objects, "object")?;
    check_key_format(&raw.items, "item")?;
    check_key_format(&raw.recipes, "recipe")?;
    check_key_format(&raw.professions, "profession")?;
    check_key_format(&raw.chains, "chain")?;
    check_key_format(&raw.building_types, "building_type")?;
    check_balance_key_format(&raw.balance)?;
    check_key_format(&raw.bodies, "body")?;
    check_key_format(&raw.eyes, "eyes")?;
    check_key_format(&raw.hairstyles, "hairstyle")?;
    check_key_format(&raw.outfits, "outfit")?;
    check_key_format(&raw.accessories, "accessory")?;
    check_key_format(&raw.appearance_layouts, "appearance_layout")?;
    check_key_format(&raw.uniforms, "uniform")?;
    check_key_format(&raw.tags, "tag")?;
    check_key_format(&raw.placements, "placement")?;
    check_key_format(&raw.distributions, "distribution")?;
    check_key_format(&raw.coherences, "coherence")?;
    check_key_format(&raw.adjacencies, "adjacency")?;
    check_key_format(&raw.requirements, "requirement")?;

    check_id_key_dupes(&raw.objects, "object")?;
    check_id_key_dupes(&raw.items, "item")?;
    check_item_fields(&raw.items, code_tables)?;
    check_id_key_dupes(&raw.recipes, "recipe")?;
    check_id_key_dupes(&raw.professions, "profession")?;
    check_id_key_dupes(&raw.chains, "chain")?;
    check_id_key_dupes(&raw.building_types, "building_type")?;
    check_balance_key_dupes(&raw.balance)?;
    check_id_key_dupes(&raw.bodies, "body")?;
    check_id_key_dupes(&raw.eyes, "eyes")?;
    check_id_key_dupes(&raw.hairstyles, "hairstyle")?;
    check_id_key_dupes(&raw.outfits, "outfit")?;
    check_id_key_dupes(&raw.accessories, "accessory")?;
    check_id_key_dupes(&raw.appearance_layouts, "appearance_layout")?;
    check_id_key_dupes(&raw.uniforms, "uniform")?;
    check_id_key_dupes(&raw.tags, "tag")?;

    // Every rule kind shares one id/key namespace ("rule"), the same
    // namespace `emit_id_manifest` writes -- a `distribution` row and a
    // `requirement` row may never collide, even though they parsed from
    // different array tables.
    let rule_entries: Vec<&dyn IdKeyEntry> = raw
        .placements
        .iter()
        .map(|e| e as &dyn IdKeyEntry)
        .chain(raw.distributions.iter().map(|e| e as &dyn IdKeyEntry))
        .chain(raw.coherences.iter().map(|e| e as &dyn IdKeyEntry))
        .chain(raw.adjacencies.iter().map(|e| e as &dyn IdKeyEntry))
        .chain(raw.requirements.iter().map(|e| e as &dyn IdKeyEntry))
        .collect();
    check_rule_id_key_dupes(&rule_entries)?;

    check_appearance_id_not_zero(&raw.bodies, "body")?;
    check_appearance_id_not_zero(&raw.eyes, "eyes")?;
    check_appearance_id_not_zero(&raw.hairstyles, "hairstyle")?;
    check_appearance_id_not_zero(&raw.outfits, "outfit")?;
    check_appearance_id_not_zero(&raw.accessories, "accessory")?;
    check_appearance_id_not_zero(&raw.appearance_layouts, "appearance_layout")?;
    check_appearance_id_not_zero(&raw.uniforms, "uniform")?;

    check_appearance_id_u16(&raw.bodies, "body")?;
    check_appearance_id_u16(&raw.eyes, "eyes")?;
    check_appearance_id_u16(&raw.hairstyles, "hairstyle")?;
    check_appearance_id_u16(&raw.outfits, "outfit")?;
    check_appearance_id_u16(&raw.accessories, "accessory")?;

    let tag_ids: BTreeMap<&str, u32> = raw
        .tags
        .iter()
        .map(|t| (t.key.value.as_str(), t.id.value))
        .collect();
    check_object_tags(&raw.objects, &tag_ids)?;
    check_building_type_tags(&raw.building_types, &tag_ids)?;
    check_building_type_ranges(&raw.building_types)?;
    check_building_type_density_coverage(&raw.building_types, &raw.balance)?;
    check_distribution_subject_fits_its_own_land_use(
        &raw.building_types,
        &raw.distributions,
        &raw.balance,
    )?;
    check_tag_role_layers(&raw.tags, code_tables)?;
    check_placement_floor_range(&raw.placements)?;
    check_distribution_ranges(&raw.distributions)?;
    check_requirement_range(&raw.requirements)?;
    // Resolved eagerly (not deferred to the final assembly below) so a
    // dangling tag reference on any rule kind fails the build here,
    // alongside every other cross-reference check, rather than mixed in
    // with the plain-shape assembly further down.
    let mut rules: Vec<RuleDef> = Vec::new();
    rules.extend(build_placement_rules(&raw.placements, &tag_ids)?);
    rules.extend(build_distribution_rules(&raw.distributions, &tag_ids)?);
    rules.extend(build_coherence_rules(&raw.coherences, &tag_ids)?);
    let adjacency_rules = build_adjacency_rules(&raw.adjacencies, &tag_ids)?;
    check_no_symmetric_forbid_duplicates(&raw.adjacencies, &adjacency_rules)?;
    rules.extend(adjacency_rules);
    rules.extend(build_requirement_rules(&raw.requirements, &tag_ids)?);
    rules.sort_by(|a, b| a.key.cmp(&b.key));

    check_object_names(&raw.objects)?;
    check_object_layers(&raw.objects, code_tables)?;

    // Story 2.3 (AC3): every archetype checks out on its own first, then
    // every object's own `height`/`collider` is resolved against
    // whichever (if any) it names -- lowered *before* any existing
    // geometry/footprint check below ever runs, so none of them need a
    // second copy for the archetype path.
    check_archetype_key_format(&raw.archetypes)?;
    check_archetype_key_dupes(&raw.archetypes)?;
    check_archetype_self_consistency(&raw.archetypes)?;
    let archetypes_by_key: BTreeMap<&str, &ArchetypeEntry> = raw
        .archetypes
        .iter()
        .map(|a| (a.key.value.as_str(), a))
        .collect();
    let lowered_objects = lower_objects(&raw.objects, &archetypes_by_key)?;

    check_object_footprint_cap(&lowered_objects)?;
    check_object_colliders(&lowered_objects)?;
    check_object_interact_at(&lowered_objects)?;
    check_object_sprite_sheet_root(&raw.objects, sprite_sheet_allowed_root)?;
    check_object_sprite_sheets(&raw.objects, sheet_dims)?;
    // Story 2.5 (Tim's direction): resolved once, here, and carried
    // forward on `Defs` itself -- `None` iff there are no objects (the
    // only case this key's absence is not already a hard error above),
    // so a caller that does have objects to draw never needs a fallback
    // literal of its own.
    let tile_size_px: Option<u32> = if !lowered_objects.is_empty() {
        let tile_size_px = find_tile_size_px(&raw.balance).ok_or_else(|| {
            DefsError::new(
                &lowered_objects[0].path,
                lowered_objects[0].key.line,
                lowered_objects[0].key.col,
                "defs/ declares an object but no 'render.tile_size_px' balance key -- FR126's sprite/footprint agreement cannot be checked without it".to_string(),
            )
        })?;
        check_object_sprite_matches_footprint(&lowered_objects, tile_size_px)?;
        check_object_flat_layers(&lowered_objects, tile_size_px, code_tables)?;
        Some(tile_size_px)
    } else {
        None
    };
    // Story 2.4: last among the object checks -- every other object-level
    // rejection above (name, layer, footprint cap, collider/interact_at
    // geometry, sprite) gets its own chance to fire on a fixture built to
    // exercise it before this generic catch-all ever runs.
    check_object_walkability_tag(&lowered_objects)?;
    // Story 2.9: after every other object-level rejection, same
    // reasoning as `check_object_walkability_tag`'s own placement.
    check_object_roles(&lowered_objects, &raw.tags)?;

    let item_keys: BTreeSet<&str> = raw.items.iter().map(|i| i.key.value.as_str()).collect();
    check_recipe_item_refs(&raw.recipes, &item_keys)?;

    let profession_keys: BTreeSet<&str> = raw
        .professions
        .iter()
        .map(|p| p.key.value.as_str())
        .collect();
    check_chain_profession_refs(&raw.chains, &profession_keys)?;
    check_building_type_profession_refs(&raw.building_types, &profession_keys)?;

    check_balance_range(&raw.balance)?;

    check_one_layout_per_family(&raw.appearance_layouts)?;
    for b in &raw.bodies {
        check_sheet_fits_layout(
            SheetCheck {
                path: &b.path,
                line: b.sheet.line,
                col: b.sheet.col,
                kind: "body",
                key: &b.key.value,
                family: b.family.value,
                sheet: &b.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
            sprite_sheet_allowed_root,
        )?;
    }
    for e in &raw.eyes {
        check_sheet_fits_layout(
            SheetCheck {
                path: &e.path,
                line: e.sheet.line,
                col: e.sheet.col,
                kind: "eyes",
                key: &e.key.value,
                family: e.family.value,
                sheet: &e.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
            sprite_sheet_allowed_root,
        )?;
    }
    for h in &raw.hairstyles {
        check_sheet_fits_layout(
            SheetCheck {
                path: &h.path,
                line: h.sheet.line,
                col: h.sheet.col,
                kind: "hairstyle",
                key: &h.key.value,
                family: h.family.value,
                sheet: &h.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
            sprite_sheet_allowed_root,
        )?;
    }
    for o in &raw.outfits {
        check_sheet_fits_layout(
            SheetCheck {
                path: &o.path,
                line: o.sheet.line,
                col: o.sheet.col,
                kind: "outfit",
                key: &o.key.value,
                family: o.family.value,
                sheet: &o.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
            sprite_sheet_allowed_root,
        )?;
    }
    for a in &raw.accessories {
        check_sheet_fits_layout(
            SheetCheck {
                path: &a.path,
                line: a.sheet.line,
                col: a.sheet.col,
                kind: "accessory",
                key: &a.key.value,
                family: a.family.value,
                sheet: &a.sheet.value,
            },
            &raw.appearance_layouts,
            sheet_dims,
            sprite_sheet_allowed_root,
        )?;
    }
    check_uniforms(
        &raw.uniforms,
        &profession_keys,
        &raw.outfits,
        &raw.accessories,
    )?;

    let mut objects: Vec<ObjectDef> = lowered_objects
        .iter()
        .map(|o| {
            // Already checked by `check_object_layers` above (over the
            // raw, unlowered tree -- lowering never touches `layer`);
            // `validate` never partially resolves a tree it will go on
            // to reject.
            let layer = code_tables
                .get("layer", &o.layer.value)
                .expect("layer already validated");
            ObjectDef {
                id: o.id.value,
                key: o.key.value.clone(),
                name: o.name.value.clone(),
                layer,
                sprite: SpriteRect {
                    sheet: o.sprite.value.sheet.clone(),
                    x: o.sprite.value.x,
                    y: o.sprite.value.y,
                    w: o.sprite.value.w,
                    h: o.sprite.value.h,
                },
                width: o.width,
                height: o.height,
                collider: o.collider.as_ref().map(|c| ColliderRect {
                    x0: c.value.x0,
                    y0: c.value.y0,
                    x1: c.value.x1,
                    y1: c.value.y1,
                }),
                interact_at: o.interact_at.as_ref().map(|c| ColliderRect {
                    x0: c.value.x0,
                    y0: c.value.y0,
                    x1: c.value.x1,
                    y1: c.value.y1,
                }),
                window: o.window,
                tags: resolve_object_tags(&o.path, &o.key, &o.tags, &tag_ids)
                    .expect("tags already validated"),
            }
        })
        .collect();
    objects.sort_by(|a, b| a.key.cmp(&b.key));

    let mut items: Vec<ItemDef> = raw
        .items
        .iter()
        .map(|i| ItemDef {
            id: i.id.value,
            key: i.key.value.clone(),
            unit: code_tables
                .get("unit", &i.unit.value)
                .expect("unit already validated by check_item_fields"),
            shelf_life_minutes: i.shelf_life_minutes.value,
            width: i.bulk_width.value,
            height: i.bulk_height.value,
        })
        .collect();
    items.sort_by(|a, b| a.key.cmp(&b.key));

    let mut recipes: Vec<RecipeDef> = raw
        .recipes
        .iter()
        .map(|r| RecipeDef {
            id: r.id.value,
            key: r.key.value.clone(),
            inputs: {
                let mut v = r.inputs.clone();
                v.sort();
                v
            },
            outputs: {
                let mut v = r.outputs.clone();
                v.sort();
                v
            },
        })
        .collect();
    recipes.sort_by(|a, b| a.key.cmp(&b.key));

    let mut professions: Vec<ProfessionDef> = raw
        .professions
        .iter()
        .map(|p| ProfessionDef {
            id: p.id.value,
            key: p.key.value.clone(),
        })
        .collect();
    professions.sort_by(|a, b| a.key.cmp(&b.key));

    let mut chains: Vec<ChainDef> = raw
        .chains
        .iter()
        .map(|c| ChainDef {
            id: c.id.value,
            key: c.key.value.clone(),
            links: {
                let mut v = c.links.clone();
                v.sort();
                v
            },
        })
        .collect();
    chains.sort_by(|a, b| a.key.cmp(&b.key));

    let mut building_types: Vec<BuildingTypeDef> = raw
        .building_types
        .iter()
        .map(|b| BuildingTypeDef {
            id: b.id.value,
            key: b.key.value.clone(),
            tags: resolve_building_type_tags(&b.path, &b.key, &b.tags, &tag_ids)
                .expect("tags already validated"),
            land_uses: crate::model::land_use_mask(&b.land_uses),
            density_min: b.density_min,
            density_max: b.density_max,
            min_interior_width_cells: b.min_interior_width_cells,
            min_interior_depth_cells: b.min_interior_depth_cells,
            weight: b.weight,
            requires_site: crate::model::site_context_mask(&b.requires_site),
            prefers_site: crate::model::site_context_mask(&b.prefers_site),
            density_affinity: b.density_affinity,
            professions: {
                let mut v: Vec<String> = b.professions.clone();
                v.sort();
                v.dedup();
                v
            },
        })
        .collect();
    building_types.sort_by(|a, b| a.key.cmp(&b.key));

    let mut balance: Vec<BalanceDef> = raw
        .balance
        .iter()
        .map(|b| BalanceDef {
            key: b.key.value.clone(),
            value: b.value.value,
            min: b.min,
            max: b.max,
        })
        .collect();
    balance.sort_by(|a, b| a.key.cmp(&b.key));

    let mut bodies: Vec<BodyDef> = raw
        .bodies
        .iter()
        .map(|b| BodyDef {
            id: b.id.value as u16,
            key: b.key.value.clone(),
            family: b.family.value,
            sheet: b.sheet.value.clone(),
            pool: b.pool.value,
        })
        .collect();
    bodies.sort_by(|a, b| a.key.cmp(&b.key));

    let mut eyes: Vec<EyesDef> = raw
        .eyes
        .iter()
        .map(|e| EyesDef {
            id: e.id.value as u16,
            key: e.key.value.clone(),
            family: e.family.value,
            sheet: e.sheet.value.clone(),
            pool: e.pool.value,
        })
        .collect();
    eyes.sort_by(|a, b| a.key.cmp(&b.key));

    let mut hairstyles: Vec<HairstyleDef> = raw
        .hairstyles
        .iter()
        .map(|h| HairstyleDef {
            id: h.id.value as u16,
            key: h.key.value.clone(),
            family: h.family.value,
            sheet: h.sheet.value.clone(),
            style: h.style,
            color: h.color,
            rare: h.rare,
        })
        .collect();
    hairstyles.sort_by(|a, b| a.key.cmp(&b.key));

    let mut outfits: Vec<OutfitDef> = raw
        .outfits
        .iter()
        .map(|o| OutfitDef {
            id: o.id.value as u16,
            key: o.key.value.clone(),
            family: o.family.value,
            sheet: o.sheet.value.clone(),
            pool: o.pool.value,
            hides_hairstyle: o.hides_hairstyle,
        })
        .collect();
    outfits.sort_by(|a, b| a.key.cmp(&b.key));

    let mut accessories: Vec<AccessoryDef> = raw
        .accessories
        .iter()
        .map(|a| AccessoryDef {
            id: a.id.value as u16,
            key: a.key.value.clone(),
            family: a.family.value,
            sheet: a.sheet.value.clone(),
            pool: a.pool.value,
            slot: a.slot.value,
        })
        .collect();
    accessories.sort_by(|a, b| a.key.cmp(&b.key));

    let mut appearance_layouts: Vec<AppearanceLayoutDef> = raw
        .appearance_layouts
        .iter()
        .map(|l| AppearanceLayoutDef {
            id: l.id.value,
            key: l.key.value.clone(),
            family: l.family.value,
            cell_width: l.cell_width,
            cell_height: l.cell_height,
            directions: l.directions.clone(),
            rows: l
                .rows
                .iter()
                .map(|r| AppearanceLayoutRowDef {
                    animation: r.animation.clone(),
                    row: r.row,
                    frames_per_direction: r.frames_per_direction,
                })
                .collect(),
            accepted_sizes: l.accepted_sizes.value.clone(),
        })
        .collect();
    appearance_layouts.sort_by(|a, b| a.key.cmp(&b.key));

    let mut uniforms: Vec<UniformDef> = raw
        .uniforms
        .iter()
        .map(|u| UniformDef {
            id: u.id.value,
            key: u.key.value.clone(),
            profession: u.profession.value.clone(),
            outfit: u.outfit.clone(),
            accessory: u.accessory.clone(),
        })
        .collect();
    uniforms.sort_by(|a, b| a.key.cmp(&b.key));

    let mut tags: Vec<TagDef> = raw
        .tags
        .iter()
        .map(|t| TagDef {
            id: t.id.value,
            key: t.key.value.clone(),
            role: t.role.as_ref().map(|r| RoleDef {
                layers: r
                    .layers
                    .iter()
                    .map(|l| {
                        code_tables
                            .get("layer", l)
                            .expect("role layer name already validated by check_tag_role_layers")
                    })
                    .collect(),
            }),
        })
        .collect();
    tags.sort_by(|a, b| a.key.cmp(&b.key));

    Ok(Defs {
        objects,
        items,
        recipes,
        professions,
        chains,
        building_types,
        balance,
        bodies,
        eyes,
        hairstyles,
        outfits,
        accessories,
        appearance_layouts,
        uniforms,
        tags,
        rules,
        tile_size_px,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parse::parse_all;
    use std::path::PathBuf;

    fn files(pairs: &[(&str, &str)]) -> Vec<(PathBuf, String)> {
        pairs
            .iter()
            .map(|(p, t)| (PathBuf::from(p), t.to_string()))
            .collect()
    }

    /// `name`/`layer`/`sprite` boilerplate for a 1x1 object whose sprite is
    /// exactly one tile (16x16) -- appended to every object fixture below
    /// that is not itself exercising name/layer/sprite validation, so the
    /// pre-existing collider/interact_at tests stay focused on the one
    /// thing each already asserts.
    const OBJECT_HEADER: &str = "name = \"Trash Bin\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\n";

    const BALANCE_RENDER_TOML: &str =
        "[[balance]]\nkey = \"render.tile_size_px\"\nvalue = 16\nmin = 1\nmax = 64\n";

    /// Story 2.4: declares the `underfoot` tag -- every fixture below that
    /// wants a colliderless object to pass the walkability invariant adds
    /// this file alongside its own `defs/tags/x.toml` and tags the object
    /// `"underfoot"`. Story 2.9 also declares a `fixture` role tag here
    /// (layer `furniture`, `OBJECT_HEADER`'s own layer) -- every object
    /// fixture below now needs exactly one role tag too, and every one of
    /// these fixtures already uses `OBJECT_HEADER`'s `layer = "furniture"`.
    const TAGS_UNDERFOOT_TOML: &str = "[[tag]]\nid = 1\nkey = \"underfoot\"\n\n[[tag]]\nid = 2\nkey = \"fixture\"\nrole = { layers = [\"furniture\"] }\n";

    /// Story 2.9: a fixture without `underfoot` at all still needs
    /// exactly one role tag -- used by fixtures that declare no `defs/
    /// tags/x.toml` of their own otherwise.
    const TAGS_FIXTURE_ROLE_TOML: &str =
        "[[tag]]\nid = 1\nkey = \"fixture\"\nrole = { layers = [\"furniture\"] }\n";

    fn object_sheet_dims() -> BTreeMap<String, (u32, u32)> {
        [("fixtures/objects/test.png".to_string(), (16u32, 16u32))]
            .into_iter()
            .collect()
    }

    fn object_code_tables() -> CodeTables {
        CodeTables::from_entries(&[
            ("layer", "furniture", 2),
            ("layer", "objects", 3),
            ("layer", "walls", 4),
            ("unit", "piece", 0),
            ("unit", "millilitre", 2),
        ])
    }

    fn valid_tree() -> Vec<(PathBuf, String)> {
        files(&[
            (
                "defs/objects/city-props.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"trash_bin\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\ntags = [\"fixture\"]\n"
                ),
            ),
            ("defs/tags/roles.toml", TAGS_FIXTURE_ROLE_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            (
                "defs/items/sanitation.toml",
                "[[item]]\nid = 1\nkey = \"bottle\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n\n[[item]]\nid = 2\nkey = \"recycled_glass\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n",
            ),
            (
                "defs/recipes/sanitation.toml",
                "[[recipe]]\nid = 1\nkey = \"bottle_recycling\"\ninputs = [\"bottle\"]\noutputs = [\"recycled_glass\"]\n",
            ),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/chains/sanitation.toml",
                "[[chain]]\nid = 1\nkey = \"plastic_bottle\"\nlinks = [\"sanitation_worker\"]\n",
            ),
            (
                "defs/balance/citizen.toml",
                "[[balance]]\nkey = \"citizen.bar_decay.rest\"\nvalue = 10\nmin = 0\nmax = 100\n",
            ),
        ])
    }

    #[test]
    fn a_consistent_tree_validates_and_sorts_by_key() {
        let raw = parse_all(&valid_tree()).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap();
        assert_eq!(defs.objects[0].key, "trash_bin");
        assert_eq!(defs.objects[0].name, "Trash Bin");
        assert_eq!(defs.objects[0].layer, 2);
        assert_eq!(defs.objects[0].sprite.sheet, "fixtures/objects/test.png");
        assert_eq!(defs.items[0].key, "bottle");
        assert_eq!(defs.recipes[0].inputs, vec!["bottle"]);
        assert_eq!(defs.chains[0].links, vec!["sanitation_worker"]);
        assert_eq!(defs.balance[0].value, 10);
    }

    // --- story 2.3: archetypes -------------------------------------------

    /// Tim's direction: lowering an object through an archetype must
    /// produce the exact same `ObjectDef` a hand-authored, explicit
    /// `height`/`collider` produces for the same geometry -- the proof
    /// that a migration to an archetype changes no byte of either
    /// generated artefact but `defs_version`.
    #[test]
    fn an_object_via_archetype_produces_the_same_object_def_as_the_explicit_equivalent() {
        let explicit = files(&[
            (
                "defs/objects/city-props.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"lamppost\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 6, y0 = 10, x1 = 10, y1 = 14 }}\ntags = [\"fixture\"]\n"
                ),
            ),
            ("defs/tags/roles.toml", TAGS_FIXTURE_ROLE_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let via_archetype = files(&[
            (
                "defs/objects/city-props.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"lamppost\"\n{OBJECT_HEADER}width = 1\narchetype = \"pole\"\ntags = [\"fixture\"]\n"
                ),
            ),
            (
                "defs/archetypes/city.toml",
                "[[archetype]]\nkey = \"pole\"\nheight = 1\ncollider_inset = { left = 6, top = 10, right = 6, bottom = 2 }\n",
            ),
            ("defs/tags/roles.toml", TAGS_FIXTURE_ROLE_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);

        let explicit_defs = validate(
            &parse_all(&explicit).unwrap(),
            &object_sheet_dims(),
            &object_code_tables(),
            "",
        )
        .unwrap();
        let archetype_defs = validate(
            &parse_all(&via_archetype).unwrap(),
            &object_sheet_dims(),
            &object_code_tables(),
            "",
        )
        .unwrap();
        assert_eq!(explicit_defs.objects, archetype_defs.objects);
        assert_eq!(archetype_defs.objects[0].height, 1);
        assert_eq!(
            archetype_defs.objects[0].collider,
            Some(ColliderRect {
                x0: 6,
                y0: 10,
                x1: 10,
                y1: 14
            })
        );
    }

    /// AC3's "collider supplied by neither means walkable" -- an
    /// archetype that supplies only `height` leaves an object free to be
    /// explicitly walkable via the ordinary `underfoot` tag, exactly as
    /// if it had named no archetype at all.
    #[test]
    fn an_archetype_supplying_only_height_leaves_the_object_walkable_via_underfoot() {
        let f = files(&[
            (
                "defs/objects/city-props.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"bridge_deck\"\n{OBJECT_HEADER}width = 1\narchetype = \"flat\"\ntags = [\"underfoot\", \"fixture\"]\n"
                ),
            ),
            (
                "defs/archetypes/city.toml",
                "[[archetype]]\nkey = \"flat\"\nheight = 1\n",
            ),
            ("defs/tags/roles.toml", TAGS_UNDERFOOT_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let defs = validate(
            &parse_all(&f).unwrap(),
            &object_sheet_dims(),
            &object_code_tables(),
            "",
        )
        .unwrap();
        assert_eq!(defs.objects[0].height, 1);
        assert_eq!(defs.objects[0].collider, None);
    }

    /// `height` and `collider` each resolve their own source
    /// independently -- an object may take one from the archetype and
    /// declare the other itself.
    #[test]
    fn height_and_collider_may_come_from_different_sources() {
        let f = files(&[
            (
                "defs/objects/city-props.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"trash_bin\"\n{OBJECT_HEADER}width = 1\nheight = 1\narchetype = \"full_cell\"\ntags = [\"fixture\"]\n"
                ),
            ),
            (
                "defs/archetypes/city.toml",
                "[[archetype]]\nkey = \"full_cell\"\ncollider_inset = { left = 0, top = 0, right = 0, bottom = 0 }\n",
            ),
            ("defs/tags/roles.toml", TAGS_FIXTURE_ROLE_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let defs = validate(
            &parse_all(&f).unwrap(),
            &object_sheet_dims(),
            &object_code_tables(),
            "",
        )
        .unwrap();
        assert_eq!(defs.objects[0].height, 1);
        assert_eq!(
            defs.objects[0].collider,
            Some(ColliderRect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16
            })
        );
    }

    #[test]
    fn a_kebab_case_key_is_rejected_as_invalid_snake_case() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"trash-bin\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("invalid item key 'trash-bin'"));
    }

    #[test]
    fn a_balance_key_with_a_kebab_case_segment_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"citizen.bar-decay.rest\"\nvalue = 1\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(
            err.message
                .contains("invalid balance key 'citizen.bar-decay.rest'")
        );
    }

    #[test]
    fn duplicate_id_within_one_file_is_rejected() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"a\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n\n[[item]]\nid = 1\nkey = \"b\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("duplicate item id 1"));
    }

    #[test]
    fn duplicate_id_across_two_files_in_the_same_subdirectory_is_rejected() {
        let f = files(&[
            (
                "defs/items/a.toml",
                "[[item]]\nid = 1\nkey = \"a\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n",
            ),
            (
                "defs/items/b.toml",
                "[[item]]\nid = 1\nkey = \"b\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.path.ends_with("b.toml"));
        assert!(err.message.contains("duplicate item id 1"));
        assert!(err.message.contains("a.toml"));
    }

    #[test]
    fn duplicate_key_is_rejected_even_with_distinct_ids() {
        let f = files(&[(
            "defs/items/x.toml",
            "[[item]]\nid = 1\nkey = \"a\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n\n[[item]]\nid = 2\nkey = \"a\"\nunit = \"piece\"\nshelf_life_minutes = 0\nbulk = { width = 1, height = 1 }\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("duplicate item key 'a'"));
    }

    #[test]
    fn duplicate_balance_key_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 1\nmin = 0\nmax = 10\n\n[[balance]]\nkey = \"a\"\nvalue = 2\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("duplicate balance key 'a'"));
    }

    #[test]
    fn a_recipe_naming_an_unknown_item_is_rejected() {
        let f = files(&[(
            "defs/recipes/x.toml",
            "[[recipe]]\nid = 1\nkey = \"r\"\ninputs = [\"nope\"]\noutputs = []\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("unknown item 'nope'"));
    }

    #[test]
    fn a_chain_naming_an_unknown_profession_is_rejected() {
        let f = files(&[(
            "defs/chains/x.toml",
            "[[chain]]\nid = 1\nkey = \"c\"\nlinks = [\"nope\"]\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("unknown profession 'nope'"));
    }

    #[test]
    fn an_out_of_range_balance_value_is_rejected() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 999\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("out of its own declared range"));
    }

    #[test]
    fn a_zero_area_collider_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 5, y0 = 5, x1 = 5, y1 = 9 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("zero or negative area"));
    }

    #[test]
    fn a_collider_outside_the_footprint_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 20, y1 = 8 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("does not fit inside its footprint"));
    }

    /// Story 2.4 AC3: a collider outside its own sprite bounds is
    /// rejected -- proven as the corollary Tim's direction describes,
    /// never a duplicate check: `check_object_sprite_matches_footprint`
    /// already fixes the sprite to exactly the footprint's own extent,
    /// so a collider outside the sprite is always outside the footprint
    /// too, and is refused by this exact same containment check.
    #[test]
    fn a_collider_outside_its_sprite_is_rejected_as_a_footprint_containment_failure() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 20, y1 = 8 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert_eq!(
            err.to_string(),
            "defs/objects/x.toml:9:12: object 'a' collider (0, 0)-(20, 8) does not fit inside its footprint (0, 0)-(16, 16) sub-cells"
        );
    }

    #[test]
    fn a_collider_flush_with_the_footprint_edge_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 16, y1 = 16 }}\ntags = [\"fixture\"]\n"
                ),
            ),
            ("defs/tags/roles.toml", TAGS_FIXTURE_ROLE_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap();
        assert_eq!(
            defs.objects[0].collider,
            Some(ColliderRect {
                x0: 0,
                y0: 0,
                x1: 16,
                y1: 16
            })
        );
    }

    // --- story 2.4: the walkability invariant (FR128) ----------------------

    /// Quentin's direction: "one table-driven test, not four" -- every one
    /// of the AC's own example kinds (manhole, rug, doormat, floor decal)
    /// is colliderless and carries the `underfoot` tag, and the build
    /// passes. Without this, a check that rejects every colliderless
    /// object regardless of the tag would also pass the negative tests
    /// below -- this is what proves it does not.
    #[test]
    fn underfoot_allow_listed_props_with_no_collider_pass() {
        for key in ["manhole", "rug", "doormat", "floor_decal"] {
            let f = files(&[
                (
                    "defs/objects/x.toml",
                    &format!(
                        "[[object]]\nid = 1\nkey = \"{key}\"\n{OBJECT_HEADER}width = 1\nheight = 1\ntags = [\"underfoot\", \"fixture\"]\n"
                    ),
                ),
                ("defs/balance/render.toml", BALANCE_RENDER_TOML),
                ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
            ]);
            let raw = parse_all(&f).unwrap();
            let result = validate(&raw, &object_sheet_dims(), &object_code_tables(), "");
            assert!(
                result.is_ok(),
                "'{key}' tagged underfoot should pass: {result:?}"
            );
        }
    }

    /// A colliderless prop that never named `underfoot` is rejected by
    /// name -- the AC's own "trash can with no collision" example.
    #[test]
    fn a_colliderless_object_not_tagged_underfoot_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"trash_can\"\n{OBJECT_HEADER}width = 1\nheight = 1\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("trash_can"));
        assert!(err.message.contains("underfoot"));
    }

    /// The other direction: a collider (it blocks) and the `underfoot` tag
    /// (it is explicitly walkable) can never both be declared.
    #[test]
    fn an_object_tagged_underfoot_with_a_collider_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\ntags = [\"underfoot\", \"fixture\"]\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("declares both a collider"));
    }

    #[test]
    fn an_absent_collider_stays_none() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ntags = [\"underfoot\", \"fixture\"]\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap();
        assert_eq!(defs.objects[0].collider, None);
    }

    #[test]
    fn a_zero_area_interact_at_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ninteract_at = {{ x0 = 0, y0 = 16, x1 = 0, y1 = 32 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("zero or negative area"));
        assert!(err.message.contains("interact_at"));
    }

    #[test]
    fn an_interact_at_beyond_the_reach_bound_is_rejected() {
        // The bound is INTERACT_AT_MAX_REACH_CELLS cells beyond the
        // footprint on every side; one sub-cell further out is refused.
        let beyond = -(INTERACT_AT_MAX_REACH_CELLS * COLLIDER_SUBCELLS_PER_CELL) - 1;
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ninteract_at = {{ x0 = {beyond}, y0 = 0, x1 = 16, y1 = 16 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("reaches further than"));
    }

    #[test]
    fn an_interact_at_exactly_at_the_reach_bound_is_accepted() {
        let at = -(INTERACT_AT_MAX_REACH_CELLS * COLLIDER_SUBCELLS_PER_CELL);
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ninteract_at = {{ x0 = {at}, y0 = 0, x1 = 16, y1 = 16 }}\ntags = [\"underfoot\", \"fixture\"]\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap();
        assert_eq!(defs.objects[0].interact_at.unwrap().x0, at as i32);
    }

    #[test]
    fn an_interact_at_entirely_inside_the_objects_own_collider_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 0, y0 = 0, x1 = 16, y1 = 16 }}\ninteract_at = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("could never be reached"));
    }

    #[test]
    fn an_interact_at_reaching_outside_its_own_collider_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\ninteract_at = {{ x0 = 0, y0 = 16, x1 = 16, y1 = 32 }}\ntags = [\"fixture\"]\n"
                ),
            ),
            ("defs/tags/roles.toml", TAGS_FIXTURE_ROLE_TOML),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw, &object_sheet_dims(), &object_code_tables(), "").is_ok());
    }

    #[test]
    fn an_absent_interact_at_stays_none() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!(
                    "[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\ntags = [\"underfoot\", \"fixture\"]\n"
                ),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap();
        assert_eq!(defs.objects[0].interact_at, None);
    }

    #[test]
    fn an_object_with_an_empty_name_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("empty name"));
    }

    #[test]
    fn an_object_naming_an_unknown_layer_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"basement\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("unknown layer 'basement'"));
    }

    #[test]
    fn an_object_naming_a_deprecated_layer_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"overhead\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let codes = CodeTables::from_entries(&[
            ("layer", "furniture", 2),
            ("layer", "objects", 3),
            ("layer", "walls", 4),
            ("layer", "overhead", 1),
        ]);
        let err = validate(&raw, &object_sheet_dims(), &codes, "").unwrap_err();
        assert!(err.message.contains("deprecated layer"));
    }

    #[test]
    fn an_object_naming_a_sheet_never_read_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                &format!("[[object]]\nid = 1\nkey = \"a\"\n{OBJECT_HEADER}width = 1\nheight = 1\n"),
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("dimensions were never read"));
    }

    #[test]
    fn a_sprite_rect_outside_its_sheet_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 4, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("does not fit inside sheet"));
    }

    #[test]
    fn a_sprite_width_not_matching_the_footprint_width_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 2\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("does not equal its footprint width"));
    }

    #[test]
    fn a_sprite_height_not_a_whole_multiple_of_tile_size_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 20 }\nwidth = 1\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (16, 20));
        let err = validate(&raw, &dims, &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("whole multiple of tile_size_px"));
    }

    #[test]
    fn a_sprite_height_shorter_than_the_footprint_height_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 1\nheight = 2\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("shorter than its footprint height"));
    }

    #[test]
    fn a_sprite_taller_than_the_footprint_overhanging_upward_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 32 }\nwidth = 1\nheight = 1\ntags = [\"underfoot\", \"fixture\"]\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (16, 32));
        assert!(validate(&raw, &dims, &object_code_tables(), "").is_ok());
    }

    #[test]
    fn a_footprint_width_of_zero_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 16 }\nwidth = 0\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &object_sheet_dims(), &object_code_tables(), "").unwrap_err();
        assert!(err.message.contains("footprint width or height of 0"));
    }

    #[test]
    fn a_footprint_of_exactly_the_cap_on_both_axes_is_accepted() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 128, h = 128 }\nwidth = 8\nheight = 8\ntags = [\"underfoot\", \"fixture\"]\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
            ("defs/tags/x.toml", TAGS_UNDERFOOT_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (128, 128));
        assert!(validate(&raw, &dims, &object_code_tables(), "").is_ok());
    }

    #[test]
    fn a_footprint_one_wider_than_the_cap_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 144, h = 16 }\nwidth = 9\nheight = 1\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (144, 16));
        let err = validate(&raw, &dims, &object_code_tables(), "").unwrap_err();
        assert!(
            err.message
                .contains("footprint width 9 exceeds MAX_FOOTPRINT_CELLS (8)")
        );
        assert!(
            err.message
                .contains("compose the structure from multiple objects")
        );
    }

    #[test]
    fn a_footprint_one_taller_than_the_cap_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 16, h = 144 }\nwidth = 1\nheight = 9\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (16, 144));
        let err = validate(&raw, &dims, &object_code_tables(), "").unwrap_err();
        assert!(
            err.message
                .contains("footprint height 9 exceeds MAX_FOOTPRINT_CELLS (8)")
        );
    }

    #[test]
    fn a_footprint_exceeding_the_cap_on_both_axes_is_rejected() {
        let f = files(&[
            (
                "defs/objects/x.toml",
                "[[object]]\nid = 1\nkey = \"a\"\nname = \"A\"\nlayer = \"furniture\"\nsprite = { sheet = \"fixtures/objects/test.png\", x = 0, y = 0, w = 144, h = 144 }\nwidth = 9\nheight = 9\n",
            ),
            ("defs/balance/render.toml", BALANCE_RENDER_TOML),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut dims = object_sheet_dims();
        dims.insert("fixtures/objects/test.png".to_string(), (144, 144));
        let err = validate(&raw, &dims, &object_code_tables(), "").unwrap_err();
        assert!(
            err.message
                .contains("footprint width 9 exceeds MAX_FOOTPRINT_CELLS (8)")
        );
    }

    #[test]
    fn an_in_range_balance_value_at_the_boundary_is_accepted() {
        let f = files(&[(
            "defs/balance/x.toml",
            "[[balance]]\nkey = \"a\"\nvalue = 10\nmin = 0\nmax = 10\n",
        )]);
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").is_ok());
    }

    // --- Story 1.10: appearance --------------------------------------------

    const LAYOUT_TOML: &str = "[[appearance_layout]]\nid = 1\nkey = \"adult\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"right\", \"up\", \"left\", \"down\"]\nrows = [\n  { animation = \"idle\", row = 1, frames_per_direction = 6 },\n  { animation = \"walk\", row = 2, frames_per_direction = 6 },\n]\naccepted_sizes = [{ width = 896, height = 656 }]\n";

    fn appearance_sheet_dims() -> BTreeMap<String, (u32, u32)> {
        [("sheets/body.png".to_string(), (896, 656))]
            .into_iter()
            .collect()
    }

    #[test]
    fn a_body_fitting_its_familys_layout_is_accepted() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap();
        assert_eq!(defs.bodies[0].key, "body_01");
    }

    #[test]
    fn a_sheet_too_small_for_its_familys_layout_is_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut small_dims = BTreeMap::new();
        small_dims.insert("sheets/body.png".to_string(), (32, 32));
        let err = validate(&raw, &small_dims, &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("only accepts"));
    }

    #[test]
    fn a_sheet_bigger_than_the_grid_but_not_a_declared_size_is_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let mut bigger_dims = BTreeMap::new();
        // Bigger than the grid on every axis, but not one of LAYOUT_TOML's
        // declared accepted_sizes -- must still be rejected by name, not
        // waved through for being "big enough".
        bigger_dims.insert("sheets/body.png".to_string(), (960, 700));
        let err = validate(&raw, &bigger_dims, &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("only accepts"));
        assert!(err.message.contains("960x700"));
    }

    #[test]
    fn a_part_naming_a_family_with_no_layout_is_rejected() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 1\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("no [[appearance_layout]] entry"));
    }

    #[test]
    fn a_declared_id_above_u16_max_is_rejected() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 65536\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("does not fit in a u16"));
    }

    #[test]
    fn a_declared_id_at_exactly_u16_max_is_accepted() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/appearance/bodies.toml",
                "[[body]]\nid = 65535\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let defs = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap();
        assert_eq!(defs.bodies[0].id, 65535);
    }

    #[test]
    fn a_declared_id_of_zero_is_rejected_for_every_appearance_kind() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 0\nkey = \"body_01\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("declares id 0"));
    }

    #[test]
    fn two_layouts_for_the_same_family_are_rejected() {
        let f = files(&[(
            "defs/appearance/layouts.toml",
            "[[appearance_layout]]\nid = 1\nkey = \"a\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"down\"]\nrows = [{ animation = \"idle\", row = 0, frames_per_direction = 1 }]\naccepted_sizes = [{ width = 16, height = 32 }]\n\n[[appearance_layout]]\nid = 2\nkey = \"b\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"down\"]\nrows = [{ animation = \"idle\", row = 0, frames_per_direction = 1 }]\naccepted_sizes = [{ width = 16, height = 32 }]\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("exactly one layout per family"));
    }

    /// Story 2.7, AC1(e): every `[[appearance_layout]]` must share one
    /// cell size -- a family declaring its own, different cell size is
    /// rejected by its own key, naming both sizes.
    #[test]
    fn two_layouts_with_different_cell_sizes_are_rejected() {
        let f = files(&[(
            "defs/appearance/layouts.toml",
            "[[appearance_layout]]\nid = 1\nkey = \"adult\"\nfamily = \"adult\"\ncell_width = 16\ncell_height = 32\ndirections = [\"down\"]\nrows = [{ animation = \"idle\", row = 0, frames_per_direction = 1 }]\naccepted_sizes = [{ width = 16, height = 32 }]\n\n[[appearance_layout]]\nid = 2\nkey = \"kid\"\nfamily = \"kid\"\ncell_width = 12\ncell_height = 24\ndirections = [\"down\"]\nrows = [{ animation = \"idle\", row = 0, frames_per_direction = 1 }]\naccepted_sizes = [{ width = 12, height = 24 }]\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &BTreeMap::new(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("kid"), "{}", err.message);
        assert!(err.message.contains("16x32"), "{}", err.message);
        assert!(err.message.contains("12x24"), "{}", err.message);
    }

    fn appearance_and_profession_tree(uniform_toml: &str) -> Vec<(PathBuf, String)> {
        files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/appearance/accessories.toml",
                "[[accessory]]\nid = 1\nkey = \"jacket\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"role_only\"\nslot = \"torso\"\n",
            ),
            ("defs/appearance/uniforms.toml", uniform_toml),
        ])
    }

    #[test]
    fn a_uniform_naming_a_real_profession_and_role_only_accessory_is_accepted() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"sanitation_worker_uniform\"\nprofession = \"sanitation_worker\"\naccessory = \"jacket\"\n",
        );
        let raw = parse_all(&f).unwrap();
        assert!(validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").is_ok());
    }

    #[test]
    fn a_uniform_naming_an_unknown_profession_is_rejected() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"no_such_profession\"\naccessory = \"jacket\"\n",
        );
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("names unknown profession"));
    }

    #[test]
    fn a_uniform_naming_an_unknown_accessory_is_rejected() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"sanitation_worker\"\naccessory = \"no_such_accessory\"\n",
        );
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("names unknown accessory"));
    }

    #[test]
    fn a_uniform_naming_a_civilian_pool_accessory_is_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/appearance/accessories.toml",
                "[[accessory]]\nid = 1\nkey = \"backpack\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\nslot = \"back\"\n",
            ),
            (
                "defs/appearance/uniforms.toml",
                "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"sanitation_worker\"\naccessory = \"backpack\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("not an adult role_only accessory"));
    }

    #[test]
    fn a_uniform_overriding_neither_outfit_nor_accessory_is_rejected() {
        let f = appearance_and_profession_tree(
            "[[uniform]]\nid = 1\nkey = \"ghost\"\nprofession = \"sanitation_worker\"\n",
        );
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("overrides neither"));
    }

    #[test]
    fn two_uniforms_for_the_same_profession_are_rejected() {
        let f = files(&[
            ("defs/appearance/layouts.toml", LAYOUT_TOML),
            (
                "defs/professions/sanitation.toml",
                "[[profession]]\nid = 1\nkey = \"sanitation_worker\"\n",
            ),
            (
                "defs/appearance/accessories.toml",
                "[[accessory]]\nid = 1\nkey = \"jacket\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"role_only\"\nslot = \"torso\"\n\n[[accessory]]\nid = 2\nkey = \"helmet\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"role_only\"\nslot = \"head\"\n",
            ),
            (
                "defs/appearance/uniforms.toml",
                "[[uniform]]\nid = 1\nkey = \"a\"\nprofession = \"sanitation_worker\"\naccessory = \"jacket\"\n\n[[uniform]]\nid = 2\nkey = \"b\"\nprofession = \"sanitation_worker\"\naccessory = \"helmet\"\n",
            ),
        ]);
        let raw = parse_all(&f).unwrap();
        let err = validate(&raw, &appearance_sheet_dims(), &CodeTables::default(), "").unwrap_err();
        assert!(err.message.contains("exactly one uniform per profession"));
    }

    #[test]
    fn an_invalid_pool_value_is_rejected_at_parse_time() {
        let f = files(&[(
            "defs/appearance/accessories.toml",
            "[[accessory]]\nid = 1\nkey = \"a\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"bogus\"\nslot = \"head\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("bogus"));
    }

    #[test]
    fn an_invalid_slot_value_is_rejected_at_parse_time() {
        let f = files(&[(
            "defs/appearance/accessories.toml",
            "[[accessory]]\nid = 1\nkey = \"a\"\nfamily = \"adult\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\nslot = \"waist\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("waist"));
    }

    #[test]
    fn an_invalid_family_value_is_rejected_at_parse_time() {
        let f = files(&[(
            "defs/appearance/bodies.toml",
            "[[body]]\nid = 1\nkey = \"a\"\nfamily = \"teen\"\nsheet = \"sheets/body.png\"\npool = \"civilian\"\n",
        )]);
        let err = parse_all(&f).unwrap_err();
        assert!(err.message.contains("teen"));
    }

    #[test]
    fn validate_page_groups_returns_the_theme_to_group_table() {
        let f = files(&[(
            "defs/atlas/page-groups.toml",
            "[[page_group]]\ntheme = \"camping\"\ngroup = \"street\"\n\n[[page_group]]\ntheme = \"kitchen\"\ngroup = \"kitchen\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let table = validate_page_groups(&raw).unwrap();
        assert_eq!(table.get("camping").map(String::as_str), Some("street"));
        assert_eq!(table.get("kitchen").map(String::as_str), Some("kitchen"));
    }

    #[test]
    fn validate_page_groups_rejects_a_theme_declared_twice() {
        let f = files(&[(
            "defs/atlas/page-groups.toml",
            "[[page_group]]\ntheme = \"camping\"\ngroup = \"street\"\n\n[[page_group]]\ntheme = \"camping\"\ngroup = \"other\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate_page_groups(&raw).unwrap_err();
        assert!(err.message.contains("camping"));
    }

    #[test]
    fn validate_page_groups_rejects_a_table_mapping_nothing_to_the_shared_group() {
        let f = files(&[(
            "defs/atlas/page-groups.toml",
            "[[page_group]]\ntheme = \"kitchen\"\ngroup = \"kitchen\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate_page_groups(&raw).unwrap_err();
        assert!(err.message.contains(ATLAS_SHARED_GROUP));
    }

    #[test]
    fn validate_page_groups_rejects_an_empty_table() {
        let raw = crate::model::RawDefs::default();
        let err = validate_page_groups(&raw).unwrap_err();
        assert!(err.message.contains(ATLAS_SHARED_GROUP));
    }

    /// Story 2.7 (Tim's direction): `defs/atlas/page-groups.toml` may
    /// never map a theme onto a `character_*` group -- that prefix is
    /// reserved for the character-part packer's own groups.
    #[test]
    fn validate_page_groups_rejects_a_theme_mapped_to_a_character_prefixed_group() {
        let f = files(&[(
            "defs/atlas/page-groups.toml",
            "[[page_group]]\ntheme = \"camping\"\ngroup = \"street\"\n\n[[page_group]]\ntheme = \"kitchen\"\ngroup = \"character_body\"\n",
        )]);
        let raw = parse_all(&f).unwrap();
        let err = validate_page_groups(&raw).unwrap_err();
        assert!(err.message.contains("kitchen"), "{}", err.message);
        assert!(err.message.contains("character_body"), "{}", err.message);
    }

    // --- Tim's cycle 2 direction: `check_no_symmetric_forbid_duplicates`'s
    // own canonicalisation, exercised directly against `AdjacencyEntry`
    // rather than a whole parsed tree -- fine enough that a fixture-file
    // roundtrip would only obscure which direction/subject combination is
    // under test.

    fn forbid_entry(
        id: u32,
        key: &str,
        a: &str,
        b: &str,
        direction: Option<RawDirection>,
    ) -> AdjacencyEntry {
        AdjacencyEntry {
            path: PathBuf::from("defs/rules/test.toml"),
            id: Located::at(id, 1, 1),
            key: Located::at(key.to_string(), 1, 1),
            a: Located::at(a.to_string(), 1, 1),
            b: Some(Located::at(b.to_string(), 1, 1)),
            direction,
            alternatives: None,
            rotate: false,
            relation: RawAdjacencyRelation::Forbid,
        }
    }

    fn check_forbid_entries(entries: &[AdjacencyEntry]) -> Result<(), DefsError> {
        let tag_ids: BTreeMap<&str, u32> = [("road", 1u32), ("floor", 2u32), ("wall", 3u32)]
            .into_iter()
            .collect();
        let rules = build_adjacency_rules(entries, &tag_ids)?;
        check_no_symmetric_forbid_duplicates(entries, &rules)
    }

    #[test]
    fn same_subject_different_direction_is_not_a_duplicate() {
        // "road never has floor to its north" and "...to its south" are
        // two different physical constraints, not the same seam seen
        // from two sides -- the bug this replaces collapsed both onto
        // one "axis" and refused the second row.
        let entries = [
            forbid_entry(
                1,
                "road_never_north_of_floor",
                "road",
                "floor",
                Some(RawDirection::North),
            ),
            forbid_entry(
                2,
                "road_never_south_of_floor",
                "road",
                "floor",
                Some(RawDirection::South),
            ),
        ];
        assert!(check_forbid_entries(&entries).is_ok());
    }

    #[test]
    fn opposite_seam_same_direction_is_not_a_duplicate() {
        // "road never has floor to its north" and "floor never has road
        // to its north" describe different seams (the second is
        // equivalent to "road never has floor to its *south*"), so they
        // must both stand.
        let entries = [
            forbid_entry(
                1,
                "road_never_north_of_floor",
                "road",
                "floor",
                Some(RawDirection::North),
            ),
            forbid_entry(
                2,
                "floor_never_north_of_road",
                "floor",
                "road",
                Some(RawDirection::North),
            ),
        ];
        assert!(check_forbid_entries(&entries).is_ok());
    }

    #[test]
    fn subject_swapped_with_the_direction_flipped_is_the_same_constraint() {
        let entries = [
            forbid_entry(
                1,
                "road_never_north_of_floor",
                "road",
                "floor",
                Some(RawDirection::North),
            ),
            forbid_entry(
                2,
                "floor_never_south_of_road",
                "floor",
                "road",
                Some(RawDirection::South),
            ),
        ];
        let err = check_forbid_entries(&entries).unwrap_err();
        assert!(err.message.contains("floor_never_south_of_road"));
        assert!(err.message.contains("road_never_north_of_floor"));
    }

    #[test]
    fn a_directional_row_already_covered_by_an_any_direction_row_is_rejected() {
        let entries = [
            forbid_entry(1, "road_never_touches_wall", "road", "wall", None),
            forbid_entry(
                2,
                "road_never_north_of_wall",
                "road",
                "wall",
                Some(RawDirection::North),
            ),
        ];
        let err = check_forbid_entries(&entries).unwrap_err();
        assert!(err.message.contains("road_never_north_of_wall"));
    }

    #[test]
    fn same_tag_row_north_and_south_are_the_same_constraint() {
        let entries = [
            forbid_entry(
                1,
                "wall_never_north_of_wall",
                "wall",
                "wall",
                Some(RawDirection::North),
            ),
            forbid_entry(
                2,
                "wall_never_south_of_wall",
                "wall",
                "wall",
                Some(RawDirection::South),
            ),
        ];
        let err = check_forbid_entries(&entries).unwrap_err();
        assert!(err.message.contains("wall_never_south_of_wall"));
    }

    #[test]
    fn same_tag_row_north_and_east_are_different_constraints() {
        let entries = [
            forbid_entry(
                1,
                "wall_never_north_of_wall",
                "wall",
                "wall",
                Some(RawDirection::North),
            ),
            forbid_entry(
                2,
                "wall_never_east_of_wall",
                "wall",
                "wall",
                Some(RawDirection::East),
            ),
        ];
        assert!(check_forbid_entries(&entries).is_ok());
    }

    #[test]
    fn dead_alternative_error_names_the_tag_key_and_direction() {
        let entries = [AdjacencyEntry {
            path: PathBuf::from("defs/rules/test.toml"),
            id: Located::at(1, 1, 1),
            key: Located::at("contradiction".to_string(), 1, 1),
            a: Located::at("wall".to_string(), 1, 1),
            b: None,
            direction: None,
            alternatives: Some(vec![vec![
                RawNeighbourTerm {
                    direction: RawDirection::North,
                    tag: "floor".to_string(),
                    present: true,
                },
                RawNeighbourTerm {
                    direction: RawDirection::North,
                    tag: "floor".to_string(),
                    present: false,
                },
            ]]),
            rotate: false,
            relation: RawAdjacencyRelation::Require,
        }];
        let tag_ids: BTreeMap<&str, u32> = [("road", 1u32), ("floor", 2u32), ("wall", 3u32)]
            .into_iter()
            .collect();
        let err = build_adjacency_rules(&entries, &tag_ids).unwrap_err();
        assert!(err.message.contains("'floor'"));
        assert!(err.message.contains("north"));
    }
}

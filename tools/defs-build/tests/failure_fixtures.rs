//! Quentin's direction: the malformed-input criterion is the heart of
//! this story, and one sad-path test does not discharge it. One fixture
//! per failure category under `tests/fixtures/invalid/`, each merged over
//! `tests/fixtures/valid/` (an overlay file replaces a same-path base
//! file, or is added alongside it) -- never the live `defs/` tree, so
//! this suite never breaks because someone edited real game data.
//!
//! Every assertion below is on the exact rendered message
//! (`path:line:col: text`), not merely on a non-zero exit -- "fails with
//! the offending file and line named" is untested if the check only
//! looks at whether an error occurred.

mod support;

use std::path::{Path, PathBuf};

use support::{
    appearance_sheet_bytes, build_err, build_err_enforcing_sheet_root, layer_codes, merged_tree,
    object_sheet_bytes, read_tree, sheet_dims, valid_dir,
};

#[test]
fn toml_syntax_error_names_the_offending_file_and_line() {
    let err = build_err("toml-syntax-error");
    assert_eq!(err.path, PathBuf::from("defs/items/sanitation.toml"));
    assert_eq!(err.line, 1);
}

#[test]
fn unknown_key_is_named_with_its_own_line() {
    let err = build_err("unknown-key");
    assert_eq!(
        err.to_string(),
        "defs/items/sanitation.toml:4:1: unknown field `bogus`, expected `id` or `key`"
    );
}

#[test]
fn missing_required_key_is_named() {
    let err = build_err("missing-required-key");
    assert_eq!(
        err.to_string(),
        "defs/items/sanitation.toml:1:1: missing field `id`"
    );
}

#[test]
fn wrong_value_type_is_named_at_the_bad_value() {
    let err = build_err("wrong-value-type");
    assert_eq!(
        err.to_string(),
        "defs/items/sanitation.toml:2:6: invalid type: string \"nope\", expected u32"
    );
}

#[test]
fn duplicate_id_within_one_file_is_named() {
    let err = build_err("duplicate-id-in-file");
    assert_eq!(
        err.to_string(),
        "defs/items/sanitation.toml:6:6: duplicate item id 1 -- first declared at defs/items/sanitation.toml:2:6"
    );
}

#[test]
fn duplicate_id_across_two_files_in_the_same_subdirectory_is_named() {
    let err = build_err("duplicate-id-across-files");
    assert_eq!(
        err.to_string(),
        "defs/items/sanitation.toml:2:6: duplicate item id 1 -- first declared at defs/items/extra.toml:2:6"
    );
}

#[test]
fn duplicate_key_within_one_file_is_named() {
    let err = build_err("duplicate-key-in-file");
    assert_eq!(
        err.to_string(),
        "defs/items/sanitation.toml:7:7: duplicate item key 'bottle' -- first declared at defs/items/sanitation.toml:3:7"
    );
}

#[test]
fn a_recipe_naming_an_unknown_item_is_named() {
    let err = build_err("dangling-recipe-item");
    assert_eq!(
        err.to_string(),
        "defs/recipes/sanitation.toml:3:7: recipe 'bottle_recycling' names unknown item 'nonexistent-item' in inputs"
    );
}

#[test]
fn a_chain_naming_an_unknown_profession_is_named() {
    let err = build_err("dangling-chain-profession");
    assert_eq!(
        err.to_string(),
        "defs/chains/sanitation.toml:3:7: chain 'plastic_bottle' names unknown profession 'nonexistent-profession' in links"
    );
}

#[test]
fn an_out_of_range_balance_value_is_named() {
    let err = build_err("out-of-range-balance-value");
    assert_eq!(
        err.to_string(),
        "defs/balance/citizen.toml:3:9: balance 'citizen.bar_decay.rest' value 999 is out of its own declared range [0, 100]"
    );
}

// --- story 2.10: tags and the five rule kinds -------------------------------

#[test]
fn an_object_naming_an_unknown_tag_is_named() {
    let err = build_err("dangling-object-tag-reference");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'trash_bin' names unknown tag 'nonexistent_tag' -- accepted tags are [fixture]"
    );
}

// --- story 2.3: footprint proposal and classification (archetypes) --------

#[test]
fn an_object_naming_an_unknown_archetype_is_named() {
    let err = build_err("dangling-object-archetype-reference");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:8:13: object 'trash_bin' names unknown archetype 'nonexistent_archetype' -- accepted archetypes are []"
    );
}

#[test]
fn an_object_declaring_height_and_naming_an_archetype_that_also_supplies_it_is_named() {
    let err = build_err("archetype-height-declared-twice");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'trash_bin' declares its own height and names archetype 'full_cell' which also supplies height -- exactly one source is allowed"
    );
}

#[test]
fn an_object_declaring_no_height_and_no_archetype_height_is_named() {
    let err = build_err("archetype-height-declared-nowhere");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'trash_bin' declares no height, and either names no archetype or names one with no height of its own -- exactly one source is required"
    );
}

#[test]
fn an_object_declaring_a_collider_and_naming_an_archetype_that_also_supplies_one_is_named() {
    let err = build_err("archetype-collider-declared-twice");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'trash_bin' declares its own collider and names archetype 'full_cell' which also supplies a collider -- exactly one source is allowed"
    );
}

#[test]
fn an_archetype_collider_inset_that_does_not_fit_its_own_height_is_named() {
    let err = build_err("archetype-collider-does-not-fit-footprint");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:4:18: archetype 'too_tall' collider_inset does not fit its own footprint -- top 10 + bottom 10 leaves no room within height 1 cell(s) (16 sub-cells)"
    );
}

#[test]
fn a_duplicate_archetype_key_is_named() {
    let err = build_err("duplicate-archetype-key");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:6:7: duplicate archetype key 'pole' -- first declared at defs/archetypes/city.toml:2:7"
    );
}

#[test]
fn a_non_snake_case_archetype_key_is_rejected() {
    let err = build_err("invalid-archetype-key-format");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:2:7: invalid archetype key 'BadKey' -- keys must be snake_case (lowercase letters, digits, single underscores)"
    );
}

#[test]
fn an_archetype_declaring_height_zero_is_named() {
    let err = build_err("archetype-height-zero");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:3:10: archetype 'zero_height' declares height 0 -- every object occupies at least one cell"
    );
}

#[test]
fn an_archetype_height_exceeding_the_cap_is_named() {
    let err = build_err("archetype-height-exceeds-cap");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:3:10: archetype 'too_deep' height 9 exceeds MAX_FOOTPRINT_CELLS (8)"
    );
}

#[test]
fn an_archetype_with_a_negative_inset_is_named() {
    let err = build_err("archetype-negative-inset");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:3:18: archetype 'bad_inset' collider_inset (-1, 0, 0, 0) has a negative inset -- left/top/right/bottom must each be 0 or more"
    );
}

#[test]
fn an_archetype_supplying_neither_height_nor_collider_inset_is_named() {
    let err = build_err("archetype-supplies-neither");
    assert_eq!(
        err.to_string(),
        "defs/archetypes/city.toml:2:7: archetype 'empty' supplies neither height nor collider_inset -- an archetype must supply at least one"
    );
}

/// Tim's direction, cycle 1: the one archetype-collider misfit only
/// detectable after lowering (the object's own `width`, unknown to the
/// archetype) is reported at the object's own `archetype = "..."` line,
/// naming both the object and the archetype -- never at a line inside
/// `defs/archetypes/`, which would point outside the file the error is
/// about.
#[test]
fn an_archetype_collider_that_does_not_fit_a_narrow_objects_width_is_named_at_the_objects_own_archetype_line()
 {
    let err = build_err("archetype-collider-does-not-fit-object-width");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:8:13: object 'trash_bin' collider (10, 0)-(6, 16) from archetype 'too_wide_inset' has zero or negative area"
    );
}

#[test]
fn an_unknown_rule_kind_is_named_with_its_own_line() {
    let err = build_err("unknown-rule-kind");
    assert_eq!(err.path, PathBuf::from("defs/rules/cafes.toml"));
    assert!(err.message.contains("bogus"));
}

#[test]
fn a_field_belonging_to_another_rule_kind_is_rejected() {
    let err = build_err("rule-field-belongs-to-another-kind");
    assert_eq!(err.path, PathBuf::from("defs/rules/cafes.toml"));
    assert_eq!(err.line, 5);
    assert!(err.message.contains("ratio"));
}

#[test]
fn a_rule_naming_an_unknown_tag_is_named() {
    let err = build_err("rule-dangling-tag-reference");
    assert_eq!(
        err.to_string(),
        "defs/rules/cafes.toml:4:11: rule 'no_cafe_above_floor_2' names unknown tag 'cafe' in subject -- accepted tags are [fixture]"
    );
}

#[test]
fn a_distribution_ratio_of_zero_is_rejected() {
    let err = build_err("distribution-ratio-zero");
    assert_eq!(
        err.to_string(),
        "defs/rules/services.toml:6:9: distribution rule 'waste_per_seating' has ratio 0 -- ratio must be a positive integer"
    );
}

#[test]
fn a_distribution_tolerance_of_zero_is_rejected() {
    let err = build_err("distribution-tolerance-non-positive");
    assert_eq!(
        err.to_string(),
        "defs/rules/services.toml:7:21: distribution rule 'waste_per_seating' has tolerance_percent 0 -- tolerance_percent must be a positive integer"
    );
}

/// AC2's coverage bound (Quentin's direction, PR #294 cycle 1): a zero
/// `max_distance` can never express "evenly spread" -- refused just like
/// a zero ratio or tolerance.
#[test]
fn a_distribution_max_distance_of_zero_is_rejected() {
    let err = build_err("distribution-max-distance-zero");
    assert_eq!(
        err.to_string(),
        "defs/rules/services.toml:9:16: distribution rule 'waste_per_seating' has max_distance 0 -- max_distance must be a positive integer"
    );
}

#[test]
fn a_placement_floor_min_above_floor_max_is_rejected() {
    let err = build_err("placement-floor-min-above-max");
    assert_eq!(
        err.to_string(),
        "defs/rules/cafes.toml:3:7: placement rule 'impossible_floor_range' has floor_min 3 greater than floor_max 1"
    );
}

#[test]
fn a_duplicate_rule_id_across_two_different_kinds_is_named() {
    let err = build_err("duplicate-rule-id");
    assert_eq!(
        err.to_string(),
        "defs/rules/cafes.toml:7:6: duplicate rule id 1 -- first declared at defs/rules/cafes.toml:2:6"
    );
}

// --- story 2.9: roles and the adjacency grammar (AC1/AC3, FR119) -----------

#[test]
fn an_object_with_no_role_tag_is_rejected() {
    let err = build_err("object-role-count-zero");
    assert!(err.message.contains("carries 0 role tag(s)"));
    assert!(err.message.contains("trash_bin"));
}

#[test]
fn an_object_with_two_role_tags_is_rejected() {
    let err = build_err("object-role-count-two");
    assert!(err.message.contains("carries 2 role tag(s)"));
    assert!(err.message.contains("trash_bin"));
}

#[test]
fn an_objects_layer_outside_its_own_roles_allowed_layers_is_rejected() {
    let err = build_err("role-layer-not-allowed");
    assert!(err.message.contains("role 'fixture'"));
    assert!(err.message.contains("'walls'"));
}

#[test]
fn a_role_naming_an_unknown_layer_is_rejected() {
    let err = build_err("role-unknown-layer");
    assert!(
        err.message
            .contains("tag 'fixture' role names unknown layer 'basement'")
    );
}

#[test]
fn an_adjacency_alternatives_term_naming_an_unknown_tag_is_rejected() {
    let err = build_err("adjacency-alternatives-unknown-tag");
    assert!(
        err.message
            .contains("names unknown tag 'nonexistent_tag' in alternatives")
    );
}

#[test]
fn a_forbid_row_with_a_multi_term_alternative_is_rejected() {
    let err = build_err("adjacency-forbid-multi-term-alternative");
    assert!(
        err.message.contains(
            "is a 'forbid' row but names an alternative that is not a single present tag"
        )
    );
}

#[test]
fn two_forbid_rows_for_the_same_pair_with_subjects_swapped_are_rejected() {
    let err = build_err("adjacency-symmetric-forbid-duplicate");
    assert!(err.message.contains(
        "adjacency rule 'y_never_touches_x' forbids a tag pair and direction already forbidden by 'x_never_touches_y'"
    ));
}

#[test]
fn an_adjacency_alternative_with_a_dead_contradictory_term_pair_is_rejected() {
    let err = build_err("adjacency-dead-alternative");
    assert!(err.message.contains("has a dead alternative"));
}

#[test]
fn a_non_kebab_case_filename_is_rejected() {
    let err = build_err("bad-filename");
    assert_eq!(err.path, PathBuf::from("defs/objects/CityProps.toml"));
    assert!(err.message.contains("not kebab-case"));
}

/// Quentin/Tim's direction: a git-tracked file under `defs/` that is not
/// `.toml` must be a hard, named build error -- the binary must not
/// pre-filter by extension before `parse_all` ever sees it.
#[test]
fn a_non_toml_file_is_rejected() {
    let err = build_err("non-toml-file");
    assert_eq!(err.path, PathBuf::from("defs/items/notes.md"));
    assert!(err.message.contains(".toml extension"));
}

#[test]
fn a_kebab_case_key_value_is_rejected_as_invalid_snake_case() {
    let err = build_err("invalid-key-format");
    assert!(err.message.contains("invalid item key 'trash-bin'"));
}

#[test]
fn a_balance_key_with_a_non_snake_case_segment_is_rejected() {
    let err = build_err("invalid-balance-key-format");
    assert!(
        err.message
            .contains("invalid balance key 'citizen.bar-decay.rest'")
    );
}

#[test]
fn a_zero_area_collider_is_named() {
    let err = build_err("zero-area-collider");
    assert!(err.message.contains("zero or negative area"));
}

/// Quentin's direction, story 2.4: both rectangles, collider and
/// footprint, in the same unit (sub-cells), in a fixed order, so the two
/// are comparable by eye.
#[test]
fn a_collider_outside_its_footprint_is_named() {
    let err = build_err("collider-outside-footprint");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:9:12: object 'trash_bin' collider (0, 0)-(20, 8) does not fit inside its footprint (0, 0)-(16, 16) sub-cells"
    );
}

#[test]
fn a_zero_area_interact_at_is_named() {
    let err = build_err("zero-area-interact-at");
    assert!(err.message.contains("interact_at"));
    assert!(err.message.contains("zero or negative area"));
}

#[test]
fn an_interact_at_beyond_the_reach_bound_is_named() {
    let err = build_err("interact-at-outside-bound");
    assert!(err.message.contains("reaches further than"));
}

#[test]
fn an_interact_at_inside_its_own_collider_is_named() {
    let err = build_err("interact-at-inside-collider");
    assert!(err.message.contains("could never be reached"));
}

#[test]
fn a_non_boolean_window_is_named() {
    let err = build_err("non-boolean-window");
    assert!(err.message.contains("expected") || err.message.contains("boolean"));
}

/// Id 0 is never a valid declared appearance part id -- it is the
/// runtime "no layer" sentinel.
#[test]
fn an_appearance_part_declaring_id_zero_is_named() {
    let err = build_err("appearance-id-zero");
    assert!(err.message.contains("declares id 0"));
}

/// An appearance part id above 65535 does not fit the `u16` storage
/// column and is named, not silently truncated.
#[test]
fn an_appearance_part_declaring_an_id_above_u16_max_is_named() {
    let err = build_err("appearance-id-too-large");
    assert!(err.message.contains("does not fit in a u16"));
}

/// A part declaring a family with no matching `[[appearance_layout]]` is
/// named, not silently matched to the wrong family's grid.
#[test]
fn an_appearance_part_naming_a_family_with_no_layout_is_named() {
    let err = build_err("appearance-family-mismatch");
    assert!(err.message.contains("no [[appearance_layout]] entry"));
}

/// A `[[uniform]]` naming an unknown profession is named, exactly like a
/// chain naming an unknown profession.
#[test]
fn a_uniform_naming_an_unknown_profession_is_named() {
    let err = build_err("appearance-dangling-uniform-profession");
    assert!(err.message.contains("names unknown profession"));
}

/// Story 2.7, Quentin's direction, point 1: "a sheet whose size is
/// accepted but whose grid doesn't fit, because that is the case the size
/// check can't see" -- proven through a real, committed, mismatched PNG
/// (`tests/fixtures/appearance-part-layout-mismatch/
/// body-test-too-small.png`, a real 8x8 file), run through the real
/// `defs_build::build` entry point, never a hand-built byte buffer alone.
/// The valid tree's own fixed `sheet_dims()` (this suite's own header-only
/// stand-in for a real `IHDR` read) still reports the declared, accepted
/// 16x32 for this path -- the check that catches this is the
/// character-atlas packer's own decoded-pixel-bounds check (AC1b), not
/// `validate.rs`'s size check, which this real file would sail past.
#[test]
fn a_real_body_sheet_too_small_for_its_own_declared_layout_grid_is_named() {
    let files = read_tree(&valid_dir());
    let mut bytes = appearance_sheet_bytes();
    let real_png = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/appearance-part-layout-mismatch/body-test-too-small.png"),
    )
    .unwrap();
    bytes.insert("fixtures/appearance/body-test.png".to_string(), real_png);

    let result = defs_build::build(
        &files,
        &sheet_dims(),
        &object_sheet_bytes(),
        &bytes,
        &layer_codes(),
        "",
        "test-version",
    );
    let err = result.expect_err("a too-small real body sheet must fail the build");
    assert!(err.message.contains("body"), "{}", err.message);
    assert!(err.message.contains("body_test"), "{}", err.message);
    assert!(
        err.message
            .contains("does not fit inside the decoded sheet"),
        "{}",
        err.message
    );
}

/// Story 2.2: `layer` resolves against the codes golden, never a second
/// hand-maintained list.
#[test]
fn an_object_naming_an_unknown_layer_is_named() {
    let err = build_err("unknown-layer");
    assert!(err.message.contains("unknown layer 'basement'"));
}

/// A deprecated layer may never be placed on, even though its own code
/// still resolves.
#[test]
fn an_object_naming_a_deprecated_layer_is_named() {
    let err = build_err("deprecated-layer");
    assert!(err.message.contains("deprecated layer"));
}

/// A sprite whose width does not equal `width * tile_size_px` exactly is
/// refused, naming the object.
#[test]
fn a_sprite_width_mismatching_the_footprint_is_named() {
    let err = build_err("sprite-width-mismatches-footprint");
    assert!(err.message.contains("does not equal its footprint width"));
}

/// A sprite height that is not a whole multiple of `tile_size_px` is
/// refused.
#[test]
fn a_sprite_height_not_a_tile_multiple_is_named() {
    let err = build_err("sprite-height-not-tile-multiple");
    assert!(err.message.contains("whole multiple of tile_size_px"));
}

/// A sprite shorter than its own footprint's height is refused -- a tall
/// prop may only overhang upward, never come up short.
#[test]
fn a_sprite_shorter_than_the_footprint_is_named() {
    let err = build_err("sprite-shorter-than-footprint");
    assert!(err.message.contains("shorter than its footprint height"));
}

/// An empty `name` is refused.
#[test]
fn an_empty_object_name_is_named() {
    let err = build_err("empty-object-name");
    assert!(err.message.contains("empty name"));
}

/// Story 2.2, cycle 2 (Quentin's direction): a `sprite.sheet` outside
/// `SPRITE_SHEET_ALLOWED_ROOT` is refused -- the root is an enforced
/// rule, not a CI-filter convention.
#[test]
fn a_sprite_sheet_outside_the_allowed_root_is_named() {
    let err = build_err_enforcing_sheet_root("sprite-sheet-outside-allowed-root");
    assert!(err.message.contains("is not under the allowed root"));
}

/// A `..`-laden sheet path that literally starts with the allowed root
/// but normalises to something outside it is refused just the same --
/// the check normalises `..` segments before comparing, so a path cannot
/// present as rooted just because of what its string starts with.
#[test]
fn a_sprite_sheet_escaping_the_allowed_root_via_dot_dot_is_named() {
    let err = build_err_enforcing_sheet_root("sprite-sheet-path-escape");
    assert!(err.message.contains("is not under the allowed root"));
}

/// A sprite sheet path this crate never read `IHDR` dimensions for is a
/// build error naming the object and the sheet.
#[test]
fn an_object_sprite_naming_a_sheet_never_read_is_named() {
    let err = build_err("sprite-sheet-missing");
    assert!(err.message.contains("dimensions were never read"));
}

/// A sprite rect with zero area is refused exactly like a zero-area
/// collider.
#[test]
fn an_object_sprite_with_zero_area_is_named() {
    let err = build_err("sprite-zero-area");
    assert!(err.message.contains("zero width or height"));
}

/// A sprite rect reaching past its own sheet's real bounds is a build
/// error.
#[test]
fn an_object_sprite_outside_its_sheet_is_named() {
    let err = build_err("sprite-outside-sheet-bounds");
    assert!(err.message.contains("does not fit inside sheet"));
}

/// A footprint width or height of 0 is refused -- every object occupies
/// at least one cell.
#[test]
fn an_object_footprint_dimension_of_zero_is_named() {
    let err = build_err("object-dimension-zero");
    assert!(err.message.contains("footprint width or height of 0"));
}

/// FR127's cap: a 9-cell-wide footprint is refused, naming the object and
/// directing the author to compose the structure from multiple objects.
#[test]
fn an_object_footprint_exceeding_the_cap_is_named() {
    let err = build_err("footprint-cap-exceeded");
    assert!(err.message.contains("exceeds MAX_FOOTPRINT_CELLS"));
    assert!(
        err.message
            .contains("compose the structure from multiple objects")
    );
}

/// FR128: there is no separate `walkable` flag anywhere in the schema --
/// `deny_unknown_fields` refuses it exactly like any other unknown field.
#[test]
fn a_walkable_flag_is_named() {
    let err = build_err("walkable-flag-rejected");
    assert!(err.message.contains("walkable"));
}

// --- story 2.4: the walkability invariant (FR128) ---------------------------

/// A colliderless prop nobody tagged `underfoot` is rejected by name --
/// the AC's own "trash can with no collision" example.
#[test]
fn a_colliderless_prop_not_tagged_underfoot_is_named() {
    let err = build_err("prop-no-collider-not-underfoot");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'trash_can' has no collider and is not tagged 'underfoot' -- every prop either blocks (a collider) or is explicitly walkable (the 'underfoot' tag); add one"
    );
}

/// A manhole absent from the `underfoot` tag is rejected by name -- the
/// AC's other example. Not a second code path: the exact same generic
/// check as the trash can above, exercised against a different content
/// key so both of the AC's own examples are named tests.
#[test]
fn a_manhole_absent_from_the_underfoot_tag_is_named() {
    let err = build_err("manhole-not-tagged-underfoot");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'manhole' has no collider and is not tagged 'underfoot' -- every prop either blocks (a collider) or is explicitly walkable (the 'underfoot' tag); add one"
    );
}

/// The other direction of the same invariant: an object cannot declare a
/// `collider` (it blocks) and the `underfoot` tag (it is explicitly
/// walkable) at once -- contradictory metadata, rejected by name.
#[test]
fn an_object_tagged_underfoot_with_a_collider_is_named() {
    let err = build_err("underfoot-tag-with-collider");
    assert_eq!(
        err.to_string(),
        "defs/objects/city-props.toml:3:7: object 'trash_bin' declares both a collider and the 'underfoot' tag -- an object cannot both block and be explicitly walkable"
    );
}

/// Every category this module lists above has its own fixture directory
/// under `tests/fixtures/invalid/` -- so a category added to one and not
/// the other is a hard failure here, not a silent gap. `non-integer-id`
/// and `negative-id` are asserted to fail by `shared_malformed_cases.rs`
/// (they pin the client/server equivalence Quentin's direction asks for),
/// not by their own named test here.
#[test]
fn every_known_category_has_a_fixture_directory() {
    let known = [
        "toml-syntax-error",
        "unknown-key",
        "missing-required-key",
        "wrong-value-type",
        "duplicate-id-in-file",
        "duplicate-id-across-files",
        "duplicate-key-in-file",
        "dangling-recipe-item",
        "dangling-chain-profession",
        "out-of-range-balance-value",
        "bad-filename",
        "non-toml-file",
        "invalid-key-format",
        "invalid-balance-key-format",
        "non-integer-id",
        "negative-id",
        "zero-area-collider",
        "collider-outside-footprint",
        "non-boolean-window",
        "zero-area-interact-at",
        "interact-at-outside-bound",
        "interact-at-inside-collider",
        "appearance-id-zero",
        "appearance-id-too-large",
        "appearance-family-mismatch",
        "appearance-dangling-uniform-profession",
        "unknown-layer",
        "deprecated-layer",
        "sprite-sheet-missing",
        "sprite-sheet-outside-allowed-root",
        "sprite-sheet-path-escape",
        "sprite-zero-area",
        "sprite-outside-sheet-bounds",
        "sprite-width-mismatches-footprint",
        "sprite-height-not-tile-multiple",
        "sprite-shorter-than-footprint",
        "object-dimension-zero",
        "empty-object-name",
        "footprint-cap-exceeded",
        "walkable-flag-rejected",
        "dangling-object-tag-reference",
        "unknown-rule-kind",
        "rule-field-belongs-to-another-kind",
        "rule-dangling-tag-reference",
        "distribution-ratio-zero",
        "distribution-tolerance-non-positive",
        "distribution-max-distance-zero",
        "placement-floor-min-above-max",
        "duplicate-rule-id",
        "prop-no-collider-not-underfoot",
        "manhole-not-tagged-underfoot",
        "underfoot-tag-with-collider",
        "object-role-count-zero",
        "object-role-count-two",
        "role-layer-not-allowed",
        "role-unknown-layer",
        "adjacency-alternatives-unknown-tag",
        "adjacency-forbid-multi-term-alternative",
        "adjacency-symmetric-forbid-duplicate",
        "adjacency-dead-alternative",
        "dangling-object-archetype-reference",
        "archetype-height-declared-twice",
        "archetype-height-declared-nowhere",
        "archetype-collider-declared-twice",
        "archetype-collider-does-not-fit-footprint",
        "duplicate-archetype-key",
        "invalid-archetype-key-format",
        "archetype-height-zero",
        "archetype-height-exceeds-cap",
        "archetype-negative-inset",
        "archetype-supplies-neither",
        "archetype-collider-does-not-fit-object-width",
    ];
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/invalid");
    let mut on_disk: Vec<String> = std::fs::read_dir(&base)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    on_disk.sort();
    let mut expected: Vec<String> = known.iter().map(|s| s.to_string()).collect();
    expected.sort();
    assert_eq!(on_disk, expected);
}

/// Quentin's direction: alongside every fixture above, the output
/// directory must be byte-identical before and after the failed run --
/// only achievable if emission never streams into the real output path.
/// Simulates the binary's own edge (`build` then, only on success,
/// `fsio::atomic_write`) against a scratch "output directory" pre-seeded
/// with sentinel content, for every invalid fixture category.
///
/// Tim's direction: the category list is read from `tests/fixtures/
/// invalid/` itself, never hard-coded next to it -- a category added
/// later is covered by this assertion automatically, not only by its own
/// message test above.
#[test]
fn every_invalid_fixture_leaves_pre_existing_output_untouched() {
    let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/invalid");
    let mut categories: Vec<String> = std::fs::read_dir(&base)
        .unwrap()
        .map(|e| e.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    categories.sort();
    assert!(
        !categories.is_empty(),
        "tests/fixtures/invalid/ has no categories -- this assertion would otherwise pass vacuously"
    );
    for category in categories {
        let category = category.as_str();
        let scratch = defs_build::fsio::make_scratch_dir("defs-build-notouch").unwrap();
        let rust_out = scratch.join("defs.rs");
        let json_out = scratch.join("defs.json");
        let manifest_out = scratch.join("defs-manifest.golden");
        std::fs::write(&rust_out, "sentinel rust\n").unwrap();
        std::fs::write(&json_out, "sentinel json\n").unwrap();
        std::fs::write(&manifest_out, "sentinel manifest\n").unwrap();

        let files = merged_tree(category);
        let result = defs_build::build(
            &files,
            &sheet_dims(),
            &object_sheet_bytes(),
            &appearance_sheet_bytes(),
            &layer_codes(),
            "",
            "test-version",
        );
        assert!(result.is_err(), "'{category}' was expected to fail");
        if let Ok(output) = result {
            defs_build::fsio::atomic_write(&rust_out, &output.rust).unwrap();
            defs_build::fsio::atomic_write(&json_out, &output.json).unwrap();
            defs_build::fsio::atomic_write(&manifest_out, &output.id_manifest).unwrap();
        }

        assert_eq!(
            std::fs::read_to_string(&rust_out).unwrap(),
            "sentinel rust\n",
            "'{category}' touched the rust output"
        );
        assert_eq!(
            std::fs::read_to_string(&json_out).unwrap(),
            "sentinel json\n",
            "'{category}' touched the json output"
        );
        assert_eq!(
            std::fs::read_to_string(&manifest_out).unwrap(),
            "sentinel manifest\n",
            "'{category}' touched the manifest output"
        );
        std::fs::remove_dir_all(&scratch).unwrap();
    }
}

/// The valid base tree, with no overlay, builds cleanly -- the negative
/// control every fixture above is a variation of.
#[test]
fn the_valid_base_tree_builds_cleanly() {
    let files = read_tree(&valid_dir());
    let result = defs_build::build(
        &files,
        &sheet_dims(),
        &object_sheet_bytes(),
        &appearance_sheet_bytes(),
        &layer_codes(),
        "",
        "test-version",
    );
    assert!(result.is_ok(), "valid fixture failed: {:?}", result.err());
}

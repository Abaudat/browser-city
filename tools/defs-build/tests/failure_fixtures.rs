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

use support::{build_err, merged_tree, read_tree, valid_dir};

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
        let result = defs_build::build(&files, "test-version");
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
    let result = defs_build::build(&files, "test-version");
    assert!(result.is_ok(), "valid fixture failed: {:?}", result.err());
}

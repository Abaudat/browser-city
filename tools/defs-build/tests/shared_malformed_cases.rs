//! A shared table of malformed-payload cases both the server and the
//! client are asserted to reject (Quentin's direction). The shared list
//! of case names is `fixtures/defs-malformed-cases.v1.json`; the client's
//! own JSON payload per case lives under `fixtures/defs-malformed-
//! payloads/`, checked by `client/tests/unit/defs/malformed.test.ts`.
//! Here, each shared name maps to one of `tests/fixtures/invalid/`'s own
//! (more finely categorised) TOML fixtures -- this test's job is only to
//! confirm every shared name has a mapped fixture and that fixture still
//! fails the build, so the two suites can never silently drift apart on
//! *which* categories of bad input are covered, even though the physical
//! input format (TOML files vs. one JSON payload) necessarily differs.
//!
//! Not every category this crate rejects is shareable: `item-unknown-unit`
//! needs the codes golden's unit names, which the client never reads (its
//! artefact carries the `u32` only); `sprite-sheet-
//! missing` and `sprite-outside-sheet-bounds` need a real sheet's `IHDR`
//! dimensions (`fsio::read_png_dims`), which the client never reads --
//! its own artefact only ever carries an already-validated `sprite` rect.
//! Those two exist as `tests/fixtures/invalid/` categories and
//! `failure_fixtures.rs` tests only, deliberately absent from
//! `fixtures/defs-malformed-cases.v1.json` (JSON has no comment syntax to
//! say so inline). Every other rejection category both sides can check
//! from the payload alone belongs in the shared list.

mod support;

use support::build_err;

const SHARED_CASES_JSON: &str = include_str!("../../../fixtures/defs-malformed-cases.v1.json");

/// `shared_name -> this crate's own fixture directory name`.
fn fixture_for(shared_name: &str) -> &'static str {
    match shared_name {
        "unknown-field" => "unknown-key",
        "missing-field" => "missing-required-key",
        "wrong-type" => "wrong-value-type",
        "duplicate-id" => "duplicate-id-in-file",
        "duplicate-key" => "duplicate-key-in-file",
        "dangling-item-reference" => "dangling-recipe-item",
        "dangling-profession-reference" => "dangling-chain-profession",
        "out-of-range-balance" => "out-of-range-balance-value",
        "non-integer-id" => "non-integer-id",
        "negative-id" => "negative-id",
        "zero-area-collider" => "zero-area-collider",
        "collider-outside-footprint" => "collider-outside-footprint",
        "non-boolean-window" => "non-boolean-window",
        "zero-area-interact-at" => "zero-area-interact-at",
        "interact-at-outside-bound" => "interact-at-outside-bound",
        "interact-at-inside-collider" => "interact-at-inside-collider",
        "appearance-id-zero" => "appearance-id-zero",
        "appearance-id-too-large" => "appearance-id-too-large",
        "appearance-family-mismatch" => "appearance-family-mismatch",
        "appearance-dangling-uniform-profession" => "appearance-dangling-uniform-profession",
        "unknown-layer" => "unknown-layer",
        "deprecated-layer" => "deprecated-layer",
        "sprite-zero-area" => "sprite-zero-area",
        "sprite-width-mismatches-footprint" => "sprite-width-mismatches-footprint",
        "sprite-height-not-tile-multiple" => "sprite-height-not-tile-multiple",
        "sprite-shorter-than-footprint" => "sprite-shorter-than-footprint",
        "object-dimension-zero" => "object-dimension-zero",
        "empty-object-name" => "empty-object-name",
        "footprint-cap-exceeded" => "footprint-cap-exceeded",
        "walkable-flag-rejected" => "walkable-flag-rejected",
        "dangling-tag-reference" => "dangling-object-tag-reference",
        "no-collider-not-underfoot" => "prop-no-collider-not-underfoot",
        "underfoot-with-collider" => "underfoot-tag-with-collider",
        "object-role-count-zero" => "object-role-count-zero",
        "object-role-count-two" => "object-role-count-two",
        "role-layer-not-allowed" => "role-layer-not-allowed",
        "item-missing-unit" => "item-missing-unit",
        "item-unit-wrong-type" => "item-unit-wrong-type",
        "item-bulk-zero" => "item-bulk-zero",
        "item-missing-shelf-life" => "item-missing-shelf-life",
        "item-missing-bulk" => "item-missing-bulk",
        "item-shelf-life-wrong-type" => "item-shelf-life-wrong-type",
        "item-bulk-height-cap-exceeded" => "item-bulk-height-cap-exceeded",
        "item-bulk-footprint-cap-exceeded" => "item-bulk-footprint-cap-exceeded",
        "item-shelf-life-out-of-range" => "item-shelf-life-out-of-range",
        other => panic!(
            "shared case '{other}' has no mapped tests/fixtures/invalid/ directory -- add one to fixture_for()"
        ),
    }
}

fn shared_cases() -> Vec<String> {
    // A hand-rolled parse, not `serde_json` (not an approved dependency
    // for this crate) -- the shared list is a flat JSON array of quoted
    // strings, nothing more.
    SHARED_CASES_JSON
        .lines()
        .filter_map(|line| {
            let line = line.trim().trim_end_matches(',');
            let line = line.strip_prefix('"')?.strip_suffix('"')?;
            Some(line.to_string())
        })
        .collect()
}

#[test]
fn every_shared_case_is_non_empty() {
    assert!(!shared_cases().is_empty());
}

#[test]
fn every_shared_case_maps_to_a_fixture_that_fails_the_build() {
    for name in shared_cases() {
        let fixture = fixture_for(&name);
        let _err = build_err(fixture);
    }
}

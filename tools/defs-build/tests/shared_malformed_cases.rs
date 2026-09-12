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

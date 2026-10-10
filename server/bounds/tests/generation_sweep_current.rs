//! `docs/generation.md` holds every measured generation figure, in blocks
//! stamped with the `GENERATION_VERSION` and generation-inputs fingerprint
//! they were measured under (`bounds::generation_stamp::MEASURED_BLOCKS`).
//! A stamp that differs from the generator's means the figures may be
//! stale. Parses text and hashes constants -- generates no city.

use bounds::generation_stamp::{
    CI_PROPTEST_CASES, MEASURED_BLOCKS, check_doc, current_fingerprint, quotes_a_version,
};
use sim::generation::GENERATION_VERSION;

fn read(rel: &str) -> String {
    let path = format!("{}/../../{rel}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path}: {e}"))
}

#[test]
fn docs_measured_blocks_are_stamped_with_the_current_version_and_fingerprint() {
    let text = read("docs/generation.md");
    let violations = check_doc(
        &text,
        MEASURED_BLOCKS,
        GENERATION_VERSION,
        current_fingerprint(),
    );
    assert!(
        violations.is_empty(),
        "docs/generation.md has {} stale or unstamped measured figure(s):\n{}",
        violations.len(),
        violations
            .iter()
            .map(|v| format!("  - {}", v.message))
            .collect::<Vec<_>>()
            .join("\n")
    );
}

/// Figures live in `docs/generation.md` only; a comment next to the code
/// points at the block label and never quotes a version.
#[test]
fn no_source_comment_quotes_a_generation_version_number() {
    let mut files = vec![
        (
            "defs/balance/generation.toml".to_string(),
            read("defs/balance/generation.toml"),
        ),
        (
            "server/sim/tests/invariants.rs".to_string(),
            read("server/sim/tests/invariants.rs"),
        ),
    ];
    let dir = format!("{}/../sim/src/generation", env!("CARGO_MANIFEST_DIR"));
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().is_some_and(|e| e == "rs") {
            let name = format!(
                "server/sim/src/generation/{}",
                path.file_name().unwrap().to_string_lossy()
            );
            files.push((name, std::fs::read_to_string(&path).unwrap()));
        }
    }
    let mut found = Vec::new();
    for (name, text) in &files {
        for (i, line) in text.lines().enumerate() {
            if quotes_a_version(line) {
                found.push(format!("{name}:{}: {}", i + 1, line.trim()));
            }
        }
    }
    assert!(
        found.is_empty(),
        "these comments quote a GENERATION_VERSION number; point at the stamped block in docs/generation.md instead:\n{}",
        found.join("\n")
    );
}

#[test]
fn the_implied_case_count_is_ci_s_proptest_cases() {
    let ci = read(".github/workflows/ci.yml");
    let line = ci
        .lines()
        .find(|l| l.trim_start().starts_with("PROPTEST_CASES:"))
        .expect("ci.yml sets PROPTEST_CASES");
    let value: u32 = line.split(':').nth(1).unwrap().trim().parse().unwrap();
    assert_eq!(value, CI_PROPTEST_CASES);
}

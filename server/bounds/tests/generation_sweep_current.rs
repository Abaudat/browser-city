//! `docs/generation.md` holds every measured generation figure, in blocks
//! stamped with the `GENERATION_VERSION` and generation-inputs fingerprint
//! they were measured under (`bounds::generation_stamp::MEASURED_BLOCKS`).
//! A stamp that differs from the generator's means the figures may be
//! stale. Parses text and hashes constants -- generates no city.

use std::path::{Path, PathBuf};

use bounds::generation_stamp::{
    CI_PROPTEST_CASES, MEASURED_BLOCKS, check_doc, comment_restates_a_measurement,
    current_fingerprint, quotes_a_version,
};
use sim::generation::GENERATION_VERSION;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn read(rel: &str) -> String {
    let path = root().join(rel);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {path:?}: {e}"))
}

/// Every file under `dir` (recursively) with extension `ext`.
fn files_under(dir: &Path, ext: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries {
        let path = entry.unwrap().path();
        if path.is_dir() {
            files_under(&path, ext, out);
        } else if path.extension().is_some_and(|e| e == ext) {
            out.push(path);
        }
    }
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
/// names the block and never restates a version or a figure.
#[test]
fn no_source_comment_restates_a_version_or_a_measured_figure() {
    let root = root();
    let mut files: Vec<PathBuf> = Vec::new();
    for (dir, ext) in [
        ("defs/balance", "toml"),
        ("defs/rules", "toml"),
        ("defs/building-types", "toml"),
        ("server/sim/src/generation", "rs"),
    ] {
        files_under(&root.join(dir), ext, &mut files);
    }
    for rel in [
        "server/sim/tests/invariants.rs",
        "server/sim/tests/neighbourhoods.rs",
        "server/sim/tests/catchment_floor.rs",
    ] {
        files.push(root.join(rel));
    }
    // The scan itself must see the files it claims to (a moved directory
    // must not turn it vacuous).
    assert!(files.len() > 8, "scanned only {} files", files.len());
    let mut found = Vec::new();
    for path in &files {
        let text = std::fs::read_to_string(path).unwrap();
        for (i, line) in text.lines().enumerate() {
            if quotes_a_version(line) || comment_restates_a_measurement(line) {
                found.push(format!(
                    "{}:{}: {}",
                    path.strip_prefix(&root).unwrap().display(),
                    i + 1,
                    line.trim()
                ));
            }
        }
    }
    assert!(
        found.is_empty(),
        "these comments restate a version or a measured figure; name the stamped block in docs/generation.md instead:\n{}",
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

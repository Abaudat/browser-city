//! Shared fixture-tree helpers for this crate's integration tests. Named
//! `tests/support/mod.rs` rather than `tests/support.rs` so cargo does not
//! treat it as its own test binary -- each `tests/*.rs` file that wants it
//! declares `mod support;`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub fn read_tree(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            walk(root, &path, out);
        } else {
            let rel = path.strip_prefix(root).unwrap();
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let full = PathBuf::from(format!("defs/{rel_str}"));
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            out.push((full, text));
        }
    }
}

pub fn valid_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/valid")
}

pub fn invalid_dir(category: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/invalid")
        .join(category)
}

/// The valid base tree with one invalid-category overlay merged on top --
/// an overlay path that already exists in the base replaces it; a new
/// path is added alongside it. `BTreeMap` keeps the merge (and therefore
/// `parse_all`'s own file-processing order) deterministic.
pub fn merged_tree(category: &str) -> Vec<(PathBuf, String)> {
    let mut files: BTreeMap<PathBuf, String> = read_tree(&valid_dir()).into_iter().collect();
    for (path, text) in read_tree(&invalid_dir(category)) {
        files.insert(path, text);
    }
    files.into_iter().collect()
}

pub fn build_err(category: &str) -> defs_build::DefsError {
    let files = merged_tree(category);
    defs_build::build(&files, "test-version").expect_err(&format!(
        "fixture category '{category}' was expected to fail the build"
    ))
}

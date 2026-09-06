//! NFR37: every `#[spacetimedb::table]` in `../src` must be registered in
//! `bounds::TABLE_BOUNDS`, and every registered bound must name a real
//! table. Scans source rather than the compiled schema so it catches a
//! table added without a bound before `spacetime build` ever runs, and
//! lives in this crate (not in `browser_city`'s own tests) because
//! `browser_city` cannot be natively `cargo test`ed -- see `src/lib.rs`.

use bounds::TABLE_BOUNDS;
use std::fs;
use std::path::{Path, PathBuf};

/// Pulls every `accessor = <name>` out of a `#[spacetimedb::table(...)]`
/// attribute in `text`. Deliberately simple string scanning -- this is a
/// guard rail, not a Rust parser, and the attribute's shape is fixed by
/// SpacetimeDB's macro.
fn table_accessors_in(text: &str) -> Vec<String> {
    let mut accessors = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("#[spacetimedb::table(") {
        rest = &rest[at..];
        let close = rest.find(')').unwrap_or(rest.len());
        let attr = &rest[..close];
        if let Some(acc_at) = attr.find("accessor") {
            let after = &attr[acc_at + "accessor".len()..];
            if let Some(eq_at) = after.find('=') {
                let value = after[eq_at + 1..]
                    .trim_start()
                    .split(|c: char| c == ',' || c.is_whitespace())
                    .next()
                    .unwrap_or("");
                if !value.is_empty() {
                    accessors.push(value.to_string());
                }
            }
        }
        rest = &rest[close.min(rest.len())..];
        if rest.is_empty() {
            break;
        }
        rest = &rest[1..];
    }
    accessors
}

fn rust_files_under(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
    {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.is_dir() {
            rust_files_under(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

fn module_src_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("bounds crate has a parent directory")
        .join("src")
}

fn declared_accessors() -> Vec<String> {
    let mut files = Vec::new();
    rust_files_under(&module_src_dir(), &mut files);
    let mut accessors = Vec::new();
    for file in files {
        let text = fs::read_to_string(&file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        accessors.extend(table_accessors_in(&text));
    }
    accessors
}

#[test]
fn every_table_has_a_declared_bound() {
    let registered: Vec<&str> = TABLE_BOUNDS.iter().map(|b| b.accessor).collect();
    for accessor in declared_accessors() {
        assert!(
            registered.contains(&accessor.as_str()),
            "table `{accessor}` has no bound registered in bounds::TABLE_BOUNDS (NFR37)"
        );
    }
}

#[test]
fn every_registered_bound_has_a_matching_table() {
    let declared = declared_accessors();
    for bound in TABLE_BOUNDS {
        assert!(
            declared.iter().any(|d| d == bound.accessor),
            "bounds::TABLE_BOUNDS registers `{}` but no #[spacetimedb::table] with that accessor exists",
            bound.accessor
        );
    }
}

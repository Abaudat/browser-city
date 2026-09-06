//! NFR37: every `#[spacetimedb::table]` in `../src` must be registered in
//! `bounds::TABLE_BOUNDS`, and every registered bound must name a real
//! table. Scans source rather than the compiled schema so it catches a
//! table added without a bound before `spacetime build` ever runs, and
//! lives in this crate (not in `browser_city`'s own tests) because
//! `browser_city` cannot be natively `cargo test`ed -- see `src/lib.rs`.

use bounds::TABLE_BOUNDS;
use std::fs;
use std::path::{Path, PathBuf};

/// Finds the index just past the parenthesis that balances the one at
/// `open` (which must itself be `(`) -- i.e. the matching `)` for a
/// `#[spacetimedb::table(...)]` attribute that may itself contain nested
/// parens, e.g. an `index(btree(...))` sub-attribute. Panics if the
/// attribute's parens never balance, which means the scanner's assumption
/// about the macro's shape is wrong and it must not silently guess.
fn matching_paren_end(text: &str, open: usize) -> usize {
    debug_assert_eq!(text.as_bytes()[open], b'(');
    let mut depth: i32 = 0;
    for (i, b) in text.as_bytes()[open..].iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return open + i + 1;
                }
            }
            _ => {}
        }
    }
    panic!("unbalanced parentheses scanning a #[spacetimedb::table(...)] attribute");
}

/// Pulls every `accessor = <name>` out of a `#[spacetimedb::table(...)]`
/// attribute in `text`, balancing nested parens (an `index(...)`
/// sub-attribute is common) rather than stopping at the first `)`.
/// Deliberately simple string scanning -- this is a guard rail, not a Rust
/// parser -- but it fails closed: a bare `#[table(...)]` (legal only after
/// `use spacetimedb::table;`) is rejected outright rather than silently
/// skipped, because a scanner that only recognises the qualified spelling
/// must not pass a table it cannot see.
fn table_accessors_in(text: &str, file: &Path) -> Vec<String> {
    assert!(
        !text.contains("#[table("),
        "{} has a bare #[table(...)] -- NFR37's bounds scanner only recognises the qualified \
         #[spacetimedb::table(...)] form; spell it out so the registry can see it",
        file.display()
    );

    let mut accessors = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.find("#[spacetimedb::table(") {
        let open = at + "#[spacetimedb::table".len();
        let close = matching_paren_end(rest, open);
        let attr = &rest[open + 1..close - 1];
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
        rest = &rest[close..];
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
        accessors.extend(table_accessors_in(&text, &file));
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

#[cfg(test)]
mod scanner {
    use super::*;

    #[test]
    fn balances_nested_parens_like_an_index_sub_attribute() {
        let src = "#[spacetimedb::table(accessor = person, index(btree(columns = [name])))]\n\
                   pub struct Person { name: String }";
        assert_eq!(
            table_accessors_in(src, Path::new("test.rs")),
            vec!["person".to_string()]
        );
    }

    #[test]
    fn finds_every_table_in_one_file() {
        let src = "#[spacetimedb::table(accessor = a)]\nstruct A;\n\
                   #[spacetimedb::table(accessor = b, public)]\nstruct B;";
        assert_eq!(
            table_accessors_in(src, Path::new("test.rs")),
            vec!["a".to_string(), "b".to_string()]
        );
    }

    #[test]
    #[should_panic(expected = "has a bare #[table(")]
    fn rejects_the_unqualified_spelling() {
        let src = "use spacetimedb::table;\n#[table(accessor = person)]\nstruct Person;";
        table_accessors_in(src, Path::new("test.rs"));
    }
}

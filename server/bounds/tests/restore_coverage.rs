//! Story 1.4: every non-scheduled table must have a `restore_<accessor>`
//! reducer (`tables::restore`), or a table nobody remembers to add one
//! for is a table the backup can never actually restore. Reads the same
//! `bounds::schema` scanner `registry_matches_tables.rs` and
//! `schema_shape.rs` already rely on, never a second one.

use std::fs;
use std::path::Path;

use bounds::schema::{module_src_dir, parse_module_schema, reducer_names_in_dir};

#[test]
fn every_non_scheduled_table_has_a_restore_reducer() {
    let schema = parse_module_schema(&module_src_dir());
    let reducers = reducer_names_in_dir(&module_src_dir());
    for table in &schema.tables {
        if table.scheduled_reducer.is_some() || table.accessor == "restore_state" {
            // `restore_state` is the restore mechanism's own gate, not
            // something the mechanism restores.
            continue;
        }
        let expected = format!("restore_{}", table.accessor);
        assert!(
            reducers.iter().any(|r| r == &expected),
            "non-scheduled table `{}` has no `{expected}` reducer in `tables::restore` (story 1.4)",
            table.accessor
        );
    }
}

/// The reverse direction: a `restore_*` reducer that does not name a real
/// non-scheduled table is dead code at best, and a typo'd table name at
/// worst -- either way, `check-backup-restore.sh` would never call it.
#[test]
fn every_restore_reducer_names_a_real_non_scheduled_table() {
    let schema = parse_module_schema(&module_src_dir());
    let reducers = reducer_names_in_dir(&module_src_dir());
    for name in &reducers {
        let Some(accessor) = name.strip_prefix("restore_") else {
            continue;
        };
        let table = schema.tables.iter().find(|t| t.accessor == accessor);
        match table {
            Some(t) => assert!(
                t.scheduled_reducer.is_none(),
                "`{name}` names scheduled table `{accessor}` -- a scheduled table is derived state and must never be restored"
            ),
            None => panic!("`{name}` names no table `{accessor}` in the schema"),
        }
    }
}

fn restore_rs_text() -> String {
    let path = module_src_dir().join("tables").join("restore.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// The string literals inside `const <name>: &[&str] = &[ ... ];` in
/// `text` -- a plain text scan (never `syn`/a real parser), matching
/// `bounds::schema`'s own house style for reading `../src` without
/// depending on `browser_city` (which cannot be linked natively).
fn const_str_list(text: &str, name: &str) -> Vec<String> {
    let marker = format!("const {name}: &[&str] = &[");
    let start = text
        .find(&marker)
        .unwrap_or_else(|| panic!("restore.rs: no `{marker}` found"))
        + marker.len();
    let end = text[start..]
        .find("];")
        .unwrap_or_else(|| panic!("restore.rs: `{name}`'s list has no closing `];`"))
        + start;
    text[start..end]
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.trim_matches('"').to_string())
        .collect()
}

/// `begin_restore`'s own function body text, brace-matched from its first
/// `{` -- so the check below only ever looks inside that one function,
/// never anywhere else in the file.
fn begin_restore_body(text: &str) -> &str {
    let fn_at = text
        .find("pub fn begin_restore")
        .expect("restore.rs: no `pub fn begin_restore` found");
    let open = text[fn_at..].find('{').expect("begin_restore has no body") + fn_at;
    let mut depth: i32 = 0;
    for (i, b) in text.as_bytes()[open..].iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return &text[open..open + i + 1];
                }
            }
            _ => {}
        }
    }
    panic!("restore.rs: begin_restore's body braces are unbalanced");
}

/// Tim's direction: `begin_restore`'s emptiness check must not be a
/// hand-written list nobody is forced to update. `NON_INIT_SEEDED_TABLES`
/// (`restore.rs`) is the single source of truth this reads -- both for
/// which tables must be checked, and (via `begin_restore_body`) whether
/// each one actually is, textually, inside `begin_restore` itself.
#[test]
fn begin_restore_checks_every_non_init_seeded_table_for_emptiness() {
    let text = restore_rs_text();
    let non_init_seeded = const_str_list(&text, "NON_INIT_SEEDED_TABLES");
    assert!(
        !non_init_seeded.is_empty(),
        "NON_INIT_SEEDED_TABLES is empty -- the const scan found nothing"
    );
    let body = begin_restore_body(&text);
    for table in &non_init_seeded {
        let needle = format!("ctx.db.{table}().iter().next().is_some()");
        assert!(
            body.contains(&needle),
            "begin_restore's body has no `{needle}` emptiness check for `{table}` (listed in NON_INIT_SEEDED_TABLES)"
        );
    }
}

/// The two named constants (`INIT_SEEDED_TABLES`, `NON_INIT_SEEDED_TABLES`)
/// must partition every non-scheduled table exactly -- no table missing
/// from both (an unenforced hole in "never restore over a live world"),
/// none in both (an ambiguous rule), and no stale name left in either
/// list for a table that no longer exists.
#[test]
fn the_two_named_table_lists_exactly_partition_every_non_scheduled_table() {
    let schema = parse_module_schema(&module_src_dir());
    let text = restore_rs_text();
    let init_seeded = const_str_list(&text, "INIT_SEEDED_TABLES");
    let non_init_seeded = const_str_list(&text, "NON_INIT_SEEDED_TABLES");

    for name in init_seeded.iter().chain(non_init_seeded.iter()) {
        assert!(
            schema.tables.iter().any(|t| &t.accessor == name),
            "'{name}' is listed in restore.rs but is not a real table in the schema"
        );
    }
    for name in &init_seeded {
        assert!(
            !non_init_seeded.contains(name),
            "'{name}' is in both INIT_SEEDED_TABLES and NON_INIT_SEEDED_TABLES"
        );
    }

    for table in &schema.tables {
        if table.scheduled_reducer.is_some() || table.accessor == "restore_state" {
            continue;
        }
        let in_init = init_seeded.contains(&table.accessor);
        let in_non_init = non_init_seeded.contains(&table.accessor);
        assert!(
            in_init || in_non_init,
            "'{}' is a non-scheduled table but is in neither INIT_SEEDED_TABLES nor NON_INIT_SEEDED_TABLES in restore.rs",
            table.accessor
        );
    }
}

/// Sanity: the helpers above actually read the real file, not an empty
/// string -- a silently-wrong path would make every assertion above
/// vacuously true.
#[test]
fn restore_rs_is_readable_and_nonempty() {
    let path = module_src_dir().join("tables").join("restore.rs");
    assert!(Path::new(&path).is_file(), "{} not found", path.display());
    assert!(!restore_rs_text().is_empty());
}

/// One `restore_<table>` reducer's own signature text, from
/// `pub fn restore_<table>(` to the matching close-paren -- brace/paren
/// depth tracked the same way `begin_restore_body` tracks `{}`, so a
/// `Vec<Row>` or similar nested `(`/`)` inside a type does not end the
/// scan early.
fn restore_reducer_signature<'a>(text: &'a str, table: &str) -> &'a str {
    let marker = format!("pub fn restore_{table}(");
    let start = text
        .find(&marker)
        .unwrap_or_else(|| panic!("restore.rs: no `{marker}` found"));
    let open = start + marker.len() - 1;
    let mut depth: i32 = 0;
    for (i, b) in text.as_bytes()[open..].iter().enumerate() {
        match b {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return &text[start..open + i + 1];
                }
            }
            _ => {}
        }
    }
    panic!("restore.rs: restore_{table}'s signature parens are unbalanced");
}

/// Tim's direction (cycle 4): a restore that stops at the restored data's
/// own maximum id can re-issue an id the source already handed out and
/// deleted, corrupting a dangling reference in another table. Every
/// auto_inc table's own `restore_<table>` reducer must take a
/// `sequence_floor: u64` parameter and advance the sequence past it
/// (`restore_autoinc_rows`, `tables::restore`'s own module doc) -- a
/// table added next month without it is a build failure, not a silent
/// gap in that guarantee.
#[test]
fn every_auto_inc_table_restore_reducer_takes_a_sequence_floor() {
    let schema = parse_module_schema(&module_src_dir());
    let text = restore_rs_text();
    let mut checked = 0;
    for table in &schema.tables {
        if table.scheduled_reducer.is_some() || table.accessor == "restore_state" {
            continue;
        }
        let is_auto_inc = table.columns.iter().any(|c| c.primary_key && c.auto_inc);
        if !is_auto_inc {
            continue;
        }
        let sig = restore_reducer_signature(&text, &table.accessor);
        assert!(
            sig.contains("sequence_floor: u64"),
            "restore_{}'s signature has no `sequence_floor: u64` parameter -- an auto_inc table's restore reducer must be able to advance the sequence past the exported floor, never merely to the restored maximum id",
            table.accessor
        );
        checked += 1;
    }
    assert!(
        checked > 0,
        "no auto_inc table found in the schema -- this test would otherwise pass vacuously"
    );
}

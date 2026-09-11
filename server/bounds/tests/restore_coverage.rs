//! Story 1.4: every non-scheduled table must have a `restore_<accessor>`
//! reducer (`tables::restore`), or a table nobody remembers to add one
//! for is a table the backup can never actually restore. Reads the same
//! `bounds::schema` scanner `registry_matches_tables.rs` and
//! `schema_shape.rs` already rely on, never a second one.

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

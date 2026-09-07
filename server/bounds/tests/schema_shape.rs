//! Static schema-shape assertions against the module's real source
//! (NFR33-NFR37) -- layer one of the guard: native, sub-second, and it must
//! fail before anything that needs a toolchain. Layer two
//! (`schema_snapshot_current.rs`) pins the whole shape; layer three
//! (`scripts/ci/check-schema-additive.sh`) diffs it against history.

use bounds::TABLE_BOUNDS;
use bounds::schema::{module_src_dir, parse_module_schema, read_rust_files, reducer_names_in_dir};

const COLUMN_CEILING: usize = 8;

fn schema() -> bounds::schema::ModuleSchema {
    parse_module_schema(&module_src_dir())
}

#[test]
fn every_table_has_exactly_one_primary_key() {
    for table in &schema().tables {
        let pk_count = table.columns.iter().filter(|c| c.primary_key).count();
        assert_eq!(
            pk_count, 1,
            "table `{}` has {pk_count} #[primary_key] columns -- exactly one is required (NFR33)",
            table.accessor
        );
    }
}

#[test]
fn no_rust_enum_is_declared_anywhere_in_module_source() {
    // NFR36: extensible sets are a `u32` code plus a companion table, never
    // an enum. Deliberately as blunt as grepping for the word `enum` --
    // that is enough to make the wrong thing loud, and this module has no
    // legitimate use for one.
    for (path, text) in read_rust_files(&module_src_dir()) {
        for (i, line) in text.lines().enumerate() {
            let stripped = line.split("//").next().unwrap_or(line);
            assert!(
                !stripped.split_whitespace().any(|w| w == "enum"),
                "{}:{}: `enum` found -- NFR36 forbids Rust enums in the module; use a u32 code plus a companion table",
                path.display(),
                i + 1
            );
        }
    }
}

#[test]
fn every_table_stays_under_the_column_ceiling_unless_waived() {
    for table in &schema().tables {
        if table.wide_table_waiver.is_some() {
            continue;
        }
        assert!(
            table.columns.len() <= COLUMN_CEILING,
            "table `{}` has {} columns, over the {COLUMN_CEILING}-column ceiling (NFR35) -- narrow it, \
             or add a `// bc:wide-table: <reason>` waiver line inside the struct body",
            table.accessor,
            table.columns.len()
        );
    }
}

#[test]
fn every_scheduled_table_has_the_required_columns_and_names_a_real_reducer() {
    let reducers = reducer_names_in_dir(&module_src_dir());
    for table in &schema().tables {
        let Some(reducer) = &table.scheduled_reducer else {
            continue;
        };
        let scheduled_id = table
            .columns
            .iter()
            .find(|c| c.name == "scheduled_id")
            .unwrap_or_else(|| {
                panic!(
                    "scheduled table `{}` has no `scheduled_id` column",
                    table.accessor
                )
            });
        assert_eq!(
            scheduled_id.ty, "u64",
            "scheduled table `{}`'s scheduled_id must be u64",
            table.accessor
        );
        assert!(
            scheduled_id.primary_key && scheduled_id.auto_inc,
            "scheduled table `{}`'s scheduled_id must be #[primary_key] #[auto_inc] (NFR34)",
            table.accessor
        );

        let scheduled_at = table
            .columns
            .iter()
            .find(|c| c.name == "scheduled_at")
            .unwrap_or_else(|| {
                panic!(
                    "scheduled table `{}` has no `scheduled_at` column",
                    table.accessor
                )
            });
        assert!(
            scheduled_at.ty.ends_with("ScheduleAt"),
            "scheduled table `{}`'s scheduled_at must be typed ScheduleAt, got `{}`",
            table.accessor,
            scheduled_at.ty
        );

        assert!(
            reducers.iter().any(|r| r == reducer),
            "scheduled table `{}` names reducer `{reducer}`, but no #[spacetimedb::reducer] fn `{reducer}` exists",
            table.accessor
        );
    }
}

#[test]
fn every_table_in_source_is_registered_in_table_bounds() {
    // Belt-and-braces alongside `registry_matches_tables.rs`, which already
    // proves this via its own independent accessor-only scanner; this one
    // walks the fuller schema model instead so a future change to either
    // scanner is caught by the other.
    let registered: Vec<&str> = TABLE_BOUNDS.iter().map(|b| b.accessor).collect();
    for table in &schema().tables {
        assert!(
            registered.contains(&table.accessor.as_str()),
            "table `{}` has no bound registered in bounds::TABLE_BOUNDS (NFR37)",
            table.accessor
        );
    }
}

//! Static schema-shape assertions against the module's real source
//! (NFR33-NFR37) -- layer one of the guard: native, sub-second, and it must
//! fail before anything that needs a toolchain. Layer two
//! (`schema_snapshot_current.rs`) pins the whole shape; layer three
//! (`scripts/ci/check-schema-additive.sh`) diffs it against history.

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

// Every table has a `TABLE_BOUNDS` row (NFR37): `registry_matches_tables.rs`
// owns that assertion; it is not duplicated here.

/// The words a table or column may not be named for: a till's cash is
/// `stock` rows and nothing else (story 6.8, FR92).
const CASH_WORDS: [&str; 3] = ["cash", "till", "denomination"];

/// The banned word a name is made of, matched on `_`-separated segments,
/// singular or plural -- never as a substring, so `open_until` and
/// `cashier_id` are not caught.
fn cash_word_in(name: &str) -> Option<&'static str> {
    name.to_lowercase().split('_').find_map(|segment| {
        CASH_WORDS.into_iter().find(|word| {
            segment == *word
                || segment.strip_suffix('s') == Some(word)
                || segment.strip_suffix("es") == Some(word)
        })
    })
}

#[test]
fn the_cash_name_check_matches_whole_words_only() {
    for flagged in [
        "till_id",
        "tills",
        "cash_total",
        "denomination",
        "cashes",
        "open_till",
    ] {
        assert!(
            cash_word_in(flagged).is_some(),
            "{flagged} should be flagged"
        );
    }
    for fine in [
        "open_until",
        "valid_until",
        "cashier_id",
        "tillage",
        "stock_id",
    ] {
        assert!(cash_word_in(fine).is_none(), "{fine} should not be flagged");
    }
}

#[test]
fn no_table_or_column_is_named_for_cash_a_till_or_a_denomination() {
    for table in &schema().tables {
        let names = std::iter::once(&table.accessor)
            .chain(std::iter::once(&table.struct_name))
            .chain(table.columns.iter().map(|c| &c.name));
        for name in names {
            assert!(
                cash_word_in(name).is_none(),
                "`{name}` in table `{}` is named for cash, a till or a denomination -- cash is `stock` rows (FR92)",
                table.accessor
            );
        }
    }
}

/// Story 4.5 (FR142): a player's data keys on `character_id`; an identity
/// column anywhere else would silently split a player in two the moment a
/// second identity is linked.
const IDENTITY_COLUMN_ALLOWED: &[&str] = &["character_identity", "module_owner", "link_request"];

#[test]
fn only_the_listed_tables_hold_an_identity_column() {
    for table in &schema().tables {
        if IDENTITY_COLUMN_ALLOWED.contains(&table.accessor.as_str()) {
            continue;
        }
        for col in &table.columns {
            assert!(
                !col.ty.contains("Identity"),
                "table `{}` column `{}` is an Identity -- key player data on `character_id` (FR142), or add the table to IDENTITY_COLUMN_ALLOWED with a reason",
                table.accessor,
                col.name
            );
        }
    }
}

#[test]
fn the_character_table_carries_no_identity_column() {
    let s = schema();
    let t = s.tables.iter().find(|t| t.accessor == "character").expect("character table");
    assert!(t.columns.iter().all(|c| !c.ty.contains("Identity")));
}

#[test]
fn identity_tables_are_private() {
    let s = schema();
    for name in ["character", "character_identity", "link_request", "oidc_issuer"] {
        let t = s.tables.iter().find(|t| t.accessor == name).expect("table");
        assert!(!t.public, "`{name}` must stay private -- clients read `my_character` instead");
    }
}

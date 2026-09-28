//! Story 4.2 (Tim's cycle-2 direction): `tables::schedules::
//! disarm_all_scheduled_tables` must disarm every scheduled table the
//! schema declares, and nothing else -- a table added to the schema
//! without a matching `disarm!(...)` call silently reopens the restore
//! race that function exists to close, for exactly that table. Reads the
//! same `bounds::schema` scanner `registry_matches_tables.rs`/
//! `restore_coverage.rs` already rely on, never a second one.

use std::fs;
use std::path::Path;

use bounds::schema::{module_src_dir, parse_module_schema};

fn schedules_rs_text() -> String {
    let path = module_src_dir().join("tables").join("schedules.rs");
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// `disarm_all_scheduled_tables`'s own function body text, brace-matched
/// from its first `{` -- the same technique `restore_coverage.rs`'s
/// `begin_restore_body` uses, so a `disarm!(...)` call elsewhere in the
/// file (there is none today, but nothing enforces that) is never
/// mistaken for one inside this function.
fn disarm_all_scheduled_tables_body(text: &str) -> &str {
    let fn_at = text
        .find("pub fn disarm_all_scheduled_tables")
        .expect("schedules.rs: no `pub fn disarm_all_scheduled_tables` found");
    let open = text[fn_at..]
        .find('{')
        .expect("disarm_all_scheduled_tables has no body")
        + fn_at;
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
    panic!("schedules.rs: disarm_all_scheduled_tables's body braces are unbalanced");
}

/// Every `disarm!(<accessor>)` call inside `body`, in source order --
/// deliberately not a `HashSet` at this step, so a duplicate invocation
/// (harmless at runtime, a sign of a copy-paste mistake all the same) is
/// still visible to a caller that wants it.
fn disarm_calls(body: &str) -> Vec<String> {
    let mut calls = Vec::new();
    let mut rest = body;
    while let Some(at) = rest.find("disarm!(") {
        let after = &rest[at + "disarm!(".len()..];
        let close = after
            .find(')')
            .expect("schedules.rs: a disarm!( call has no closing )");
        calls.push(after[..close].trim().to_string());
        rest = &after[close..];
    }
    calls
}

#[test]
fn disarm_all_scheduled_tables_covers_every_scheduled_table_and_nothing_else() {
    let schema = parse_module_schema(&module_src_dir());
    let text = schedules_rs_text();
    let body = disarm_all_scheduled_tables_body(&text);
    let calls = disarm_calls(body);

    let scheduled: Vec<&str> = schema
        .tables
        .iter()
        .filter(|t| t.scheduled_reducer.is_some())
        .map(|t| t.accessor.as_str())
        .collect();
    assert!(
        !scheduled.is_empty(),
        "the schema declares no scheduled table at all -- this test would otherwise pass vacuously"
    );

    for accessor in &scheduled {
        assert!(
            calls.iter().any(|c| c == accessor),
            "scheduled table `{accessor}` has no `disarm!({accessor})` call in \
             disarm_all_scheduled_tables -- a restore target's own copy of this cadence \
             would stay armed from its pre-restore epoch through the whole restore"
        );
    }

    for call in &calls {
        assert!(
            scheduled.iter().any(|s| s == call),
            "disarm_all_scheduled_tables calls `disarm!({call})`, but `{call}` is not a \
             scheduled table in the schema -- a stale or mistyped accessor"
        );
    }

    assert_eq!(
        calls.len(),
        scheduled.len(),
        "disarm_all_scheduled_tables's own disarm!(...) calls ({}) and the schema's \
         scheduled tables ({}) are not the same count -- a duplicate call, most likely",
        calls.len(),
        scheduled.len()
    );
}

#[test]
fn schedules_rs_is_readable_and_nonempty() {
    let path = module_src_dir().join("tables").join("schedules.rs");
    assert!(Path::new(&path).is_file(), "{} not found", path.display());
    assert!(!schedules_rs_text().is_empty());
}

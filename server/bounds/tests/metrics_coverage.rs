//! Story 4.12: `tables::metrics::sample_all_tables` must sample every
//! table the schema declares -- the sampler's own tables and every
//! scheduled table included -- exactly once, and nothing else. Same
//! pattern as `schedules_coverage.rs`, over the same schema scanner.

use std::fs;

use bounds::schema::{module_src_dir, parse_module_schema};

fn body_of_sample_all_tables() -> String {
    let path = module_src_dir().join("tables").join("metrics.rs");
    let text =
        fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
    let fn_at = text
        .find("fn sample_all_tables(")
        .expect("metrics.rs: no `fn sample_all_tables`");
    let open = text[fn_at..].find('{').expect("no body") + fn_at;
    let mut depth = 0i32;
    for (i, b) in text.as_bytes()[open..].iter().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return text[open..open + i + 1].to_string();
                }
            }
            _ => {}
        }
    }
    panic!("metrics.rs: sample_all_tables's braces are unbalanced");
}

fn sample_calls(body: &str) -> Vec<String> {
    let mut calls = Vec::new();
    let mut rest = body;
    while let Some(at) = rest.find("sample!(") {
        let after = &rest[at + "sample!(".len()..];
        let close = after.find(')').expect("a sample!( call has no closing )");
        calls.push(after[..close].trim().to_string());
        rest = &after[close..];
    }
    calls
}

fn declared() -> Vec<String> {
    parse_module_schema(&module_src_dir())
        .tables
        .into_iter()
        .map(|t| t.accessor)
        .collect()
}

#[test]
fn every_declared_table_is_sampled() {
    let calls = sample_calls(&body_of_sample_all_tables());
    for accessor in declared() {
        assert!(
            calls.contains(&accessor),
            "table `{accessor}` has no `sample!({accessor})` in sample_all_tables"
        );
    }
}

#[test]
fn nothing_undeclared_is_sampled() {
    let declared = declared();
    for call in sample_calls(&body_of_sample_all_tables()) {
        assert!(
            declared.contains(&call),
            "sample_all_tables samples `{call}`, which is not a table in the schema"
        );
    }
}

#[test]
fn every_table_is_sampled_exactly_once() {
    let mut calls = sample_calls(&body_of_sample_all_tables());
    let mut declared = declared();
    calls.sort_unstable();
    declared.sort_unstable();
    assert_eq!(
        calls.len(),
        declared.len(),
        "sample_all_tables's sample!(...) calls ({}) and the schema's tables ({}) differ in count -- \
         a duplicate call, most likely",
        calls.len(),
        declared.len()
    );
    assert_eq!(calls, declared);
}

//! Pins `sim::codes` (NFR36): every extensible set is a `u32` code plus a
//! name, never a Rust enum, so a new variant is a row insert rather than a
//! migration. A code's number is as permanent as a primary key -- renumber
//! one, or hand its retired number to a different name, and any matter,
//! decision record or reason stored under the old number silently means
//! something else. `tests/goldens/codes_v1.golden` pins the whole mapping;
//! a diff there is exactly the moment a human must look.

use sim::codes::{Code, layer, matter_kind, node_kind, provision, reason_code};

const GOLDEN: &str = include_str!("goldens/codes_v1.golden");

struct GoldenRow {
    set: String,
    code: u32,
    name: String,
    /// A set may carry a 4th, set-specific column -- `layer`'s FR123
    /// `rank`, pinned by this same golden. Absent for every other set.
    extra: Option<String>,
}

fn parse_golden(text: &str) -> Vec<GoldenRow> {
    text.lines()
        .map(|line| {
            let mut parts = line.split(' ');
            let set = parts
                .next()
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"))
                .to_string();
            let code: u32 = parts
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"));
            let name = parts
                .next()
                .unwrap_or_else(|| panic!("malformed golden row: {line:?}"))
                .to_string();
            let extra = parts.next().map(|s| s.to_string());
            GoldenRow {
                set,
                code,
                name,
                extra,
            }
        })
        .collect()
}

fn assert_matches_golden(set_name: &str, codes: &[Code], golden: &[GoldenRow]) {
    let rows: Vec<&GoldenRow> = golden.iter().filter(|r| r.set == set_name).collect();
    assert_eq!(
        rows.len(),
        codes.len(),
        "{set_name}: golden has {} rows but sim::codes::{set_name} has {} -- regenerate the golden",
        rows.len(),
        codes.len()
    );
    for (code, row) in codes.iter().zip(rows.iter()) {
        assert_eq!(
            code.code, row.code,
            "{set_name}: code order/number moved -- golden has {}, sim::codes has {} for {:?}",
            row.code, code.code, code.name
        );
        assert_eq!(
            code.name, row.name,
            "{set_name}: code {} was renamed or renumbered -- golden has {:?}, sim::codes has {:?}",
            code.code, row.name, code.name
        );
    }
}

fn assert_unique(set_name: &str, codes: &[Code]) {
    let mut seen_codes = std::collections::BTreeSet::new();
    let mut seen_names = std::collections::BTreeSet::new();
    for c in codes {
        assert!(
            seen_codes.insert(c.code),
            "{set_name}: code {} is declared more than once",
            c.code
        );
        assert!(
            seen_names.insert(c.name),
            "{set_name}: name {:?} is declared more than once",
            c.name
        );
    }
}

#[test]
fn matter_kind_matches_golden_and_is_unique() {
    let golden = parse_golden(GOLDEN);
    assert_matches_golden("matter_kind", matter_kind::CODES, &golden);
    assert_unique("matter_kind", matter_kind::CODES);
}

#[test]
fn provision_matches_golden_and_is_unique() {
    let golden = parse_golden(GOLDEN);
    assert_matches_golden("provision", provision::CODES, &golden);
    assert_unique("provision", provision::CODES);
}

#[test]
fn reason_code_matches_golden_and_is_unique() {
    let golden = parse_golden(GOLDEN);
    assert_matches_golden("reason_code", reason_code::CODES, &golden);
    assert_unique("reason_code", reason_code::CODES);
}

#[test]
fn node_kind_matches_golden_and_is_unique() {
    let golden = parse_golden(GOLDEN);
    assert_matches_golden("node_kind", node_kind::CODES, &golden);
    assert_unique("node_kind", node_kind::CODES);
}

/// `layer` carries its FR123 `rank` inline (`sim::codes::layer::LayerCode`,
/// not the shared `Code`), so it gets its own check rather than
/// `assert_matches_golden`/`assert_unique` -- code, name and rank must all
/// three match the golden, in order.
#[test]
fn layer_matches_golden_and_is_unique() {
    let golden = parse_golden(GOLDEN);
    let rows: Vec<&GoldenRow> = golden.iter().filter(|r| r.set == "layer").collect();
    assert_eq!(
        rows.len(),
        layer::CODES.len(),
        "layer: golden has {} rows but sim::codes::layer has {} -- regenerate the golden",
        rows.len(),
        layer::CODES.len()
    );

    let mut seen_codes = std::collections::BTreeSet::new();
    let mut seen_names = std::collections::BTreeSet::new();
    for (entry, row) in layer::CODES.iter().zip(rows.iter()) {
        assert_eq!(
            entry.code, row.code,
            "layer: code order/number moved -- golden has {}, sim::codes has {}",
            row.code, entry.code
        );
        assert_eq!(
            entry.name, row.name,
            "layer: code {} was renamed -- golden has {:?}, sim::codes has {:?}",
            entry.code, row.name, entry.name
        );
        let golden_rank: u32 = row
            .extra
            .as_deref()
            .unwrap_or_else(|| panic!("layer {}: golden row has no rank column", entry.code))
            .parse()
            .unwrap_or_else(|_| panic!("layer {}: golden rank column is not a u32", entry.code));
        assert_eq!(
            entry.rank, golden_rank,
            "layer: code {}'s rank changed -- golden has {golden_rank}, sim::codes has {}",
            entry.code, entry.rank
        );
        assert!(
            seen_codes.insert(entry.code),
            "layer: code {} is declared more than once",
            entry.code
        );
        assert!(
            seen_names.insert(entry.name),
            "layer: name {:?} is declared more than once",
            entry.name
        );
    }
}

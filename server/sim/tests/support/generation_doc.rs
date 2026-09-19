//! Story 3.1 (FR111): the small, line-oriented reader for
//! `docs/generation.md`'s six fixed, machine-read sections -- test-only,
//! no library, scoped to exactly this document's own shape (Tim's
//! direction). Every other line in the document (prose, including
//! `## Passes`'s own `### ` sub-headings, read only for their own
//! names) is otherwise free text this parser never looks at.
//!
//! Shape: a `## <kind>` heading for each of [`KIND_SECTIONS`], plus
//! `## parameters`, each immediately followed (no blank line) by one
//! table:
//!
//! ```text
//! | key | status | pass | scope | reads | intent |
//! | --- | --- | --- | --- | --- | --- |
//! <key> | committed|planned | <pass> | <scope> | <reads> | <intent>
//! ```
//!
//! (`## parameters`'s own table drops `scope`/`reads`: `| balance key |
//! status | pass | intent |`.) `pass` must name one of the `### `
//! headings collected from `## Passes`, never a second hardcoded list.
//! `scope` is one of [`SCOPES`]; `reads` is `-` or a `+`-joined list of
//! [`PARAMETER_NAMES`]. A rule `key` is unique across all five kind
//! sections -- the same key committed under two sections is exactly the
//! "a key naming two kinds" AC3 forbids.
//!
//! Panics, naming `path:line:`, on anything malformed: a stray
//! lowercase `## ` heading outside the closed six, a closed heading
//! repeated, a missing/emptied `## Passes`, a missing section or table,
//! a wrong header, a missing/malformed separator, an unknown `status`,
//! an unrecognised `pass`/`scope`/`reads` token, a duplicate key, an
//! empty `key`/`intent`, or a ragged row.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// The five closed kind headings, in `RuleKind`'s own declared order.
pub const KIND_SECTIONS: [&str; 5] = [
    "placement",
    "distribution",
    "coherence",
    "adjacency",
    "requirement",
];

/// Every lowercase `## ` heading this document ever recognises --
/// [`KIND_SECTIONS`] plus the balance-key table. A stray lowercase `## `
/// heading outside this set fails the build (Tim's direction).
const CLOSED_LOWERCASE_HEADINGS: [&str; 6] = [
    "parameters",
    "placement",
    "distribution",
    "coherence",
    "adjacency",
    "requirement",
];

/// A rule row's closed `scope` vocabulary (Derek's direction).
pub const SCOPES: [&str; 5] = ["cell", "room", "building", "neighbourhood", "site"];

/// The four FR113 neighbourhood parameters, exactly as the "Neighbourhood
/// parameters" section's own table names them -- a `reads` cell names
/// one or more of these, `+`-joined, or `-` for none.
pub const PARAMETER_NAMES: [&str; 4] = ["Density", "Building age", "Affluence", "Land-use mix"];

const KIND_HEADER: &str = "| key | status | pass | scope | reads | intent |";
const BALANCE_HEADER: &str = "| balance key | status | pass | intent |";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Committed,
    Planned,
}

#[derive(Debug, Clone)]
pub struct Row {
    pub key: String,
    pub status: Status,
    pub pass: String,
    pub scope: String,
    pub reads: Vec<String>,
    pub intent: String,
}

#[derive(Debug, Clone)]
pub struct BalanceRow {
    pub key: String,
    pub status: Status,
    pub pass: String,
    pub intent: String,
}

#[derive(Debug, Clone)]
pub struct Doc {
    pub sections: BTreeMap<&'static str, Vec<Row>>,
    pub parameters: Vec<BalanceRow>,
    /// The `### ` headings collected from `## Passes`, in document order.
    pub passes: Vec<String>,
}

/// `(heading_line, body_start, body_end)`, 0-indexed -- `body_start` is
/// the line right after the heading, `body_end` is the first line of
/// the next `## ` heading (exclusive) or `lines.len()`. `None` if
/// `heading` (an exact, already-`"## "`-prefixed string) is not found.
fn section_bounds(lines: &[&str], heading: &str) -> Option<(usize, usize, usize)> {
    let heading_line = lines.iter().position(|l| l.trim() == heading)?;
    let body_start = heading_line + 1;
    let body_end = lines[body_start..]
        .iter()
        .position(|l| l.trim_start().starts_with("## "))
        .map(|i| body_start + i)
        .unwrap_or(lines.len());
    Some((heading_line, body_start, body_end))
}

/// Reads one table starting at `lines[body_start]` (the header row,
/// immediately after the section's own heading -- no blank line
/// permitted between them): the header, then the separator, then data
/// rows until the first blank line or `body_end`. Returns each data
/// row's own columns (trimmed, the table's leading/trailing empty
/// fields already stripped), paired with its 1-indexed line number.
fn parse_table(
    path: &Path,
    lines: &[&str],
    heading_line: usize,
    body_start: usize,
    body_end: usize,
    header: &str,
    n_columns: usize,
    section_label: &str,
) -> Vec<(usize, Vec<String>)> {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };

    if body_start >= body_end {
        fail(heading_line + 1, &format!("section '{section_label}' has no table"));
    }
    if lines[body_start].trim() != header {
        fail(body_start + 1, &format!("table header must be exactly '{header}'"));
    }
    let sep_i = body_start + 1;
    if sep_i >= body_end || lines[sep_i].trim().is_empty() {
        fail(body_start + 1, "table is missing its separator row");
    }
    if !lines[sep_i]
        .trim()
        .chars()
        .all(|c| matches!(c, '|' | '-' | ':' | ' '))
    {
        fail(sep_i + 1, "malformed table separator row");
    }

    let mut rows = Vec::new();
    for i in (body_start + 2)..body_end {
        let line = lines[i];
        if line.trim().is_empty() {
            break;
        }
        let fields: Vec<String> = line.trim().split('|').map(|s| s.trim().to_string()).collect();
        if fields.len() != n_columns + 2 {
            fail(
                i + 1,
                &format!("row must have exactly {n_columns} columns: {header}"),
            );
        }
        rows.push((i + 1, fields[1..fields.len() - 1].to_vec()));
    }
    rows
}

fn build_row(
    path: &Path,
    line_no: usize,
    cols: Vec<String>,
    passes: &[String],
    seen_keys: &mut BTreeMap<String, &'static str>,
    section: &'static str,
) -> Row {
    let fail = move |msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line_no) };
    let [key, status, pass, scope, reads, intent]: [String; 6] = cols
        .try_into()
        .unwrap_or_else(|_| fail("internal: parse_table already guarantees six columns"));

    if key.is_empty() {
        fail("row's own key column is empty");
    }
    if let Some(&other) = seen_keys.get(&key) {
        fail(&format!(
            "duplicate key '{key}', already declared under section '{other}'"
        ));
    }
    let status = match status.as_str() {
        "committed" => Status::Committed,
        "planned" => Status::Planned,
        other => fail(&format!(
            "unknown status '{other}' -- must be 'committed' or 'planned'"
        )),
    };
    if !passes.iter().any(|p| p == &pass) {
        fail(&format!(
            "row's own pass '{pass}' does not name a '### ' heading under '## Passes' ({})",
            passes.join(", ")
        ));
    }
    if !SCOPES.contains(&scope.as_str()) {
        fail(&format!(
            "row's own scope '{scope}' must be one of: {}",
            SCOPES.join(", ")
        ));
    }
    let reads_list: Vec<String> = if reads == "-" {
        Vec::new()
    } else {
        let parts: Vec<String> = reads.split('+').map(|s| s.trim().to_string()).collect();
        for p in &parts {
            if !PARAMETER_NAMES.contains(&p.as_str()) {
                fail(&format!(
                    "row's own reads token '{p}' must be '-' or one of: {}",
                    PARAMETER_NAMES.join(", ")
                ));
            }
        }
        parts
    };
    if intent.is_empty() {
        fail("row's own intent column is empty");
    }

    seen_keys.insert(key.clone(), section);
    Row {
        key,
        status,
        pass,
        scope,
        reads: reads_list,
        intent,
    }
}

fn build_balance_row(
    path: &Path,
    line_no: usize,
    cols: Vec<String>,
    passes: &[String],
    seen_keys: &mut BTreeSet<String>,
) -> BalanceRow {
    let fail = move |msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line_no) };
    let [key, status, pass, intent]: [String; 4] = cols
        .try_into()
        .unwrap_or_else(|_| fail("internal: parse_table already guarantees four columns"));

    if key.is_empty() {
        fail("row's own balance key column is empty");
    }
    if !seen_keys.insert(key.clone()) {
        fail(&format!("duplicate balance key '{key}'"));
    }
    let status = match status.as_str() {
        "committed" => Status::Committed,
        "planned" => Status::Planned,
        other => fail(&format!(
            "unknown status '{other}' -- must be 'committed' or 'planned'"
        )),
    };
    if !passes.iter().any(|p| p == &pass) {
        fail(&format!(
            "row's own pass '{pass}' does not name a '### ' heading under '## Passes' ({})",
            passes.join(", ")
        ));
    }
    if intent.is_empty() {
        fail("row's own intent column is empty");
    }

    BalanceRow {
        key,
        status,
        pass,
        intent,
    }
}

pub fn parse(path: &Path, text: &str) -> Doc {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };
    let lines: Vec<&str> = text.lines().collect();

    // A stray lowercase '## ' heading outside the closed six.
    for (i, line) in lines.iter().enumerate() {
        if let Some(rest) = line.trim().strip_prefix("## ") {
            let starts_lowercase = rest.chars().next().is_some_and(|c| c.is_ascii_lowercase());
            if starts_lowercase && !CLOSED_LOWERCASE_HEADINGS.contains(&rest) {
                fail(
                    i + 1,
                    &format!(
                        "'## {rest}' is a lowercase '## ' heading but not one of the six closed machine-read sections ({})",
                        CLOSED_LOWERCASE_HEADINGS.join(", ")
                    ),
                );
            }
        }
    }

    // A closed heading repeated.
    for &name in &CLOSED_LOWERCASE_HEADINGS {
        let heading = format!("## {name}");
        let occurrences: Vec<usize> = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| l.trim() == heading)
            .map(|(i, _)| i)
            .collect();
        if occurrences.len() > 1 {
            fail(
                occurrences[1] + 1,
                &format!("'{heading}' section appears more than once"),
            );
        }
    }

    // The pass vocabulary -- collected once, checked against by every row.
    let (passes_heading, passes_body_start, passes_body_end) =
        section_bounds(&lines, "## Passes")
            .unwrap_or_else(|| fail(lines.len().max(1), "missing '## Passes' section"));
    let passes: Vec<String> = lines[passes_body_start..passes_body_end]
        .iter()
        .filter_map(|l| l.trim().strip_prefix("### ").map(|s| s.trim().to_string()))
        .collect();
    if passes.is_empty() {
        fail(passes_heading + 1, "'## Passes' has no '### ' pass headings");
    }

    let mut sections: BTreeMap<&'static str, Vec<Row>> =
        KIND_SECTIONS.iter().map(|&k| (k, Vec::new())).collect();
    let mut seen_keys: BTreeMap<String, &'static str> = BTreeMap::new();
    for &name in &KIND_SECTIONS {
        let heading = format!("## {name}");
        let (heading_line, body_start, body_end) = section_bounds(&lines, &heading)
            .unwrap_or_else(|| fail(lines.len().max(1), &format!("missing '{heading}' section")));
        let raw_rows = parse_table(
            path,
            &lines,
            heading_line,
            body_start,
            body_end,
            KIND_HEADER,
            6,
            &heading,
        );
        for (line_no, cols) in raw_rows {
            let row = build_row(path, line_no, cols, &passes, &mut seen_keys, name);
            sections.get_mut(name).expect("pre-seeded above").push(row);
        }
    }

    let (p_heading_line, p_body_start, p_body_end) = section_bounds(&lines, "## parameters")
        .unwrap_or_else(|| fail(lines.len().max(1), "missing '## parameters' section"));
    let raw_balance_rows = parse_table(
        path,
        &lines,
        p_heading_line,
        p_body_start,
        p_body_end,
        BALANCE_HEADER,
        4,
        "## parameters",
    );
    let mut balance_seen: BTreeSet<String> = BTreeSet::new();
    let mut parameters = Vec::new();
    for (line_no, cols) in raw_balance_rows {
        parameters.push(build_balance_row(
            path,
            line_no,
            cols,
            &passes,
            &mut balance_seen,
        ));
    }

    Doc {
        sections,
        parameters,
        passes,
    }
}

/// Story 3.1 (Quentin's and Tim's direction, cycle 1): the pure
/// comparison AC2/AC3 enforce, extracted so each failure branch is
/// unit-testable with a planted disagreement rather than only ever
/// exercised against the real, always-agreeing repo. `committed` is
/// `(key, section)` pairs -- the caller (`rule_examples.rs`) maps
/// `defs::RULES` through `RuleKind` to build it; this function touches
/// no `sim` type at all.
///
/// A key can appear under at most one section in a `Doc` [`parse`]
/// produced (`parse` itself rejects the same key under two sections), so
/// `found.len() > 1` below can only happen for a hand-built `Doc` that
/// skips that guard -- never for real parsed input.
pub fn check_rules_current(doc: &Doc, committed: &[(&str, &str)]) -> Vec<String> {
    let mut failures = Vec::new();

    for &(key, section) in committed {
        let found: Vec<(&'static str, &Row)> = KIND_SECTIONS
            .iter()
            .filter_map(|&s| {
                doc.sections[s]
                    .iter()
                    .find(|r| r.key == key)
                    .map(|r| (s, r))
            })
            .collect();
        match found.len() {
            0 => failures.push(format!(
                "'{key}' is committed in defs/rules/ but has no row in docs/generation.md -- add one under '## {section}':\n    | {key} | committed | <pass> | <scope> | <reads> | <intent> |\nre-run: bash scripts/dev/verify-defs.sh"
            )),
            1 => {
                let (found_section, row) = found[0];
                if found_section != section {
                    failures.push(format!(
                        "'{key}' is committed under docs/generation.md's '## {found_section}' section, but defs/rules/ has it as {section} -- move the row"
                    ));
                } else if row.status != Status::Committed {
                    failures.push(format!(
                        "'{key}' is committed in defs/rules/ but docs/generation.md still marks it 'planned' under '## {section}' -- flip it to 'committed'"
                    ));
                }
            }
            _ => failures.push(format!(
                "'{key}' appears under more than one section in docs/generation.md"
            )),
        }
    }

    let committed_keys: BTreeSet<&str> = committed.iter().map(|&(k, _)| k).collect();
    for &section in &KIND_SECTIONS {
        for row in &doc.sections[section] {
            if row.status == Status::Committed && !committed_keys.contains(row.key.as_str()) {
                failures.push(format!(
                    "docs/generation.md marks '{}' committed under '## {}', but no such rule key exists in defs/rules/ (orphan row)",
                    row.key, section
                ));
            }
        }
    }

    failures
}

#[cfg(test)]
mod tests {
    use super::{BalanceRow, Doc, PARAMETER_NAMES, Row, SCOPES, Status, check_rules_current, parse};
    use std::collections::BTreeMap;
    use std::path::Path;

    /// Runs `parse` against `text` and returns its own panic message --
    /// same idiom `support::grid`'s own tests use (Quentin's direction:
    /// assert the exact `path:line:` text, never merely that it
    /// panicked).
    fn err(text: &str) -> String {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(|| parse(Path::new("docs/generation.md"), text));
        std::panic::set_hook(prev);
        match result {
            Ok(_) => panic!("expected parse to panic on:\n{text}"),
            Err(payload) => *payload
                .downcast::<String>()
                .expect("panic! with format args always carries a String payload"),
        }
    }

    /// The whole document's own shape, zero rows in every table --
    /// every test below starts here and inserts/replaces/removes lines
    /// by index, so an expected line number is always `index + 1`,
    /// never hand-counted against a giant string literal.
    fn skeleton() -> Vec<&'static str> {
        vec![
            "## Passes",
            "",
            "### Prop placement",
            "",
            "## placement",
            "| key | status | pass | scope | reads | intent |",
            "| --- | --- | --- | --- | --- | --- |",
            "",
            "## distribution",
            "| key | status | pass | scope | reads | intent |",
            "| --- | --- | --- | --- | --- | --- |",
            "",
            "## coherence",
            "| key | status | pass | scope | reads | intent |",
            "| --- | --- | --- | --- | --- | --- |",
            "",
            "## adjacency",
            "| key | status | pass | scope | reads | intent |",
            "| --- | --- | --- | --- | --- | --- |",
            "",
            "## requirement",
            "| key | status | pass | scope | reads | intent |",
            "| --- | --- | --- | --- | --- | --- |",
            "",
            "## parameters",
            "| balance key | status | pass | intent |",
            "| --- | --- | --- | --- |",
        ]
    }

    fn text_of(lines: &[&str]) -> String {
        lines.join("\n") + "\n"
    }

    #[test]
    fn skeleton_parses_with_five_empty_kind_sections_and_an_empty_parameters_table() {
        let doc = parse(Path::new("docs/generation.md"), &text_of(&skeleton()));
        assert_eq!(doc.passes, vec!["Prop placement".to_string()]);
        for name in super::KIND_SECTIONS {
            assert!(doc.sections[name].is_empty());
        }
        assert!(doc.parameters.is_empty());
    }

    #[test]
    fn a_committed_row_parses_with_scope_and_reads() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| lighting_ground_floor_only | committed | Prop placement | site | Density | a lamppost on a rooftop |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        let row = &doc.sections["placement"][0];
        assert_eq!(row.key, "lighting_ground_floor_only");
        assert_eq!(row.status, Status::Committed);
        assert_eq!(row.pass, "Prop placement");
        assert_eq!(row.scope, "site");
        assert_eq!(row.reads, vec!["Density".to_string()]);
        assert_eq!(row.intent, "a lamppost on a rooftop");
    }

    #[test]
    fn a_reads_cell_of_dash_means_no_parameters() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| some_key | committed | Prop placement | site | - | an intent |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert!(doc.sections["placement"][0].reads.is_empty());
    }

    #[test]
    fn a_reads_cell_with_two_plus_joined_parameters_parses_both() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| some_key | committed | Prop placement | site | Density+Affluence | an intent |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(
            doc.sections["placement"][0].reads,
            vec!["Density".to_string(), "Affluence".to_string()]
        );
    }

    #[test]
    fn a_planned_row_parses() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| a_future_rule | planned | Prop placement | site | - | not built yet |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(doc.sections["placement"][0].status, Status::Planned);
    }

    #[test]
    fn a_committed_balance_row_parses() {
        let mut lines = skeleton();
        let i = lines.len() - 1; // the parameters table's own separator row
        lines.insert(
            i + 1,
            "| render.tile_size_px | committed | Prop placement | the tile every screen-space measurement is built from |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(doc.parameters.len(), 1);
        assert_eq!(doc.parameters[0].key, "render.tile_size_px");
        assert_eq!(doc.parameters[0].status, Status::Committed);
    }

    #[test]
    fn a_missing_passes_section_is_named() {
        let mut lines = skeleton();
        lines.drain(0..4); // '## Passes', blank, '### Prop placement', blank
        assert_eq!(
            err(&text_of(&lines)),
            format!("docs/generation.md:{}: missing '## Passes' section", lines.len())
        );
    }

    #[test]
    fn passes_with_no_sub_headings_is_named() {
        let mut lines = skeleton();
        lines.remove(2); // '### Prop placement'
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:1: '## Passes' has no '### ' pass headings"
        );
    }

    #[test]
    fn a_missing_kind_section_is_named() {
        let mut lines = skeleton();
        lines.drain(4..8); // '## placement' and its empty table
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: missing '## placement' section",
                lines.len()
            )
        );
    }

    #[test]
    fn a_kind_section_with_no_table_is_named() {
        let mut lines = skeleton();
        lines.drain(5..8); // the header, separator and trailing blank, heading stays
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:5: section '## placement' has no table"
        );
    }

    #[test]
    fn a_wrong_table_header_is_named() {
        let mut lines = skeleton();
        lines[5] = "| wrong | header |";
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:6: table header must be exactly '| key | status | pass | scope | reads | intent |'"
        );
    }

    #[test]
    fn a_missing_separator_row_is_named() {
        let mut lines = skeleton();
        lines.remove(6); // the separator row only
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:6: table is missing its separator row"
        );
    }

    #[test]
    fn a_malformed_separator_row_is_named() {
        let mut lines = skeleton();
        lines[6] = "not a separator";
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:7: malformed table separator row"
        );
    }

    #[test]
    fn a_ragged_row_is_named() {
        let mut lines = skeleton();
        lines.insert(7, "| some_key | committed | Prop placement | site |");
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:8: row must have exactly 6 columns: | key | status | pass | scope | reads | intent |"
        );
    }

    #[test]
    fn an_empty_key_is_named() {
        let mut lines = skeleton();
        lines.insert(7, "|  | committed | Prop placement | site | - | an intent |");
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:8: row's own key column is empty"
        );
    }

    #[test]
    fn an_unknown_status_is_named() {
        let mut lines = skeleton();
        lines.insert(7, "| some_key | maybe | Prop placement | site | - | an intent |");
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:8: unknown status 'maybe' -- must be 'committed' or 'planned'"
        );
    }

    #[test]
    fn a_pass_not_matching_any_passes_heading_is_named() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| some_key | committed | prop placement | site | - | an intent |",
        );
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:8: row's own pass 'prop placement' does not name a '### ' heading under '## Passes' (Prop placement)"
        );
    }

    #[test]
    fn an_empty_pass_is_named() {
        let mut lines = skeleton();
        lines.insert(7, "| some_key | committed |  | site | - | an intent |");
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:8: row's own pass '' does not name a '### ' heading under '## Passes' (Prop placement)"
        );
    }

    #[test]
    fn an_invalid_scope_is_named() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| some_key | committed | Prop placement | planet | - | an intent |",
        );
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:8: row's own scope 'planet' must be one of: {}",
                SCOPES.join(", ")
            )
        );
    }

    #[test]
    fn an_invalid_reads_token_is_named() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| some_key | committed | Prop placement | site | Weather | an intent |",
        );
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:8: row's own reads token 'Weather' must be '-' or one of: {}",
                PARAMETER_NAMES.join(", ")
            )
        );
    }

    #[test]
    fn an_empty_intent_is_named() {
        let mut lines = skeleton();
        lines.insert(
            7,
            "| some_key | committed | Prop placement | site | - |  |",
        );
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:8: row's own intent column is empty"
        );
    }

    #[test]
    fn a_duplicate_key_in_one_section_is_named() {
        let mut lines = skeleton();
        lines.insert(7, "| some_key | committed | Prop placement | site | - | a |");
        lines.insert(8, "| some_key | planned | Prop placement | site | - | b |");
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:9: duplicate key 'some_key', already declared under section 'placement'"
        );
    }

    #[test]
    fn a_key_repeated_under_two_different_sections_is_named() {
        let mut lines = skeleton();
        // distribution's own row slot (the blank line right after its
        // separator) is index 11 in the unmodified skeleton -- inserted
        // first so placement's own slot (index 7) is unaffected by it.
        lines.insert(11, "| some_key | planned | Prop placement | site | - | b |");
        lines.insert(7, "| some_key | committed | Prop placement | site | - | a |");
        let expected_line = lines
            .iter()
            .position(|l| l.contains("some_key | planned"))
            .expect("the just-inserted distribution row is still in the vec")
            + 1;
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: duplicate key 'some_key', already declared under section 'placement'"
            )
        );
    }

    #[test]
    fn a_repeated_closed_heading_is_named() {
        let mut lines = skeleton();
        lines.insert(8, "## placement");
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:9: '## placement' section appears more than once"
        );
    }

    #[test]
    fn a_stray_lowercase_heading_outside_the_closed_six_is_named() {
        let mut lines = skeleton();
        lines.insert(0, "## stray");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:1: '## stray' is a lowercase '## ' heading but not one of the six closed machine-read sections ({})",
                super::CLOSED_LOWERCASE_HEADINGS.join(", ")
            )
        );
    }

    #[test]
    fn a_title_case_heading_is_never_treated_as_machine_read() {
        // A prose heading anywhere in the document parses fine -- only a
        // lowercase-first '## ' heading is ever checked against the
        // closed six.
        let mut lines = skeleton();
        lines.insert(0, "## Does not fit");
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(doc.passes, vec!["Prop placement".to_string()]);
    }

    #[test]
    fn a_missing_parameters_section_is_named() {
        let mut lines = skeleton();
        let len = lines.len();
        lines.drain(len - 3..len); // '## parameters' and its empty table
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: missing '## parameters' section",
                lines.len()
            )
        );
    }

    #[test]
    fn a_balance_row_with_an_unrecognised_pass_is_named() {
        let mut lines = skeleton();
        let i = lines.len() - 1;
        lines.insert(i + 1, "| a.balance.key | committed | nowhere | an intent |");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: row's own pass 'nowhere' does not name a '### ' heading under '## Passes' (Prop placement)",
                i + 2
            )
        );
    }

    #[test]
    fn a_duplicate_balance_key_is_named() {
        let mut lines = skeleton();
        let i = lines.len() - 1;
        lines.insert(i + 1, "| a.balance.key | committed | Prop placement | a |");
        lines.insert(i + 2, "| a.balance.key | planned | Prop placement | b |");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: duplicate balance key 'a.balance.key'",
                i + 3
            )
        );
    }

    // -- check_rules_current: the pure AC2/AC3 comparison, planted ------

    fn mk_doc(rows_by_section: &[(&'static str, Vec<Row>)]) -> Doc {
        let mut sections: BTreeMap<&'static str, Vec<Row>> =
            super::KIND_SECTIONS.iter().map(|&k| (k, Vec::new())).collect();
        for (s, rows) in rows_by_section {
            sections.insert(*s, rows.clone());
        }
        Doc {
            sections,
            parameters: Vec::<BalanceRow>::new(),
            passes: vec!["Prop placement".to_string()],
        }
    }

    fn row(key: &str, status: Status) -> Row {
        Row {
            key: key.to_string(),
            status,
            pass: "Prop placement".to_string(),
            scope: "site".to_string(),
            reads: Vec::new(),
            intent: "an intent".to_string(),
        }
    }

    #[test]
    fn check_rules_current_flags_a_missing_row() {
        let doc = mk_doc(&[]);
        let failures = check_rules_current(&doc, &[("some_key", "placement")]);
        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("'some_key' is committed in defs/rules/ but has no row"));
        assert!(failures[0].contains("## placement"));
        assert!(failures[0].contains("committed"));
        assert!(failures[0].contains("re-run: bash scripts/dev/verify-defs.sh"));
    }

    #[test]
    fn check_rules_current_flags_a_planned_row_whose_key_is_committed() {
        let doc = mk_doc(&[("placement", vec![row("some_key", Status::Planned)])]);
        let failures = check_rules_current(&doc, &[("some_key", "placement")]);
        assert_eq!(
            failures,
            vec![
                "'some_key' is committed in defs/rules/ but docs/generation.md still marks it 'planned' under '## placement' -- flip it to 'committed'"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_rules_current_flags_a_row_under_the_wrong_section() {
        let doc = mk_doc(&[(
            "adjacency",
            vec![row("some_key", Status::Committed)],
        )]);
        let failures = check_rules_current(&doc, &[("some_key", "placement")]);
        assert_eq!(
            failures,
            vec![
                "'some_key' is committed under docs/generation.md's '## adjacency' section, but defs/rules/ has it as placement -- move the row"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_rules_current_flags_an_orphan_committed_row() {
        let doc = mk_doc(&[(
            "placement",
            vec![row("orphan_key", Status::Committed)],
        )]);
        let failures = check_rules_current(&doc, &[]);
        assert_eq!(
            failures,
            vec![
                "docs/generation.md marks 'orphan_key' committed under '## placement', but no such rule key exists in defs/rules/ (orphan row)"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_rules_current_allows_a_planned_row_with_no_committed_key() {
        let doc = mk_doc(&[(
            "placement",
            vec![row("future_key", Status::Planned)],
        )]);
        let failures = check_rules_current(&doc, &[]);
        assert!(failures.is_empty());
    }

    #[test]
    fn check_rules_current_passes_when_everything_agrees() {
        let doc = mk_doc(&[(
            "placement",
            vec![row("some_key", Status::Committed)],
        )]);
        let failures = check_rules_current(&doc, &[("some_key", "placement")]);
        assert!(failures.is_empty());
    }
}

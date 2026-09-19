//! Story 3.1 (FR111): the small, line-oriented reader for
//! `docs/generation.md`'s machine-read surface -- test-only, no library,
//! scoped to exactly this document's own shape (Tim's direction).
//!
//! The closed six (`## parameters` and the five `## <kind>` sections)
//! are lowercase headings, each immediately followed (no blank line) by
//! one table:
//!
//! ```text
//! | key | status | pass | scope | reads | intent |
//! | --- | --- | --- | --- | --- | --- |
//! <key> | committed|planned | <pass> | <scope> | <reads> | <intent>
//! ```
//!
//! (`## parameters`'s own table drops `scope`/`reads`.) A machine-read
//! section holds exactly that one table and nothing else -- any
//! non-blank line between the table's own end and the next `## `
//! heading fails the build, so a stray blank line splitting a table
//! never silently drops the rows below it.
//!
//! Two Title Case sections are read too, because they tabulate a
//! vocabulary or a derived value nothing else checks: "## Neighbourhood
//! parameters"'s own `| Parameter | ... |` table (its first column is
//! the closed `reads` vocabulary -- never a second hardcoded list) and
//! "## Must never be seen"'s own `| ... | Claimed by | Status |` table
//! (`Status` is a value derived from `Claimed by` against the five kind
//! sections, checked here rather than trusted). Both allow free prose
//! before and after their own table; only a stray table-shaped line
//! immediately after the table's own blank-line end is refused, the
//! same accidental-split risk in a section that is allowed real prose
//! around it.
//!
//! `pass` must name one of the `### ` headings collected from `##
//! Passes`, never a second hardcoded list; `scope` is one of [`SCOPES`],
//! the one vocabulary this document tabulates nowhere so the constant
//! is its own definition. A rule `key` is unique across all five kind
//! sections.
//!
//! Panics, naming `path:line:`, on anything malformed: a stray
//! lowercase `## ` heading outside the closed six, a closed heading
//! repeated, a missing/emptied `## Passes` or `## Neighbourhood
//! parameters`, a missing section or table, content after a table's own
//! end, a wrong header, a missing/malformed separator, an unknown
//! `status`, an unrecognised `pass`/`scope`/`reads` token, a duplicate
//! key, an empty required column, or a ragged row.

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

/// A rule row's closed `scope` vocabulary (Derek's direction) -- the
/// document tabulates no second copy of this one, so the constant is
/// its own definition (Quentin's cycle-2 direction).
pub const SCOPES: [&str; 5] = ["cell", "room", "building", "neighbourhood", "site"];

const KIND_HEADER: &str = "| key | status | pass | scope | reads | intent |";
const BALANCE_HEADER: &str = "| balance key | status | pass | intent |";
const PARAMETERS_HEADING: &str = "## Neighbourhood parameters";
const PARAMETERS_TABLE_HEADER: &str = "| Parameter | Unit | Range | Visible carrier |";
const CATALOGUE_HEADING: &str = "## Must never be seen";
const CATALOGUE_HEADER: &str = "| Visual failure | Expected kind | Claimed by | Status |";

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
pub struct CatalogueRow {
    pub visual_failure: String,
    pub expected_kind: String,
    pub claimed_by: Vec<String>,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct Doc {
    pub sections: BTreeMap<&'static str, Vec<Row>>,
    pub parameters: Vec<BalanceRow>,
    pub passes: Vec<String>,
    pub parameter_names: Vec<String>,
    pub catalogue: Vec<CatalogueRow>,
}

#[derive(Clone, Copy)]
struct Section {
    heading_line: usize,
    body_start: usize,
    body_end: usize,
}

/// The heading line, and the body bounds (`body_start`, right after the
/// heading; `body_end`, the first line of the next `## ` heading or
/// `lines.len()`), all 0-indexed. `None` if `heading` (an exact,
/// already-`"## "`-prefixed string) is not found.
fn section_bounds(lines: &[&str], heading: &str) -> Option<Section> {
    let heading_line = lines.iter().position(|l| l.trim() == heading)?;
    let body_start = heading_line + 1;
    let body_end = lines[body_start..]
        .iter()
        .position(|l| l.trim_start().starts_with("## "))
        .map(|i| body_start + i)
        .unwrap_or(lines.len());
    Some(Section {
        heading_line,
        body_start,
        body_end,
    })
}

/// Reads one table whose header sits at `lines[section.body_start]`
/// (immediately after the section's own heading -- no blank line
/// permitted): the header, then the separator, then data rows until the
/// first blank line or `section.body_end`. After that, any further
/// non-blank line before `section.body_end` fails -- a machine-read
/// section holds one table and nothing else (Quentin's and Tim's
/// cycle-2 direction: a stray blank line splitting a table must never
/// silently drop the rows below it). Returns each data row's own
/// columns (trimmed, the table's leading/trailing empty fields already
/// stripped), paired with its 1-indexed line number.
fn parse_table(
    path: &Path,
    lines: &[&str],
    section: Section,
    header: &str,
    n_columns: usize,
    section_label: &str,
) -> Vec<(usize, Vec<String>)> {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };
    let Section {
        heading_line,
        body_start,
        body_end,
    } = section;

    if body_start >= body_end {
        fail(
            heading_line + 1,
            &format!("section '{section_label}' has no table"),
        );
    }
    if lines[body_start].trim() != header {
        fail(
            body_start + 1,
            &format!("table header must be exactly '{header}'"),
        );
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
    let mut end_of_table = body_end;
    for (i, &line) in lines.iter().enumerate().take(body_end).skip(sep_i + 1) {
        if line.trim().is_empty() {
            end_of_table = i;
            break;
        }
        rows.push((i + 1, split_row(path, i + 1, line, n_columns, header)));
    }
    for (offset, &line) in lines[end_of_table..body_end].iter().enumerate() {
        if !line.trim().is_empty() {
            fail(
                end_of_table + offset + 1,
                "a machine-read section holds one table and nothing else",
            );
        }
    }
    rows
}

/// The bespoke reader for a Title Case section that is nonetheless
/// machine-read (`## Neighbourhood parameters`, `## Must never be
/// seen`): unlike [`parse_table`]'s six closed sections, free prose is
/// allowed both before and after the table, so the header is searched
/// for rather than assumed adjacent to the heading, and only a stray
/// table-shaped line immediately after the table's own blank-line end
/// is refused -- the same accidental-split risk `parse_table` refuses
/// outright, tolerated here only because the rest of the section is
/// real prose.
fn parse_prose_table(
    path: &Path,
    lines: &[&str],
    heading: &str,
    header: &str,
    n_columns: usize,
) -> Vec<(usize, Vec<String>)> {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };
    let Section {
        heading_line,
        body_start,
        body_end,
    } = section_bounds(lines, heading)
        .unwrap_or_else(|| fail(lines.len().max(1), &format!("missing '{heading}' section")));

    let Some(header_rel) = lines[body_start..body_end]
        .iter()
        .position(|l| l.trim() == header)
    else {
        fail(
            heading_line + 1,
            &format!("section '{heading}' has no table"),
        );
    };
    let header_i = body_start + header_rel;
    let sep_i = header_i + 1;
    if sep_i >= body_end || lines[sep_i].trim().is_empty() {
        fail(header_i + 1, "table is missing its separator row");
    }
    if !lines[sep_i]
        .trim()
        .chars()
        .all(|c| matches!(c, '|' | '-' | ':' | ' '))
    {
        fail(sep_i + 1, "malformed table separator row");
    }

    let mut rows = Vec::new();
    let mut end_of_table = body_end;
    for (i, &line) in lines.iter().enumerate().take(body_end).skip(sep_i + 1) {
        if line.trim().is_empty() {
            end_of_table = i;
            break;
        }
        rows.push((i + 1, split_row(path, i + 1, line, n_columns, header)));
    }
    if end_of_table < body_end {
        for (offset, &line) in lines[(end_of_table + 1)..body_end].iter().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            if line.trim().starts_with('|') {
                fail(
                    end_of_table + 1 + offset + 1,
                    "a row appears after this section's own table already ended -- a blank line split it",
                );
            }
            break;
        }
    }
    rows
}

/// Splits one `| a | b | ... |` row into its own `n_columns` trimmed
/// cells, failing (naming `line_no`) if the count disagrees.
fn split_row(
    path: &Path,
    line_no: usize,
    line: &str,
    n_columns: usize,
    header: &str,
) -> Vec<String> {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };
    let fields: Vec<String> = line
        .trim()
        .split('|')
        .map(|s| s.trim().to_string())
        .collect();
    if fields.len() != n_columns + 2 {
        fail(
            line_no,
            &format!("row must have exactly {n_columns} columns: {header}"),
        );
    }
    fields[1..fields.len() - 1].to_vec()
}

fn parse_status(path: &Path, line_no: usize, value: &str) -> Status {
    match value {
        "committed" => Status::Committed,
        "planned" => Status::Planned,
        other => panic!(
            "{}:{}: unknown status '{other}' -- must be 'committed' or 'planned'",
            path.display(),
            line_no
        ),
    }
}

fn check_pass(path: &Path, line_no: usize, pass: &str, passes: &[String]) {
    if !passes.iter().any(|p| p == pass) {
        panic!(
            "{}:{}: row's own pass '{pass}' does not name a '### ' heading under '## Passes' ({})",
            path.display(),
            line_no,
            passes.join(", ")
        );
    }
}

fn non_empty(path: &Path, line_no: usize, field: &str, value: &str) {
    if value.is_empty() {
        panic!(
            "{}:{}: row's own {field} column is empty",
            path.display(),
            line_no
        );
    }
}

fn build_row(
    path: &Path,
    line_no: usize,
    cols: Vec<String>,
    passes: &[String],
    parameter_names: &[String],
    seen_keys: &mut BTreeMap<String, &'static str>,
    section: &'static str,
) -> Row {
    let cols: [String; 6] = cols.try_into().unwrap_or_else(|_| {
        panic!(
            "{}:{}: internal: split_row already guarantees six columns",
            path.display(),
            line_no
        )
    });
    let [key, status, pass, scope, reads, intent] = cols;

    non_empty(path, line_no, "key", &key);
    if let Some(&other) = seen_keys.get(&key) {
        panic!(
            "{}:{}: duplicate key '{key}', already declared under section '{other}'",
            path.display(),
            line_no
        );
    }
    let status = parse_status(path, line_no, &status);
    check_pass(path, line_no, &pass, passes);
    if !SCOPES.contains(&scope.as_str()) {
        panic!(
            "{}:{}: row's own scope '{scope}' must be one of: {}",
            path.display(),
            line_no,
            SCOPES.join(", ")
        );
    }
    let reads_list: Vec<String> = if reads == "-" {
        Vec::new()
    } else {
        let parts: Vec<String> = reads.split('+').map(|s| s.trim().to_string()).collect();
        for p in &parts {
            if !parameter_names.iter().any(|n| n == p) {
                panic!(
                    "{}:{}: row's own reads token '{p}' must be '-' or one of: {}",
                    path.display(),
                    line_no,
                    parameter_names.join(", ")
                );
            }
        }
        parts
    };
    non_empty(path, line_no, "intent", &intent);

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
    let cols: [String; 4] = cols.try_into().unwrap_or_else(|_| {
        panic!(
            "{}:{}: internal: split_row already guarantees four columns",
            path.display(),
            line_no
        )
    });
    let [key, status, pass, intent] = cols;

    non_empty(path, line_no, "balance key", &key);
    if !seen_keys.insert(key.clone()) {
        panic!(
            "{}:{}: duplicate balance key '{key}'",
            path.display(),
            line_no
        );
    }
    let status = parse_status(path, line_no, &status);
    check_pass(path, line_no, &pass, passes);
    non_empty(path, line_no, "intent", &intent);

    BalanceRow {
        key,
        status,
        pass,
        intent,
    }
}

fn build_catalogue_row(path: &Path, line_no: usize, cols: Vec<String>) -> CatalogueRow {
    let cols: [String; 4] = cols.try_into().unwrap_or_else(|_| {
        panic!(
            "{}:{}: internal: split_row already guarantees four columns",
            path.display(),
            line_no
        )
    });
    let [visual_failure, expected_kind, claimed_by, status] = cols;

    non_empty(path, line_no, "Visual failure", &visual_failure);
    if !KIND_SECTIONS.contains(&expected_kind.as_str()) {
        panic!(
            "{}:{}: row's own Expected kind '{expected_kind}' must be one of: {}",
            path.display(),
            line_no,
            KIND_SECTIONS.join(", ")
        );
    }
    let claimed_by: Vec<String> = if claimed_by.is_empty() {
        Vec::new()
    } else {
        claimed_by
            .split('+')
            .map(|s| s.trim().to_string())
            .collect()
    };
    match status.as_str() {
        "claimed" | "unclaimed" => {}
        other => panic!(
            "{}:{}: unknown Status '{other}' -- must be 'claimed' or 'unclaimed'",
            path.display(),
            line_no
        ),
    }

    CatalogueRow {
        visual_failure,
        expected_kind,
        claimed_by,
        status,
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
    let passes_section = section_bounds(&lines, "## Passes")
        .unwrap_or_else(|| fail(lines.len().max(1), "missing '## Passes' section"));
    let passes: Vec<String> = lines[passes_section.body_start..passes_section.body_end]
        .iter()
        .filter_map(|l| l.trim().strip_prefix("### ").map(|s| s.trim().to_string()))
        .collect();
    if passes.is_empty() {
        fail(
            passes_section.heading_line + 1,
            "'## Passes' has no '### ' pass headings",
        );
    }

    // The parameter-name vocabulary -- derived from the Neighbourhood
    // parameters table's own first column, never a second hardcoded
    // list (Quentin's and Tim's cycle-2 direction).
    let parameter_rows =
        parse_prose_table(path, &lines, PARAMETERS_HEADING, PARAMETERS_TABLE_HEADER, 4);
    if parameter_rows.is_empty() {
        fail(
            lines.len().max(1),
            &format!("'{PARAMETERS_HEADING}' table has no rows"),
        );
    }
    let parameter_names: Vec<String> = parameter_rows
        .into_iter()
        .map(|(line_no, cols)| {
            let name = cols[0].clone();
            non_empty(path, line_no, "Parameter", &name);
            name
        })
        .collect();

    let mut sections: BTreeMap<&'static str, Vec<Row>> =
        KIND_SECTIONS.iter().map(|&k| (k, Vec::new())).collect();
    let mut seen_keys: BTreeMap<String, &'static str> = BTreeMap::new();
    for &name in &KIND_SECTIONS {
        let heading = format!("## {name}");
        let section = section_bounds(&lines, &heading)
            .unwrap_or_else(|| fail(lines.len().max(1), &format!("missing '{heading}' section")));
        let raw_rows = parse_table(path, &lines, section, KIND_HEADER, 6, &heading);
        for (line_no, cols) in raw_rows {
            let row = build_row(
                path,
                line_no,
                cols,
                &passes,
                &parameter_names,
                &mut seen_keys,
                name,
            );
            sections.get_mut(name).expect("pre-seeded above").push(row);
        }
    }

    let p_section = section_bounds(&lines, "## parameters")
        .unwrap_or_else(|| fail(lines.len().max(1), "missing '## parameters' section"));
    let raw_balance_rows = parse_table(path, &lines, p_section, BALANCE_HEADER, 4, "## parameters");
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

    let raw_catalogue_rows =
        parse_prose_table(path, &lines, CATALOGUE_HEADING, CATALOGUE_HEADER, 4);
    let catalogue: Vec<CatalogueRow> = raw_catalogue_rows
        .into_iter()
        .map(|(line_no, cols)| build_catalogue_row(path, line_no, cols))
        .collect();

    Doc {
        sections,
        parameters,
        passes,
        parameter_names,
        catalogue,
    }
}

/// Story 3.1 (Quentin's and Tim's direction): the pure comparison
/// AC2/AC3 enforce, extracted so each failure branch is unit-testable
/// with a planted disagreement rather than only ever exercised against
/// the real, always-agreeing repo. `committed` is `(key, section)`
/// pairs -- the caller (`rule_examples.rs`) maps `defs::RULES` through
/// `RuleKind` to build it; this function touches no `sim` type at all.
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

/// Story 3.1 (Quentin's cycle-2 direction): "## Must never be seen"'s
/// own `Status` is a derived value with a stated derivation -- checked
/// here, mechanically, rather than trusted. Every `Claimed by` key must
/// exist in some kind section; the section it is actually found under
/// must equal the row's own `Expected kind`; `Status` must equal
/// `claimed` exactly when `Claimed by` is non-empty and every key in it
/// is `committed`, `unclaimed` otherwise. Pure, over `doc.catalogue` and
/// `doc.sections` alone, unit-tested against planted disagreements the
/// same way [`check_rules_current`] is.
pub fn check_catalogue(doc: &Doc) -> Vec<String> {
    let mut failures = Vec::new();

    for row in &doc.catalogue {
        let mut derived_claimed = !row.claimed_by.is_empty();
        for key in &row.claimed_by {
            let found: Vec<(&'static str, &Row)> = KIND_SECTIONS
                .iter()
                .filter_map(|&s| {
                    doc.sections[s]
                        .iter()
                        .find(|r| &r.key == key)
                        .map(|r| (s, r))
                })
                .collect();
            match found.len() {
                0 => {
                    failures.push(format!(
                        "'Must never be seen' row '{}' names '{key}' in its own Claimed by column, but no such key exists in any kind section",
                        row.visual_failure
                    ));
                    derived_claimed = false;
                }
                1 => {
                    let (found_section, found_row) = found[0];
                    if found_section != row.expected_kind {
                        failures.push(format!(
                            "'Must never be seen' row '{}' names Expected kind '{}', but its own claiming key '{key}' is committed under '## {found_section}'",
                            row.visual_failure, row.expected_kind
                        ));
                        derived_claimed = false;
                    }
                    if found_row.status != Status::Committed {
                        derived_claimed = false;
                    }
                }
                _ => {
                    failures.push(format!(
                        "'{key}' appears under more than one section in docs/generation.md"
                    ));
                    derived_claimed = false;
                }
            }
        }
        let expected_status = if derived_claimed {
            "claimed"
        } else {
            "unclaimed"
        };
        if row.status != expected_status {
            failures.push(format!(
                "'Must never be seen' row '{}' is marked '{}', but its own Claimed by column derives '{expected_status}'",
                row.visual_failure, row.status
            ));
        }
    }

    failures
}

#[cfg(test)]
mod tests {
    use super::{
        CatalogueRow, Doc, Row, SCOPES, Status, check_catalogue, check_rules_current, parse,
    };
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

    /// The whole document's own shape: zero rows in every kind/balance
    /// table, two rows in `## Neighbourhood parameters` (enough to
    /// exercise a `+`-joined `reads` cell), zero catalogue rows. Every
    /// test below starts here and finds its own insertion point or
    /// expected line number by searching, never by hand-counting an
    /// index that a skeleton edit could silently invalidate.
    fn skeleton() -> Vec<&'static str> {
        vec![
            "## Passes",
            "",
            "### Prop placement",
            "",
            "## Neighbourhood parameters",
            "",
            "| Parameter | Unit | Range | Visible carrier |",
            "| --- | --- | --- | --- |",
            "| Density | integer | not yet ranged | plot packing |",
            "| Affluence | integer | not yet ranged | family choice |",
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
            "",
            "## Must never be seen",
            "",
            "| Visual failure | Expected kind | Claimed by | Status |",
            "| --- | --- | --- | --- |",
        ]
    }

    fn text_of(lines: &[&str]) -> String {
        lines.join("\n") + "\n"
    }

    /// The 0-indexed line where a fresh data row may be inserted into
    /// the `## <name>` kind section -- the blank line right after its
    /// own separator, found by searching so a skeleton edit can never
    /// leave an insertion-based test silently pointed at the wrong
    /// line.
    fn kind_row_slot(lines: &[&str], name: &str) -> usize {
        let heading = format!("## {name}");
        lines.iter().position(|l| *l == heading).unwrap() + 3
    }

    fn balance_row_slot(lines: &[&str]) -> usize {
        lines.iter().position(|l| *l == "## parameters").unwrap() + 3
    }

    /// `## Must never be seen`'s own table header is not immediately
    /// after the heading (prose is allowed there), so this searches for
    /// the header line itself, not the heading.
    fn catalogue_row_slot(lines: &[&str]) -> usize {
        lines
            .iter()
            .position(|l| *l == super::CATALOGUE_HEADER)
            .unwrap()
            + 2
    }

    /// The 1-indexed line of the first occurrence of `needle` in the
    /// final, post-mutation `lines` -- the expected panic location for
    /// most tests below, computed rather than hand-counted.
    fn line_of(lines: &[&str], needle: &str) -> usize {
        lines.iter().position(|l| l.contains(needle)).unwrap() + 1
    }

    #[test]
    fn skeleton_parses_with_five_empty_kind_sections_and_an_empty_parameters_table() {
        let doc = parse(Path::new("docs/generation.md"), &text_of(&skeleton()));
        assert_eq!(doc.passes, vec!["Prop placement".to_string()]);
        assert_eq!(
            doc.parameter_names,
            vec!["Density".to_string(), "Affluence".to_string()]
        );
        for name in super::KIND_SECTIONS {
            assert!(doc.sections[name].is_empty());
        }
        assert!(doc.parameters.is_empty());
        assert!(doc.catalogue.is_empty());
    }

    #[test]
    fn a_committed_row_parses_with_scope_and_reads() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
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
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | Prop placement | site | - | an intent |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert!(doc.sections["placement"][0].reads.is_empty());
    }

    #[test]
    fn a_reads_cell_with_two_plus_joined_parameters_parses_both() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
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
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| a_future_rule | planned | Prop placement | site | - | not built yet |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(doc.sections["placement"][0].status, Status::Planned);
    }

    #[test]
    fn a_committed_balance_row_parses() {
        let mut lines = skeleton();
        let slot = balance_row_slot(&lines);
        lines.insert(
            slot,
            "| render.tile_size_px | committed | Prop placement | the tile every screen-space measurement is built from |",
        );
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(doc.parameters.len(), 1);
        assert_eq!(doc.parameters[0].key, "render.tile_size_px");
        assert_eq!(doc.parameters[0].status, Status::Committed);
    }

    #[test]
    fn renaming_a_parameter_changes_what_reads_accepts() {
        let mut lines = skeleton();
        let param_i = lines
            .iter()
            .position(|l| l.starts_with("| Affluence |"))
            .unwrap();
        lines[param_i] = "| Wealth | integer | not yet ranged | family choice |";
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | Prop placement | site | Affluence | an intent |",
        );
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own reads token 'Affluence' must be '-' or one of: Density, Wealth"
            )
        );
    }

    #[test]
    fn a_missing_passes_section_is_named() {
        let mut lines = skeleton();
        lines.drain(0..4); // '## Passes', blank, '### Prop placement', blank
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: missing '## Passes' section",
                lines.len()
            )
        );
    }

    #[test]
    fn passes_with_no_sub_headings_is_named() {
        let mut lines = skeleton();
        let i = lines
            .iter()
            .position(|l| *l == "### Prop placement")
            .unwrap();
        lines.remove(i);
        assert_eq!(
            err(&text_of(&lines)),
            "docs/generation.md:1: '## Passes' has no '### ' pass headings"
        );
    }

    #[test]
    fn a_missing_neighbourhood_parameters_section_is_named() {
        let mut lines = skeleton();
        let start = lines
            .iter()
            .position(|l| *l == "## Neighbourhood parameters")
            .unwrap();
        let end = lines.iter().position(|l| *l == "## placement").unwrap();
        lines.drain(start..end);
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: missing '## Neighbourhood parameters' section",
                lines.len()
            )
        );
    }

    #[test]
    fn a_neighbourhood_parameters_section_with_no_table_is_named() {
        let mut lines = skeleton();
        let header_i = lines
            .iter()
            .position(|l| *l == super::PARAMETERS_TABLE_HEADER)
            .unwrap();
        let end = lines.iter().position(|l| *l == "## placement").unwrap();
        lines.drain(header_i..end);
        let heading_line = lines
            .iter()
            .position(|l| *l == "## Neighbourhood parameters")
            .unwrap()
            + 1;
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{heading_line}: section '## Neighbourhood parameters' has no table"
            )
        );
    }

    #[test]
    fn a_stray_row_after_the_neighbourhood_parameters_table_ended_is_named() {
        let mut lines = skeleton();
        let placement_i = lines.iter().position(|l| *l == "## placement").unwrap();
        lines.insert(placement_i, "| Stray | integer | - | nothing |");
        let expected_line = line_of(&lines, "| Stray |");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: a row appears after this section's own table already ended -- a blank line split it"
            )
        );
    }

    #[test]
    fn a_missing_kind_section_is_named() {
        let mut lines = skeleton();
        let start = lines.iter().position(|l| *l == "## placement").unwrap();
        lines.drain(start..start + 4); // heading, header, separator, blank
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
        let heading_i = lines.iter().position(|l| *l == "## placement").unwrap();
        lines.drain(heading_i + 1..heading_i + 4); // header, separator, blank
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: section '## placement' has no table",
                heading_i + 1
            )
        );
    }

    #[test]
    fn a_wrong_table_header_is_named() {
        let mut lines = skeleton();
        let heading_i = lines.iter().position(|l| *l == "## placement").unwrap();
        lines[heading_i + 1] = "| wrong | header |";
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: table header must be exactly '| key | status | pass | scope | reads | intent |'",
                heading_i + 2
            )
        );
    }

    #[test]
    fn a_missing_separator_row_is_named() {
        let mut lines = skeleton();
        let heading_i = lines.iter().position(|l| *l == "## placement").unwrap();
        lines.remove(heading_i + 2); // the separator row only
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: table is missing its separator row",
                heading_i + 2
            )
        );
    }

    #[test]
    fn a_malformed_separator_row_is_named() {
        let mut lines = skeleton();
        let heading_i = lines.iter().position(|l| *l == "## placement").unwrap();
        lines[heading_i + 2] = "not a separator";
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: malformed table separator row",
                heading_i + 3
            )
        );
    }

    #[test]
    fn a_stray_row_after_a_blank_line_in_a_kind_section_is_named() {
        let mut lines = skeleton();
        let dist_i = lines.iter().position(|l| *l == "## distribution").unwrap();
        lines.insert(
            dist_i,
            "| stray_key | committed | Prop placement | site | - | an intent |",
        );
        let expected_line = line_of(&lines, "stray_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: a machine-read section holds one table and nothing else"
            )
        );
    }

    #[test]
    fn a_ragged_row_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(slot, "| some_key | committed | Prop placement | site |");
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row must have exactly 6 columns: | key | status | pass | scope | reads | intent |"
            )
        );
    }

    #[test]
    fn an_empty_key_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "|  | committed | Prop placement | site | - | an intent |",
        );
        let expected_line = line_of(&lines, "|  | committed |");
        assert_eq!(
            err(&text_of(&lines)),
            format!("docs/generation.md:{expected_line}: row's own key column is empty")
        );
    }

    #[test]
    fn an_unknown_status_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | maybe | Prop placement | site | - | an intent |",
        );
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: unknown status 'maybe' -- must be 'committed' or 'planned'"
            )
        );
    }

    #[test]
    fn a_pass_not_matching_any_passes_heading_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | prop placement | site | - | an intent |",
        );
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own pass 'prop placement' does not name a '### ' heading under '## Passes' (Prop placement)"
            )
        );
    }

    #[test]
    fn an_empty_pass_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(slot, "| some_key | committed |  | site | - | an intent |");
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own pass '' does not name a '### ' heading under '## Passes' (Prop placement)"
            )
        );
    }

    #[test]
    fn an_invalid_scope_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | Prop placement | planet | - | an intent |",
        );
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own scope 'planet' must be one of: {}",
                SCOPES.join(", ")
            )
        );
    }

    #[test]
    fn an_invalid_reads_token_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | Prop placement | site | Weather | an intent |",
        );
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own reads token 'Weather' must be '-' or one of: Density, Affluence"
            )
        );
    }

    #[test]
    fn an_empty_intent_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | Prop placement | site | - |  |",
        );
        let expected_line = line_of(&lines, "some_key");
        assert_eq!(
            err(&text_of(&lines)),
            format!("docs/generation.md:{expected_line}: row's own intent column is empty")
        );
    }

    #[test]
    fn a_duplicate_key_in_one_section_is_named() {
        let mut lines = skeleton();
        let slot = kind_row_slot(&lines, "placement");
        lines.insert(
            slot,
            "| some_key | committed | Prop placement | site | - | a |",
        );
        lines.insert(
            slot + 1,
            "| some_key | planned | Prop placement | site | - | b |",
        );
        let expected_line = line_of(&lines, "some_key | planned");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: duplicate key 'some_key', already declared under section 'placement'"
            )
        );
    }

    #[test]
    fn a_key_repeated_under_two_different_sections_is_named() {
        let mut lines = skeleton();
        // Insert into distribution (later in the document) first, so
        // placement's own slot, computed afterward, is unaffected.
        let dist_slot = kind_row_slot(&lines, "distribution");
        lines.insert(
            dist_slot,
            "| some_key | planned | Prop placement | site | - | b |",
        );
        let placement_slot = kind_row_slot(&lines, "placement");
        lines.insert(
            placement_slot,
            "| some_key | committed | Prop placement | site | - | a |",
        );
        let expected_line = line_of(&lines, "some_key | planned");
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
        let i = lines.iter().position(|l| *l == "## distribution").unwrap();
        lines.insert(i, "## placement");
        let expected_line = lines
            .iter()
            .enumerate()
            .filter(|(_, l)| **l == "## placement")
            .nth(1)
            .unwrap()
            .0
            + 1;
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: '## placement' section appears more than once"
            )
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
        let mut lines = skeleton();
        lines.insert(0, "## Does not fit");
        let doc = parse(Path::new("docs/generation.md"), &text_of(&lines));
        assert_eq!(doc.passes, vec!["Prop placement".to_string()]);
    }

    #[test]
    fn a_missing_parameters_section_is_named() {
        let mut lines = skeleton();
        let start = lines.iter().position(|l| *l == "## parameters").unwrap();
        let end = lines
            .iter()
            .position(|l| *l == "## Must never be seen")
            .unwrap();
        lines.drain(start..end);
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
        let slot = balance_row_slot(&lines);
        lines.insert(slot, "| a.balance.key | committed | nowhere | an intent |");
        let expected_line = line_of(&lines, "a.balance.key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own pass 'nowhere' does not name a '### ' heading under '## Passes' (Prop placement)"
            )
        );
    }

    #[test]
    fn a_duplicate_balance_key_is_named() {
        let mut lines = skeleton();
        let slot = balance_row_slot(&lines);
        lines.insert(slot, "| a.balance.key | committed | Prop placement | a |");
        lines.insert(slot + 1, "| a.balance.key | planned | Prop placement | b |");
        let expected_line = line_of(&lines, "a.balance.key | planned");
        assert_eq!(
            err(&text_of(&lines)),
            format!("docs/generation.md:{expected_line}: duplicate balance key 'a.balance.key'")
        );
    }

    #[test]
    fn a_stray_row_after_a_blank_line_in_the_parameters_section_is_named() {
        let mut lines = skeleton();
        let catalogue_i = lines
            .iter()
            .position(|l| *l == "## Must never be seen")
            .unwrap();
        lines.insert(
            catalogue_i,
            "| a.balance.key | committed | Prop placement | an intent |",
        );
        let expected_line = line_of(&lines, "a.balance.key");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: a machine-read section holds one table and nothing else"
            )
        );
    }

    #[test]
    fn a_missing_catalogue_section_is_named() {
        let mut lines = skeleton();
        let start = lines
            .iter()
            .position(|l| *l == "## Must never be seen")
            .unwrap();
        lines.truncate(start);
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{}: missing '## Must never be seen' section",
                lines.len()
            )
        );
    }

    #[test]
    fn a_catalogue_row_with_an_unrecognised_expected_kind_is_named() {
        let mut lines = skeleton();
        let slot = catalogue_row_slot(&lines);
        lines.insert(slot, "| some failure | nonsense | | unclaimed |");
        let expected_line = line_of(&lines, "some failure");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: row's own Expected kind 'nonsense' must be one of: {}",
                super::KIND_SECTIONS.join(", ")
            )
        );
    }

    #[test]
    fn a_catalogue_row_with_an_unknown_status_is_named() {
        let mut lines = skeleton();
        let slot = catalogue_row_slot(&lines);
        lines.insert(slot, "| some failure | adjacency | | maybe |");
        let expected_line = line_of(&lines, "some failure");
        assert_eq!(
            err(&text_of(&lines)),
            format!(
                "docs/generation.md:{expected_line}: unknown Status 'maybe' -- must be 'claimed' or 'unclaimed'"
            )
        );
    }

    #[test]
    fn a_catalogue_row_with_an_empty_visual_failure_is_named() {
        let mut lines = skeleton();
        let slot = catalogue_row_slot(&lines);
        lines.insert(slot, "|  | adjacency | | unclaimed |");
        let expected_line = line_of(&lines, "|  | adjacency |");
        assert_eq!(
            err(&text_of(&lines)),
            format!("docs/generation.md:{expected_line}: row's own Visual failure column is empty")
        );
    }

    // -- check_rules_current: the pure AC2/AC3 comparison, planted ------

    fn mk_doc(rows_by_section: &[(&'static str, Vec<Row>)]) -> Doc {
        let mut sections: BTreeMap<&'static str, Vec<Row>> = super::KIND_SECTIONS
            .iter()
            .map(|&k| (k, Vec::new()))
            .collect();
        for (s, rows) in rows_by_section {
            sections.insert(*s, rows.clone());
        }
        Doc {
            sections,
            parameters: Vec::new(),
            passes: vec!["Prop placement".to_string()],
            parameter_names: vec!["Density".to_string(), "Affluence".to_string()],
            catalogue: Vec::new(),
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
        assert_eq!(
            failures,
            vec![
                "'some_key' is committed in defs/rules/ but has no row in docs/generation.md -- add one under '## placement':\n    | some_key | committed | <pass> | <scope> | <reads> | <intent> |\nre-run: bash scripts/dev/verify-defs.sh"
                    .to_string()
            ]
        );
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
        let doc = mk_doc(&[("adjacency", vec![row("some_key", Status::Committed)])]);
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
        let doc = mk_doc(&[("placement", vec![row("orphan_key", Status::Committed)])]);
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
        let doc = mk_doc(&[("placement", vec![row("future_key", Status::Planned)])]);
        let failures = check_rules_current(&doc, &[]);
        assert!(failures.is_empty());
    }

    #[test]
    fn check_rules_current_passes_when_everything_agrees() {
        let doc = mk_doc(&[("placement", vec![row("some_key", Status::Committed)])]);
        let failures = check_rules_current(&doc, &[("some_key", "placement")]);
        assert!(failures.is_empty());
    }

    #[test]
    fn check_rules_current_flags_a_key_present_under_more_than_one_section() {
        // A Doc `parse()` produces can never have this shape (it rejects
        // the same key under two sections at parse time), but the pure
        // function must still behave sanely against a hand-built one
        // that does (Quentin's cycle-2 note).
        let doc = mk_doc(&[
            ("placement", vec![row("dup_key", Status::Committed)]),
            ("adjacency", vec![row("dup_key", Status::Committed)]),
        ]);
        let failures = check_rules_current(&doc, &[("dup_key", "placement")]);
        assert_eq!(
            failures,
            vec!["'dup_key' appears under more than one section in docs/generation.md".to_string()]
        );
    }

    // -- check_catalogue: the pure "Must never be seen" comparison ------

    fn catalogue_row(
        visual_failure: &str,
        expected_kind: &str,
        claimed_by: &[&str],
        status: &str,
    ) -> CatalogueRow {
        CatalogueRow {
            visual_failure: visual_failure.to_string(),
            expected_kind: expected_kind.to_string(),
            claimed_by: claimed_by.iter().map(|s| s.to_string()).collect(),
            status: status.to_string(),
        }
    }

    fn mk_doc_with_catalogue(
        rows_by_section: &[(&'static str, Vec<Row>)],
        catalogue: Vec<CatalogueRow>,
    ) -> Doc {
        let mut doc = mk_doc(rows_by_section);
        doc.catalogue = catalogue;
        doc
    }

    #[test]
    fn check_catalogue_flags_a_claimed_by_key_that_does_not_exist() {
        let doc = mk_doc_with_catalogue(
            &[],
            vec![catalogue_row(
                "a failure",
                "adjacency",
                &["missing_key"],
                "unclaimed",
            )],
        );
        assert_eq!(
            check_catalogue(&doc),
            vec![
                "'Must never be seen' row 'a failure' names 'missing_key' in its own Claimed by column, but no such key exists in any kind section"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_catalogue_flags_a_claimed_by_key_under_the_wrong_section() {
        let doc = mk_doc_with_catalogue(
            &[("adjacency", vec![row("some_key", Status::Committed)])],
            vec![catalogue_row(
                "a failure",
                "requirement",
                &["some_key"],
                "unclaimed",
            )],
        );
        assert_eq!(
            check_catalogue(&doc),
            vec![
                "'Must never be seen' row 'a failure' names Expected kind 'requirement', but its own claiming key 'some_key' is committed under '## adjacency'"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_catalogue_flags_status_claimed_with_an_empty_claimed_by() {
        let doc = mk_doc_with_catalogue(
            &[],
            vec![catalogue_row("a failure", "adjacency", &[], "claimed")],
        );
        assert_eq!(
            check_catalogue(&doc),
            vec![
                "'Must never be seen' row 'a failure' is marked 'claimed', but its own Claimed by column derives 'unclaimed'"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_catalogue_flags_status_unclaimed_when_it_should_be_claimed() {
        let doc = mk_doc_with_catalogue(
            &[("adjacency", vec![row("some_key", Status::Committed)])],
            vec![catalogue_row(
                "a failure",
                "adjacency",
                &["some_key"],
                "unclaimed",
            )],
        );
        assert_eq!(
            check_catalogue(&doc),
            vec![
                "'Must never be seen' row 'a failure' is marked 'unclaimed', but its own Claimed by column derives 'claimed'"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_catalogue_flags_status_claimed_when_the_claiming_key_is_still_planned() {
        let doc = mk_doc_with_catalogue(
            &[("adjacency", vec![row("some_key", Status::Planned)])],
            vec![catalogue_row(
                "a failure",
                "adjacency",
                &["some_key"],
                "claimed",
            )],
        );
        assert_eq!(
            check_catalogue(&doc),
            vec![
                "'Must never be seen' row 'a failure' is marked 'claimed', but its own Claimed by column derives 'unclaimed'"
                    .to_string()
            ]
        );
    }

    #[test]
    fn check_catalogue_passes_when_claimed_correctly() {
        let doc = mk_doc_with_catalogue(
            &[("adjacency", vec![row("some_key", Status::Committed)])],
            vec![catalogue_row(
                "a failure",
                "adjacency",
                &["some_key"],
                "claimed",
            )],
        );
        assert!(check_catalogue(&doc).is_empty());
    }

    #[test]
    fn check_catalogue_passes_when_unclaimed_with_no_claims() {
        let doc = mk_doc_with_catalogue(
            &[],
            vec![catalogue_row("a failure", "adjacency", &[], "unclaimed")],
        );
        assert!(check_catalogue(&doc).is_empty());
    }
}

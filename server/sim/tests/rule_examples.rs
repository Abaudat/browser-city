//! Story 2.12 (AC1/AC2/AC3, NFR27): the agent-facing example corpus over
//! the committed rule table -- every `[[placement]]`/`[[distribution]]`/
//! `[[coherence]]`/`[[adjacency]]`/`[[requirement]]` row in `defs/rules/
//! *.toml` carries at least one worked example (`pass*.grid`) and one
//! deliberately failing case (`fail*.grid`) under `server/sim/tests/
//! rule-examples/<rule_key>/`, evaluated over `sim::rules::RuleSet::
//! committed()` -- never a second evaluator (`tools/defs-build` cannot
//! reach `sim` at all, so this lives here, run by plain `cargo test -p
//! sim`, Tim's direction). Reached by an agent through the one command,
//! `bash scripts/dev/verify-defs.sh`.
//!
//! `.grid` file grammar (also documented, agent-facing, in `defs/
//! README.md`):
//!
//! ```text
//! rule: <rule_key>
//! expect: pass | fail
//! floor: <i8>                          # optional, default 0
//! legend: <char>=<tag>[+<tag>...] ...
//! area: <id> <x0>,<y0> <x1>,<y1>       # optional, repeatable, half-open like Rect
//! grid:
//! <rows -- one character per cell, '.' is an empty cell, top row is y=0, left column is x=0>
//! violations:                          # only for expect: fail
//! <one rendered sim::validation::Defect line per expected violation>
//! ```
//!
//! Every case is evaluated against the *whole* committed rule set, never
//! only the rule its own directory names -- an honest `fail.grid` declares
//! every row it trips, including incidental ones, so a new rule that
//! starts firing on an old example shows up as a named regression against
//! that new rule rather than passing unnoticed (AC3, Tim's direction).
//! Assertion is exact set equality (sorted, deduplicated) against the
//! declared `violations:` block -- never "contains", never a bare
//! non-empty check.

mod support;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sim::generated::defs;
use sim::rules::{RuleKind, RuleSet, RuleSite};
use sim::validation::{Check, Defect, Location};
use support::grid::{self, Expect};

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/rule-examples")
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Every committed rule row's own "subject" for the vacuity guard: a
/// `pass` case must have at least one cell this tag names, or the example
/// proves nothing (the rule never even had a subject to judge). Exhaustive
/// (no `_ =>` arm), same discipline as `evaluate`'s own match: a sixth
/// kind is a compile error here too, so this guard can never silently
/// stop covering a new kind.
fn primary_tag(kind: &RuleKind) -> sim::rules::TagId {
    match *kind {
        RuleKind::Placement { subject, .. } => subject,
        RuleKind::Distribution { subject, .. } => subject,
        RuleKind::Coherence { subject, .. } => subject,
        RuleKind::Adjacency { a, .. } => a,
        RuleKind::Requirement { container, .. } => container,
    }
}

fn rule_dir_names() -> Vec<String> {
    let dir = examples_dir();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };
    entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect()
}

fn grid_files_in(dir: &Path, prefix: &str) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| {
            p.extension().and_then(|e| e.to_str()) == Some("grid")
                && p.file_stem()
                    .and_then(|s| s.to_str())
                    .is_some_and(|s| s == prefix || s.starts_with(&format!("{prefix}-")))
        })
        .collect();
    files.sort();
    files
}

/// AC2: a rule row added to `defs/rules/*.toml` with no directory (or one
/// missing a `pass*`/`fail*` case) fails this test by name -- the
/// completeness guarantee is a test, not a promise in a doc.
#[test]
fn every_committed_rule_has_at_least_one_pass_and_one_fail_example() {
    let dir = examples_dir();
    let mut missing = Vec::new();
    for rule in defs::RULES {
        let rule_dir = dir.join(rule.key);
        let pass = grid_files_in(&rule_dir, "pass");
        let fail = grid_files_in(&rule_dir, "fail");
        if pass.is_empty() {
            missing.push(format!(
                "'{}' has no pass*.grid under {}",
                rule.key,
                rule_dir.display()
            ));
        }
        if fail.is_empty() {
            missing.push(format!(
                "'{}' has no fail*.grid under {}",
                rule.key,
                rule_dir.display()
            ));
        }
    }
    assert!(
        missing.is_empty(),
        "every committed rule row must carry a pass and a fail example (story 2.12 AC2):\n{}",
        missing.join("\n")
    );

    // The other direction: a directory whose name is not a committed key
    // is a lie in the corpus (e.g. left behind after a rule rename).
    let known: BTreeSet<&str> = defs::RULES.iter().map(|r| r.key).collect();
    let orphans: Vec<String> = rule_dir_names()
        .into_iter()
        .filter(|name| !known.contains(name.as_str()))
        .collect();
    assert!(
        orphans.is_empty(),
        "server/sim/tests/rule-examples/ has director{} for no committed rule key: {:?} -- rename or remove {}",
        if orphans.len() == 1 { "y" } else { "ies" },
        orphans,
        if orphans.len() == 1 { "it" } else { "them" }
    );
}

fn render(rule_set: &RuleSet<'static>, v: sim::rules::Violation) -> String {
    let key = rule_set.key_of(v.rule_id).unwrap_or("<unknown-rule>");
    Defect {
        check: Check::Rule { id: v.rule_id, key },
        location: Location::Cell {
            cell: v.subject,
            other: v.other,
        },
    }
    .to_string()
}

/// `defs/rules/<file>.toml:<line>` for `key = "<rule_key>"` -- scanned
/// from the real committed TOML source, never re-derived or hand-kept, so
/// a mismatch report always points at the row that actually fired.
fn rule_toml_location(rule_key: &str) -> Option<String> {
    let dir = repo_root().join("defs/rules");
    let needle = format!("key = \"{rule_key}\"");
    let mut entries: Vec<PathBuf> = std::fs::read_dir(&dir)
        .ok()?
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("toml"))
        .collect();
    entries.sort();
    for path in entries {
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        for (i, line) in text.lines().enumerate() {
            if line.trim() == needle {
                let rel = path.strip_prefix(repo_root()).unwrap_or(&path);
                return Some(format!(
                    "{}:{}",
                    rel.display().to_string().replace('\\', "/"),
                    i + 1
                ));
            }
        }
    }
    None
}

/// Re-prints `grid_lines` with every found violation's subject cell
/// marked `!` and, when present, its `other` cell marked `?` -- "a small
/// normalised ASCII excerpt of the offending neighbourhood", not bare
/// coordinates (Quentin's direction).
fn annotated_grid(grid_lines: &[String], floor: i8, found: &[sim::rules::Violation]) -> String {
    let mut rows: Vec<Vec<char>> = grid_lines.iter().map(|l| l.chars().collect()).collect();
    let mut mark = |cell: sim::rules::Cell, ch: char| {
        if cell.floor != floor {
            return;
        }
        if let Some(slot) = rows
            .get_mut(cell.y as usize)
            .and_then(|row| row.get_mut(cell.x as usize))
        {
            *slot = ch;
        }
    };
    for v in found {
        mark(v.subject, '!');
        if let Some(other) = v.other {
            mark(other, '?');
        }
    }
    rows.iter()
        .map(|r| r.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("\n")
}

/// AC1/AC2/AC3: the completeness meta-test is separate
/// ([`every_committed_rule_has_at_least_one_pass_and_one_fail_example`]);
/// this is the corpus itself -- every `.grid` file, evaluated and checked
/// for exact-set agreement, plus the two vacuity guards (Tim's direction).
/// Every mismatch across the whole corpus is collected and reported
/// together, in one panic payload, rather than stopping at the first --
/// so an agent editing several rules at once sees every break in one run.
#[test]
fn every_rule_example_matches_its_declared_violations() {
    let rule_set = RuleSet::committed();
    let mut failures: Vec<String> = Vec::new();

    for dir_name in rule_dir_names() {
        let rule_dir = examples_dir().join(&dir_name);
        let mut files: Vec<PathBuf> = std::fs::read_dir(&rule_dir)
            .unwrap_or_else(|e| panic!("{}: {e}", rule_dir.display()))
            .filter_map(|e| e.ok())
            .map(|e| e.path())
            .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("grid"))
            .collect();
        files.sort();

        for path in files {
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("{}: {e}", path.display()));
            let case = grid::parse_case(&path, &text);

            if case.rule_key != dir_name {
                failures.push(format!(
                    "{}: declares 'rule: {}' but lives under the '{}' directory -- a fixture's own rule: must match its directory",
                    path.display(),
                    case.rule_key,
                    dir_name
                ));
                continue;
            }

            let Some(rule) = defs::RULES.iter().find(|r| r.key == case.rule_key) else {
                failures.push(format!(
                    "{}: 'rule: {}' names no row in defs::RULES",
                    path.display(),
                    case.rule_key
                ));
                continue;
            };

            let violations = sim::rules::evaluate(rule_set, &case.site);
            let mut found: Vec<sim::rules::Violation> = violations.clone();
            found.sort();
            found.dedup();
            let mut rendered: Vec<String> = found.iter().map(|&v| render(&rule_set, v)).collect();
            rendered.sort();

            let mut declared = case.declared_violations.clone();
            declared.sort();

            let subject_count = case
                .site
                .subjects_in_area(None, primary_tag(&rule.kind))
                .len();
            let rel = path.strip_prefix(repo_root()).unwrap_or(&path);
            let rel_display = rel.display().to_string().replace('\\', "/");

            let mut this_case_failures: Vec<String> = Vec::new();
            match case.expect {
                Expect::Pass => {
                    if subject_count == 0 {
                        this_case_failures.push(format!(
                            "'{}' is a pass example but has zero cells tagged as {}'s own subject -- it proves nothing (vacuous)",
                            rel_display, case.rule_key
                        ));
                    }
                }
                Expect::Fail => {
                    let names_own_rule = declared
                        .iter()
                        .any(|line| line.starts_with(&format!("{} at", case.rule_key)));
                    if !names_own_rule {
                        this_case_failures.push(format!(
                            "'{}' is a fail example but its declared violations never name '{}' itself",
                            rel_display, case.rule_key
                        ));
                    }
                }
            }

            if rendered != declared {
                let location = rule_toml_location(&case.rule_key)
                    .unwrap_or_else(|| "defs/rules/*.toml (row not found)".to_string());
                this_case_failures.push(format!(
                    "{rel_display}\nrule: {}\n{location}\n\nexpected:\n{}\nfound:\n{}\n\n{}\n\nadd a new case at: server/sim/tests/rule-examples/{}/fail-<name>.grid (or pass-<name>.grid)\nre-run: bash scripts/dev/verify-defs.sh",
                    case.rule_key,
                    if declared.is_empty() {
                        "  (none)".to_string()
                    } else {
                        declared.iter().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n")
                    },
                    if rendered.is_empty() {
                        "  (none)".to_string()
                    } else {
                        rendered.iter().map(|l| format!("  {l}")).collect::<Vec<_>>().join("\n")
                    },
                    annotated_grid(&case.grid_lines, case.floor, &found),
                    case.rule_key,
                ));
            }

            failures.extend(this_case_failures);
        }
    }

    assert!(
        failures.is_empty(),
        "{} rule-example mismatch(es):\n\n{}",
        failures.len(),
        failures.join("\n\n---\n\n")
    );
}

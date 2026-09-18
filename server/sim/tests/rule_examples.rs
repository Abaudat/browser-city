//! Story 2.12 (NFR27): the agent-facing example corpus over the
//! committed rule table. Every committed rule key must be named by at
//! least one `expect: pass` and one `expect: fail` `.grid` file under
//! `server/sim/tests/rule-examples/` -- flat, no per-rule directory: a
//! case's own `rules:` header names every key it is a worked example
//! for, since one well-formed composition is routinely evidence for
//! several rules at once. Reached by an agent through the one command,
//! `bash scripts/dev/verify-defs.sh`.
//!
//! `.grid` grammar (the agent-facing copy lives in `defs/README.md`):
//!
//! ```text
//! rules: <key> [<key> ...]
//! expect: pass | fail
//! floor: <i8>                        # optional, default 0
//! legend: <char>=<tag>[+<tag>...] ...
//! area: <id> <x0>,<y0> <x1>,<y1>     # optional, repeatable, half-open like Rect
//! grid:
//! <rows -- '.' empty, top row y=0, left column x=0>
//! violations:                        # only for expect: fail
//! <one rendered sim::validation::Defect line per expected violation>
//! ```
//!
//! Every case is evaluated against the *whole* committed rule set, never
//! only the rule(s) its own `rules:` header names -- an honest fail case
//! declares every row it trips, including incidental ones, so a new rule
//! that starts firing on an old example shows up as a named regression
//! rather than passing unnoticed. Assertion is exact set equality.

mod support;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use sim::generated::defs;
use sim::rules::{Cell, RuleKind, RuleSet, RuleSite, Violation};
use sim::validation::{Check, Defect, Location};
use support::grid::{self, Case, Expect};

/// The corpus's own fixed, already-repo-relative display path -- every
/// message this binary emits is built from this literal, never from an
/// absolute `PathBuf`, so a mismatch report or a parse panic can never
/// leak `CARGO_MANIFEST_DIR` (Tim's direction).
const EXAMPLES_DIR_DISPLAY: &str = "server/sim/tests/rule-examples";

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/rule-examples")
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn file_names() -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(examples_dir()) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("grid"))
        .filter_map(|e| e.file_name().into_string().ok())
        .collect();
    names.sort();
    names
}

fn load(name: &str) -> Case {
    let path = examples_dir().join(name);
    let text = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("{EXAMPLES_DIR_DISPLAY}/{name}: {e}"));
    grid::parse_case(Path::new(&format!("{EXAMPLES_DIR_DISPLAY}/{name}")), &text)
}

/// Every committed rule row's own "subject" for the pass-side vacuity
/// guard. Exhaustive (no `_ =>` arm), same discipline as `evaluate`'s own
/// match: a sixth kind is a compile error here too.
fn primary_tag(kind: &RuleKind) -> sim::rules::TagId {
    match *kind {
        RuleKind::Placement { subject, .. } => subject,
        RuleKind::Distribution { subject, .. } => subject,
        RuleKind::Coherence { subject, .. } => subject,
        RuleKind::Adjacency { a, .. } => a,
        RuleKind::Requirement { container, .. } => container,
    }
}

fn render(rule_set: &RuleSet<'static>, v: Violation) -> String {
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

/// AC2: a rule row added to `defs/rules/*.toml` with no matching case (or
/// a `rules:` header naming a key that is no longer committed) fails this
/// test by name.
#[test]
fn every_committed_rule_has_at_least_one_pass_and_one_fail_example() {
    let names = file_names();
    assert!(
        !names.is_empty(),
        "{EXAMPLES_DIR_DISPLAY}/ has no .grid files at all"
    );

    let mut named_pass: BTreeSet<String> = BTreeSet::new();
    let mut named_fail: BTreeSet<String> = BTreeSet::new();
    let mut named_any: BTreeSet<String> = BTreeSet::new();
    for name in &names {
        let case = load(name);
        for key in &case.rules {
            named_any.insert(key.clone());
            match case.expect {
                Expect::Pass => {
                    named_pass.insert(key.clone());
                }
                Expect::Fail => {
                    named_fail.insert(key.clone());
                }
            }
        }
    }

    let committed: BTreeSet<&str> = defs::RULES.iter().map(|r| r.key).collect();
    let mut missing = Vec::new();
    for key in &committed {
        if !named_pass.contains(*key) {
            missing.push(format!("'{key}' has no expect: pass case"));
        }
        if !named_fail.contains(*key) {
            missing.push(format!("'{key}' has no expect: fail case"));
        }
    }
    assert!(
        missing.is_empty(),
        "every committed rule row must carry a pass and a fail example (story 2.12 AC2):\n{}",
        missing.join("\n")
    );

    let orphans: Vec<&String> = named_any
        .iter()
        .filter(|k| !committed.contains(k.as_str()))
        .collect();
    assert!(
        orphans.is_empty(),
        "a case's 'rules:' header names key(s) that are no longer committed: {orphans:?}"
    );
}

/// Counts how many `(x, y)` cells (within both grids' shared, equal
/// dimensions) carry a different tag set between `a` and `b`, plus one
/// more if their own `floor:` header differs -- `None` when the two are
/// not even comparable (different grid size). The delta-discipline
/// guard's own oracle (Quentin's direction): a fail case must be a
/// small, minimal change over a real pass composition, never an
/// unrelated toy world -- a lone `floor:` change (`lighting_ground_
/// floor_only`'s own shape) is exactly such a minimal change, so it
/// counts for one, not an automatic disqualification.
fn cell_diff(a: &Case, b: &Case) -> Option<usize> {
    let (aw, ah) = (
        a.grid_lines.first().map_or(0, |l| l.chars().count()),
        a.grid_lines.len(),
    );
    let (bw, bh) = (
        b.grid_lines.first().map_or(0, |l| l.chars().count()),
        b.grid_lines.len(),
    );
    if (aw, ah) != (bw, bh) {
        return None;
    }
    let mut diff = usize::from(a.floor != b.floor);
    for y in 0..ah as i32 {
        for x in 0..aw as i32 {
            let mut at = a.site.tags_at(Cell::new(x, y, a.floor)).to_vec();
            let mut bt = b.site.tags_at(Cell::new(x, y, b.floor)).to_vec();
            at.sort_unstable();
            bt.sort_unstable();
            if at != bt {
                diff += 1;
            }
        }
    }
    Some(diff)
}

/// Quentin's direction: a fail case earns its place by being a minimal
/// change over a real, well-formed composition -- never a degenerate
/// standalone world that only proves a rule can fire in a vacuum. Widen
/// `MAX_DELTA_CELLS` with a comment here if one honest case genuinely
/// needs more; do not drop the guard.
#[test]
fn every_fail_case_is_a_small_delta_of_a_pass_case_sharing_its_rule() {
    const MAX_DELTA_CELLS: usize = 2;
    let cases: Vec<(String, Case)> = file_names().iter().map(|n| (n.clone(), load(n))).collect();

    let mut failures = Vec::new();
    for (fname, fcase) in cases.iter().filter(|(_, c)| c.expect == Expect::Fail) {
        let best = cases
            .iter()
            .filter(|(_, c)| {
                c.expect == Expect::Pass && c.rules.iter().any(|k| fcase.rules.contains(k))
            })
            .filter_map(|(pname, pcase)| cell_diff(pcase, fcase).map(|d| (pname, d)))
            .min_by_key(|&(_, d)| d);
        match best {
            Some((_, d)) if d <= MAX_DELTA_CELLS => {}
            Some((pname, d)) => failures.push(format!(
                "{EXAMPLES_DIR_DISPLAY}/{fname}: its closest same-size, same-floor pass case sharing a rule ({EXAMPLES_DIR_DISPLAY}/{pname}) differs in {d} cells, over the {MAX_DELTA_CELLS}-cell delta bound"
            )),
            None => failures.push(format!(
                "{EXAMPLES_DIR_DISPLAY}/{fname}: no expect: pass case shares any of its own rules {:?} at the same dimensions and floor to compare against",
                fcase.rules
            )),
        }
    }
    assert!(
        failures.is_empty(),
        "{} fail case(s) are not a small delta of a pass case (story 2.12, Quentin's direction):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn annotated_grid(grid_lines: &[String], floor: i8, found: &[Violation]) -> String {
    let mut rows: Vec<Vec<char>> = grid_lines.iter().map(|l| l.chars().collect()).collect();
    let mut mark = |cell: Cell, ch: char| {
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

/// `defs/rules/<file>.toml:<line>` for `key = "<rule_key>"`, scanned from
/// the real committed TOML source.
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

/// Builds the one panic payload for a mismatched case -- pure, so
/// [`a_mismatch_report_never_contains_an_absolute_path`] can pin its own
/// output directly, never through a disk fixture.
#[allow(clippy::too_many_arguments)]
fn mismatch_report(
    display_name: &str,
    rule_key: &str,
    grid_lines: &[String],
    floor: i8,
    found: &[Violation],
    rendered: &[String],
    declared: &[String],
) -> String {
    let location = rule_toml_location(rule_key)
        .unwrap_or_else(|| "defs/rules/*.toml (row not found)".to_string());
    let block = |lines: &[String]| {
        if lines.is_empty() {
            "  (none)".to_string()
        } else {
            lines
                .iter()
                .map(|l| format!("  {l}"))
                .collect::<Vec<_>>()
                .join("\n")
        }
    };
    format!(
        "{EXAMPLES_DIR_DISPLAY}/{display_name}\nrule: {rule_key}\n{location}\n\nexpected:\n{}\nfound:\n{}\n\n{}\n\nadd a new case at: {EXAMPLES_DIR_DISPLAY}/<name>.grid\nre-run: bash scripts/dev/verify-defs.sh",
        block(declared),
        block(rendered),
        annotated_grid(grid_lines, floor, found),
    )
}

#[test]
fn a_mismatch_report_never_contains_an_absolute_path() {
    let report = mismatch_report(
        "made-up.grid",
        "some_rule",
        &["X".to_string()],
        0,
        &[],
        &[],
        &["some_rule at (0, 0, 0)".to_string()],
    );
    assert!(!report.contains(env!("CARGO_MANIFEST_DIR")));
    assert!(report.starts_with(EXAMPLES_DIR_DISPLAY));
}

/// AC1/AC3: every `.grid` file, evaluated against the whole committed
/// `RuleSet` and checked for exact-set agreement, plus the two vacuity
/// guards (Tim's direction) run per key a case's own `rules:` header
/// names. Every mismatch across the whole corpus is collected and
/// reported together, in one panic payload, rather than stopping at the
/// first.
#[test]
fn every_rule_example_matches_its_declared_violations() {
    let rule_set = RuleSet::committed();
    let names = file_names();
    assert!(
        !names.is_empty(),
        "{EXAMPLES_DIR_DISPLAY}/ has no .grid files to evaluate"
    );

    let mut failures: Vec<String> = Vec::new();
    for name in &names {
        let case = load(name);

        let violations = sim::rules::evaluate(rule_set, &case.site);
        let mut found = violations;
        found.sort();
        found.dedup();
        let mut rendered: Vec<String> = found.iter().map(|&v| render(&rule_set, v)).collect();
        rendered.sort();
        let mut declared = case.declared_violations.clone();
        declared.sort();

        for key in &case.rules {
            let Some(rule) = defs::RULES.iter().find(|r| r.key == key.as_str()) else {
                failures.push(format!(
                    "{EXAMPLES_DIR_DISPLAY}/{name}: 'rules:' names '{key}', no such committed rule"
                ));
                continue;
            };
            match case.expect {
                Expect::Pass => {
                    let count = case
                        .site
                        .subjects_in_area(None, primary_tag(&rule.kind))
                        .len();
                    if count == 0 {
                        failures.push(format!(
                            "{EXAMPLES_DIR_DISPLAY}/{name}: a pass example but has zero cells tagged as '{key}'s own subject -- it proves nothing (vacuous)"
                        ));
                    }
                }
                Expect::Fail => {
                    if !found.iter().any(|v| v.rule_id == rule.id) {
                        failures.push(format!(
                            "{EXAMPLES_DIR_DISPLAY}/{name}: a fail example for '{key}' but no found violation actually names that rule's own id"
                        ));
                    }
                }
            }
        }

        if rendered != declared {
            let rule_key = case.rules.first().cloned().unwrap_or_default();
            failures.push(mismatch_report(
                name,
                &rule_key,
                &case.grid_lines,
                case.floor,
                &found,
                &rendered,
                &declared,
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} rule-example mismatch(es):\n\n{}",
        failures.len(),
        failures.join("\n\n---\n\n")
    );
}

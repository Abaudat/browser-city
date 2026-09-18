//! Story 2.12 (AC1/AC2): the small, line-oriented reader for `server/sim/
//! tests/rule-examples/<rule_key>/*.grid` -- test-only, no library, scoped
//! to exactly this corpus's own shape (Tim's direction, matching `tools/
//! defs-build/tests/shared_malformed_cases.rs`'s own precedent of a tiny
//! hand-rolled reader over a general-purpose parser dependency).
//!
//! A `.grid` file is a handful of `key: value` header lines, a `grid:`
//! block (one character per cell, `.` reserved for "no tags"), and --
//! only for a `fail` case -- a `violations:` block naming every violation
//! the harness itself must report, in the exact text
//! `sim::validation::Defect`'s own `Display` renders. See `../rule_examples.rs`'s
//! own module doc for the full grammar; `defs/README.md` is the
//! agent-facing copy of the same grammar.

use std::path::Path;

use sim::rules::testing::SiteBuilder;
use sim::rules::{AreaId, Cell, TagId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expect {
    Pass,
    Fail,
}

pub struct Case {
    pub rule_key: String,
    pub expect: Expect,
    pub floor: i8,
    pub site: sim::rules::testing::Site,
    /// Declared in file order; a rendered `Defect` line each -- only ever
    /// non-empty for a `Fail` case.
    pub declared_violations: Vec<String>,
    /// The `grid:` block's own rows, verbatim, in the same top-row-is-y=0
    /// order the site was built from -- a mismatch report re-prints this
    /// with the actually-found subject/other cells marked (Tim's
    /// direction), never re-derives it from the built site.
    pub grid_lines: Vec<String>,
}

/// Parses one `.grid` file's own text into a [`Case`]. Panics, naming
/// `path` and the offending line, on anything malformed -- this is a
/// harness-cannot-run condition (exit 2 for `scripts/dev/verify-defs.sh`),
/// never a silent skip.
pub fn parse_case(path: &Path, text: &str) -> Case {
    let lines: Vec<&str> = text.lines().collect();
    let mut rule_key: Option<String> = None;
    let mut expect: Option<Expect> = None;
    let mut floor: i8 = 0;
    let mut legend: std::collections::BTreeMap<char, Vec<TagId>> =
        std::collections::BTreeMap::new();
    let mut areas: Vec<(AreaId, i32, i32, i32, i32)> = Vec::new();

    let mut i = 0;
    let mut grid_start = None;
    while i < lines.len() {
        let raw = lines[i];
        let line = raw.trim();
        if line.is_empty() {
            i += 1;
            continue;
        }
        if line == "grid:" {
            grid_start = Some(i + 1);
            break;
        }
        let Some((key, value)) = line.split_once(':') else {
            panic!(
                "{}:{}: expected a 'key: value' header line or 'grid:', got {line:?}",
                path.display(),
                i + 1
            );
        };
        let value = value.trim();
        match key.trim() {
            "rule" => rule_key = Some(value.to_string()),
            "expect" => {
                expect = Some(match value {
                    "pass" => Expect::Pass,
                    "fail" => Expect::Fail,
                    other => panic!(
                        "{}:{}: 'expect' must be 'pass' or 'fail', got {other:?}",
                        path.display(),
                        i + 1
                    ),
                });
            }
            "floor" => {
                floor = value.parse().unwrap_or_else(|_| {
                    panic!(
                        "{}:{}: 'floor' must be an i8, got {value:?}",
                        path.display(),
                        i + 1
                    )
                });
            }
            "legend" => {
                for token in value.split_whitespace() {
                    let Some((ch, tags)) = token.split_once('=') else {
                        panic!(
                            "{}:{}: legend entry '{token}' must be '<char>=<tag>[+<tag>...]'",
                            path.display(),
                            i + 1
                        );
                    };
                    let mut chars = ch.chars();
                    let c = chars.next().unwrap_or_else(|| {
                        panic!(
                            "{}:{}: legend entry '{token}' names no character",
                            path.display(),
                            i + 1
                        )
                    });
                    if chars.next().is_some() {
                        panic!(
                            "{}:{}: legend entry '{token}' names more than one character",
                            path.display(),
                            i + 1
                        );
                    }
                    if c == '.' {
                        panic!(
                            "{}:{}: '.' is reserved for an empty cell, it cannot be a legend entry",
                            path.display(),
                            i + 1
                        );
                    }
                    let ids: Vec<TagId> =
                        tags.split('+').map(|t| super::tag_id(t.trim())).collect();
                    legend.insert(c, ids);
                }
            }
            "area" => {
                let mut parts = value.split_whitespace();
                let id: AreaId = parts
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or_else(|| {
                        panic!("{}:{}: bad 'area' id in {value:?}", path.display(), i + 1)
                    });
                let rect: Vec<&str> = parts.collect();
                if rect.len() != 2 {
                    panic!(
                        "{}:{}: 'area' must be '<id> <x0>,<y0> <x1>,<y1>', got {value:?}",
                        path.display(),
                        i + 1
                    );
                }
                let parse_pair = |s: &str| -> (i32, i32) {
                    let (a, b) = s.split_once(',').unwrap_or_else(|| {
                        panic!("{}:{}: bad area corner {s:?}", path.display(), i + 1)
                    });
                    (
                        a.parse().unwrap_or_else(|_| {
                            panic!("{}:{}: bad area corner {s:?}", path.display(), i + 1)
                        }),
                        b.parse().unwrap_or_else(|_| {
                            panic!("{}:{}: bad area corner {s:?}", path.display(), i + 1)
                        }),
                    )
                };
                let (x0, y0) = parse_pair(rect[0]);
                let (x1, y1) = parse_pair(rect[1]);
                areas.push((id, x0, y0, x1, y1));
            }
            other => panic!("{}:{}: unknown header key '{other}'", path.display(), i + 1),
        }
        i += 1;
    }

    let grid_start =
        grid_start.unwrap_or_else(|| panic!("{}: missing a 'grid:' block", path.display()));
    let rule_key =
        rule_key.unwrap_or_else(|| panic!("{}: missing a 'rule:' header", path.display()));
    let expect =
        expect.unwrap_or_else(|| panic!("{}: missing an 'expect:' header", path.display()));

    let mut builder = SiteBuilder::new();
    let mut grid_lines: Vec<String> = Vec::new();
    let mut y = 0i32;
    let mut row_end = grid_start;
    for &raw_row in &lines[grid_start..] {
        if raw_row.trim() == "violations:" {
            break;
        }
        if raw_row.is_empty() {
            row_end += 1;
            continue;
        }
        grid_lines.push(raw_row.to_string());
        for (x, ch) in raw_row.chars().enumerate() {
            if ch == '.' {
                continue;
            }
            let tags = legend.get(&ch).unwrap_or_else(|| {
                panic!(
                    "{}:{}: '{ch}' at column {x} is not declared in 'legend:'",
                    path.display(),
                    row_end + 1
                )
            });
            builder = builder.cell(Cell::new(x as i32, y, floor), tags);
        }
        y += 1;
        row_end += 1;
    }
    for (id, x0, y0, x1, y1) in areas {
        for ax in x0..x1 {
            for ay in y0..y1 {
                builder = builder.area(Cell::new(ax, ay, floor), id);
            }
        }
    }

    let mut declared_violations = Vec::new();
    if row_end < lines.len() && lines[row_end].trim() == "violations:" {
        for &raw in &lines[row_end + 1..] {
            let line = raw.trim();
            if line.is_empty() {
                continue;
            }
            declared_violations.push(line.to_string());
        }
    }

    if expect == Expect::Fail && declared_violations.is_empty() {
        panic!(
            "{}: 'expect: fail' but no 'violations:' block (or it is empty) -- a fail case must declare at least one violation",
            path.display()
        );
    }
    if expect == Expect::Pass && !declared_violations.is_empty() {
        panic!(
            "{}: 'expect: pass' but a 'violations:' block is present -- a pass case must have none",
            path.display()
        );
    }

    Case {
        rule_key,
        expect,
        floor,
        site: builder.build(),
        declared_violations,
        grid_lines,
    }
}

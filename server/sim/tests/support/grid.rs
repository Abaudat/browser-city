//! Story 2.12: the small, line-oriented reader for `server/sim/tests/
//! rule-examples/*.grid` -- test-only, no library, scoped to exactly this
//! corpus's own shape. See `../rule_examples.rs`'s own module doc for the
//! full grammar; `defs/README.md` is the agent-facing copy of it.

use std::path::Path;

use sim::rules::testing::SiteBuilder;
use sim::rules::{AreaId, Cell, TagId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Expect {
    Pass,
    Fail,
}

pub struct Case {
    pub rules: Vec<String>,
    pub expect: Expect,
    pub floor: i8,
    pub site: sim::rules::testing::Site,
    pub declared_violations: Vec<String>,
    /// The `grid:` block's rows, verbatim -- a mismatch report re-prints
    /// these with the actually-found subject/other cells marked, so the
    /// original characters (not a re-render of the parsed site) matter.
    pub grid_lines: Vec<String>,
}

/// Parses one `.grid` file's own text into a [`Case`]. Panics, naming
/// `path` and the offending line, on anything malformed.
pub fn parse_case(path: &Path, text: &str) -> Case {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };

    let lines: Vec<&str> = text.lines().collect();
    let grid_at = lines
        .iter()
        .position(|l| l.trim() == "grid:")
        .unwrap_or_else(|| fail(lines.len().max(1), "missing a 'grid:' block"));
    let violations_at = lines[grid_at + 1..]
        .iter()
        .position(|l| l.trim() == "violations:")
        .map(|i| grid_at + 1 + i);
    let grid_end = violations_at.unwrap_or(lines.len());

    let mut rules: Option<Vec<String>> = None;
    let mut expect: Option<Expect> = None;
    let mut floor: i8 = 0;
    let mut floor_set = false;
    let mut legend: std::collections::BTreeMap<char, Vec<TagId>> = Default::default();
    let mut areas: Vec<(usize, AreaId, i32, i32, i32, i32)> = Vec::new();
    for (i, line) in lines[..grid_at].iter().enumerate() {
        let line_no = i + 1;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once(':') else {
            fail(line_no, "expected a 'key: value' header line or 'grid:'");
        };
        let value = value.trim();
        match key.trim() {
            "rules" if rules.is_none() => {
                rules = Some(value.split_whitespace().map(String::from).collect())
            }
            "expect" if expect.is_none() => {
                expect = Some(match value {
                    "pass" => Expect::Pass,
                    "fail" => Expect::Fail,
                    _ => fail(line_no, "'expect' must be 'pass' or 'fail'"),
                })
            }
            "floor" if !floor_set => {
                floor = value
                    .parse()
                    .unwrap_or_else(|_| fail(line_no, "'floor' must be an i8"));
                floor_set = true;
            }
            "rules" | "expect" | "floor" => fail(line_no, "duplicate header, already declared"),
            "legend" => {
                for token in value.split_whitespace() {
                    let Some((ch, tags)) = token.split_once('=') else {
                        fail(line_no, "legend entry must be '<char>=<tag>[+<tag>...]'");
                    };
                    let mut chars = ch.chars();
                    let c = chars
                        .next()
                        .unwrap_or_else(|| fail(line_no, "legend entry names no character"));
                    if chars.next().is_some() || c == '.' {
                        fail(
                            line_no,
                            "legend character must be exactly one, and never '.'",
                        );
                    }
                    let ids: Vec<TagId> =
                        tags.split('+').map(|t| super::tag_id(t.trim())).collect();
                    if legend.insert(c, ids).is_some() {
                        fail(line_no, "legend character declared twice");
                    }
                }
            }
            "area" => {
                let parts: Vec<&str> = value.split_whitespace().collect();
                let [id, c0, c1] = parts[..] else {
                    fail(line_no, "'area' must be '<id> <x0>,<y0> <x1>,<y1>'");
                };
                let id: AreaId = id.parse().unwrap_or_else(|_| fail(line_no, "bad area id"));
                let corner = |s: &str| -> (i32, i32) {
                    let (a, b) = s
                        .split_once(',')
                        .unwrap_or_else(|| fail(line_no, "bad area corner"));
                    (
                        a.parse()
                            .unwrap_or_else(|_| fail(line_no, "bad area corner")),
                        b.parse()
                            .unwrap_or_else(|_| fail(line_no, "bad area corner")),
                    )
                };
                let ((x0, y0), (x1, y1)) = (corner(c0), corner(c1));
                areas.push((line_no, id, x0, y0, x1, y1));
            }
            _ => fail(line_no, "unknown header key"),
        }
    }

    let rules = rules.unwrap_or_else(|| fail(lines.len().max(1), "missing a 'rules:' header"));
    if rules.is_empty() {
        fail(lines.len().max(1), "'rules:' names no key");
    }
    let expect = expect.unwrap_or_else(|| fail(lines.len().max(1), "missing an 'expect:' header"));

    let grid_lines: Vec<String> = lines[grid_at + 1..grid_end]
        .iter()
        .map(|s| s.to_string())
        .collect();
    let width = grid_lines.first().map_or(0, |r| r.chars().count());
    let mut builder = SiteBuilder::new();
    for (row_i, row) in grid_lines.iter().enumerate() {
        let line_no = grid_at + 2 + row_i;
        if row.is_empty() {
            fail(
                line_no,
                "a blank line is never allowed inside a 'grid:' block",
            );
        }
        if row.chars().count() != width {
            fail(
                line_no,
                "every grid row must be the same length as the first",
            );
        }
        for (x, ch) in row.chars().enumerate() {
            if ch == '.' {
                continue;
            }
            let tags = legend
                .get(&ch)
                .unwrap_or_else(|| fail(line_no, "character is not declared in 'legend:'"));
            builder = builder.cell(Cell::new(x as i32, row_i as i32, floor), tags);
        }
    }
    let height = grid_lines.len() as i32;
    for (line_no, id, x0, y0, x1, y1) in areas {
        if x0 < 0 || y0 < 0 || x0 >= x1 || y0 >= y1 || x1 > width as i32 || y1 > height {
            fail(
                line_no,
                "'area' rect must be non-negative, ordered, and inside the grid",
            );
        }
        for ax in x0..x1 {
            for ay in y0..y1 {
                builder = builder.area(Cell::new(ax, ay, floor), id);
            }
        }
    }

    let declared_violations: Vec<String> = match violations_at {
        Some(v) => lines[v + 1..]
            .iter()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .map(String::from)
            .collect(),
        None => Vec::new(),
    };
    if expect == Expect::Fail && declared_violations.is_empty() {
        fail(
            lines.len(),
            "'expect: fail' needs a non-empty 'violations:' block",
        );
    }
    if expect == Expect::Pass && !declared_violations.is_empty() {
        fail(
            lines.len(),
            "'expect: pass' must have no 'violations:' block",
        );
    }

    Case {
        rules,
        expect,
        floor,
        site: builder.build(),
        declared_violations,
        grid_lines,
    }
}

#[cfg(test)]
mod tests {
    use super::{Expect, parse_case};
    use std::path::Path;

    /// Runs `parse_case` against `text` and returns its own panic
    /// message, for asserting the exact `path:line:` text a malformed
    /// fixture produces (Quentin's direction) -- never merely that it
    /// panicked.
    fn err(text: &str) -> String {
        let prev = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let result = std::panic::catch_unwind(|| parse_case(Path::new("f.grid"), text));
        std::panic::set_hook(prev);
        match result {
            Ok(_) => panic!("expected parse_case to panic on:\n{text}"),
            Err(payload) => *payload
                .downcast::<String>()
                .expect("panic! with format args always carries a String payload"),
        }
    }

    const WELL_FORMED: &str = "rules: r\nexpect: pass\nlegend: W=wall\ngrid:\nW\n";

    #[test]
    fn a_well_formed_pass_case_parses() {
        let case = parse_case(Path::new("f.grid"), WELL_FORMED);
        assert_eq!(case.rules, vec!["r"]);
        assert_eq!(case.expect, Expect::Pass);
        assert!(case.declared_violations.is_empty());
    }

    #[test]
    fn a_well_formed_fail_case_parses_its_declared_violations() {
        let text =
            "rules: r\nexpect: fail\nlegend: W=wall\ngrid:\nW\nviolations:\nr at (0, 0, 0)\n";
        let case = parse_case(Path::new("f.grid"), text);
        assert_eq!(case.declared_violations, vec!["r at (0, 0, 0)"]);
    }

    #[test]
    fn missing_grid_block_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\n"),
            "f.grid:2: missing a 'grid:' block"
        );
    }

    #[test]
    fn missing_rules_header_is_named() {
        assert_eq!(
            err("expect: pass\ngrid:\nW\n"),
            "f.grid:3: missing a 'rules:' header"
        );
    }

    #[test]
    fn missing_expect_header_is_named() {
        assert_eq!(
            err("rules: r\ngrid:\nW\n"),
            "f.grid:3: missing an 'expect:' header"
        );
    }

    #[test]
    fn a_duplicate_rules_header_is_named() {
        assert_eq!(
            err("rules: r\nrules: r2\nexpect: pass\ngrid:\nW\n"),
            "f.grid:2: duplicate header, already declared"
        );
    }

    #[test]
    fn a_duplicate_expect_header_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nexpect: fail\ngrid:\nW\n"),
            "f.grid:3: duplicate header, already declared"
        );
    }

    #[test]
    fn a_duplicate_floor_header_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nfloor: 0\nfloor: 1\ngrid:\nW\n"),
            "f.grid:4: duplicate header, already declared"
        );
    }

    #[test]
    fn a_legend_character_declared_twice_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall W=floor\ngrid:\nW\n"),
            "f.grid:3: legend character declared twice"
        );
    }

    #[test]
    fn an_undeclared_grid_character_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\ngrid:\nX\n"),
            "f.grid:4: character is not declared in 'legend:'"
        );
    }

    #[test]
    fn a_ragged_grid_row_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall\ngrid:\nWW\nW\n"),
            "f.grid:6: every grid row must be the same length as the first"
        );
    }

    #[test]
    fn a_blank_line_inside_the_grid_block_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall\ngrid:\nW\n\nW\n"),
            "f.grid:6: a blank line is never allowed inside a 'grid:' block"
        );
    }

    #[test]
    fn an_area_rect_reaching_outside_the_grid_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall\narea: 1 0,0 2,1\ngrid:\nW\n"),
            "f.grid:4: 'area' rect must be non-negative, ordered, and inside the grid"
        );
    }

    #[test]
    fn a_negative_area_corner_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall\narea: 1 -1,0 1,1\ngrid:\nW\n"),
            "f.grid:4: 'area' rect must be non-negative, ordered, and inside the grid"
        );
    }

    #[test]
    fn a_reversed_area_rect_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall\narea: 1 1,0 0,1\ngrid:\nW\n"),
            "f.grid:4: 'area' rect must be non-negative, ordered, and inside the grid"
        );
    }

    #[test]
    fn a_fail_case_with_no_violations_block_is_named() {
        assert_eq!(
            err("rules: r\nexpect: fail\nlegend: W=wall\ngrid:\nW\n"),
            "f.grid:5: 'expect: fail' needs a non-empty 'violations:' block"
        );
    }

    #[test]
    fn a_pass_case_with_a_violations_block_is_named() {
        assert_eq!(
            err("rules: r\nexpect: pass\nlegend: W=wall\ngrid:\nW\nviolations:\nr at (0, 0, 0)\n"),
            "f.grid:7: 'expect: pass' must have no 'violations:' block"
        );
    }
}

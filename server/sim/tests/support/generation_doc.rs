//! Story 3.1 (FR111, AC2/AC3): the small, line-oriented reader for
//! `docs/generation.md`'s five fixed, machine-read kind sections --
//! test-only, no library, scoped to exactly this document's own shape
//! (Tim's direction). Every other line in the document (prose, the
//! `## parameters` table, any other heading) is free text this parser
//! never looks at. See `../rule_examples.rs`'s own doc comment for how
//! the extracted rows are checked against `defs::RULES`.
//!
//! Shape: a `## <kind>` heading for each of [`KIND_SECTIONS`], each
//! immediately followed (blank lines aside) by one table:
//!
//! ```text
//! | key | status | pass | intent |
//! | --- | --- | --- | --- |
//! <key> | committed|planned | <pass> | <intent>
//! ```
//!
//! Panics, naming `path:line:`, on anything malformed: a missing
//! section, a section with no table, a header row that is not exactly
//! `| key | status | pass | intent |`, a missing or malformed separator
//! row, an unknown `status`, a duplicate key within one section, or a
//! ragged row (not exactly four columns).

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
    pub intent: String,
}

/// One kind section name -> its own rows, in document order.
pub type Doc = BTreeMap<&'static str, Vec<Row>>;

const HEADER_LINE: &str = "| key | status | pass | intent |";

pub fn parse(path: &Path, text: &str) -> Doc {
    let fail = |line: usize, msg: &str| -> ! { panic!("{}:{}: {msg}", path.display(), line) };
    let lines: Vec<&str> = text.lines().collect();

    let mut doc: Doc = KIND_SECTIONS.iter().map(|&k| (k, Vec::new())).collect();

    for &name in &KIND_SECTIONS {
        let heading = format!("## {name}");
        let Some(start) = lines.iter().position(|l| l.trim() == heading) else {
            fail(lines.len().max(1), &format!("missing '{heading}' section"));
        };
        let end = lines[start + 1..]
            .iter()
            .position(|l| l.trim_start().starts_with("## "))
            .map(|i| start + 1 + i)
            .unwrap_or(lines.len());

        let body = &lines[start + 1..end];
        let mut body_iter = body
            .iter()
            .enumerate()
            .filter(|(_, l)| !l.trim().is_empty());

        let Some((header_i, header_line)) = body_iter.next() else {
            fail(start + 1, &format!("section '{heading}' has no table"));
        };
        if header_line.trim() != HEADER_LINE {
            fail(
                start + 2 + header_i,
                &format!("table header must be exactly '{HEADER_LINE}'"),
            );
        }
        let Some((sep_i, sep_line)) = body_iter.next() else {
            fail(
                start + 2 + header_i,
                "table is missing its '| --- | --- | --- | --- |' separator row",
            );
        };
        if !sep_line
            .trim()
            .chars()
            .all(|c| matches!(c, '|' | '-' | ':' | ' '))
        {
            fail(start + 2 + sep_i, "malformed table separator row");
        }

        let rows = doc.get_mut(name).expect("every kind name is pre-seeded");
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for (i, line) in body_iter {
            let line_no = start + 2 + i;
            let fields: Vec<&str> = line.trim().split('|').map(str::trim).collect();
            let [_, key, status, pass, intent, _] = fields[..] else {
                fail(
                    line_no,
                    "row must have exactly four columns: | key | status | pass | intent |",
                );
            };
            if key.is_empty() {
                fail(line_no, "row's own key column is empty");
            }
            let status = match status {
                "committed" => Status::Committed,
                "planned" => Status::Planned,
                other => fail(
                    line_no,
                    &format!("unknown status '{other}' -- must be 'committed' or 'planned'"),
                ),
            };
            if !seen.insert(key.to_string()) {
                fail(line_no, &format!("duplicate key '{key}' in section '{name}'"));
            }
            rows.push(Row {
                key: key.to_string(),
                status,
                pass: pass.to_string(),
                intent: intent.to_string(),
            });
        }
    }

    doc
}

#[cfg(test)]
mod tests {
    use super::{Status, parse};
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

    const ALL_FIVE_EMPTY: &str = "\
## placement
| key | status | pass | intent |
| --- | --- | --- | --- |

## distribution
| key | status | pass | intent |
| --- | --- | --- | --- |

## coherence
| key | status | pass | intent |
| --- | --- | --- | --- |

## adjacency
| key | status | pass | intent |
| --- | --- | --- | --- |

## requirement
| key | status | pass | intent |
| --- | --- | --- | --- |
";

    #[test]
    fn five_empty_sections_parse_to_five_empty_row_lists() {
        let doc = parse(Path::new("docs/generation.md"), ALL_FIVE_EMPTY);
        assert_eq!(doc.len(), 5);
        for name in super::KIND_SECTIONS {
            assert!(doc[name].is_empty());
        }
    }

    #[test]
    fn a_committed_row_parses_under_its_own_section() {
        let text = "## placement\n\
             | key | status | pass | intent |\n\
             | --- | --- | --- | --- |\n\
             | lighting_ground_floor_only | committed | prop placement | a lamppost on a rooftop |\n\
             \n\
             ## distribution\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n\
             \n\
             ## coherence\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n\
             \n\
             ## adjacency\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n\
             \n\
             ## requirement\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n";
        let doc = parse(Path::new("docs/generation.md"), text);
        assert_eq!(doc["placement"].len(), 1);
        assert_eq!(doc["placement"][0].key, "lighting_ground_floor_only");
        assert_eq!(doc["placement"][0].status, Status::Committed);
        assert_eq!(doc["placement"][0].pass, "prop placement");
        assert_eq!(doc["placement"][0].intent, "a lamppost on a rooftop");
    }

    #[test]
    fn a_planned_row_parses() {
        let text = "## placement\n\
             | key | status | pass | intent |\n\
             | --- | --- | --- | --- |\n\
             | a_future_rule | planned | prop placement | not built yet |\n";
        let doc = parse(Path::new("docs/generation.md"), text);
        assert_eq!(doc["placement"][0].status, Status::Planned);
    }

    #[test]
    fn a_missing_section_is_named() {
        assert_eq!(err(""), "docs/generation.md:1: missing '## placement' section");
    }

    #[test]
    fn a_section_with_no_table_is_named() {
        assert_eq!(
            err("## placement\n\n## distribution\n"),
            "docs/generation.md:1: section '## placement' has no table"
        );
    }

    #[test]
    fn a_wrong_table_header_is_named() {
        assert_eq!(
            err("## placement\n| wrong | header |\n"),
            "docs/generation.md:2: table header must be exactly '| key | status | pass | intent |'"
        );
    }

    #[test]
    fn a_missing_separator_row_is_named() {
        assert_eq!(
            err("## placement\n| key | status | pass | intent |\n"),
            "docs/generation.md:2: table is missing its '| --- | --- | --- | --- |' separator row"
        );
    }

    #[test]
    fn a_malformed_separator_row_is_named() {
        assert_eq!(
            err("## placement\n| key | status | pass | intent |\nnot a separator\n"),
            "docs/generation.md:3: malformed table separator row"
        );
    }

    #[test]
    fn an_unknown_status_is_named() {
        assert_eq!(
            err(
                "## placement\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n\
                 | some_key | maybe | prop placement | intent text |\n"
            ),
            "docs/generation.md:4: unknown status 'maybe' -- must be 'committed' or 'planned'"
        );
    }

    #[test]
    fn a_duplicate_key_in_one_section_is_named() {
        assert_eq!(
            err(
                "## placement\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n\
                 | some_key | committed | prop placement | a |\n\
                 | some_key | planned | prop placement | b |\n"
            ),
            "docs/generation.md:5: duplicate key 'some_key' in section 'placement'"
        );
    }

    #[test]
    fn a_ragged_row_is_named() {
        assert_eq!(
            err(
                "## placement\n| key | status | pass | intent |\n| --- | --- | --- | --- |\n\
                 | some_key | committed | prop placement |\n"
            ),
            "docs/generation.md:4: row must have exactly four columns: | key | status | pass | intent |"
        );
    }
}

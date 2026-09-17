//! Quentin's direction (story 2.9, AC4): one data-driven fixture,
//! `fixtures/room-grammar.v1.json` -- rows of `{x, y, tags, areas}` cells
//! plus the expected sorted `[rule_key]` (or `[]`) the real committed
//! grammar gives them, evaluated by the same `sim::rules::evaluate`
//! every other rule-defs acceptance test uses. Adding a case is editing
//! that JSON file alone, never this one -- the actual "agents and Derek
//! grow coverage later" mechanism AC4 asks for.
//!
//! A cell with a `wall`/`floor` tag but no `areas` entry (or one whose
//! own areas never satisfy a Requirement row) also fails
//! `room_has_a_door`/`building_has_an_entrance`/
//! `walled_room_has_waste_bin` -- Requirement's own "a container cell
//! outside any real area is itself a violation" rule (story 2.10,
//! Quentin's decision) applies here exactly as it does everywhere else,
//! so several of the smaller fixture cases below expect those rows
//! alongside the one row they are actually about; this is the real,
//! documented engine behaviour, not test noise to work around.
//!
//! No `serde_json` dependency (this crate's own `[dev-dependencies]`
//! stay minimal, matching `tools/defs-build/tests/shared_malformed_cases.rs`
//! 's own precedent): a small hand-rolled parser scoped to exactly this
//! fixture's own shape.

mod support;

use sim::rules::{AreaId, Cell, TagId, evaluate};
use support::grammar_rules;

#[derive(Debug)]
struct FixtureCell {
    x: i32,
    y: i32,
    tags: Vec<String>,
    areas: Vec<u64>,
}

#[derive(Debug)]
struct FixtureCase {
    name: String,
    cells: Vec<FixtureCell>,
    expected_rule_keys: Vec<String>,
}

mod json {
    //! A minimal recursive-descent JSON reader, scoped to exactly the
    //! shapes `room-grammar.v1.json` uses: objects, arrays, strings and
    //! non-negative/negative integers. No floats, no escapes beyond the
    //! ones this fixture never needs -- this is not a general-purpose
    //! parser.

    #[derive(Debug, Clone)]
    pub enum Value {
        Object(Vec<(String, Value)>),
        Array(Vec<Value>),
        String(String),
        Number(i64),
    }

    impl Value {
        pub fn as_array(&self) -> &[Value] {
            match self {
                Value::Array(items) => items,
                other => panic!("expected an array, got {other:?}"),
            }
        }

        pub fn as_str(&self) -> &str {
            match self {
                Value::String(s) => s,
                other => panic!("expected a string, got {other:?}"),
            }
        }

        pub fn as_i64(&self) -> i64 {
            match self {
                Value::Number(n) => *n,
                other => panic!("expected a number, got {other:?}"),
            }
        }

        pub fn get(&self, key: &str) -> &Value {
            match self {
                Value::Object(fields) => {
                    &fields
                        .iter()
                        .find(|(k, _)| k == key)
                        .unwrap_or_else(|| panic!("missing field '{key}' in {self:?}"))
                        .1
                }
                other => panic!("expected an object, got {other:?}"),
            }
        }
    }

    struct Parser<'a> {
        bytes: &'a [u8],
        pos: usize,
    }

    impl<'a> Parser<'a> {
        fn skip_ws(&mut self) {
            while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_whitespace() {
                self.pos += 1;
            }
        }

        fn expect(&mut self, b: u8) {
            self.skip_ws();
            assert_eq!(
                self.bytes[self.pos], b,
                "expected '{}' at byte {}",
                b as char, self.pos
            );
            self.pos += 1;
        }

        fn parse_value(&mut self) -> Value {
            self.skip_ws();
            match self.bytes[self.pos] {
                b'{' => self.parse_object(),
                b'[' => self.parse_array(),
                b'"' => Value::String(self.parse_string()),
                _ => self.parse_number(),
            }
        }

        fn parse_object(&mut self) -> Value {
            self.expect(b'{');
            let mut fields = Vec::new();
            self.skip_ws();
            if self.bytes[self.pos] == b'}' {
                self.pos += 1;
                return Value::Object(fields);
            }
            loop {
                self.skip_ws();
                let key = self.parse_string();
                self.expect(b':');
                let value = self.parse_value();
                fields.push((key, value));
                self.skip_ws();
                match self.bytes[self.pos] {
                    b',' => {
                        self.pos += 1;
                    }
                    b'}' => {
                        self.pos += 1;
                        break;
                    }
                    other => panic!("unexpected byte '{}' in object", other as char),
                }
            }
            Value::Object(fields)
        }

        fn parse_array(&mut self) -> Value {
            self.expect(b'[');
            let mut items = Vec::new();
            self.skip_ws();
            if self.bytes[self.pos] == b']' {
                self.pos += 1;
                return Value::Array(items);
            }
            loop {
                items.push(self.parse_value());
                self.skip_ws();
                match self.bytes[self.pos] {
                    b',' => {
                        self.pos += 1;
                    }
                    b']' => {
                        self.pos += 1;
                        break;
                    }
                    other => panic!("unexpected byte '{}' in array", other as char),
                }
            }
            Value::Array(items)
        }

        fn parse_string(&mut self) -> String {
            self.expect(b'"');
            let start = self.pos;
            while self.bytes[self.pos] != b'"' {
                self.pos += 1;
            }
            let s = std::str::from_utf8(&self.bytes[start..self.pos])
                .unwrap()
                .to_string();
            self.pos += 1;
            s
        }

        fn parse_number(&mut self) -> Value {
            let start = self.pos;
            if self.bytes[self.pos] == b'-' {
                self.pos += 1;
            }
            while self.pos < self.bytes.len() && self.bytes[self.pos].is_ascii_digit() {
                self.pos += 1;
            }
            let s = std::str::from_utf8(&self.bytes[start..self.pos]).unwrap();
            Value::Number(s.parse().unwrap_or_else(|_| panic!("bad number '{s}'")))
        }
    }

    pub fn parse(text: &str) -> Value {
        let mut p = Parser {
            bytes: text.as_bytes(),
            pos: 0,
        };
        let v = p.parse_value();
        p.skip_ws();
        v
    }
}

fn load_cases() -> Vec<FixtureCase> {
    let text = include_str!("../../../fixtures/room-grammar.v1.json");
    let root = json::parse(text);
    root.as_array()
        .iter()
        .map(|case| {
            let name = case.get("name").as_str().to_string();
            let cells = case
                .get("cells")
                .as_array()
                .iter()
                .map(|c| FixtureCell {
                    x: c.get("x").as_i64() as i32,
                    y: c.get("y").as_i64() as i32,
                    tags: c
                        .get("tags")
                        .as_array()
                        .iter()
                        .map(|t| t.as_str().to_string())
                        .collect(),
                    areas: c
                        .get("areas")
                        .as_array()
                        .iter()
                        .map(|a| a.as_i64() as u64)
                        .collect(),
                })
                .collect();
            let expected_rule_keys = case
                .get("expected_rule_keys")
                .as_array()
                .iter()
                .map(|k| k.as_str().to_string())
                .collect();
            FixtureCase {
                name,
                cells,
                expected_rule_keys,
            }
        })
        .collect()
}

#[test]
fn every_room_grammar_fixture_case_matches_its_own_expected_rule_keys() {
    let cases = load_cases();
    assert!(!cases.is_empty());
    let rules = grammar_rules();

    for case in &cases {
        let mut builder = sim::rules::testing::SiteBuilder::new();
        for cell in &case.cells {
            let tag_ids: Vec<TagId> = cell.tags.iter().map(|t| support::tag_id(t)).collect();
            let site_cell = Cell::new(cell.x, cell.y, 0);
            builder = builder.cell(site_cell, &tag_ids);
            for &area in &cell.areas {
                builder = builder.area(site_cell, area as AreaId);
            }
        }
        let site = builder.build();
        let violations = evaluate(&rules, &site);

        let mut actual_keys: Vec<&str> = violations
            .iter()
            .map(|v| {
                rules
                    .iter()
                    .find(|r| r.id == v.rule_id)
                    .expect("every violation names a rule in the same set")
                    .key
            })
            .collect();
        actual_keys.sort_unstable();
        actual_keys.dedup();

        let mut expected: Vec<&str> = case.expected_rule_keys.iter().map(|s| s.as_str()).collect();
        expected.sort_unstable();

        assert_eq!(
            actual_keys, expected,
            "case '{}': expected rule keys {:?}, got {:?} (violations: {:?})",
            case.name, expected, actual_keys, violations
        );
    }
}

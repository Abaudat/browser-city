//! The crate's one reader of the codes golden, `server/sim/tests/goldens/
//! codes_v1.golden` -- `sim::codes`' single append-only source of truth --
//! never a second, hand-maintained list in this crate. An authored name
//! (an object's `layer`, an item's `unit`) resolves through [`CodeTables`]
//! to the numeric code. Pure: takes the golden's own text, already read by
//! `fsio`.

use std::collections::BTreeMap;

/// Layer names no object may ever declare (Tim's direction, cycle 1):
/// mirrors `sim::codes::layer::DEPRECATED_CODES` (`overhead`) by name --
/// this crate stays detached from `server/`'s own Cargo workspace
/// (`Cargo.toml`'s own direction), so it can never depend on `sim`
/// directly to read that list itself. Declared here, in its own file, so
/// `scripts/ci/check-layer-table-current.sh` has one obvious place to
/// parse it out of and compare against `server/sim/src/codes.rs`'s own
/// `DEPRECATED_CODES` -- the same guard that already keeps `client/src/
/// render/layer-table.ts`'s copy honest.
pub const DEPRECATED_LAYER_NAMES: &[&str] = &["overhead"];

/// Every set in the codes golden, as `set -> (name -> code)`.
#[derive(Debug, Default, Clone)]
pub struct CodeTables {
    sets: BTreeMap<String, BTreeMap<String, u32>>,
}

impl CodeTables {
    /// Parses every `<set> <code> <name> ...` line of the golden. A line
    /// that does not have a numeric code and a name is ignored.
    pub fn parse(golden_text: &str) -> Self {
        let mut sets: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();
        for line in golden_text.lines() {
            let mut parts = line.split_whitespace();
            let Some(set) = parts.next() else { continue };
            let Some(code) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
                continue;
            };
            let Some(name) = parts.next() else { continue };
            sets.entry(set.to_string())
                .or_default()
                .insert(name.to_string(), code);
        }
        CodeTables { sets }
    }

    /// One set's `name -> code` map; empty for a set the golden never
    /// mentions.
    pub fn set(&self, set: &str) -> &BTreeMap<String, u32> {
        static EMPTY: BTreeMap<String, u32> = BTreeMap::new();
        self.sets.get(set).unwrap_or(&EMPTY)
    }

    /// `name`'s code within `set`, if it has one.
    pub fn get(&self, set: &str, name: &str) -> Option<u32> {
        self.set(set).get(name).copied()
    }

    /// Builds tables from `(set, name, code)` triples -- for tests that
    /// need a small fixed subset of the real golden.
    pub fn from_entries(entries: &[(&str, &str, u32)]) -> Self {
        let mut sets: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();
        for (set, name, code) in entries {
            sets.entry(set.to_string())
                .or_default()
                .insert(name.to_string(), *code);
        }
        CodeTables { sets }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "matter_kind 0 sanitation
layer 0 ground 0
layer 1 overhead 1
layer 2 furniture 10
";

    #[test]
    fn a_set_maps_its_names_to_codes_and_ignores_every_other_set() {
        let tables = CodeTables::parse(SAMPLE);
        assert_eq!(tables.get("layer", "ground"), Some(0));
        assert_eq!(tables.get("layer", "overhead"), Some(1));
        assert_eq!(tables.get("layer", "furniture"), Some(2));
        assert_eq!(tables.get("layer", "sanitation"), None);
        assert_eq!(tables.set("layer").len(), 3);
    }

    #[test]
    fn an_empty_golden_yields_empty_sets() {
        assert!(CodeTables::parse("").set("layer").is_empty());
    }

    #[test]
    fn the_same_parser_answers_for_unit() {
        let golden = format!(
            "{SAMPLE}unit 0 piece
unit 2 millilitre
"
        );
        let tables = CodeTables::parse(&golden);
        assert_eq!(tables.get("unit", "piece"), Some(0));
        assert_eq!(tables.get("unit", "millilitre"), Some(2));
        assert_eq!(tables.set("unit").len(), 2);
        assert_eq!(tables.set("layer").len(), 3);
    }
}

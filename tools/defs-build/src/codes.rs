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

/// Mirrors `sim::codes::layer::FIRST_POOL_RANK`: every layer whose golden
/// rank is below it is a flat-pass layer. `check-layer-table-current.sh`
/// fails the build if this, the sim constant and the client's disagree.
pub const FIRST_POOL_RANK: u32 = 10;

/// Every set in the codes golden, as `set -> (name -> code)`, plus each
/// layer's rank (the fourth column of a `layer` row).
#[derive(Debug, Default, Clone)]
pub struct CodeTables {
    sets: BTreeMap<String, BTreeMap<String, u32>>,
    layer_ranks: BTreeMap<String, u32>,
}

impl CodeTables {
    /// Parses every `<set> <code> <name> ...` line of the golden. A line
    /// that does not have a numeric code and a name is ignored.
    pub fn parse(golden_text: &str) -> Self {
        let mut sets: BTreeMap<String, BTreeMap<String, u32>> = BTreeMap::new();
        let mut layer_ranks = BTreeMap::new();
        for line in golden_text.lines() {
            let mut parts = line.split_whitespace();
            let Some(set) = parts.next() else { continue };
            let Some(code) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
                continue;
            };
            let Some(name) = parts.next() else { continue };
            if set == "layer"
                && let Some(rank) = parts.next().and_then(|s| s.parse::<u32>().ok())
            {
                layer_ranks.insert(name.to_string(), rank);
            }
            sets.entry(set.to_string())
                .or_default()
                .insert(name.to_string(), code);
        }
        CodeTables { sets, layer_ranks }
    }

    /// Whether `layer` is a flat-pass layer: its golden rank is below
    /// [`FIRST_POOL_RANK`]. A layer with no known rank is not flat.
    pub fn is_flat_layer(&self, layer: &str) -> bool {
        self.layer_ranks
            .get(layer)
            .is_some_and(|rank| *rank < FIRST_POOL_RANK)
    }

    /// Every layer name whose golden rank is below [`FIRST_POOL_RANK`].
    pub fn flat_layer_names(&self) -> Vec<&str> {
        self.layer_ranks
            .iter()
            .filter(|(_, rank)| **rank < FIRST_POOL_RANK)
            .map(|(name, _)| name.as_str())
            .collect()
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
        CodeTables {
            sets,
            layer_ranks: BTreeMap::new(),
        }
    }

    /// Adds each `(layer name, rank)` -- for tests that build a subset with
    /// [`CodeTables::from_entries`].
    pub fn with_layer_ranks(mut self, ranks: &[(&str, u32)]) -> Self {
        for (name, rank) in ranks {
            self.layer_ranks.insert(name.to_string(), *rank);
        }
        self
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
    fn flat_layers_are_derived_from_the_golden_ranks() {
        let tables = CodeTables::parse(
            "layer 0 ground 0
layer 1 overhead 1
layer 2 furniture 10
layer 7 ground_objects 5
",
        );
        assert!(tables.is_flat_layer("ground_objects"));
        assert!(!tables.is_flat_layer("furniture"));
        assert!(!tables.is_flat_layer("unknown"));
    }

    /// The real golden's flat set is exactly the layers ranked below the
    /// first pool rank -- the check is derived, never a typed list.
    #[test]
    fn the_real_golden_flat_layers_are_the_ranks_below_the_first_pool_rank() {
        let golden = include_str!("../../../server/sim/tests/goldens/codes_v1.golden");
        let tables = CodeTables::parse(golden);
        let mut flat = tables.flat_layer_names();
        flat.sort();
        assert_eq!(flat, ["ground", "ground_objects", "overhead"]);
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

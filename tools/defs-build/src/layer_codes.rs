//! Resolves an authored `layer` (or item `unit`) name (`defs/objects/*.toml`) to its
//! numeric `sim::codes::layer` code, against the single append-only
//! source of truth for that ladder: `server/sim/tests/goldens/
//! codes_v1.golden` (Tim's direction) -- never a second, hand-maintained
//! list in this crate. Pure: takes the golden's own text, already read by
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

/// Parses every `<kind> <code> <name> ...` line of the codes golden for
/// one set (`layer`, `unit`) into `name -> code`. Every other kind's line
/// (`matter_kind`, `provision`, ...) is ignored -- this crate only ever
/// resolves the names of the sets it is asked for.
pub fn parse_codes(golden_text: &str, set: &str) -> BTreeMap<String, u32> {
    let mut map = BTreeMap::new();
    for line in golden_text.lines() {
        let mut parts = line.split_whitespace();
        let Some(kind) = parts.next() else { continue };
        if kind != set {
            continue;
        }
        let Some(code) = parts.next().and_then(|s| s.parse::<u32>().ok()) else {
            continue;
        };
        let Some(name) = parts.next() else { continue };
        map.insert(name.to_string(), code);
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str =
        "matter_kind 0 sanitation\nlayer 0 ground 0\nlayer 1 overhead 1\nlayer 2 furniture 10\n";

    #[test]
    fn parses_only_layer_lines_into_a_name_to_code_map() {
        let map = parse_codes(SAMPLE, "layer");
        assert_eq!(map.get("ground"), Some(&0));
        assert_eq!(map.get("overhead"), Some(&1));
        assert_eq!(map.get("furniture"), Some(&2));
        assert_eq!(map.get("sanitation"), None);
        assert_eq!(map.len(), 3);
    }

    #[test]
    fn an_empty_golden_yields_an_empty_map() {
        assert!(parse_codes("", "layer").is_empty());
    }

    #[test]
    fn the_same_parser_answers_for_unit_and_ignores_every_other_kind() {
        let golden = format!(
            "{SAMPLE}unit 0 piece
unit 2 millilitre
"
        );
        let map = parse_codes(&golden, "unit");
        assert_eq!(map.get("piece"), Some(&0));
        assert_eq!(map.get("millilitre"), Some(&2));
        assert_eq!(map.len(), 2);
    }
}

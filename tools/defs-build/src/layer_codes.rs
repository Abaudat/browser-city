//! Resolves an authored `layer` name (`defs/objects/*.toml`) to its
//! numeric `sim::codes::layer` code, against the single append-only
//! source of truth for that ladder: `server/sim/tests/goldens/
//! codes_v1.golden` (Tim's direction) -- never a second, hand-maintained
//! list in this crate. Pure: takes the golden's own text, already read by
//! `fsio`.

use std::collections::BTreeMap;

/// Parses every `layer <code> <name> <rank>` line of the codes golden
/// into `name -> code`. Every other kind's line (`matter_kind`,
/// `provision`, ...) is ignored -- this crate only ever resolves layer
/// names.
pub fn parse_layer_codes(golden_text: &str) -> BTreeMap<String, u32> {
    let mut map = BTreeMap::new();
    for line in golden_text.lines() {
        let mut parts = line.split_whitespace();
        let Some(kind) = parts.next() else { continue };
        if kind != "layer" {
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
        let map = parse_layer_codes(SAMPLE);
        assert_eq!(map.get("ground"), Some(&0));
        assert_eq!(map.get("overhead"), Some(&1));
        assert_eq!(map.get("furniture"), Some(&2));
        assert_eq!(map.get("sanitation"), None);
        assert_eq!(map.len(), 3);
    }

    #[test]
    fn an_empty_golden_yields_an_empty_map() {
        assert!(parse_layer_codes("").is_empty());
    }
}

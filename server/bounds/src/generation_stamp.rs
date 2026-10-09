//! The stamp a measured generation block carries: the `GENERATION_VERSION`
//! and a fingerprint of every `generation.*` balance row it was measured
//! under. A retune moves generated output without a version bump, so the
//! version alone cannot tell a stale block from a current one.

use sim::generated::defs::BalanceSeed;

/// FNV-1a (64-bit) over the sorted `key=value\n` lines of every row whose
/// key starts with `generation.`. Row order and non-`generation.` rows do
/// not matter.
pub fn balance_fingerprint(rows: &[BalanceSeed]) -> u64 {
    let mut lines: Vec<String> = rows
        .iter()
        .filter(|r| r.key.starts_with("generation."))
        .map(|r| format!("{}={}\n", r.key, r.value))
        .collect();
    lines.sort_unstable();
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in lines.iter().flat_map(|l| l.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

/// The stamp text a sweep prints after `label` and `docs/generation.md`
/// repeats: ` at GENERATION_VERSION=<n> fingerprint=<16 hex>`.
pub fn stamp(version: u32, rows: &[BalanceSeed]) -> String {
    format!(
        " at GENERATION_VERSION={version} fingerprint={:016x}",
        balance_fingerprint(rows)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(key: &'static str, value: i64) -> BalanceSeed {
        BalanceSeed {
            key,
            value,
            min: 0,
            max: 1000,
        }
    }

    fn rows() -> Vec<BalanceSeed> {
        vec![
            row("generation.streets.max_detour_percent", 200),
            row("generation.land_use.min_leaf_cells", 4),
            row("citizen.bar_decay.rest", 10),
        ]
    }

    #[test]
    fn changes_when_a_streets_value_changes() {
        let mut changed = rows();
        changed[0].value = 201;
        assert_ne!(balance_fingerprint(&rows()), balance_fingerprint(&changed));
    }

    #[test]
    fn changes_when_a_land_use_value_changes() {
        let mut changed = rows();
        changed[1].value = 5;
        assert_ne!(balance_fingerprint(&rows()), balance_fingerprint(&changed));
    }

    #[test]
    fn ignores_row_order() {
        let mut reordered = rows();
        reordered.reverse();
        assert_eq!(
            balance_fingerprint(&rows()),
            balance_fingerprint(&reordered)
        );
    }

    #[test]
    fn ignores_a_non_generation_key() {
        let mut changed = rows();
        changed[2].value = 99;
        assert_eq!(balance_fingerprint(&rows()), balance_fingerprint(&changed));
    }

    #[test]
    fn stamp_renders_version_and_sixteen_hex_digits() {
        let s = stamp(10, &rows());
        assert!(s.starts_with(" at GENERATION_VERSION=10 fingerprint="));
        assert_eq!(s.rsplit('=').next().unwrap().len(), 16);
    }
}

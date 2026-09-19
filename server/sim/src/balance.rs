//! One shared balance-key lookup (Tim's direction, story 3.2): `appearance`
//! and `world::walkability` each used to carry their own private copy of
//! this exact lookup; both now go through [`value`] instead, so a third
//! generation-era module never grows a fourth.

use crate::generated::defs;

/// Looks up `key` in `balance`, panicking (naming the key) if it is
/// missing -- every caller passes [`crate::generated::defs::BALANCE`] in
/// production, but the signature accepts any slice so a test can pin the
/// verdict to a deliberately different value (`appearance`'s and
/// `walkability`'s own tests already rely on this).
pub fn value(balance: &[defs::BalanceSeed], key: &str) -> i64 {
    balance
        .iter()
        .find(|b| b.key == key)
        .unwrap_or_else(|| panic!("sim::balance: missing balance key '{key}'"))
        .value
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn value_reads_a_present_key() {
        let balance = [defs::BalanceSeed {
            key: "a.b",
            value: 42,
            min: 0,
            max: 100,
        }];
        assert_eq!(value(&balance, "a.b"), 42);
    }

    #[test]
    #[should_panic(expected = "missing balance key 'nope'")]
    fn value_panics_naming_a_missing_key() {
        value(&[], "nope");
    }
}

//! `docs/architecture.md`'s naming table, made mechanical: the two string
//! shapes this crate enforces are a file name's own stem (kebab-case,
//! checked in `parse.rs`) and a def key's own value (snake_case, checked
//! in `validate.rs`) -- two different rows of that table, never to be
//! confused with each other.

/// A file name's stem must be kebab-case: lowercase ASCII letters and
/// digits, single hyphens, no leading, trailing or doubled hyphen.
pub fn is_kebab_case(stem: &str) -> bool {
    if stem.is_empty() || stem.starts_with('-') || stem.ends_with('-') || stem.contains("--") {
        return false;
    }
    stem.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// A def key (or one segment of a dotted balance key) must be
/// snake_case: lowercase ASCII letters and digits, single underscores, no
/// leading, trailing or doubled underscore ("Data keys -- snake_case,
/// matches Rust, so no translation layer").
pub fn is_snake_case(s: &str) -> bool {
    if s.is_empty() || s.starts_with('_') || s.ends_with('_') || s.contains("__") {
        return false;
    }
    s.bytes()
        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_')
}

/// A balance key is dotted snake_case ("Balance keys -- dotted
/// snake_case, e.g. `citizen.bar_decay.rest`"): every dot-separated
/// segment held to [`is_snake_case`], and there must be at least one
/// non-empty segment (so `""`, `"a."`, `".a"` and `"a..b"` are all
/// rejected, not just a segment with a bad character in it).
pub fn is_dotted_snake_case(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    s.split('.').all(is_snake_case)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_kebab_case_accepts_lowercase_digits_and_single_hyphens() {
        assert!(is_kebab_case("city-props"));
        assert!(is_kebab_case("a1-b2"));
        assert!(is_kebab_case("a"));
    }

    #[test]
    fn is_kebab_case_rejects_uppercase_underscore_leading_trailing_and_double_hyphen() {
        assert!(!is_kebab_case("CityProps"));
        assert!(!is_kebab_case("city_props"));
        assert!(!is_kebab_case("-city"));
        assert!(!is_kebab_case("city-"));
        assert!(!is_kebab_case("city--props"));
        assert!(!is_kebab_case(""));
    }

    #[test]
    fn is_snake_case_accepts_lowercase_digits_and_single_underscores() {
        assert!(is_snake_case("trash_bin"));
        assert!(is_snake_case("a1_b2"));
        assert!(is_snake_case("a"));
        assert!(is_snake_case("bottle"));
    }

    #[test]
    fn is_snake_case_rejects_uppercase_hyphen_leading_trailing_and_double_underscore() {
        assert!(!is_snake_case("TrashBin"));
        assert!(!is_snake_case("trash-bin"));
        assert!(!is_snake_case("_trash"));
        assert!(!is_snake_case("trash_"));
        assert!(!is_snake_case("trash__bin"));
        assert!(!is_snake_case(""));
    }

    #[test]
    fn is_dotted_snake_case_accepts_every_segment_snake_case() {
        assert!(is_dotted_snake_case("citizen.bar_decay.rest"));
        assert!(is_dotted_snake_case("a"));
    }

    #[test]
    fn is_dotted_snake_case_rejects_a_bad_segment_or_an_empty_one() {
        assert!(!is_dotted_snake_case("citizen.bar-decay.rest"));
        assert!(!is_dotted_snake_case("citizen..rest"));
        assert!(!is_dotted_snake_case(".rest"));
        assert!(!is_dotted_snake_case("rest."));
        assert!(!is_dotted_snake_case(""));
    }
}

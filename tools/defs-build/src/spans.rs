//! Maps a byte offset (from a `toml::Spanned` field or a `toml::de::Error`)
//! to a 1-based `(line, column)` pair -- so every [`crate::error::DefsError`]
//! prints `path:line:col: message` itself, rather than re-printing `toml`'s
//! own multi-line pretty error (Tim's direction).

/// `text[..offset]`'s own line/column, both 1-based. `offset` past
/// `text.len()` clamps to the end of the text rather than panicking --
/// this is only ever fed a span `toml` itself produced against this exact
/// text, but clamping keeps a future caller's mistake a wrong line number
/// instead of a panic.
pub fn line_col(text: &str, offset: usize) -> (usize, usize) {
    let offset = offset.min(text.len());
    let mut line = 1usize;
    let mut last_newline: Option<usize> = None;
    for (i, b) in text.as_bytes()[..offset].iter().enumerate() {
        if *b == b'\n' {
            line += 1;
            last_newline = Some(i);
        }
    }
    let col = match last_newline {
        Some(nl) => offset - nl,
        None => offset + 1,
    };
    (line, col)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn offset_zero_is_line_one_column_one() {
        assert_eq!(line_col("abc", 0), (1, 1));
    }

    #[test]
    fn offset_on_the_first_line_counts_columns() {
        assert_eq!(line_col("abcdef", 3), (1, 4));
    }

    #[test]
    fn offset_right_after_a_newline_is_column_one_of_the_next_line() {
        assert_eq!(line_col("ab\ncd", 3), (2, 1));
    }

    #[test]
    fn offset_mid_second_line_counts_from_its_own_newline() {
        assert_eq!(line_col("ab\ncdef", 6), (2, 4));
    }

    #[test]
    fn multiple_newlines_accumulate_the_line_number() {
        assert_eq!(line_col("a\nb\nc\nd", 6), (4, 1));
    }

    #[test]
    fn an_offset_past_the_end_clamps_rather_than_panics() {
        assert_eq!(line_col("abc", 999), (1, 4));
    }
}

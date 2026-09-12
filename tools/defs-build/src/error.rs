//! The one error type every fallible stage in this crate returns. "The
//! build fails with the offending file and line named" (story 2.1's AC) is
//! a property of this type's `Display`, not of any one call site.

use std::fmt;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DefsError {
    pub path: PathBuf,
    pub line: usize,
    pub col: usize,
    pub message: String,
}

impl DefsError {
    pub fn new(
        path: impl AsRef<Path>,
        line: usize,
        col: usize,
        message: impl Into<String>,
    ) -> Self {
        Self {
            path: path.as_ref().to_path_buf(),
            line,
            col,
            message: message.into(),
        }
    }
}

impl fmt::Display for DefsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Forward slashes always: this is printed straight to a CI log and
        // into stderr-snapshot fixtures, so a Windows dev's backslash-separated
        // PathBuf must not make the message diverge from what the same
        // fixture prints on a Linux runner.
        let path = self.path.to_string_lossy().replace('\\', "/");
        write!(f, "{path}:{}:{}: {}", self.line, self.col, self.message)
    }
}

impl std::error::Error for DefsError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_is_path_colon_line_colon_col_colon_message() {
        let e = DefsError::new("defs/items/foo.toml", 12, 5, "unknown field `bogus`");
        assert_eq!(
            e.to_string(),
            "defs/items/foo.toml:12:5: unknown field `bogus`"
        );
    }

    #[test]
    fn display_normalises_a_windows_path_separator() {
        let e = DefsError::new(PathBuf::from("defs\\items\\foo.toml"), 1, 1, "x");
        assert_eq!(e.to_string(), "defs/items/foo.toml:1:1: x");
    }
}

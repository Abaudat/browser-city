//! `defs_version`: a SHA-256 over every git-tracked file under `defs/`,
//! sorted by path bytes, LF-normalised -- computed, never hand-bumped
//! (Tim's direction), so there is no place to bump one artefact and
//! forget another. Pure over an already-collected file list; the actual
//! `git ls-files`/`fs::read` happens at the binary's own edge.

use std::path::PathBuf;

use crate::sha256::sha256_hex;

/// Hex characters kept from the full SHA-256 digest -- 64 bits, ample to
/// distinguish any `defs/` tree this project will ever have while staying
/// short enough to read in a diff or a log line.
pub const DEFS_VERSION_LEN: usize = 16;

/// Strips every `\r` byte -- not just `\r\n` -- so a Windows checkout
/// (CRLF) and a Linux checkout (LF) of the exact same content hash
/// identically (Tim's direction; `defs/` holds only text TOML, so this is
/// never applied to binary content).
fn normalize_lf(content: &[u8]) -> Vec<u8> {
    content.iter().copied().filter(|&b| b != b'\r').collect()
}

/// `files` need not already be sorted -- sorted here, by path bytes, so a
/// caller (or a future git version) that lists files in a different order
/// still produces the same version.
pub fn compute_defs_version(files: &[(PathBuf, Vec<u8>)]) -> String {
    let mut sorted: Vec<&(PathBuf, Vec<u8>)> = files.iter().collect();
    sorted.sort_by(|a, b| {
        a.0.to_string_lossy()
            .replace('\\', "/")
            .into_bytes()
            .cmp(&b.0.to_string_lossy().replace('\\', "/").into_bytes())
    });

    let mut buf: Vec<u8> = Vec::new();
    for (path, content) in sorted {
        let normalized = normalize_lf(content);
        buf.extend_from_slice(path.to_string_lossy().replace('\\', "/").as_bytes());
        buf.push(0);
        buf.extend_from_slice(normalized.len().to_string().as_bytes());
        buf.push(0);
        buf.extend_from_slice(&normalized);
        buf.push(b'\n');
    }

    let digest = sha256_hex(&buf);
    digest[..DEFS_VERSION_LEN].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_deterministic_regardless_of_input_order() {
        let a = vec![
            (PathBuf::from("defs/a.toml"), b"one".to_vec()),
            (PathBuf::from("defs/b.toml"), b"two".to_vec()),
        ];
        let b = vec![
            (PathBuf::from("defs/b.toml"), b"two".to_vec()),
            (PathBuf::from("defs/a.toml"), b"one".to_vec()),
        ];
        assert_eq!(compute_defs_version(&a), compute_defs_version(&b));
    }

    #[test]
    fn changing_any_file_content_changes_the_version() {
        let a = vec![(PathBuf::from("defs/a.toml"), b"one".to_vec())];
        let b = vec![(PathBuf::from("defs/a.toml"), b"ONE".to_vec())];
        assert_ne!(compute_defs_version(&a), compute_defs_version(&b));
    }

    #[test]
    fn renaming_a_file_with_identical_content_changes_the_version() {
        let a = vec![(PathBuf::from("defs/a.toml"), b"x".to_vec())];
        let b = vec![(PathBuf::from("defs/z.toml"), b"x".to_vec())];
        assert_ne!(compute_defs_version(&a), compute_defs_version(&b));
    }

    #[test]
    fn adding_a_file_changes_the_version() {
        let a = vec![(PathBuf::from("defs/a.toml"), b"x".to_vec())];
        let b = vec![
            (PathBuf::from("defs/a.toml"), b"x".to_vec()),
            (PathBuf::from("defs/b.toml"), b"y".to_vec()),
        ];
        assert_ne!(compute_defs_version(&a), compute_defs_version(&b));
    }

    #[test]
    fn a_crlf_copy_and_an_lf_copy_of_the_same_content_hash_identically() {
        let lf = vec![(PathBuf::from("defs/a.toml"), b"a = 1\nb = 2\n".to_vec())];
        let crlf = vec![(PathBuf::from("defs/a.toml"), b"a = 1\r\nb = 2\r\n".to_vec())];
        assert_eq!(compute_defs_version(&lf), compute_defs_version(&crlf));
    }

    #[test]
    fn version_is_the_declared_hex_length() {
        let v = compute_defs_version(&[(PathBuf::from("defs/a.toml"), b"x".to_vec())]);
        assert_eq!(v.len(), DEFS_VERSION_LEN);
        assert!(v.chars().all(|c| c.is_ascii_hexdigit()));
    }
}

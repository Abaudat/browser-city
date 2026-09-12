//! The filesystem/process edge: everything in this crate that actually
//! reads a directory, shells out to `git`, or writes a file lives here --
//! `parse`, `validate` and `emit` never do (Quentin's direction).

use std::io;
use std::path::{Path, PathBuf};
use std::process::Command;

fn run_git_ls_files(repo_root: &Path, args: &[&str]) -> io::Result<Vec<PathBuf>> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_root)
        .arg("ls-files")
        .args(args)
        .output()?;
    if !output.status.success() {
        return Err(io::Error::other(format!(
            "git ls-files {args:?} failed: {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    let text = String::from_utf8(output.stdout)
        .map_err(|e| io::Error::other(format!("git ls-files output was not UTF-8: {e}")))?;
    Ok(text
        .split('\0')
        .filter(|s| !s.is_empty())
        .map(|s| PathBuf::from(s.replace('\\', "/")))
        .collect())
}

/// Every path `git ls-files` reports under `dir` (relative to `repo_root`,
/// forward-slash separated, already sorted the way `git` itself sorts
/// them -- byte order -- though every caller here re-sorts anyway rather
/// than depending on that). A git failure is a hard error: this function
/// exists specifically to answer "which files does git track", so a repo
/// git cannot see is never silently treated as empty.
pub fn list_git_tracked_files(repo_root: &Path, dir: &str) -> io::Result<Vec<PathBuf>> {
    run_git_ls_files(repo_root, &["-z", dir])
}

/// Every path under `dir` that exists on disk but is not `git add`ed and
/// is not gitignored (relative to `repo_root`). Quentin's direction:
/// `defs_version` is computed from `git ls-files`, so a def that exists
/// on disk but is not yet tracked is invisible to a local build and
/// present in CI's (CI always checks out a fully-committed tree) --
/// the caller must fail loudly on a non-empty result rather than quietly
/// generating from a different tree than CI will.
pub fn list_untracked_files(repo_root: &Path, dir: &str) -> io::Result<Vec<PathBuf>> {
    run_git_ls_files(repo_root, &["--others", "--exclude-standard", "-z", dir])
}

/// Reads every one of `paths` (relative to `repo_root`) as raw bytes,
/// paired with its own relative path -- the shape [`crate::version::
/// compute_defs_version`] wants.
pub fn read_bytes(repo_root: &Path, paths: &[PathBuf]) -> io::Result<Vec<(PathBuf, Vec<u8>)>> {
    paths
        .iter()
        .map(|p| {
            let bytes = std::fs::read(repo_root.join(p))?;
            Ok((p.clone(), bytes))
        })
        .collect()
}

/// Reads every one of `paths` as UTF-8 text -- the shape [`crate::parse::
/// parse_all`] wants. A non-UTF-8 file is a hard error naming the path,
/// never a lossy replacement that would silently corrupt a def.
pub fn read_text(repo_root: &Path, paths: &[PathBuf]) -> io::Result<Vec<(PathBuf, String)>> {
    paths
        .iter()
        .map(|p| {
            let text = std::fs::read_to_string(repo_root.join(p))
                .map_err(|e| io::Error::other(format!("{}: {e}", p.display())))?;
            Ok((p.clone(), text))
        })
        .collect()
}

/// Writes `contents` to `path` atomically: the full text lands in a
/// sibling temp file first, and only a rename -- never a stream into
/// `path` itself -- makes it visible at `path`. An interrupted write (a
/// killed process, a full disk) leaves the temp file orphaned and `path`
/// exactly as it was (Tim/Quentin's direction: "no partial output" is a
/// design property, not a matter of ordering).
pub fn atomic_write(path: &Path, contents: &str) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other(format!("{} has no parent directory", path.display())))?;
    std::fs::create_dir_all(dir)?;
    let tmp = dir.join(format!(
        ".{}.tmp-{}-{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("defs-build-out"),
        std::process::id(),
        unique_suffix()
    ));
    std::fs::write(&tmp, contents)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

fn unique_suffix() -> u128 {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let count = COUNTER.fetch_add(1, Ordering::Relaxed);
    nanos.wrapping_add(count as u128)
}

/// A fresh, empty directory under the OS temp dir, unique per call -- this
/// crate's own stand-in for a `tempfile::TempDir`, since `toml` and
/// `serde` are the only dependencies approved for it (Tim's direction).
/// Never auto-deleted: every caller (tests, the `defs-build` binary's own
/// scratch work) removes it explicitly when done.
pub fn make_scratch_dir(prefix: &str) -> io::Result<PathBuf> {
    let dir = std::env::temp_dir().join(format!(
        "{prefix}-{}-{}",
        std::process::id(),
        unique_suffix()
    ));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(args)
            .status()
            .expect("git must be on PATH for this test");
        assert!(status.success(), "git {args:?} failed in {}", dir.display());
    }

    #[test]
    fn list_git_tracked_files_lists_only_tracked_files_under_dir() {
        let dir = make_scratch_dir("defs-build-test-git").unwrap();
        std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
        std::fs::write(dir.join("defs/objects/a.toml"), "x = 1\n").unwrap();
        std::fs::write(dir.join("untracked.toml"), "y = 1\n").unwrap();
        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "t@t.com"]);
        git(&dir, &["config", "user.name", "t"]);
        git(&dir, &["add", "defs"]);
        git(&dir, &["commit", "-q", "-m", "init"]);

        let files = list_git_tracked_files(&dir, "defs").unwrap();

        assert_eq!(files, vec![PathBuf::from("defs/objects/a.toml")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_git_tracked_files_fails_outside_a_git_repository() {
        let dir = make_scratch_dir("defs-build-test-nogit").unwrap();
        let result = list_git_tracked_files(&dir, "defs");
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_untracked_files_finds_a_disk_file_git_has_never_seen() {
        let dir = make_scratch_dir("defs-build-test-untracked").unwrap();
        std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
        std::fs::write(dir.join("defs/objects/a.toml"), "x = 1\n").unwrap();
        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "t@t.com"]);
        git(&dir, &["config", "user.name", "t"]);
        git(&dir, &["add", "defs/objects/a.toml"]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        std::fs::write(dir.join("defs/objects/b.toml"), "y = 1\n").unwrap();

        let files = list_untracked_files(&dir, "defs").unwrap();

        assert_eq!(files, vec![PathBuf::from("defs/objects/b.toml")]);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn list_untracked_files_is_empty_once_everything_is_added() {
        let dir = make_scratch_dir("defs-build-test-nountracked").unwrap();
        std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
        std::fs::write(dir.join("defs/objects/a.toml"), "x = 1\n").unwrap();
        git(&dir, &["init", "-q"]);
        git(&dir, &["config", "user.email", "t@t.com"]);
        git(&dir, &["config", "user.name", "t"]);
        git(&dir, &["add", "-A"]);
        git(&dir, &["commit", "-q", "-m", "init"]);

        let files = list_untracked_files(&dir, "defs").unwrap();

        assert!(files.is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn read_bytes_fails_naming_the_missing_path() {
        let dir = make_scratch_dir("defs-build-test-readbytes").unwrap();
        let result = read_bytes(&dir, &[PathBuf::from("nope.toml")]);
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn read_text_fails_naming_the_missing_path() {
        let dir = make_scratch_dir("defs-build-test-readtext").unwrap();
        let err = read_text(&dir, &[PathBuf::from("nope.toml")]).unwrap_err();
        assert!(err.to_string().contains("nope.toml"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_creates_the_file_with_exact_contents() {
        let dir = make_scratch_dir("defs-build-test").unwrap();
        let path = dir.join("out.txt");
        atomic_write(&path, "hello\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "hello\n");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn atomic_write_overwrites_an_existing_file_and_leaves_no_tmp_behind() {
        let dir = make_scratch_dir("defs-build-test").unwrap();
        let path = dir.join("out.txt");
        atomic_write(&path, "first\n").unwrap();
        atomic_write(&path, "second\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second\n");
        let leftover: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp-"))
            .collect();
        assert!(leftover.is_empty(), "a .tmp- file was left behind");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn make_scratch_dir_returns_distinct_empty_directories() {
        let a = make_scratch_dir("defs-build-test").unwrap();
        let b = make_scratch_dir("defs-build-test").unwrap();
        assert_ne!(a, b);
        std::fs::remove_dir_all(&a).unwrap();
        std::fs::remove_dir_all(&b).unwrap();
    }
}

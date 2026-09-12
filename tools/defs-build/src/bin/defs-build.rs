//! The CLI edge: `cargo run --manifest-path tools/defs-build/Cargo.toml`.
//! Every subcommand-free run regenerates both committed artefacts from
//! `defs/` in the repository this crate lives in
//! (`CARGO_MANIFEST_DIR/../..`) -- see `../lib.rs`/`../fsio.rs` for the
//! actual logic; this file is only the wiring.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use defs_build::{build, fsio, version};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn die(msg: impl std::fmt::Display) -> ExitCode {
    eprintln!("defs-build: FAIL -- {msg}");
    ExitCode::FAILURE
}

fn main() -> ExitCode {
    let root = repo_root();
    match run(&root) {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => die(e),
    }
}

fn run(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    // Quentin's direction: a def on disk but not yet `git add`ed is
    // invisible to `defs_version` (computed from `git ls-files`) here,
    // but present the moment CI checks out a fully-committed tree -- fail
    // loudly rather than silently building from a different tree than CI
    // will.
    let untracked = fsio::list_untracked_files(root, "defs")?;
    if !untracked.is_empty() {
        let names: Vec<String> = untracked.iter().map(|p| p.display().to_string()).collect();
        return Err(format!(
            "defs/ has untracked file(s) that a build elsewhere (e.g. CI) would not see: {} -- git add them or remove them",
            names.join(", ")
        )
        .into());
    }

    let tracked = fsio::list_git_tracked_files(root, "defs")?;
    let byte_files = fsio::read_bytes(root, &tracked)?;
    let defs_version = version::compute_defs_version(&byte_files);

    // Every tracked path, not just `*.toml` ones (Quentin/Tim's
    // direction): `parse_all`'s own `check_filename` is what must reject
    // an unknown extension, named with its own path -- never a pre-filter
    // that makes that branch unreachable and the file invisible.
    let mut text_files = fsio::read_text(root, &tracked)?;
    text_files.sort_by(|a, b| a.0.cmp(&b.0));

    let output = build(&text_files, &defs_version)?;

    let rust_path = root.join("server/sim/src/generated/defs.rs");
    let json_path = root.join("client/public/defs/defs.json");
    let manifest_path = root.join("tools/defs-build/goldens/defs-manifest.golden");
    fsio::atomic_write(&rust_path, &output.rust)?;
    fsio::atomic_write(&json_path, &output.json)?;
    fsio::atomic_write(&manifest_path, &output.id_manifest)?;

    eprintln!(
        "defs-build: wrote {}, {} and {} (defs_version {defs_version})",
        rust_path.display(),
        json_path.display(),
        manifest_path.display()
    );
    Ok(())
}

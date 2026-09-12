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
    let tracked = fsio::list_git_tracked_files(root, "defs")?;
    let byte_files = fsio::read_bytes(root, &tracked)?;
    let defs_version = version::compute_defs_version(&byte_files);

    let toml_paths: Vec<PathBuf> = tracked
        .iter()
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("toml"))
        .cloned()
        .collect();
    let text_files = fsio::read_text(root, &toml_paths)?;
    let mut sorted_text_files = text_files;
    sorted_text_files.sort_by(|a, b| a.0.cmp(&b.0));

    let output = build(&sorted_text_files, &defs_version)?;

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

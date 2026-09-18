//! The CLI edge: `cargo run --manifest-path tools/defs-build/Cargo.toml`.
//! Every subcommand-free run regenerates both committed artefacts from
//! `defs/` in the repository this crate lives in
//! (`CARGO_MANIFEST_DIR/../..`) -- see `../lib.rs`/`../fsio.rs` for the
//! actual logic; this file is only the wiring.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use defs_build::{build_from_repo_root, fsio, model, version};

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

    // Every other input-collection step (reading `defs/`'s own sources,
    // every referenced sheet's dims/bytes, the codes golden) plus the
    // call to `build` itself lives in one place now, shared with this
    // crate's own `tests/contact_sheet_real_defs.rs` (Quentin's
    // direction) -- only the untracked-file refusal above and writing
    // the outputs below stay specific to this binary's own edge.
    let output = build_from_repo_root(root, &defs_version)?;

    let rust_path = root.join("server/sim/src/generated/defs.rs");
    let json_path = root.join("client/public/defs/defs.json");
    let manifest_path = root.join("tools/defs-build/goldens/defs-manifest.golden");
    let atlas_dir = root.join(model::ATLAS_PAGES_DIR);
    let contact_sheet_path = root.join(model::CONTACT_SHEET_PATH);
    fsio::atomic_write(&rust_path, &output.rust)?;
    fsio::atomic_write(&json_path, &output.json)?;
    fsio::atomic_write(&manifest_path, &output.id_manifest)?;
    // Story 2.6: this directory is wholly owned by this run -- anything
    // in it this run did not write is deleted, so a stale page never
    // outlives the group or object that produced it (Tim's direction).
    fsio::sync_binary_dir(&atlas_dir, &output.atlas_pages)?;
    // Story 2.5: the contact sheet -- a fourth committed output, kept
    // current by the same `check-defs-current.sh` gate as the other
    // three, no separate command.
    fsio::atomic_write(&contact_sheet_path, &output.contact_sheet)?;

    eprintln!(
        "defs-build: wrote {}, {}, {}, {} and {} atlas page(s) under {} (defs_version {defs_version})",
        rust_path.display(),
        json_path.display(),
        manifest_path.display(),
        contact_sheet_path.display(),
        output.atlas_pages.len(),
        atlas_dir.display()
    );
    Ok(())
}

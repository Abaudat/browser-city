//! The CLI edge: `cargo run --manifest-path tools/defs-build/Cargo.toml`.
//! Every subcommand-free run regenerates both committed artefacts from
//! `defs/` in the repository this crate lives in
//! (`CARGO_MANIFEST_DIR/../..`) -- see `../lib.rs`/`../fsio.rs` for the
//! actual logic; this file is only the wiring.

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use std::collections::BTreeMap;

use defs_build::{
    appearance_sheet_paths, build, fsio, layer_codes, model, object_sprite_sheet_paths, parse,
    version,
};

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

    // Every def, not just `*.toml` ones (Quentin/Tim's direction):
    // `parse_all`'s own `check_filename` is what must reject an unknown
    // extension, named with its own path -- never a pre-filter that
    // makes that branch unreachable and the file invisible.
    // `list_defs_sources` alone owns the one exception (`defs/README.md`,
    // agent-facing documentation), so it still folds into `defs_version`
    // above (via the unfiltered `tracked`) but never reaches
    // `check_filename`'s own non-`.toml` refusal.
    let mut text_files = fsio::read_text(root, &fsio::list_defs_sources(root)?)?;
    text_files.sort_by(|a, b| a.0.cmp(&b.0));

    // Story 1.10/2.2: which sheets does the tree reference, so their real
    // `IHDR` dimensions can be read before `validate` checks the layout/
    // sprite invariants against them -- the one impure step `build` itself
    // never performs (Quentin's direction: parse/validate/emit stay pure).
    let raw = parse::parse_all(&text_files)?;
    let mut sheet_paths = appearance_sheet_paths(&raw);
    sheet_paths.extend(object_sprite_sheet_paths(&raw));
    sheet_paths.sort();
    sheet_paths.dedup();
    let sheet_dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(root, &sheet_paths)?
        .into_iter()
        .collect();

    // Story 2.6: every object's own `sprite.sheet`, read whole -- the
    // atlas packer's real pixel input.
    let mut object_sheet_paths = object_sprite_sheet_paths(&raw);
    object_sheet_paths.sort();
    object_sheet_paths.dedup();
    let object_sheet_paths_buf: Vec<PathBuf> =
        object_sheet_paths.iter().map(PathBuf::from).collect();
    let object_sheet_bytes: BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(root, &object_sheet_paths_buf)?
            .into_iter()
            .map(|(p, bytes)| (p.to_string_lossy().replace('\\', "/"), bytes))
            .collect();

    // Story 2.7: every appearance part's own `sheet`, read whole -- the
    // character-part packer's real pixel input, now that this story packs
    // character parts too.
    let mut appearance_sheet_paths = appearance_sheet_paths(&raw);
    appearance_sheet_paths.sort();
    appearance_sheet_paths.dedup();
    let appearance_sheet_paths_buf: Vec<PathBuf> =
        appearance_sheet_paths.iter().map(PathBuf::from).collect();
    let appearance_sheet_bytes: BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(root, &appearance_sheet_paths_buf)?
            .into_iter()
            .map(|(p, bytes)| (p.to_string_lossy().replace('\\', "/"), bytes))
            .collect();

    // Story 2.2: a `layer` name resolves against the codes golden --
    // `sim::codes::layer`'s single append-only ladder -- never a second,
    // hand-maintained list in this crate.
    let codes_golden = fsio::read_codes_golden(root)?;
    let layer_codes = layer_codes::parse_layer_codes(&codes_golden);

    let output = build(
        &text_files,
        &sheet_dims,
        &object_sheet_bytes,
        &appearance_sheet_bytes,
        &layer_codes,
        model::SPRITE_SHEET_ALLOWED_ROOT,
        &defs_version,
    )?;

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

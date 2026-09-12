//! `tools/defs-build`: turns `defs/` (TOML, NFR31's single source of
//! truth) into `server/sim/src/generated/defs.rs` and `client/public/
//! defs/defs.json`, one pass, one `defs_version` covering both. A plain
//! library over three separately testable stages -- `parse`, `validate`,
//! `emit` -- each pure over in-memory input; only `fsio` and the
//! `defs-build` binary touch the filesystem or a subprocess (Quentin's
//! direction: nothing about defs validity belongs anywhere but this
//! crate's own tests).

pub mod emit;
pub mod error;
pub mod fsio;
pub mod model;
pub mod naming;
pub mod parse;
pub mod sha256;
pub mod spans;
pub mod validate;
pub mod version;

pub use error::DefsError;
pub use model::Defs;

/// The three rendered texts one successful [`build`] produces: the Rust
/// include, the client JSON asset, and the append-only id/key manifest
/// (Tim's direction) -- never written to disk by this crate itself; only
/// the `defs-build` binary's own edge does that, and only once every
/// stage has already succeeded.
#[derive(Debug)]
pub struct BuildOutput {
    pub rust: String,
    pub json: String,
    pub id_manifest: String,
}

/// Runs every stage over an already-collected `(path, text)` file list and
/// an already-computed `defs_version` -- the one function a caller needs
/// once the filesystem edge has done its own job. Returns every rendered
/// artefact, or the first [`DefsError`] found; writes nothing.
pub fn build(
    files: &[(std::path::PathBuf, String)],
    defs_version: &str,
) -> Result<BuildOutput, DefsError> {
    let raw = parse::parse_all(files)?;
    let defs = validate::validate(&raw)?;
    Ok(BuildOutput {
        rust: emit::emit_rust(&defs, defs_version),
        json: emit::emit_json(&defs, defs_version),
        id_manifest: emit::emit_id_manifest(&defs),
    })
}

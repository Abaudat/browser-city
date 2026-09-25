//! `tools/defs-build`: turns `defs/` (TOML, NFR31's single source of
//! truth) into `server/sim/src/generated/defs.rs` and `client/public/
//! defs/defs.json`, one pass, one `defs_version` covering both. A plain
//! library over three separately testable stages -- `parse`, `validate`,
//! `emit` -- each pure over in-memory input; only `fsio` and the
//! `defs-build` binary touch the filesystem or a subprocess (Quentin's
//! direction: nothing about defs validity belongs anywhere but this
//! crate's own tests).

pub mod atlas;
pub mod codes;
pub mod contact_sheet;
pub mod emit;
pub mod error;
pub mod fsio;
pub mod model;
pub mod naming;
pub mod parse;
pub mod propose;
pub mod sha256;
pub mod spans;
pub mod validate;
pub mod version;

pub use error::DefsError;
pub use model::Defs;

/// The rendered texts and pages one successful [`build`] produces: the
/// Rust include, the client JSON asset, the append-only id/key manifest
/// (Tim's direction), every packed atlas page's own filename plus PNG
/// bytes (story 2.6), and the contact sheet (story 2.5) -- never written
/// to disk by this crate itself; only the `defs-build` binary's own edge
/// does that, and only once every stage has already succeeded.
#[derive(Debug)]
pub struct BuildOutput {
    pub rust: String,
    pub json: String,
    pub id_manifest: String,
    pub atlas_pages: Vec<(String, Vec<u8>)>,
    pub contact_sheet: String,
}

/// Runs every stage over an already-collected `(path, text)` file list, the
/// `(width, height)` already read from every appearance part's and every
/// object's own sheet file (story 1.10/2.2; empty for a tree with no such
/// entries), the codes-golden sets (layer, unit) already read from the codes
/// golden ([`codes::CodeTables::parse`]), the root every `sheet`/
/// `sprite.sheet` must live under (`sprite_sheet_allowed_root` -- the real
/// binary always passes [`model::SPRITE_SHEET_ALLOWED_ROOT`]; an empty
/// string disables the check, which is this crate's own fixture trees'
/// job, never a caller with real defs), and an already-computed
/// `defs_version` -- the one function a caller needs once the filesystem
/// edge has done its own job. Returns every rendered artefact, or the
/// first [`DefsError`] found; writes nothing.
pub fn build(
    files: &[(std::path::PathBuf, String)],
    sheet_dims: &std::collections::BTreeMap<String, (u32, u32)>,
    object_sheet_bytes: &std::collections::BTreeMap<String, Vec<u8>>,
    appearance_sheet_bytes: &std::collections::BTreeMap<String, Vec<u8>>,
    code_tables: &codes::CodeTables,
    sprite_sheet_allowed_root: &str,
    defs_version: &str,
) -> Result<BuildOutput, DefsError> {
    let raw = parse::parse_all(files)?;
    let defs = validate::validate(&raw, sheet_dims, code_tables, sprite_sheet_allowed_root)?;
    let page_groups = validate::validate_page_groups(&raw)?;
    let character_parts = atlas::character::collect_character_parts(
        &defs.bodies,
        &defs.eyes,
        &defs.hairstyles,
        &defs.outfits,
        &defs.accessories,
    );
    let atlas = atlas::build::build_atlas(
        &defs.objects,
        object_sheet_bytes,
        &page_groups,
        &character_parts,
        appearance_sheet_bytes,
        &defs.appearance_layouts,
    )
    .map_err(|e| DefsError::new("tools/defs-build/atlas", 0, 0, e))?;

    let id_manifest = emit::emit_id_manifest(&defs);
    // Quentin's direction: a short, deterministic fingerprint of this same
    // build's own id manifest, printed on the contact sheet beside
    // `defs_version` -- truncated the same way `defs_version` and every
    // atlas page hash already are.
    let manifest_hash = &sha256::sha256_hex(id_manifest.as_bytes())[..version::DEFS_VERSION_LEN];

    let cards = contact_sheet::cards(&raw, &defs, &atlas.atlas_by_object_id);
    // `contact_sheet::build` resolves `Defs::tile_size_px` itself, right
    // beside its only reader -- structurally unreachable when `cards` is
    // empty, never a fallback literal here (Tim's direction, cycle 2).
    let contact_sheet_html = contact_sheet::build(
        &cards,
        defs.tile_size_px,
        &atlas.pages,
        defs_version,
        manifest_hash,
    );

    Ok(BuildOutput {
        rust: emit::emit_rust(&defs, defs_version),
        json: emit::emit_json(
            &defs,
            defs_version,
            &atlas.pages,
            &atlas.atlas_by_object_id,
            &atlas.atlas_by_character_part,
        ),
        id_manifest,
        atlas_pages: atlas
            .pages
            .into_iter()
            .zip(atlas.page_bytes)
            .map(|(p, bytes)| (p.file, bytes))
            .collect(),
        contact_sheet: contact_sheet_html,
    })
}

/// Every `sheet` path an already-parsed [`model::RawDefs`] tree references
/// (story 1.10) -- the list a caller (the `defs-build` binary) reads real
/// `IHDR` dimensions for via `fsio::read_png_dims` before calling
/// [`build`]. Pure: just walks the tree `parse_all` already built.
pub fn appearance_sheet_paths(raw: &model::RawDefs) -> Vec<String> {
    let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for b in &raw.bodies {
        paths.insert(b.sheet.value.clone());
    }
    for e in &raw.eyes {
        paths.insert(e.sheet.value.clone());
    }
    for h in &raw.hairstyles {
        paths.insert(h.sheet.value.clone());
    }
    for o in &raw.outfits {
        paths.insert(o.sheet.value.clone());
    }
    for a in &raw.accessories {
        paths.insert(a.sheet.value.clone());
    }
    paths.into_iter().collect()
}

/// Every object `sprite.sheet` path an already-parsed [`model::RawDefs`]
/// tree references (story 2.2) -- the list a caller (the `defs-build`
/// binary) reads real `IHDR` dimensions for via `fsio::read_png_dims`
/// before calling [`build`]. Pure: just walks the tree `parse_all`
/// already built.
pub fn object_sprite_sheet_paths(raw: &model::RawDefs) -> Vec<String> {
    let mut paths: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    for o in &raw.objects {
        paths.insert(o.sprite.value.sheet.clone());
    }
    paths.into_iter().collect()
}

/// Every filesystem read [`build`] itself needs, collected from a real
/// checkout at `root`, then handed straight to `build` -- the one place
/// "the whole pipeline over a real `defs/` tree" lives, so a step added
/// here is never silently skipped by one of its two callers (Quentin's
/// direction): `bin/defs-build.rs`'s own edge, and this crate's own
/// `tests/contact_sheet_real_defs.rs`, which used to hand-copy this same
/// ~70 lines and would otherwise keep asserting against a pipeline the
/// binary no longer runs the moment one of them changed alone.
///
/// What stays specific to the binary's own edge, not lifted here: the
/// untracked-file refusal (must run before `defs_version` is computed,
/// which the binary does before calling this) and writing every output to
/// disk.
pub fn build_from_repo_root(
    root: &std::path::Path,
    defs_version: &str,
) -> Result<BuildOutput, Box<dyn std::error::Error>> {
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
    let sheet_dims: std::collections::BTreeMap<String, (u32, u32)> =
        fsio::read_png_dims(root, &sheet_paths)?
            .into_iter()
            .collect();

    // Story 2.6: every object's own `sprite.sheet`, read whole -- the
    // atlas packer's real pixel input.
    let mut object_sheet_paths = object_sprite_sheet_paths(&raw);
    object_sheet_paths.sort();
    object_sheet_paths.dedup();
    let object_sheet_paths_buf: Vec<std::path::PathBuf> = object_sheet_paths
        .iter()
        .map(std::path::PathBuf::from)
        .collect();
    let object_sheet_bytes: std::collections::BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(root, &object_sheet_paths_buf)?
            .into_iter()
            .map(|(p, bytes)| (p.to_string_lossy().replace('\\', "/"), bytes))
            .collect();

    // Story 2.7: every appearance part's own `sheet`, read whole -- the
    // character-part packer's real pixel input.
    let mut appearance_paths = appearance_sheet_paths(&raw);
    appearance_paths.sort();
    appearance_paths.dedup();
    let appearance_sheet_paths_buf: Vec<std::path::PathBuf> = appearance_paths
        .iter()
        .map(std::path::PathBuf::from)
        .collect();
    let appearance_sheet_bytes: std::collections::BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(root, &appearance_sheet_paths_buf)?
            .into_iter()
            .map(|(p, bytes)| (p.to_string_lossy().replace('\\', "/"), bytes))
            .collect();

    // Story 2.2: a `layer` name resolves against the codes golden --
    // `sim::codes::layer`'s single append-only ladder -- never a second,
    // hand-maintained list in this crate.
    let codes_golden = fsio::read_codes_golden(root)?;
    let code_tables = codes::CodeTables::parse(&codes_golden);

    let output = build(
        &text_files,
        &sheet_dims,
        &object_sheet_bytes,
        &appearance_sheet_bytes,
        &code_tables,
        model::SPRITE_SHEET_ALLOWED_ROOT,
        defs_version,
    )?;
    Ok(output)
}

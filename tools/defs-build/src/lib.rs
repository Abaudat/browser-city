//! `tools/defs-build`: turns `defs/` (TOML, NFR31's single source of
//! truth) into `server/sim/src/generated/defs.rs` and `client/public/
//! defs/defs.json`, one pass, one `defs_version` covering both. A plain
//! library over three separately testable stages -- `parse`, `validate`,
//! `emit` -- each pure over in-memory input; only `fsio` and the
//! `defs-build` binary touch the filesystem or a subprocess (Quentin's
//! direction: nothing about defs validity belongs anywhere but this
//! crate's own tests).

pub mod atlas;
pub mod contact_sheet;
pub mod emit;
pub mod error;
pub mod fsio;
pub mod layer_codes;
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

/// `defs/balance/render.toml`'s own `render.tile_size_px` -- the contact
/// sheet's own geometry conversion needs it (Tim's direction: never
/// assume 1 sub-cell == 1px). `validate.rs` already refuses a tree that
/// declares an object but no such key, so this only ever falls back to a
/// literal for the (already validated, hence vacuous) case of zero
/// objects.
fn find_tile_size_px(defs: &Defs) -> u32 {
    defs.balance
        .iter()
        .find(|b| b.key == "render.tile_size_px")
        .map(|b| b.value as u32)
        // Only reachable with zero objects (nothing for the sheet to
        // draw) -- validate.rs refuses this key's absence whenever any
        // object exists.
        .unwrap_or(16)
}

/// Runs every stage over an already-collected `(path, text)` file list, the
/// `(width, height)` already read from every appearance part's and every
/// object's own sheet file (story 1.10/2.2; empty for a tree with no such
/// entries), the `name -> code` layer ladder already read from the codes
/// golden ([`layer_codes::parse_layer_codes`]), the root every `sheet`/
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
    layer_codes: &std::collections::BTreeMap<String, u32>,
    sprite_sheet_allowed_root: &str,
    defs_version: &str,
) -> Result<BuildOutput, DefsError> {
    let raw = parse::parse_all(files)?;
    let defs = validate::validate(&raw, sheet_dims, layer_codes, sprite_sheet_allowed_root)?;
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

    // Story 2.3: `archetype` is authoring-time only and never reaches
    // `ObjectDef` (Tim's direction) -- the contact sheet still needs it to
    // group by, so it is read back here, from the pre-lowering entry, by
    // key (unique -- `validate.rs` already enforces this). The raw
    // entry's own `layer` (the authored name) and `path`/`key.line` (the
    // def's own file/line) come from the same lookup.
    let raw_objects_by_key: std::collections::BTreeMap<&str, &model::ObjectEntry> = raw
        .objects
        .iter()
        .map(|e| (e.key.value.as_str(), e))
        .collect();
    let tag_key_by_id: std::collections::BTreeMap<u32, &str> =
        defs.tags.iter().map(|t| (t.id, t.key.as_str())).collect();
    let tile_size_px = find_tile_size_px(&defs);
    let cards: Vec<contact_sheet::CardInput> = defs
        .objects
        .iter()
        .map(|o| {
            let raw_entry = raw_objects_by_key
                .get(o.key.as_str())
                .expect("every validated object came from a raw entry of the same key");
            let mut tag_keys: Vec<&str> = o
                .tags
                .iter()
                .map(|id| {
                    *tag_key_by_id
                        .get(id)
                        .expect("every object tag id was resolved from a real tag")
                })
                .collect();
            tag_keys.sort_unstable();
            contact_sheet::CardInput {
                obj: o,
                layer_name: raw_entry.layer.value.as_str(),
                archetype: raw_entry.archetype.as_ref().map(|a| a.value.as_str()),
                tag_keys,
                def_path: raw_entry.path.to_str().unwrap_or_default(),
                def_line: raw_entry.key.line,
                atlas: atlas.atlas_by_object_id[&o.id],
            }
        })
        .collect();
    let contact_sheet_html = contact_sheet::build(
        &cards,
        tile_size_px,
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

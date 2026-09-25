//! Shared fixture-tree helpers for this crate's integration tests. Named
//! `tests/support/mod.rs` rather than `tests/support.rs` so cargo does not
//! treat it as its own test binary -- each `tests/*.rs` file that wants it
//! declares `mod support;`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub fn read_tree(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out
}

fn walk(root: &Path, dir: &Path, out: &mut Vec<(PathBuf, String)>) {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
        .map(|e| e.unwrap().path())
        .collect();
    entries.sort();
    for path in entries {
        if path.is_dir() {
            walk(root, &path, out);
        } else {
            let rel = path.strip_prefix(root).unwrap();
            let rel_str = rel.to_string_lossy().replace('\\', "/");
            let full = PathBuf::from(format!("defs/{rel_str}"));
            let text = std::fs::read_to_string(&path)
                .unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()));
            out.push((full, text));
        }
    }
}

pub fn valid_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/valid")
}

pub fn invalid_dir(category: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/invalid")
        .join(category)
}

/// The valid base tree with one invalid-category overlay merged on top --
/// an overlay path that already exists in the base replaces it; a new
/// path is added alongside it. `BTreeMap` keeps the merge (and therefore
/// `parse_all`'s own file-processing order) deterministic.
pub fn merged_tree(category: &str) -> Vec<(PathBuf, String)> {
    let mut files: BTreeMap<PathBuf, String> = read_tree(&valid_dir()).into_iter().collect();
    for (path, text) in read_tree(&invalid_dir(category)) {
        files.insert(path, text);
    }
    files.into_iter().collect()
}

/// The `(width, height)` every `tests/fixtures/valid/appearance/*.toml`
/// sheet path needs to satisfy the valid tree's own `[[appearance_layout]]`
/// (16x32 cells, one direction, one frame) -- fixed here rather than read
/// from a real file, since these tests exercise `validate`'s own logic,
/// never `fsio`'s.
/// The `(width, height)` every `tests/fixtures/valid/objects/*.toml`
/// sprite sheet path needs to satisfy the valid tree's own objects --
/// fixed here rather than read from a real file, exactly like
/// [`appearance_sheet_dims`].
pub fn object_sheet_dims() -> BTreeMap<String, (u32, u32)> {
    [(
        "fixtures/objects/ME_Theme_Sorter_16x16/1_Test_Singles_16x16/trash-bin-test.png",
        (16, 16),
    )]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// Both [`appearance_sheet_dims`] and [`object_sheet_dims`] merged --
/// every fixture directory declares both kinds of sheet path, so every
/// caller wants the union.
pub fn sheet_dims() -> BTreeMap<String, (u32, u32)> {
    let mut all = appearance_sheet_dims();
    all.extend(object_sheet_dims());
    all
}

/// Real PNG bytes for every path [`object_sheet_dims`] declares -- story
/// 2.6's atlas packer decodes real pixels, so `build()` needs more than a
/// declared `(width, height)` for an object's own sheet (appearance
/// sheets are never packed by this story; only `object_sheet_dims`'s
/// paths need bytes). A solid colour is enough: these tests exercise
/// `parse`/`validate`/the packer's own grouping and pass-through, never
/// pixel content.
pub fn object_sheet_bytes() -> BTreeMap<String, Vec<u8>> {
    object_sheet_dims()
        .into_iter()
        .map(|(path, (w, h))| {
            let rgba = vec![200u8; (w * h * 4) as usize];
            let bytes = defs_build::atlas::image::encode_rgba8(w, h, &rgba)
                .expect("fixture PNG encode must succeed");
            (path, bytes)
        })
        .collect()
}

/// Real PNG bytes for every path [`appearance_sheet_dims`] declares --
/// story 2.7's character-part packer decodes real pixels, exactly like
/// [`object_sheet_bytes`] -- a solid, non-transparent colour is enough
/// (these tests exercise `parse`/`validate`/the packer's own strip
/// building, never pixel content).
pub fn appearance_sheet_bytes() -> BTreeMap<String, Vec<u8>> {
    appearance_sheet_dims()
        .into_iter()
        .map(|(path, (w, h))| {
            let rgba = vec![200u8; (w * h * 4) as usize];
            let bytes = defs_build::atlas::image::encode_rgba8(w, h, &rgba)
                .expect("fixture PNG encode must succeed");
            (path, bytes)
        })
        .collect()
}

pub fn appearance_sheet_dims() -> BTreeMap<String, (u32, u32)> {
    [
        ("fixtures/appearance/body-test.png", (16, 32)),
        ("fixtures/appearance/eyes-test.png", (16, 32)),
        ("fixtures/appearance/outfit-test.png", (16, 32)),
        ("fixtures/appearance/hair-test.png", (16, 32)),
        ("fixtures/appearance/accessory-test.png", (16, 32)),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

/// The `name -> code` layer ladder the valid tree's own objects resolve
/// against -- a small, fixed subset of the real codes golden (Quentin's
/// direction: these integration tests exercise `validate`/`build`'s own
/// logic through real fixture trees, never `fsio`'s filesystem reads).
pub fn layer_codes() -> BTreeMap<String, u32> {
    [("furniture", 2u32), ("objects", 3u32), ("walls", 4u32)]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
}

/// The `name -> code` unit set the valid tree's items resolve against --
/// a fixed subset of the real codes golden, like [`layer_codes`].
pub fn unit_codes() -> BTreeMap<String, u32> {
    [("piece", 0u32), ("gram", 1u32), ("millilitre", 2u32)]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect()
}

/// `""` (never `defs_build::model::SPRITE_SHEET_ALLOWED_ROOT`): every
/// fixture directory but the two dedicated to that check names sheet
/// paths that live nowhere near `ModernTileset/` -- an empty root always
/// passes (`validate.rs`'s own `sheet_is_under_root`), so those fixtures
/// stay focused on the one thing each is testing.
///
/// `mod support` is compiled fresh into every `tests/*.rs` binary that
/// declares it (same reasoning as `build_err_enforcing_sheet_root`'s own
/// `#[allow(dead_code)]` below) -- a `tests/*.rs` file exercising `build`
/// directly rather than through a failure fixture sees this as unused.
#[allow(dead_code)]
pub fn build_err(category: &str) -> defs_build::DefsError {
    let files = merged_tree(category);
    defs_build::build(
        &files,
        &sheet_dims(),
        &object_sheet_bytes(),
        &appearance_sheet_bytes(),
        &layer_codes(),
        &unit_codes(),
        "",
        "test-version",
    )
    .expect_err(&format!(
        "fixture category '{category}' was expected to fail the build"
    ))
}

/// Like [`build_err`], but enforces the real
/// [`defs_build::model::SPRITE_SHEET_ALLOWED_ROOT`] -- the two fixture
/// categories that exercise the sheet-root check itself
/// (`sprite-sheet-outside-allowed-root`, `sprite-sheet-path-escape`) use
/// this instead.
///
/// `mod support` is compiled fresh into every `tests/*.rs` binary that
/// declares it; `failure_fixtures.rs` is the only one that calls this, so
/// `shared_malformed_cases.rs`'s own copy sees it as unused.
#[allow(dead_code)]
pub fn build_err_enforcing_sheet_root(category: &str) -> defs_build::DefsError {
    let files = merged_tree(category);
    defs_build::build(
        &files,
        &sheet_dims(),
        &object_sheet_bytes(),
        &appearance_sheet_bytes(),
        &layer_codes(),
        &unit_codes(),
        defs_build::model::SPRITE_SHEET_ALLOWED_ROOT,
        "test-version",
    )
    .expect_err(&format!(
        "fixture category '{category}' was expected to fail the build"
    ))
}

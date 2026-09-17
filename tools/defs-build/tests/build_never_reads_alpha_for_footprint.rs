//! Story 2.3 (AC1/AC3), Quentin's direction: `defs-build`'s normal build
//! path must never read alpha to decide a footprint. Builds the same
//! defs tree twice, swapping only the object's own sprite sheet bytes
//! for a different-alpha PNG of the identical size, and asserts both
//! generated artefacts come out byte-identical -- proof by construction,
//! not by code inspection.

mod support;

use std::collections::BTreeMap;

use support::{layer_codes, object_sheet_dims, read_tree, sheet_dims, valid_dir};

#[test]
fn swapping_an_object_sheets_alpha_never_changes_either_generated_artefact() {
    let files = read_tree(&valid_dir());
    let layer_codes = layer_codes();
    let sheet_dims = sheet_dims();

    let (sheet, (w, h)) = object_sheet_dims()
        .into_iter()
        .next()
        .expect("at least one object sheet must exist in the shared valid fixture tree");

    // Two sheets, identical size, deliberately different alpha content --
    // one fully opaque, one with a checkerboard hole punched through it.
    let opaque_rgba = vec![255u8; (w * h * 4) as usize];
    let mut punched_rgba = opaque_rgba.clone();
    for i in (0..punched_rgba.len()).step_by(8) {
        punched_rgba[i + 3] = 0;
    }

    let opaque_bytes = defs_build::atlas::image::encode_rgba8(w, h, &opaque_rgba).unwrap();
    let punched_bytes = defs_build::atlas::image::encode_rgba8(w, h, &punched_rgba).unwrap();
    assert_ne!(
        opaque_bytes, punched_bytes,
        "the two fixture sheets must actually differ in their own bytes"
    );

    let mut object_sheet_bytes_a: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    object_sheet_bytes_a.insert(sheet.clone(), opaque_bytes);
    let mut object_sheet_bytes_b: BTreeMap<String, Vec<u8>> = BTreeMap::new();
    object_sheet_bytes_b.insert(sheet.clone(), punched_bytes);

    let out_a = defs_build::build(
        &files,
        &sheet_dims,
        &object_sheet_bytes_a,
        &layer_codes,
        "",
        "test-version",
    )
    .unwrap();
    let out_b = defs_build::build(
        &files,
        &sheet_dims,
        &object_sheet_bytes_b,
        &layer_codes,
        "",
        "test-version",
    )
    .unwrap();

    // `defs.rs` never learns an atlas page exists at all (Tim's own
    // direction, `model.rs`'s `AtlasRect` doc comment) -- unaffected by
    // alpha, byte for byte.
    assert_eq!(out_a.rust, out_b.rust);
    assert_eq!(out_a.id_manifest, out_b.id_manifest);

    // `defs.json` legitimately differs in one place: the packed atlas
    // page's own content hash, embedded in its filename (story 2.6) --
    // real pixels really did change. Strip only that content-hashed
    // filename before comparing the rest, which is exactly the object's
    // own `width`/`height`/`collider` (and everything else) unaffected by
    // alpha.
    let strip_page_hash = |json: &str| -> String {
        let mut out = String::new();
        let mut rest = json;
        while let Some(idx) = rest.find("\"file\": \"") {
            out.push_str(&rest[..idx]);
            rest = &rest[idx + "\"file\": \"".len()..];
            let end = rest.find('"').expect("unterminated file value");
            rest = &rest[end..];
        }
        out.push_str(rest);
        out
    };
    assert_eq!(strip_page_hash(&out_a.json), strip_page_hash(&out_b.json));
    assert_ne!(
        out_a.json, out_b.json,
        "the two builds' JSON must differ somewhere (the atlas page's own content hash) -- otherwise this test is vacuous"
    );
}

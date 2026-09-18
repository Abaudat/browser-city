//! Story 2.5 (Quentin's direction): a golden of the *whole* emitted
//! contact sheet, over the small, dedicated fixture tree at `tests/
//! fixtures/contact-sheet/` -- never the live `defs/` tree, which churns
//! on every art change. Byte-exact, so any change to the sheet's own
//! markup, geometry or grouping is a visible diff in review.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

fn fixture_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/contact-sheet")
}

fn read_tree(dir: &Path) -> Vec<(PathBuf, String)> {
    let mut out = Vec::new();
    walk(dir, dir, &mut out);
    out.sort_by(|a, b| a.0.cmp(&b.0));
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

/// The four sprite sheets `objects/props.toml` names, sized to match each
/// object's own declared footprint/overhang -- a solid colour is enough,
/// this test exercises the sheet's own markup, never pixel content.
fn sheet_dims() -> BTreeMap<String, (u32, u32)> {
    [
        (
            "fixtures/objects/ME_Theme_Sorter_16x16/1_Test_Singles_16x16/bench.png",
            (48, 16),
        ),
        (
            "fixtures/objects/ME_Theme_Sorter_16x16/1_Test_Singles_16x16/lamppost.png",
            (16, 64),
        ),
        (
            "fixtures/objects/ME_Theme_Sorter_16x16/1_Test_Singles_16x16/sign.png",
            (16, 16),
        ),
        (
            "fixtures/objects/ME_Theme_Sorter_16x16/1_Test_Singles_16x16/planter.png",
            (16, 16),
        ),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

fn sheet_bytes() -> BTreeMap<String, Vec<u8>> {
    sheet_dims()
        .into_iter()
        .map(|(path, (w, h))| {
            let rgba = vec![180u8; (w * h * 4) as usize];
            let bytes = defs_build::atlas::image::encode_rgba8(w, h, &rgba)
                .expect("fixture PNG encode must succeed");
            (path, bytes)
        })
        .collect()
}

fn layer_codes() -> BTreeMap<String, u32> {
    [("furniture".to_string(), 2u32)].into_iter().collect()
}

fn build_output() -> defs_build::BuildOutput {
    let files = read_tree(&fixture_dir());
    defs_build::build(
        &files,
        &sheet_dims(),
        &sheet_bytes(),
        &BTreeMap::new(),
        &layer_codes(),
        "",
        "fixture-version",
    )
    .expect("the contact-sheet fixture tree must build")
}

#[test]
fn the_whole_emitted_contact_sheet_matches_its_golden_byte_for_byte() {
    let output = build_output();
    let golden_path =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/goldens/contact-sheet.golden.html");
    let golden = std::fs::read_to_string(&golden_path)
        .unwrap_or_else(|e| panic!("cannot read {}: {e}", golden_path.display()));
    assert_eq!(
        output.contact_sheet, golden,
        "the contact sheet's own markup drifted from tests/goldens/contact-sheet.golden.html -- \
         if this is an intentional change, regenerate the golden from output.contact_sheet"
    );
}

#[test]
fn the_contact_sheet_is_byte_identical_across_two_builds() {
    let a = build_output().contact_sheet;
    let b = build_output().contact_sheet;
    assert_eq!(a, b);
}

#[test]
fn every_object_key_appears_exactly_once() {
    let output = build_output();
    for key in [
        "bench_bespoke",
        "lamppost_pole",
        "sign_pole",
        "planter_walkthrough",
    ] {
        let needle = format!("data-key=\"{key}\"");
        let count = output.contact_sheet.matches(&needle).count();
        assert_eq!(count, 1, "'{key}' must appear exactly once, found {count}");
    }
}

#[test]
fn objects_naming_no_archetype_render_in_their_own_visible_bucket() {
    let output = build_output();
    assert!(output.contact_sheet.contains("(no archetype -- bespoke)"));
    assert!(output.contact_sheet.contains("data-archetype=\"pole\""));
}

//! Story 2.3, Quentin's direction: runs [`propose`] over every committed
//! `[[object]]`'s own sprite sheet and asserts only that it never panics
//! and never returns a [`ProposeError`] -- report-only, deliberately
//! never asserting equality with the object's own authored footprint
//! (the proposal is not the authority; a test that forced them to match
//! would quietly make it one).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::image::decode_rgba8;
use defs_build::propose::propose;
use defs_build::{fsio, object_sprite_sheet_paths, parse};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn propose_never_panics_or_errors_over_every_committed_objects_sheet() {
    let root = repo_root();
    let tracked = fsio::list_git_tracked_files(&root, "defs").unwrap();
    let mut text_files = fsio::read_text(&root, &tracked).unwrap();
    text_files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&text_files).unwrap();

    assert!(
        !raw.objects.is_empty(),
        "defs/objects/ has no objects -- this test would pass vacuously"
    );

    let mut sheet_paths = object_sprite_sheet_paths(&raw);
    sheet_paths.sort();
    sheet_paths.dedup();
    let sheet_bytes: BTreeMap<String, Vec<u8>> = fsio::read_bytes(
        &root,
        &sheet_paths.iter().map(PathBuf::from).collect::<Vec<_>>(),
    )
    .unwrap()
    .into_iter()
    .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
    .collect();

    for o in &raw.objects {
        let sheet = &o.sprite.value.sheet;
        let bytes = sheet_bytes
            .get(sheet)
            .unwrap_or_else(|| panic!("object '{}': sheet '{sheet}' never read", o.key.value));
        let (w, h, rgba) = decode_rgba8(bytes)
            .unwrap_or_else(|e| panic!("object '{}': cannot decode '{sheet}': {e}", o.key.value));
        match propose(w, h, &rgba) {
            Ok(_) => {}
            Err(e) => panic!(
                "object '{}': propose() over its own sheet '{sheet}' returned an error: {e}",
                o.key.value
            ),
        }
    }
}

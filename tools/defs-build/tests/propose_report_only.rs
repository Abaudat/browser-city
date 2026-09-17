//! Story 2.3, Quentin's direction: runs [`propose`] over every committed
//! `[[object]]`'s own sprite *rect* (cropped from its sheet, never the
//! whole decoded sheet -- an atlas-style sheet with more than one object
//! would otherwise feed the wrong pixels in, even though every sheet
//! today happens to be `x = 0, y = 0` and whole) and asserts only that
//! it never panics -- report-only, deliberately never asserting success:
//! a named [`ProposeError`] on a real prop with a real gap under its own
//! art (a legitimate outcome once the sprite root cause of story 2.3
//! cycle 1's panic was fixed) is reported, not failed. Never asserts
//! equality with the object's own authored footprint either -- the
//! proposal is not the authority; a test that forced them to match
//! would quietly make it one.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::image::decode_rgba8;
use defs_build::propose::propose;
use defs_build::{fsio, object_sprite_sheet_paths, parse};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// Extracts the `w`x`h` rect at `(x, y)` out of an already-decoded
/// `sheet_w`x`sheet_h` RGBA8 buffer -- the object's own `sprite` rect,
/// never the whole sheet.
fn crop(sheet_rgba: &[u8], sheet_w: u32, x: u32, y: u32, w: u32, h: u32) -> Vec<u8> {
    let mut out = vec![0u8; w as usize * h as usize * 4];
    for row in 0..h {
        for col in 0..w {
            let src_i = (((y + row) * sheet_w + (x + col)) * 4) as usize;
            let dst_i = ((row * w + col) * 4) as usize;
            out[dst_i..dst_i + 4].copy_from_slice(&sheet_rgba[src_i..src_i + 4]);
        }
    }
    out
}

#[test]
fn propose_never_panics_over_every_committed_objects_own_sprite_rect() {
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

    let mut ok_count = 0;
    let mut err_count = 0;
    for o in &raw.objects {
        let sheet = &o.sprite.value.sheet;
        let bytes = sheet_bytes
            .get(sheet)
            .unwrap_or_else(|| panic!("object '{}': sheet '{sheet}' never read", o.key.value));
        let (sheet_w, sheet_h, sheet_rgba) = decode_rgba8(bytes)
            .unwrap_or_else(|e| panic!("object '{}': cannot decode '{sheet}': {e}", o.key.value));
        let sprite = &o.sprite.value;
        assert!(
            sprite.x + sprite.w <= sheet_w && sprite.y + sprite.h <= sheet_h,
            "object '{}': sprite rect does not fit inside its own sheet",
            o.key.value
        );
        let cropped = crop(&sheet_rgba, sheet_w, sprite.x, sprite.y, sprite.w, sprite.h);

        // The call under test -- must not panic, whatever it returns.
        match propose(sprite.w, sprite.h, &cropped) {
            Ok(_) => ok_count += 1,
            Err(e) => {
                err_count += 1;
                eprintln!(
                    "propose_report_only: object '{}' ({sheet}): propose() over its own sprite \
                     rect returned {e} -- report-only, not a failure",
                    o.key.value
                );
            }
        }
    }
    eprintln!("propose_report_only: {ok_count} ok, {err_count} refused (report-only)");
}

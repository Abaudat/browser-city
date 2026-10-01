//! Story 15.3: the committed colliders agree with the committed art, read
//! as real PNGs, and moving one by a sub-cell turns the build red naming the
//! key and the columns -- the mutation check, automated. Every object in
//! `defs/` is held to the rule; the trash can and the lamppost are also
//! shifted.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::image::decode_rgba8;
use defs_build::model::{ColliderRect, Defs, ObjectDef, SPRITE_SHEET_ALLOWED_ROOT};
use defs_build::silhouette::{Disagreement, check_collider_against_art};
use defs_build::{codes, fsio, parse, validate};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn real_defs() -> Defs {
    let root = repo_root();
    let mut files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&files).unwrap();
    let mut sheets = defs_build::appearance_sheet_paths(&raw);
    sheets.extend(defs_build::object_sprite_sheet_paths(&raw));
    sheets.sort();
    sheets.dedup();
    let dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&root, &sheets)
        .unwrap()
        .into_iter()
        .collect();
    let tables = codes::CodeTables::parse(&fsio::read_codes_golden(&root).unwrap());
    validate::validate(&raw, &dims, &tables, SPRITE_SHEET_ALLOWED_ROOT).unwrap()
}

fn verdict(o: &ObjectDef, tile: u32, collider: ColliderRect) -> Result<(), Disagreement> {
    let bytes = fsio::read_bytes(&repo_root(), &[PathBuf::from(&o.sprite.sheet)])
        .unwrap()
        .remove(0)
        .1;
    let (w, _h, rgba) = decode_rgba8(&bytes).unwrap();
    check_collider_against_art(&rgba, w, &o.sprite, o.height, tile, collider)
}

fn object<'a>(defs: &'a Defs, key: &str) -> &'a ObjectDef {
    defs.objects.iter().find(|o| o.key == key).unwrap()
}

#[test]
fn every_committed_collider_agrees_with_its_art() {
    let defs = real_defs();
    let tile = defs.tile_size_px.unwrap();
    let mut examined = 0;
    for o in &defs.objects {
        if let Some(c) = o.collider {
            assert_eq!(verdict(o, tile, c), Ok(()), "{}", o.key);
            examined += 1;
        }
    }
    assert!(examined >= 5, "examined only {examined} colliders");
}

/// The real tree built with one line of `defs/objects/city-props.toml`
/// replaced; the rendered build error.
fn build_error_with(old: &str, new: &str) -> String {
    let root = repo_root();
    let mut files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut replaced = 0;
    for (path, text) in &mut files {
        if path.ends_with("defs/objects/city-props.toml") && text.contains(old) {
            *text = text.replacen(old, new, 1);
            replaced += 1;
        }
    }
    assert_eq!(replaced, 1, "'{old}' must appear once in the real tree");
    defs_build::build_from_text_files(&root, &files, "test")
        .expect_err("the altered tree must fail the build")
        .to_string()
}

/// Moving a committed collider turns the build red naming the key and the
/// columns. The can's bottom solid row is columns 5..11 (the lid above is
/// full width).
#[test]
fn shifting_the_trash_can_collider_names_the_key_and_the_columns() {
    let msg = build_error_with(
        "collider = { x0 = 2, y0 = 7, x1 = 14, y1 = 15 }",
        "collider = { x0 = 6, y0 = 7, x1 = 14, y1 = 15 }",
    );
    assert!(
        msg.contains("object 'trash_bin' collider (6, 7)-(14, 15)")
            && msg.contains(
                "collider columns 6..14 do not cover the bottom solid row's columns 5..11"
            ),
        "{msg}"
    );
}

/// The counter's bamboo body starts at column 1 and ends before its two
/// shadow columns; its collider one sub-cell wider is refused.
#[test]
fn widening_the_counter_collider_names_the_key_and_the_columns() {
    let msg = build_error_with(
        "collider = { x0 = 1, y0 = 0, x1 = 46, y1 = 15 }",
        "collider = { x0 = 0, y0 = 0, x1 = 46, y1 = 15 }",
    );
    assert!(
        msg.contains("object 'shop_counter' collider (0, 0)-(46, 15)")
            && msg.contains("collider columns 0..46 reach outside the solid columns 1..46"),
        "{msg}"
    );
}

/// The bench's art starts five rows down: a collider from row 4 is refused.
#[test]
fn raising_the_bench_collider_names_the_key_and_the_rows() {
    let msg = build_error_with(
        "collider = { x0 = 0, y0 = 5, x1 = 32, y1 = 12 }",
        "collider = { x0 = 0, y0 = 4, x1 = 32, y1 = 12 }",
    );
    assert!(
        msg.contains("object 'park_bench' collider (0, 4)-(32, 12)")
            && msg.contains("collider rows 4..12 reach outside the solid rows 5.."),
        "{msg}"
    );
}

/// The plinth is columns 2..14: the old 4x4 box no longer covers the drawn
/// base.
#[test]
fn shrinking_the_lamppost_collider_to_its_old_box_names_the_columns() {
    let defs = real_defs();
    let tile = defs.tile_size_px.unwrap();
    let o = object(&defs, "lamppost");
    let old_box = ColliderRect {
        x0: 6,
        y0: 10,
        x1: 10,
        y1: 14,
    };
    assert_eq!(
        verdict(o, tile, old_box),
        Err(Disagreement::BottomRowOutsideCollider {
            collider: (6, 10),
            art: (2, 14)
        })
    );
}

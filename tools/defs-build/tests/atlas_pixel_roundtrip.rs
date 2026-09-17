//! Story 2.6, Quentin's direction: "the pixel round-trip, the test that
//! matters most". Runs over every real object in the committed `defs/`
//! tree, never a sample -- for each one, the pixels at its packed atlas
//! rect must be byte-identical to the pixels at its own `sprite` rect in
//! the real vendor sheet. Cheap: only the used subset is ever packed.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::{
    appearance_sheet_paths, atlas, fsio, layer_codes, model, object_sprite_sheet_paths, parse,
    validate,
};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

#[test]
fn every_real_objects_atlas_pixels_match_its_source_sprite_rect_exactly() {
    let root = repo_root();

    let tracked = fsio::list_git_tracked_files(&root, "defs").unwrap();
    let mut text_files = fsio::read_text(&root, &tracked).unwrap();
    text_files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&text_files).unwrap();

    let mut object_sheet_paths = object_sprite_sheet_paths(&raw);
    object_sheet_paths.sort();
    object_sheet_paths.dedup();
    // validate needs dims for every sheet referenced anywhere (appearance
    // parts included) -- only the object subset needs real bytes below.
    let mut all_sheet_paths = appearance_sheet_paths(&raw);
    all_sheet_paths.extend(object_sheet_paths.iter().cloned());
    all_sheet_paths.sort();
    all_sheet_paths.dedup();
    let sheet_dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&root, &all_sheet_paths)
        .unwrap()
        .into_iter()
        .collect();

    let codes_golden = fsio::read_codes_golden(&root).unwrap();
    let layer_codes = layer_codes::parse_layer_codes(&codes_golden);
    let defs = validate::validate(
        &raw,
        &sheet_dims,
        &layer_codes,
        model::SPRITE_SHEET_ALLOWED_ROOT,
    )
    .unwrap();
    assert!(
        !defs.objects.is_empty(),
        "defs/objects/ has no objects -- this test would pass vacuously"
    );

    let object_sheet_paths_buf: Vec<PathBuf> =
        object_sheet_paths.iter().map(PathBuf::from).collect();
    let object_sheet_bytes: BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(&root, &object_sheet_paths_buf)
            .unwrap()
            .into_iter()
            .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
            .collect();

    let page_groups = validate::validate_page_groups(&raw).unwrap();
    let out = atlas::build::build_atlas(&defs.objects, &object_sheet_bytes, &page_groups).unwrap();

    for o in &defs.objects {
        let rect = out.atlas_by_object_id[&o.id];
        let (page_w, page_h, page_rgba) =
            atlas::image::decode_rgba8(&out.page_bytes[rect.page as usize]).unwrap();
        assert!(rect.x + rect.w <= page_w && rect.y + rect.h <= page_h);

        let src_bytes = object_sheet_bytes.get(&o.sprite.sheet).unwrap();
        let (src_w, src_h, src_rgba) = atlas::image::decode_rgba8(src_bytes).unwrap();
        assert!(o.sprite.x + o.sprite.w <= src_w && o.sprite.y + o.sprite.h <= src_h);

        for row in 0..o.sprite.h {
            for col in 0..o.sprite.w {
                let page_i = ((rect.y + row) * page_w + (rect.x + col)) as usize * 4;
                let src_i = ((o.sprite.y + row) * src_w + (o.sprite.x + col)) as usize * 4;
                assert_eq!(
                    &page_rgba[page_i..page_i + 4],
                    &src_rgba[src_i..src_i + 4],
                    "object '{}' pixel ({col},{row}) mismatches its source sheet '{}'",
                    o.key,
                    o.sprite.sheet
                );
            }
        }
    }
}

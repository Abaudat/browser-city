//! Story 2.6, Quentin's direction: "the pixel round-trip, the test that
//! matters most". Runs over every real object in the committed `defs/`
//! tree, never a sample -- for each one, the pixels at its packed atlas
//! rect must be byte-identical to the pixels at its own `sprite` rect in
//! the real vendor sheet. Cheap: only the used subset is ever packed.
//!
//! Story 2.7, Quentin's direction, point 2: mirrored for every real
//! character part -- for every used `(row, direction, frame)` cell of
//! every real body/eyes/hairstyle/outfit/accessory sheet, the packed
//! strip's own pixels must be byte-identical to the source cell in the
//! real vendor sheet.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::character::{collect_character_parts, strip_size};
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

    let mut text_files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
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
    let layer_codes = layer_codes::parse_codes(&codes_golden, "layer");
    let unit_codes = layer_codes::parse_codes(&codes_golden, "unit");
    let defs = validate::validate(
        &raw,
        &sheet_dims,
        &layer_codes,
        &unit_codes,
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

    let character_parts = collect_character_parts(
        &defs.bodies,
        &defs.eyes,
        &defs.hairstyles,
        &defs.outfits,
        &defs.accessories,
    );
    assert!(
        !character_parts.is_empty(),
        "defs/appearance/ has no character parts -- this test would pass vacuously"
    );
    let appearance_sheet_paths_buf: Vec<PathBuf> = appearance_sheet_paths(&raw)
        .iter()
        .map(PathBuf::from)
        .collect();
    let appearance_sheet_bytes: BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(&root, &appearance_sheet_paths_buf)
            .unwrap()
            .into_iter()
            .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
            .collect();

    let out = atlas::build::build_atlas(
        &defs.objects,
        &object_sheet_bytes,
        &page_groups,
        &character_parts,
        &appearance_sheet_bytes,
        &defs.appearance_layouts,
    )
    .unwrap();

    // Tim's direction, cycle 1: every one of ~500+ objects/parts can
    // share a page (a `character_*` page in particular is shared by
    // hundreds of parts) -- decoding it once per item, not once per
    // page, is what pushed the `defs` CI job from under a minute to
    // ~8 minutes. Decoded here, once per page (never per item, never
    // cloned), and borrowed by both loops below -- `out.page_bytes`'s
    // own index is the page index, so this stays aligned by construction.
    let decoded_pages: Vec<(u32, u32, Vec<u8>)> = out
        .page_bytes
        .iter()
        .map(|bytes| atlas::image::decode_rgba8(bytes).unwrap())
        .collect();

    for o in &defs.objects {
        let rect = out.atlas_by_object_id[&o.id];
        let (page_w, page_h, page_rgba) = &decoded_pages[rect.page as usize];
        let (page_w, page_h) = (*page_w, *page_h);
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

    // Story 2.7: every real character part's own packed strip, cell by
    // cell (idle and walk, every declared direction, every frame),
    // against the real vendor sheet's own source cell -- plus a 1px
    // extruded-border spot check, mirroring the object proof above.
    for part in &character_parts {
        let layout = defs
            .appearance_layouts
            .iter()
            .find(|l| l.family == part.family)
            .unwrap_or_else(|| panic!("no layout for family '{}'", part.family.as_str()));
        let rect = out
            .atlas_by_character_part
            .get(&(part.kind, part.key.clone()))
            .unwrap_or_else(|| panic!("{} '{}' has no packed atlas rect", part.kind, part.key));
        let (page_w, page_h, page_rgba) = &decoded_pages[rect.page as usize];
        let (page_w, page_h) = (*page_w, *page_h);
        assert!(rect.x + rect.w <= page_w && rect.y + rect.h <= page_h);
        let (expected_w, expected_h) = strip_size(layout);
        assert_eq!((rect.w, rect.h), (expected_w, expected_h));

        let src_bytes = appearance_sheet_bytes.get(&part.sheet).unwrap();
        let (src_w, src_h, src_rgba) = atlas::image::decode_rgba8(src_bytes).unwrap();

        for (row_index, row) in layout.rows.iter().enumerate() {
            for (dir_index, _direction) in layout.directions.iter().enumerate() {
                for frame in 0..row.frames_per_direction {
                    let column = dir_index as u32 * row.frames_per_direction + frame;
                    let src_x = column * layout.cell_width;
                    let src_y = row.row * layout.cell_height;
                    let dst_x = column * layout.cell_width;
                    let dst_y = row_index as u32 * layout.cell_height;
                    for y in 0..layout.cell_height {
                        for x in 0..layout.cell_width {
                            let page_i =
                                ((rect.y + dst_y + y) * page_w + (rect.x + dst_x + x)) as usize * 4;
                            let src_i = ((src_y + y) * src_w + (src_x + x)) as usize * 4;
                            assert!(
                                (src_y + y) < src_h && (src_x + x) < src_w,
                                "{} '{}' cell ({row_index},{dir_index},{frame}) reaches outside its own sheet",
                                part.kind,
                                part.key
                            );
                            assert_eq!(
                                &page_rgba[page_i..page_i + 4],
                                &src_rgba[src_i..src_i + 4],
                                "{} '{}' cell ({row_index},{dir_index},{frame}) pixel ({x},{y}) mismatches its source sheet '{}'",
                                part.kind,
                                part.key,
                                part.sheet
                            );
                        }
                    }
                }
            }
        }

        // The 1px extruded border: the pixel just outside the packed
        // strip's own top-left corner must equal the strip's own
        // top-left pixel (Artie's direction, story 2.6 -- proven for
        // objects already; character parts share the exact same
        // `composite_with_extrusion` call).
        let inside = ((rect.y) * page_w + rect.x) as usize * 4;
        let above = ((rect.y - 1) * page_w + rect.x) as usize * 4;
        assert_eq!(
            &page_rgba[inside..inside + 4],
            &page_rgba[above..above + 4],
            "{} '{}': 1px extruded border above its own top-left corner is wrong",
            part.kind,
            part.key
        );
    }

    // Story 2.7, Quentin's direction: only the used rows/pages are ever
    // packed -- every character part's own virtual sheet key resolves to
    // exactly one placement (no stray page for an unused row).
    let placed_character_pages: std::collections::BTreeSet<u32> = character_parts
        .iter()
        .map(|part| out.atlas_by_character_part[&(part.kind, part.key.clone())].page)
        .collect();
    let character_group_pages = out
        .pages
        .iter()
        .filter(|p| p.group.starts_with(model::CHARACTER_GROUP_PREFIX))
        .count();
    assert_eq!(
        placed_character_pages.len(),
        character_group_pages,
        "every character-group page must actually be used by some part's own placement"
    );
}

//! Story 2.6: the impure-at-the-edge orchestration stage that turns a
//! validated [`crate::model::Defs`]'s own objects plus every already-read
//! source sheet's raw PNG bytes into packed atlas pages and each object's
//! own [`crate::model::AtlasRect`]. Reads no filesystem itself (`fsio`
//! already did that); the `png`/pixel work below is the only impure-ish
//! part, and even that is pure over in-memory bytes.

use std::collections::BTreeMap;

use crate::atlas::image::{SourceCrop, composite_with_extrusion, decode_rgba8, encode_rgba8};
use crate::atlas::pack::{PackItem, PageMeta, SourceKey, pack_all};
use crate::atlas::theme::{check_shadow_variants, resolve_page_group, theme_group};
use crate::model::{AtlasPageDef, AtlasRect, ObjectDef};
use crate::sha256::sha256_hex;
use crate::version::DEFS_VERSION_LEN;

#[derive(Debug)]
pub struct AtlasBuildOutput {
    pub pages: Vec<AtlasPageDef>,
    /// PNG bytes for each page, aligned index-for-index with `pages`.
    pub page_bytes: Vec<Vec<u8>>,
    pub atlas_by_object_id: BTreeMap<u32, AtlasRect>,
}

/// NFR12's scene-side half: a scene is the shared group
/// ([`crate::model::ATLAS_SHARED_GROUP`]) plus at most one themed group --
/// a player is never on the street and inside a themed interior at once --
/// so the pages that can ever be simultaneously bound are the shared
/// group's own page count plus the *worst* other group's own page count.
/// Fails naming both groups and their counts when that sum exceeds
/// [`crate::model::ATLAS_MAX_BOUND_PAGES`].
fn check_max_bound_pages(pages: &[PageMeta]) -> Result<(), String> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for page in pages {
        *counts.entry(page.group.as_str()).or_insert(0) += 1;
    }
    let shared_count = counts
        .get(crate::model::ATLAS_SHARED_GROUP)
        .copied()
        .unwrap_or(0);
    let worst_other = counts
        .iter()
        .filter(|(g, _)| **g != crate::model::ATLAS_SHARED_GROUP)
        .max_by_key(|(_, count)| **count);

    let (other_group, other_count) = match worst_other {
        Some((g, c)) => (*g, *c),
        None => ("", 0),
    };
    let total = shared_count + other_count;
    if total > crate::model::ATLAS_MAX_BOUND_PAGES {
        return Err(format!(
            "a scene binding '{}' ({shared_count} page(s)) and '{other_group}' ({other_count} page(s)) would bind {total} pages, more than ATLAS_MAX_BOUND_PAGES ({})",
            crate::model::ATLAS_SHARED_GROUP,
            crate::model::ATLAS_MAX_BOUND_PAGES
        ));
    }
    Ok(())
}

fn sprite_key(o: &ObjectDef) -> SourceKey {
    SourceKey {
        sheet: o.sprite.sheet.clone(),
        x: o.sprite.x,
        y: o.sprite.y,
        w: o.sprite.w,
        h: o.sprite.h,
    }
}

/// Packs every object's own sprite rect and composites the resulting
/// pages' real pixels from `sheet_bytes` (every `sprite.sheet` an object
/// names, already read whole -- see `fsio::read_bytes`, mirroring how
/// `sheet_dims` already covers `IHDR` reads). An object naming a sheet
/// missing from `sheet_bytes` is a programming-invariant failure (the
/// binary's own edge always reads every referenced sheet first), reported
/// the same way as every other atlas failure.
///
/// `page_groups` is `defs/atlas/page-groups.toml`'s own validated
/// `theme -> group` table (Artie's direction): a derived theme with no
/// row fails the build naming it, before anything is packed.
pub fn build_atlas(
    objects: &[ObjectDef],
    sheet_bytes: &BTreeMap<String, Vec<u8>>,
    page_groups: &BTreeMap<String, String>,
) -> Result<AtlasBuildOutput, String> {
    if objects.is_empty() {
        return Ok(AtlasBuildOutput {
            pages: Vec::new(),
            page_bytes: Vec::new(),
            atlas_by_object_id: BTreeMap::new(),
        });
    }

    let mut items = Vec::with_capacity(objects.len());
    // Shadow-variant consistency is a per-theme concern (Artie's own art
    // choice for one theme folder), checked before themes are ever
    // merged into a shared page group.
    let mut sheets_by_theme: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for o in objects {
        let theme = theme_group(&o.sprite.sheet)?;
        sheets_by_theme
            .entry(theme.clone())
            .or_default()
            .push(o.sprite.sheet.clone());
        let group = resolve_page_group(&theme, page_groups)?;
        items.push(PackItem {
            group,
            source: sprite_key(o),
            sort_key: o.key.clone(),
        });
    }
    for (theme, sheets) in &sheets_by_theme {
        check_shadow_variants(theme, sheets)?;
    }

    let result = pack_all(&items)?;
    check_max_bound_pages(&result.pages)?;

    // Decode every referenced sheet at most once.
    let mut decoded: BTreeMap<&str, (u32, u32, Vec<u8>)> = BTreeMap::new();
    for source in result.placements.keys() {
        if decoded.contains_key(source.sheet.as_str()) {
            continue;
        }
        let bytes = sheet_bytes.get(&source.sheet).ok_or_else(|| {
            format!(
                "sheet '{}' was referenced by an object but never read -- fsio must read every referenced sheet before build_atlas runs",
                source.sheet
            )
        })?;
        let (w, h, rgba) =
            decode_rgba8(bytes).map_err(|e| format!("sheet '{}': {e}", source.sheet))?;
        decoded.insert(source.sheet.as_str(), (w, h, rgba));
    }

    let mut page_buffers: Vec<Vec<u8>> = result
        .pages
        .iter()
        .map(|p| vec![0u8; p.width as usize * p.height as usize * 4])
        .collect();

    for (source, placement) in &result.placements {
        let (sheet_w, sheet_h, sheet_rgba) = decoded
            .get(source.sheet.as_str())
            .expect("every placement's sheet was decoded above");
        let page = &result.pages[placement.page as usize];
        let crop = SourceCrop {
            sheet_width: *sheet_w,
            sheet_height: *sheet_h,
            sheet_rgba,
            x: source.x,
            y: source.y,
            w: source.w,
            h: source.h,
        };
        composite_with_extrusion(
            &mut page_buffers[placement.page as usize],
            page.width,
            &crop,
            placement.x,
            placement.y,
        );
    }

    // Filenames are content-hashed over pixels, never PNG bytes (Tim's
    // direction) -- computed before encoding so re-encoding never changes
    // a page's own name.
    let mut pages = Vec::with_capacity(result.pages.len());
    let mut page_bytes = Vec::with_capacity(result.pages.len());
    for (i, meta) in result.pages.iter().enumerate() {
        let hash = &sha256_hex(&page_buffers[i])[..DEFS_VERSION_LEN];
        let file = format!("{}-{hash}.png", meta.group);
        let bytes = encode_rgba8(meta.width, meta.height, &page_buffers[i])
            .map_err(|e| format!("page '{file}': {e}"))?;
        pages.push(AtlasPageDef {
            file,
            group: meta.group.clone(),
            width: meta.width,
            height: meta.height,
        });
        page_bytes.push(bytes);
    }

    let mut atlas_by_object_id = BTreeMap::new();
    for o in objects {
        let key = sprite_key(o);
        let placement = result
            .placements
            .get(&key)
            .expect("every object's sprite rect was packed above");
        atlas_by_object_id.insert(
            o.id,
            AtlasRect {
                page: placement.page,
                x: placement.x,
                y: placement.y,
                w: o.sprite.w,
                h: o.sprite.h,
            },
        );
    }

    Ok(AtlasBuildOutput {
        pages,
        page_bytes,
        atlas_by_object_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SpriteRect;

    fn tiny_png(width: u32, height: u32, px: [u8; 4]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width * height) {
            rgba.extend_from_slice(&px);
        }
        encode_rgba8(width, height, &rgba).unwrap()
    }

    fn object(id: u32, key: &str, sheet: &str, w: u32, h: u32) -> ObjectDef {
        ObjectDef {
            id,
            key: key.to_string(),
            name: key.to_string(),
            layer: 2,
            sprite: SpriteRect {
                sheet: sheet.to_string(),
                x: 0,
                y: 0,
                w,
                h,
            },
            width: 1,
            height: 1,
            collider: None,
            interact_at: None,
            window: false,
            tags: vec![],
        }
    }

    const CITY_PROPS: &str = "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/lamp.png";
    const CAMPING: &str = "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/bin.png";

    /// Every test below wants `city_props`/`camping` to stay their own,
    /// distinct page groups (this crate's own [`resolve_page_group`]
    /// requires a row for every theme actually used) -- the merged-group
    /// tests build their own table instead.
    fn identity_page_groups() -> BTreeMap<String, String> {
        [
            ("city_props".to_string(), "city_props".to_string()),
            ("camping".to_string(), "camping".to_string()),
        ]
        .into_iter()
        .collect()
    }

    #[test]
    fn empty_objects_produce_no_pages() {
        let out = build_atlas(&[], &BTreeMap::new(), &BTreeMap::new()).unwrap();
        assert!(out.pages.is_empty());
        assert!(out.atlas_by_object_id.is_empty());
    }

    #[test]
    fn every_object_gets_an_atlas_rect_and_pages_are_grouped_by_theme() {
        let objects = vec![
            object(1, "lamp", CITY_PROPS, 16, 16),
            object(2, "bin", CAMPING, 16, 16),
        ];
        let mut bytes = BTreeMap::new();
        bytes.insert(CITY_PROPS.to_string(), tiny_png(16, 16, [1, 2, 3, 255]));
        bytes.insert(CAMPING.to_string(), tiny_png(16, 16, [4, 5, 6, 255]));

        let out = build_atlas(&objects, &bytes, &identity_page_groups()).unwrap();
        assert_eq!(out.pages.len(), 2, "two distinct page groups, two pages");
        assert_eq!(out.atlas_by_object_id.len(), 2);
        let r1 = out.atlas_by_object_id[&1];
        let r2 = out.atlas_by_object_id[&2];
        assert_ne!(r1.page, r2.page);
        assert_eq!((r1.w, r1.h), (16, 16));
    }

    #[test]
    fn a_theme_with_no_page_group_row_fails_naming_it() {
        let objects = vec![object(1, "lamp", CITY_PROPS, 16, 16)];
        let mut bytes = BTreeMap::new();
        bytes.insert(CITY_PROPS.to_string(), tiny_png(16, 16, [1, 2, 3, 255]));
        let err = build_atlas(&objects, &bytes, &BTreeMap::new()).unwrap_err();
        assert!(err.contains("city_props"), "{err}");
    }

    /// NFR12: a scene never binds more than the shared group plus one
    /// themed group at once, so nine single-page themed groups sitting
    /// beside a one-page shared group never trips the cap -- only the
    /// *worst* other group counts, never their sum.
    #[test]
    fn nine_single_page_themed_groups_beside_a_one_page_shared_group_pass() {
        let mut pages = vec![PageMeta {
            group: crate::model::ATLAS_SHARED_GROUP.to_string(),
            width: 2048,
            height: 16,
        }];
        for i in 0..9 {
            pages.push(PageMeta {
                group: format!("theme{i}"),
                width: 2048,
                height: 16,
            });
        }
        assert!(check_max_bound_pages(&pages).is_ok());
    }

    /// NFR12: a two-page shared group beside a two-page themed group (the
    /// worst either can be, `ATLAS_MAX_PAGES_PER_GROUP`) still passes
    /// (2 + 2 = 4 <= 8); this is `check_max_bound_pages` tested directly
    /// against a hand-built page list, past the per-group cap that would
    /// otherwise make a themed group large enough to trip it
    /// unreachable through `pack_all` itself -- naming both groups and
    /// their own counts once the sum does exceed the cap.
    #[test]
    fn a_two_page_shared_group_and_a_seven_page_themed_group_fails_naming_both() {
        let mut pages = vec![
            PageMeta {
                group: crate::model::ATLAS_SHARED_GROUP.to_string(),
                width: 2048,
                height: 16,
            },
            PageMeta {
                group: crate::model::ATLAS_SHARED_GROUP.to_string(),
                width: 2048,
                height: 16,
            },
        ];
        for _ in 0..7 {
            pages.push(PageMeta {
                group: "kitchen".to_string(),
                width: 2048,
                height: 16,
            });
        }
        let err = check_max_bound_pages(&pages).unwrap_err();
        assert!(err.contains(crate::model::ATLAS_SHARED_GROUP), "{err}");
        assert!(err.contains("kitchen"), "{err}");
        assert!(err.contains('9'), "{err}");
    }

    #[test]
    fn two_themes_mapped_to_the_same_page_group_share_pages() {
        let objects = vec![
            object(1, "lamp", CITY_PROPS, 16, 16),
            object(2, "bin", CAMPING, 16, 16),
        ];
        let mut bytes = BTreeMap::new();
        bytes.insert(CITY_PROPS.to_string(), tiny_png(16, 16, [1, 2, 3, 255]));
        bytes.insert(CAMPING.to_string(), tiny_png(16, 16, [4, 5, 6, 255]));
        let street: BTreeMap<String, String> = [
            ("city_props".to_string(), "street".to_string()),
            ("camping".to_string(), "street".to_string()),
        ]
        .into_iter()
        .collect();

        let out = build_atlas(&objects, &bytes, &street).unwrap();
        assert_eq!(out.pages.len(), 1, "merged themes share one page group");
        assert_eq!(out.pages[0].group, "street");
        let r1 = out.atlas_by_object_id[&1];
        let r2 = out.atlas_by_object_id[&2];
        assert_eq!(r1.page, r2.page);
    }

    #[test]
    fn page_filenames_are_content_hashed_and_deterministic() {
        let objects = vec![object(1, "lamp", CITY_PROPS, 16, 16)];
        let mut bytes = BTreeMap::new();
        bytes.insert(CITY_PROPS.to_string(), tiny_png(16, 16, [9, 9, 9, 255]));

        let out_a = build_atlas(&objects, &bytes, &identity_page_groups()).unwrap();
        let out_b = build_atlas(&objects, &bytes, &identity_page_groups()).unwrap();
        assert_eq!(out_a.pages[0].file, out_b.pages[0].file);
        assert!(out_a.pages[0].file.starts_with("city_props-"));
    }

    #[test]
    fn changing_one_groups_pixels_never_renames_another_groups_page() {
        let objects = vec![
            object(1, "lamp", CITY_PROPS, 16, 16),
            object(2, "bin", CAMPING, 16, 16),
        ];
        let mut bytes_a = BTreeMap::new();
        bytes_a.insert(CITY_PROPS.to_string(), tiny_png(16, 16, [1, 1, 1, 255]));
        bytes_a.insert(CAMPING.to_string(), tiny_png(16, 16, [2, 2, 2, 255]));
        let out_a = build_atlas(&objects, &bytes_a, &identity_page_groups()).unwrap();

        let mut bytes_b = bytes_a.clone();
        bytes_b.insert(CITY_PROPS.to_string(), tiny_png(16, 16, [99, 99, 99, 255]));
        let out_b = build_atlas(&objects, &bytes_b, &identity_page_groups()).unwrap();

        let camping_a = out_a.pages.iter().find(|p| p.group == "camping").unwrap();
        let camping_b = out_b.pages.iter().find(|p| p.group == "camping").unwrap();
        assert_eq!(
            camping_a.file, camping_b.file,
            "unrelated group's page must not be renamed"
        );

        let props_a = out_a
            .pages
            .iter()
            .find(|p| p.group == "city_props")
            .unwrap();
        let props_b = out_b
            .pages
            .iter()
            .find(|p| p.group == "city_props")
            .unwrap();
        assert_ne!(
            props_a.file, props_b.file,
            "changed group's page must be renamed"
        );
    }

    #[test]
    fn a_sheet_path_with_no_theme_sorter_segment_fails_naming_it() {
        let objects = vec![object(1, "x", "ModernTileset/Palettes/x.png", 16, 16)];
        let err = build_atlas(&objects, &BTreeMap::new(), &BTreeMap::new()).unwrap_err();
        assert!(err.contains("ModernTileset/Palettes/x.png"), "{err}");
    }

    /// A programming-invariant failure (the binary's own edge always
    /// reads every sheet an object references first) -- reported the same
    /// way as every other atlas failure, never a panic.
    #[test]
    fn a_referenced_sheet_missing_from_sheet_bytes_is_a_named_error() {
        let objects = vec![object(1, "lamp", CITY_PROPS, 16, 16)];
        let err = build_atlas(&objects, &BTreeMap::new(), &identity_page_groups()).unwrap_err();
        assert!(err.contains(CITY_PROPS), "{err}");
        assert!(err.contains("never read"), "{err}");
    }

    #[test]
    fn atlas_pixel_round_trips_through_the_page_exactly() {
        let objects = vec![object(1, "lamp", CITY_PROPS, 2, 2)];
        let sheet_rgba = vec![
            10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
        ];
        let sheet_bytes = encode_rgba8(2, 2, &sheet_rgba).unwrap();
        let mut bytes = BTreeMap::new();
        bytes.insert(CITY_PROPS.to_string(), sheet_bytes);

        let out = build_atlas(&objects, &bytes, &identity_page_groups()).unwrap();
        let rect = out.atlas_by_object_id[&1];
        let (pw, ph, page_rgba) = decode_rgba8(&out.page_bytes[rect.page as usize]).unwrap();
        assert!(rect.x + rect.w <= pw && rect.y + rect.h <= ph);
        for row in 0..rect.h {
            for col in 0..rect.w {
                let page_i = ((rect.y + row) * pw + (rect.x + col)) as usize * 4;
                let src_i = (row * 2 + col) as usize * 4;
                assert_eq!(
                    &page_rgba[page_i..page_i + 4],
                    &sheet_rgba[src_i..src_i + 4],
                    "pixel ({col},{row}) mismatch"
                );
            }
        }
    }
}

//! Story 2.7: packs every declared character part -- all five kinds
//! (`body`/`eyes`/`hairstyle`/`outfit`/`accessory`), every pool
//! (`defs/appearance/` is already the curated used subset, Artie's
//! direction: there is no wider "every vendor variant" set to filter down
//! from here) -- into its own family's compact strip, then hands the
//! result to the exact same [`crate::atlas::pack::pack_all`]/
//! [`crate::atlas::image::composite_with_extrusion`] pipeline
//! `atlas::build::build_atlas` already uses for props (Quentin's
//! direction: reuse the packer, never a parallel one). A part's own strip
//! is PNG-encoded and folded into the same `sheet_bytes` map props
//! already decode from, under a synthetic key ([`virtual_sheet_key`]) no
//! real `ModernTileset/` sheet path can ever collide with.
//!
//! The strip layout mirrors `client/src/render/appearance/frame-rect.ts`'s
//! `sourceFrameRect`/`compositeCellRect`/`compositeSheetSize` exactly: this
//! is the "vendor-grid math... moves to the build" Tim's direction asks
//! for, so the client crops a packed part page by nothing more than the
//! part's own `atlas` rect plus that same compact-strip cell math.

use std::collections::BTreeMap;

use crate::atlas::image::{decode_rgba8, encode_rgba8};
use crate::atlas::pack::{PackItem, SourceKey};
use crate::model::{
    AccessoryDef, AppearanceLayoutDef, BodyDef, CHARACTER_GROUP_PREFIX, EyesDef, Family,
    HairstyleDef, OutfitDef,
};

/// One part this story packs: its own kind (for error messages and its
/// own page group), key, family and sheet path -- gathered from every one
/// of the five `Defs` slices so the strip-building/packing logic below
/// runs once, generically, rather than five times by copy-paste.
#[derive(Debug, Clone)]
pub struct CharacterPartSource {
    pub kind: &'static str,
    pub key: String,
    pub family: Family,
    pub sheet: String,
}

/// This part kind's own page group -- `character_body`, `character_eyes`,
/// ... (Tim's direction: both families of one kind share one group).
pub fn character_group(kind: &str) -> String {
    format!("{CHARACTER_GROUP_PREFIX}{kind}")
}

/// Every declared part, gathered from the five validated `Defs` slices --
/// the caller (`atlas::build::build_atlas`) passes `defs.bodies`,
/// `defs.eyes`, etc. straight through.
pub fn collect_character_parts(
    bodies: &[BodyDef],
    eyes: &[EyesDef],
    hairstyles: &[HairstyleDef],
    outfits: &[OutfitDef],
    accessories: &[AccessoryDef],
) -> Vec<CharacterPartSource> {
    let mut out = Vec::with_capacity(
        bodies.len() + eyes.len() + hairstyles.len() + outfits.len() + accessories.len(),
    );
    for b in bodies {
        out.push(CharacterPartSource {
            kind: "body",
            key: b.key.clone(),
            family: b.family,
            sheet: b.sheet.clone(),
        });
    }
    for e in eyes {
        out.push(CharacterPartSource {
            kind: "eyes",
            key: e.key.clone(),
            family: e.family,
            sheet: e.sheet.clone(),
        });
    }
    for h in hairstyles {
        out.push(CharacterPartSource {
            kind: "hairstyle",
            key: h.key.clone(),
            family: h.family,
            sheet: h.sheet.clone(),
        });
    }
    for o in outfits {
        out.push(CharacterPartSource {
            kind: "outfit",
            key: o.key.clone(),
            family: o.family,
            sheet: o.sheet.clone(),
        });
    }
    for a in accessories {
        out.push(CharacterPartSource {
            kind: "accessory",
            key: a.key.clone(),
            family: a.family,
            sheet: a.sheet.clone(),
        });
    }
    out
}

fn layout_for_family(
    layouts: &[AppearanceLayoutDef],
    family: Family,
) -> Option<&AppearanceLayoutDef> {
    layouts.iter().find(|l| l.family == family)
}

/// The compact strip's own total size -- mirrors `client/src/render/
/// appearance/frame-rect.ts`'s `compositeSheetSize` field for field (Tim's
/// direction: the two must never drift, since the client crops this same
/// strip by that same math at composite time).
pub fn strip_size(layout: &AppearanceLayoutDef) -> (u32, u32) {
    let width = layout
        .rows
        .iter()
        .map(|r| r.frames_per_direction * layout.directions.len() as u32 * layout.cell_width)
        .max()
        .unwrap_or(0);
    let height = layout.rows.len() as u32 * layout.cell_height;
    (width, height)
}

fn get_px(rgba: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
    let i = (y as usize * width as usize + x as usize) * 4;
    [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]]
}

fn set_px(rgba: &mut [u8], width: u32, x: u32, y: u32, px: [u8; 4]) {
    let i = (y as usize * width as usize + x as usize) * 4;
    rgba[i..i + 4].copy_from_slice(&px);
}

/// Builds `part`'s own compact strip (AC1): every row `layout.rows`
/// declares (in *declaration* order for the destination -- never the
/// sheet's own `row` field, which only ever addresses the *source*),
/// every direction in `layout.directions`' own declared order, every
/// frame -- cropped from `part`'s already-decoded sheet at exactly the
/// cell the client's own `sourceFrameRect` would read, placed at exactly
/// the cell the client's own `compositeCellRect` would place it.
///
/// Failures here name `part.kind`/`part.key`/`part.sheet` (Quentin's
/// direction):
///  - AC1(b): a declared cell reaching past the *decoded* sheet's own
///    bounds -- the case a header-only `accepted_sizes` check cannot see
///    (a corrupt/truncated PNG whose `IHDR` still claims an accepted
///    size but whose real raster is smaller).
///  - AC1(d): the packed strip is never fully transparent; a `body`
///    strip's own every cell has at least one non-transparent pixel (a
///    body exists in every frame -- the cheap pixel-level proof the grid
///    really is the grid, Tim's direction).
fn build_strip(
    part: &CharacterPartSource,
    layout: &AppearanceLayoutDef,
    decoded_w: u32,
    decoded_h: u32,
    decoded_rgba: &[u8],
) -> Result<(u32, u32, Vec<u8>), String> {
    let (strip_w, strip_h) = strip_size(layout);
    let mut strip = vec![0u8; strip_w as usize * strip_h as usize * 4];

    for (row_index, row) in layout.rows.iter().enumerate() {
        for dir_index in 0..layout.directions.len() {
            for frame in 0..row.frames_per_direction {
                let column = dir_index as u32 * row.frames_per_direction + frame;
                let src_x = column * layout.cell_width;
                let src_y = row.row * layout.cell_height;
                let dst_x = column * layout.cell_width;
                let dst_y = row_index as u32 * layout.cell_height;
                if src_x + layout.cell_width > decoded_w || src_y + layout.cell_height > decoded_h {
                    return Err(format!(
                        "{} '{}' sheet '{}': declared cell at ({src_x},{src_y}) {}x{}px does not fit inside the decoded sheet ({decoded_w}x{decoded_h}px)",
                        part.kind, part.key, part.sheet, layout.cell_width, layout.cell_height
                    ));
                }
                for y in 0..layout.cell_height {
                    for x in 0..layout.cell_width {
                        let px = get_px(decoded_rgba, decoded_w, src_x + x, src_y + y);
                        set_px(&mut strip, strip_w, dst_x + x, dst_y + y, px);
                    }
                }
            }
        }
    }

    let any_opaque = strip.as_chunks::<4>().0.iter().any(|px| px[3] != 0);
    if !any_opaque {
        return Err(format!(
            "{} '{}' sheet '{}': packed strip is fully transparent -- every declared cell decoded to alpha 0",
            part.kind, part.key, part.sheet
        ));
    }

    if part.kind == "body" {
        for (row_index, row) in layout.rows.iter().enumerate() {
            for dir_index in 0..layout.directions.len() {
                for frame in 0..row.frames_per_direction {
                    let column = dir_index as u32 * row.frames_per_direction + frame;
                    let cx = column * layout.cell_width;
                    let cy = row_index as u32 * layout.cell_height;
                    let mut has_opaque = false;
                    'cell: for y in 0..layout.cell_height {
                        for x in 0..layout.cell_width {
                            if get_px(&strip, strip_w, cx + x, cy + y)[3] != 0 {
                                has_opaque = true;
                                break 'cell;
                            }
                        }
                    }
                    if !has_opaque {
                        return Err(format!(
                            "body '{}' sheet '{}': cell (row {row_index}, direction {dir_index}, frame {frame}) is fully transparent -- a body must be visible in every frame",
                            part.key, part.sheet
                        ));
                    }
                }
            }
        }
    }

    Ok((strip_w, strip_h, strip))
}

/// This part kind's own synthetic sheet key -- distinct from every real
/// `ModernTileset/` path (the `character-strip://` scheme no real sheet
/// path ever uses), so the strip's PNG bytes can be folded into the same
/// `sheet_bytes` map `atlas::build::build_atlas` already decodes real
/// sheets from, and packed through the exact same code.
pub fn virtual_sheet_key(kind: &str, key: &str) -> String {
    format!("character-strip://{kind}/{key}")
}

/// [`build_character_pack_items`]'s own result: one [`PackItem`] per part
/// (same order as the `parts` slice it was given, so a caller can zip the
/// two back together) plus every strip's own PNG-encoded bytes, keyed by
/// [`virtual_sheet_key`] -- ready to fold into the `sheet_bytes` map the
/// packer decodes from.
#[derive(Debug)]
pub struct CharacterPackItems {
    pub items: Vec<PackItem>,
    pub extra_sheet_bytes: BTreeMap<String, Vec<u8>>,
}

/// Builds every character part's own compact strip -- see
/// [`CharacterPackItems`].
pub fn build_character_pack_items(
    parts: &[CharacterPartSource],
    sheet_bytes: &BTreeMap<String, Vec<u8>>,
    layouts: &[AppearanceLayoutDef],
) -> Result<CharacterPackItems, String> {
    let mut items = Vec::with_capacity(parts.len());
    let mut extra_sheet_bytes = BTreeMap::new();
    // Decode each real sheet at most once, even though no two parts ever
    // share one today -- mirrors `atlas::build::build_atlas`'s own
    // single-decode-per-sheet discipline.
    let mut decoded: BTreeMap<&str, (u32, u32, Vec<u8>)> = BTreeMap::new();
    // AC1(c): every part in one family must resolve to the same strip
    // size -- trivially true today (the size depends only on the shared
    // layout), asserted anyway so the packer refuses the odd one out by
    // key rather than trusting every part resolved the same layout
    // (Tim's direction).
    let mut expected_strip_size: BTreeMap<Family, (u32, u32)> = BTreeMap::new();

    for part in parts {
        let layout = layout_for_family(layouts, part.family).ok_or_else(|| {
            format!(
                "{} '{}' declares family '{}' but no [[appearance_layout]] entry declares that family",
                part.kind,
                part.key,
                part.family.as_str()
            )
        })?;

        let (strip_w, strip_h) = strip_size(layout);
        match expected_strip_size.get(&part.family) {
            Some(&(ew, eh)) if (ew, eh) != (strip_w, strip_h) => {
                return Err(format!(
                    "{} '{}' family '{}' strip is {strip_w}x{strip_h}px but another part in the same family already packed to {ew}x{eh}px -- every part in a family must resolve to the same layout",
                    part.kind,
                    part.key,
                    part.family.as_str()
                ));
            }
            _ => {
                expected_strip_size.insert(part.family, (strip_w, strip_h));
            }
        }

        if !decoded.contains_key(part.sheet.as_str()) {
            let bytes = sheet_bytes.get(&part.sheet).ok_or_else(|| {
                format!(
                    "{} '{}' names sheet '{}' but it was never read -- fsio must read every appearance part's own sheet before the character atlas is built",
                    part.kind, part.key, part.sheet
                )
            })?;
            let (w, h, rgba) = decode_rgba8(bytes)
                .map_err(|e| format!("{} '{}' sheet '{}': {e}", part.kind, part.key, part.sheet))?;
            decoded.insert(part.sheet.as_str(), (w, h, rgba));
        }
        let (w, h, rgba) = decoded
            .get(part.sheet.as_str())
            .expect("just inserted above");

        let (strip_w, strip_h, strip_rgba) = build_strip(part, layout, *w, *h, rgba)?;

        let virtual_key = virtual_sheet_key(part.kind, &part.key);
        let png = encode_rgba8(strip_w, strip_h, &strip_rgba).map_err(|e| {
            format!(
                "{} '{}': failed to encode packed strip: {e}",
                part.kind, part.key
            )
        })?;
        extra_sheet_bytes.insert(virtual_key.clone(), png);

        items.push(PackItem {
            group: character_group(part.kind),
            source: SourceKey {
                sheet: virtual_key,
                x: 0,
                y: 0,
                w: strip_w,
                h: strip_h,
            },
            sort_key: part.key.clone(),
        });
    }

    Ok(CharacterPackItems {
        items,
        extra_sheet_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::AppearanceLayoutRowDef;

    fn layout(
        family: Family,
        cell_width: u32,
        cell_height: u32,
        directions: &[&str],
        rows: &[(&str, u32, u32)],
    ) -> AppearanceLayoutDef {
        AppearanceLayoutDef {
            id: 1,
            key: format!("{}-layout", family.as_str()),
            family,
            cell_width,
            cell_height,
            directions: directions.iter().map(|s| s.to_string()).collect(),
            rows: rows
                .iter()
                .map(
                    |(animation, row, frames_per_direction)| AppearanceLayoutRowDef {
                        animation: animation.to_string(),
                        row: *row,
                        frames_per_direction: *frames_per_direction,
                    },
                )
                .collect(),
            accepted_sizes: vec![],
        }
    }

    fn one_direction_one_frame_layout(family: Family) -> AppearanceLayoutDef {
        layout(family, 16, 32, &["down"], &[("idle", 0, 1)])
    }

    fn solid_sheet(width: u32, height: u32, px: [u8; 4]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width * height) {
            rgba.extend_from_slice(&px);
        }
        encode_rgba8(width, height, &rgba).unwrap()
    }

    fn part(kind: &'static str, key: &str, family: Family, sheet: &str) -> CharacterPartSource {
        CharacterPartSource {
            kind,
            key: key.to_string(),
            family,
            sheet: sheet.to_string(),
        }
    }

    #[test]
    fn strip_size_matches_the_layouts_own_declared_grid() {
        let l = layout(
            Family::Adult,
            16,
            32,
            &["right", "up", "left", "down"],
            &[("idle", 1, 6), ("walk", 2, 6)],
        );
        assert_eq!(strip_size(&l), (24 * 16, 2 * 32));
    }

    #[test]
    fn every_declared_kind_packs_when_its_sheet_fits_the_layout() {
        let l = one_direction_one_frame_layout(Family::Adult);
        for kind in ["body", "eyes", "hairstyle", "outfit", "accessory"] {
            let p = part(kind, &format!("{kind}_test"), Family::Adult, "sheet.png");
            let mut bytes = BTreeMap::new();
            bytes.insert("sheet.png".to_string(), solid_sheet(16, 32, [1, 2, 3, 255]));
            let pack = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap();
            let (items, extra) = (pack.items, pack.extra_sheet_bytes);
            assert_eq!(items.len(), 1);
            assert_eq!(items[0].group, character_group(kind));
            assert_eq!(extra.len(), 1);
        }
    }

    #[test]
    fn a_part_naming_a_family_with_no_layout_is_named() {
        let p = part("body", "body_01", Family::Kid, "sheet.png");
        let mut bytes = BTreeMap::new();
        bytes.insert("sheet.png".to_string(), solid_sheet(16, 32, [1, 2, 3, 255]));
        let l = one_direction_one_frame_layout(Family::Adult);
        let err = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap_err();
        assert!(err.contains("body"), "{err}");
        assert!(err.contains("body_01"), "{err}");
        assert!(err.contains("kid"), "{err}");
    }

    #[test]
    fn a_part_naming_a_sheet_never_read_is_named() {
        let p = part("eyes", "eyes_01", Family::Adult, "missing.png");
        let l = one_direction_one_frame_layout(Family::Adult);
        let err = build_character_pack_items(&[p], &BTreeMap::new(), std::slice::from_ref(&l))
            .unwrap_err();
        assert!(err.contains("eyes"), "{err}");
        assert!(err.contains("eyes_01"), "{err}");
        assert!(err.contains("missing.png"), "{err}");
        assert!(err.contains("never read"), "{err}");
    }

    /// AC1(b): the case a header/size-only check cannot see -- the sheet's
    /// declared/accepted size is fine, but the *real decoded* raster is too
    /// small for the layout's own declared cell grid.
    #[test]
    fn a_declared_cell_reaching_past_the_decoded_sheet_is_named() {
        let p = part("hairstyle", "hair_01", Family::Adult, "sheet.png");
        let mut bytes = BTreeMap::new();
        // Layout needs a 16x32 cell at (0,0); this sheet only decodes to
        // 16x16 -- smaller than the declared cell, even though nothing
        // about its own byte length lied about that.
        bytes.insert("sheet.png".to_string(), solid_sheet(16, 16, [1, 2, 3, 255]));
        let l = one_direction_one_frame_layout(Family::Adult);
        let err = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap_err();
        assert!(err.contains("hairstyle"), "{err}");
        assert!(err.contains("hair_01"), "{err}");
        assert!(err.contains("sheet.png"), "{err}");
        assert!(
            err.contains("does not fit inside the decoded sheet"),
            "{err}"
        );
    }

    #[test]
    fn a_fully_transparent_strip_is_named() {
        let p = part("outfit", "outfit_01", Family::Adult, "sheet.png");
        let mut bytes = BTreeMap::new();
        bytes.insert("sheet.png".to_string(), solid_sheet(16, 32, [0, 0, 0, 0]));
        let l = one_direction_one_frame_layout(Family::Adult);
        let err = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap_err();
        assert!(err.contains("outfit"), "{err}");
        assert!(err.contains("outfit_01"), "{err}");
        assert!(err.contains("fully transparent"), "{err}");
    }

    #[test]
    fn a_body_with_an_empty_cell_is_named() {
        let l = layout(Family::Adult, 16, 32, &["down", "up"], &[("idle", 0, 1)]);
        // A 32x32 sheet: the "down" cell (column 0) opaque, the "up" cell
        // (column 1) fully transparent -- a body must be visible in every
        // frame, even though the strip as a whole is not fully
        // transparent (the fully-transparent-strip check alone would miss
        // this).
        let mut rgba = vec![0u8; 32 * 32 * 4];
        for y in 0..32 {
            for x in 0..16 {
                let i = (y * 32 + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[9, 9, 9, 255]);
            }
        }
        let sheet_bytes = encode_rgba8(32, 32, &rgba).unwrap();
        let mut bytes = BTreeMap::new();
        bytes.insert("sheet.png".to_string(), sheet_bytes);
        let p = part("body", "body_01", Family::Adult, "sheet.png");
        let err = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap_err();
        assert!(err.contains("body_01"), "{err}");
        assert!(err.contains("fully transparent"), "{err}");
    }

    /// AC1(a) in this story's own layout: every eyes/outfit/hairstyle/
    /// accessory kind is checked exactly the same way as body, just
    /// without the per-cell-opacity rule -- one failing case per kind,
    /// named with the kind, key and sheet (Quentin's direction).
    #[test]
    fn every_non_body_kind_still_names_itself_on_a_decode_bounds_failure() {
        let l = one_direction_one_frame_layout(Family::Adult);
        for kind in ["eyes", "hairstyle", "outfit", "accessory"] {
            let p = part(kind, &format!("{kind}_01"), Family::Adult, "sheet.png");
            let mut bytes = BTreeMap::new();
            bytes.insert("sheet.png".to_string(), solid_sheet(8, 8, [1, 2, 3, 255]));
            let err =
                build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap_err();
            assert!(err.contains(kind), "{err}");
            assert!(err.contains(&format!("{kind}_01")), "{err}");
            assert!(err.contains("sheet.png"), "{err}");
        }
    }

    #[test]
    fn strips_pack_the_declared_cells_pixel_for_pixel() {
        let l = layout(Family::Adult, 2, 2, &["down", "up"], &[("idle", 0, 1)]);
        // 4x2 sheet: column 0 red, column 1 green (both rows), so "down"
        // (dir 0) reads column 0, "up" (dir 1) reads column 1.
        let rgba = vec![
            255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, //
            255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255,
        ];
        let sheet_bytes = encode_rgba8(4, 2, &rgba).unwrap();
        let mut bytes = BTreeMap::new();
        bytes.insert("sheet.png".to_string(), sheet_bytes);
        let p = part("body", "body_01", Family::Adult, "sheet.png");
        let pack = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap();
        let (items, extra) = (pack.items, pack.extra_sheet_bytes);
        let png = &extra[&items[0].source.sheet];
        let (w, h, strip) = decode_rgba8(png).unwrap();
        assert_eq!((w, h), (4, 2));
        // "down" cell at (0,0): red.
        assert_eq!(get_px(&strip, w, 0, 0), [255, 0, 0, 255]);
        // "up" cell at (2,0): green.
        assert_eq!(get_px(&strip, w, 2, 0), [0, 255, 0, 255]);
    }

    /// A real vendor sheet has more rows than the layout ever declares
    /// (idle/walk are two of many animation rows the generator sheet
    /// ships) -- only the declared rows are ever copied into the packed
    /// strip. Proven directly: a sheet whose *only* opaque pixels sit in
    /// an undeclared row (row 5, well past the layout's own idle/walk
    /// rows) must still pack to a fully transparent strip -- if an unused
    /// row leaked into the strip, this would fail the "never fully
    /// transparent" check with an unexpected pass instead.
    #[test]
    fn an_unused_row_never_reaches_the_packed_strip() {
        let l = layout(Family::Adult, 4, 4, &["down"], &[("idle", 0, 1)]);
        // 5 rows tall (0..=4); only row 0 is declared. Row 4 alone is
        // opaque.
        let mut rgba = vec![0u8; 4 * 20 * 4];
        for x in 0..4 {
            let i = (16 * 4 + x) * 4; // row 4 starts at pixel row 16
            rgba[i..i + 4].copy_from_slice(&[9, 9, 9, 255]);
        }
        let sheet_bytes = encode_rgba8(4, 20, &rgba).unwrap();
        let mut bytes = BTreeMap::new();
        bytes.insert("sheet.png".to_string(), sheet_bytes);
        let p = part("eyes", "eyes_01", Family::Adult, "sheet.png");
        let err = build_character_pack_items(&[p], &bytes, std::slice::from_ref(&l)).unwrap_err();
        assert!(
            err.contains("fully transparent"),
            "an unused row's opaque pixels must never reach the packed strip: {err}"
        );
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use crate::atlas::pack::pack_all;
    use crate::model::AppearanceLayoutRowDef;
    use proptest::prelude::*;

    fn solid_sheet(width: u32, height: u32, px: [u8; 4]) -> Vec<u8> {
        let mut rgba = Vec::with_capacity(width as usize * height as usize * 4);
        for _ in 0..(width * height) {
            rgba.extend_from_slice(&px);
        }
        encode_rgba8(width, height, &rgba).unwrap()
    }

    fn adult_layout() -> AppearanceLayoutDef {
        AppearanceLayoutDef {
            id: 1,
            key: "adult".to_string(),
            family: Family::Adult,
            cell_width: 2,
            cell_height: 2,
            directions: vec!["down".to_string(), "up".to_string()],
            rows: vec![AppearanceLayoutRowDef {
                animation: "idle".to_string(),
                row: 0,
                frames_per_direction: 1,
            }],
            accepted_sizes: vec![],
        }
    }

    fn kind_strategy() -> impl Strategy<Value = &'static str> {
        prop_oneof![
            Just("body"),
            Just("eyes"),
            Just("hairstyle"),
            Just("outfit"),
            Just("accessory"),
        ]
    }

    /// Up to 12 distinct parts, each its own kind/key/sheet, all one
    /// family -- shuffled and packed twice; Quentin's direction: packing
    /// must be deterministic and produce no overlap regardless of the
    /// part list's own order.
    fn parts_and_shuffle_strategy() -> impl Strategy<Value = (Vec<CharacterPartSource>, Vec<usize>)>
    {
        prop::collection::vec(kind_strategy(), 1..12).prop_flat_map(|kinds| {
            let parts: Vec<CharacterPartSource> = kinds
                .iter()
                .enumerate()
                .map(|(i, kind)| CharacterPartSource {
                    kind,
                    key: format!("{kind}-{i:04}"),
                    family: Family::Adult,
                    sheet: format!("sheet-{i}.png"),
                })
                .collect();
            let indices: Vec<usize> = (0..parts.len()).collect();
            Just(indices)
                .prop_shuffle()
                .prop_map(move |shuffled| (parts.clone(), shuffled))
        })
    }

    proptest! {
        #[test]
        fn packing_character_parts_is_deterministic_under_shuffling(
            (parts, shuffled_indices) in parts_and_shuffle_strategy()
        ) {
            let layout = adult_layout();
            let (strip_w, strip_h) = strip_size(&layout);
            let mut sheet_bytes = BTreeMap::new();
            for (i, part) in parts.iter().enumerate() {
                let px = [i as u8, i as u8, i as u8, 255];
                sheet_bytes.insert(part.sheet.clone(), solid_sheet(strip_w, strip_h, px));
            }
            let shuffled: Vec<CharacterPartSource> = shuffled_indices
                .iter()
                .map(|&i| parts[i].clone())
                .collect();

            let pack_a =
                build_character_pack_items(&parts, &sheet_bytes, std::slice::from_ref(&layout)).unwrap();
            let pack_b =
                build_character_pack_items(&shuffled, &sheet_bytes, std::slice::from_ref(&layout)).unwrap();

            let result_a = pack_all(&pack_a.items).unwrap();
            let result_b = pack_all(&pack_b.items).unwrap();
            prop_assert_eq!(result_a, result_b);
            prop_assert_eq!(pack_a.extra_sheet_bytes, pack_b.extra_sheet_bytes);
        }
    }
}

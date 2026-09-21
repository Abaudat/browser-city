//! Story 2.6, AC2: a page's group key is *derived* from a `sprite.sheet`
//! path's own theme-sorter directory segment -- never a hand-written list,
//! never a per-object field. Pure: a `String` in, a `String` (or a named
//! error) out.
//!
//! The derived theme is not itself the page group: `resolve_page_group`
//! maps it through `defs/atlas/page-groups.toml`'s own `theme -> group`
//! table (a street kit's own single-prop borrows from several theme
//! folders share one bound page set; a themed district keeps its own).
//! A theme with no row is a build error naming it -- never a silent
//! per-theme-folder default.

use std::collections::BTreeMap;

/// Whether a sheet's own theme-sorter root names a shadow variant --
/// Artie's direction: mixing `Shadowless` and `Black_Shadow` copies of the
/// same theme on one page looks like a collage, so [`check_shadow_variants`]
/// refuses it at build time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShadowVariant {
    /// The default, shadowed variant -- `Theme_Sorter`/`Theme_Sorter_Singles`
    /// with no `_Shadowless`/`_Black_Shadow` suffix.
    Default,
    Shadowless,
    BlackShadow,
}

fn is_theme_sorter_segment(segment: &str) -> bool {
    let lower = segment.to_ascii_lowercase();
    lower.starts_with("theme_sorter") || lower.ends_with("theme_sorter_16x16")
}

/// Story 2.13: a handful of sheet families the tileset ships outside any
/// `Theme_Sorter*` tree entirely -- a single flat folder, never a themed
/// subfolder to sort further into (unlike `Theme_Sorter_Singles/12_Kitchen_
/// Singles/...`, `Room_Builder_subfiles/` holds every modular room-building
/// sheet -- walls, floors -- directly). The folder segment itself is the
/// theme here, checked before the theme-sorter-root derivation below so a
/// path naming one of these never falls through to "no recognisable
/// theme-sorter segment".
fn flat_theme_segment(sheet: &str) -> Option<&'static str> {
    sheet.split('/').find_map(|segment| {
        if segment.eq_ignore_ascii_case("room_builder_subfiles") {
            Some("room_builder")
        } else {
            None
        }
    })
}

/// The theme-sorter root segment itself (e.g. `"Theme_Sorter_Black_Shadow_
/// Singles"`), the one segment [`is_theme_sorter_segment`] matched --
/// [`shadow_variant`] and [`theme_group`] both start from this so neither
/// can disagree about which segment they read.
fn theme_sorter_root(sheet: &str) -> Option<&str> {
    sheet.split('/').find(|s| is_theme_sorter_segment(s))
}

/// Which shadow variant a sheet's own theme-sorter root names -- `Default`
/// for a plain `Theme_Sorter`/`Theme_Sorter_Singles` root, or any path with
/// no theme-sorter root at all (interiors are the only family with
/// variants today; exteriors' `ME_Theme_Sorter_16x16` never carries one).
pub fn shadow_variant(sheet: &str) -> ShadowVariant {
    let Some(root) = theme_sorter_root(sheet) else {
        return ShadowVariant::Default;
    };
    let lower = root.to_ascii_lowercase();
    if lower.contains("black_shadow") {
        ShadowVariant::BlackShadow
    } else if lower.contains("shadowless") {
        ShadowVariant::Shadowless
    } else {
        ShadowVariant::Default
    }
}

/// Strips a leading `<digits>_` ordinal and a trailing `_singles_16x16`/
/// `_16x16`/`_singles` suffix (checked in that order, case-insensitively),
/// then lowercases what remains -- `"11_Camping_Singles_16x16"` ->
/// `"camping"`, `"12_Kitchen_Singles"` -> `"kitchen"`,
/// `"3_City_Props_Singles_16x16"` -> `"city_props"` (Tim's own worked
/// examples).
fn normalize_theme_segment(raw: &str) -> String {
    let lower = raw.to_ascii_lowercase();
    let no_ordinal = lower
        .trim_start_matches(|c: char| c.is_ascii_digit())
        .trim_start_matches('_');
    for suffix in ["_singles_16x16", "_16x16", "_singles"] {
        if let Some(stripped) = no_ordinal.strip_suffix(suffix) {
            return stripped.to_string();
        }
    }
    no_ordinal.to_string()
}

/// Derives a `sprite.sheet` path's page group: the tileset's own
/// theme-sorter directory segment, normalised (Tim's direction, AC2). A
/// sheet path with no recognisable theme-sorter segment is a build error
/// naming the path -- never a silent default group.
pub fn theme_group(sheet: &str) -> Result<String, String> {
    if let Some(theme) = flat_theme_segment(sheet) {
        return Ok(theme.to_string());
    }
    let segments: Vec<&str> = sheet.split('/').collect();
    let idx = segments.iter().position(|s| is_theme_sorter_segment(s));
    match idx {
        Some(i) if i + 1 < segments.len() => {
            let normalized = normalize_theme_segment(segments[i + 1]);
            if normalized.is_empty() {
                Err(format!(
                    "sheet path '{sheet}' has no recognisable theme-sorter segment"
                ))
            } else {
                Ok(normalized)
            }
        }
        _ => Err(format!(
            "sheet path '{sheet}' has no recognisable theme-sorter segment"
        )),
    }
}

/// Maps a derived theme (`theme_group`'s own output) to the page group it
/// actually shares, via `defs/atlas/page-groups.toml`'s table -- a theme
/// absent from it is a build error naming the theme, never a silent
/// fallback to the theme itself.
pub fn resolve_page_group(theme: &str, table: &BTreeMap<String, String>) -> Result<String, String> {
    table.get(theme).cloned().ok_or_else(|| {
        format!(
            "theme '{theme}' has no row in defs/atlas/page-groups.toml -- add one naming the page group it shares"
        )
    })
}

/// AC2/Artie's direction: every sheet feeding one group must agree on
/// [`shadow_variant`] -- refuses naming the group and the two variants
/// found. `Default` never conflicts with itself; a group with only one
/// variant present (the common case) always passes.
pub fn check_shadow_variants(group: &str, sheets: &[String]) -> Result<(), String> {
    let mut found: Vec<ShadowVariant> = Vec::new();
    for sheet in sheets {
        let v = shadow_variant(sheet);
        if !found.contains(&v) {
            found.push(v);
        }
    }
    // `Default` mixed with a named variant, or two named variants, is the
    // collage Artie's direction refuses; `Default` alone is never a
    // conflict (most groups -- everything exterior -- only ever have it).
    let named: Vec<ShadowVariant> = found
        .iter()
        .copied()
        .filter(|v| *v != ShadowVariant::Default)
        .collect();
    if found.len() > 1 && !named.is_empty() {
        return Err(format!(
            "group '{group}' mixes shadow variants across its own sheets -- pick one of Theme_Sorter/_Shadowless/_Black_Shadow consistently"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_the_group_for_every_exterior_theme_sorter_dir_this_tileset_ships() {
        let cases = [
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/1_Terrains_and_Fences_Singles_16x16/x.png",
                "terrains_and_fences",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/2_City_Terrains_Singles_16x16/x.png",
                "city_terrains",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/x.png",
                "city_props",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/10_Vehicles_Singles_16x16/x.png",
                "vehicles",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16/x.png",
                "camping",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/13_School_Singles_16x16/x.png",
                "school",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/16_Office_Singles_16x16/x.png",
                "office",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/17_Garden_Singles_16x16/x.png",
                "garden",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/21_Beach_Singles_16x16/x.png",
                "beach",
            ),
            (
                "ModernTileset/modernexteriors-win/Modern_Exteriors_16x16/ME_Theme_Sorter_16x16/23_MIlitary_Base_Singles_16x16/x.png",
                "military_base",
            ),
        ];
        for (sheet, expected) in cases {
            assert_eq!(theme_group(sheet).as_deref(), Ok(expected), "{sheet}");
        }
    }

    #[test]
    fn derives_the_group_for_every_interior_theme_sorter_singles_dir_this_tileset_ships() {
        let cases = [
            (
                "ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/12_Kitchen_Singles/x.png",
                "kitchen",
            ),
            (
                "ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/19_Hospital_SIngles/x.png",
                "hospital",
            ),
            (
                "ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Singles/2_Living_Room_Singles/x.png",
                "living_room",
            ),
            (
                "ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Black_Shadow_Singles/12_Kitchen_Singles/x.png",
                "kitchen",
            ),
            (
                "ModernTileset/moderninteriors-win/1_Interiors/16x16/Theme_Sorter_Shadowless_Singles/12_Kitchen_Singles/x.png",
                "kitchen",
            ),
        ];
        for (sheet, expected) in cases {
            assert_eq!(theme_group(sheet).as_deref(), Ok(expected), "{sheet}");
        }
    }

    #[test]
    fn derives_the_room_builder_theme_for_a_flat_non_theme_sorter_folder() {
        assert_eq!(
            theme_group(
                "ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles/Room_Builder_Walls_16x16.png"
            )
            .as_deref(),
            Ok("room_builder")
        );
    }

    #[test]
    fn a_sheet_path_with_no_theme_sorter_segment_is_a_named_error() {
        let err = theme_group("ModernTileset/moderninteriors-win/Palettes/x.png").unwrap_err();
        assert!(
            err.contains("ModernTileset/moderninteriors-win/Palettes/x.png"),
            "{err}"
        );
    }

    #[test]
    fn a_theme_sorter_segment_with_nothing_after_it_is_a_named_error() {
        let err = theme_group("a/ME_Theme_Sorter_16x16").unwrap_err();
        assert!(err.contains("ME_Theme_Sorter_16x16"), "{err}");
    }

    #[test]
    fn shadow_variant_reads_the_theme_sorter_root_not_a_theme_name() {
        assert_eq!(
            shadow_variant("a/Theme_Sorter_Singles/12_Kitchen_Singles/x.png"),
            ShadowVariant::Default
        );
        assert_eq!(
            shadow_variant("a/Theme_Sorter_Black_Shadow_Singles/12_Kitchen_Singles/x.png"),
            ShadowVariant::BlackShadow
        );
        assert_eq!(
            shadow_variant("a/Theme_Sorter_Shadowless_Singles/12_Kitchen_Singles/x.png"),
            ShadowVariant::Shadowless
        );
        assert_eq!(
            shadow_variant("a/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16/x.png"),
            ShadowVariant::Default
        );
    }

    #[test]
    fn resolve_page_group_maps_a_known_theme() {
        let table: BTreeMap<String, String> = [("camping".to_string(), "street".to_string())]
            .into_iter()
            .collect();
        assert_eq!(
            resolve_page_group("camping", &table).as_deref(),
            Ok("street")
        );
    }

    #[test]
    fn resolve_page_group_fails_naming_an_unmapped_theme() {
        let table: BTreeMap<String, String> = BTreeMap::new();
        let err = resolve_page_group("kitchen", &table).unwrap_err();
        assert!(err.contains("kitchen"), "{err}");
    }

    #[test]
    fn check_shadow_variants_passes_a_group_with_only_one_variant() {
        let sheets = vec![
            "a/Theme_Sorter_Singles/12_Kitchen_Singles/1.png".to_string(),
            "a/Theme_Sorter_Singles/12_Kitchen_Singles/2.png".to_string(),
        ];
        assert!(check_shadow_variants("kitchen", &sheets).is_ok());
    }

    #[test]
    fn check_shadow_variants_refuses_a_mix_naming_the_group() {
        let sheets = vec![
            "a/Theme_Sorter_Singles/12_Kitchen_Singles/1.png".to_string(),
            "a/Theme_Sorter_Black_Shadow_Singles/12_Kitchen_Singles/2.png".to_string(),
        ];
        let err = check_shadow_variants("kitchen", &sheets).unwrap_err();
        assert!(err.contains("kitchen"), "{err}");
    }

    #[test]
    fn check_shadow_variants_refuses_two_named_variants_with_no_default() {
        let sheets = vec![
            "a/Theme_Sorter_Shadowless_Singles/12_Kitchen_Singles/1.png".to_string(),
            "a/Theme_Sorter_Black_Shadow_Singles/12_Kitchen_Singles/2.png".to_string(),
        ];
        assert!(check_shadow_variants("kitchen", &sheets).is_err());
    }
}

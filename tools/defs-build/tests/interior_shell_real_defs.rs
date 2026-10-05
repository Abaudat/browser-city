//! Story 2.14: the interior shell (`Room_Builder_subfiles/`) rides the
//! atlas packer. Both tests run against the real `defs/` tree and the real
//! `ModernTileset/` sheets.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::build::{build_atlas, check_max_bound_pages, scene_page_budget};
use defs_build::atlas::character::collect_character_parts;
use defs_build::atlas::image::decode_rgba8;
use defs_build::atlas::pack::PageMeta;
use defs_build::atlas::theme::{resolve_page_group, theme_group};
use defs_build::{
    appearance_sheet_paths, codes, fsio, model, object_sprite_sheet_paths, parse, validate,
};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn real_page_groups() -> BTreeMap<String, String> {
    let root = repo_root();
    let mut text_files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    text_files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&text_files).unwrap();
    validate::validate_page_groups(&raw).unwrap()
}

/// Every PNG actually present in the vendor `Room_Builder_subfiles/`
/// folder resolves to a page group -- a sheet added or renamed there is
/// caught here, not by a reviewer.
#[test]
fn every_real_room_builder_sheet_resolves_to_a_page_group() {
    let root = repo_root();
    let dir = root.join("ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles");
    let groups = real_page_groups();
    let mut seen = 0;
    for entry in std::fs::read_dir(&dir).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("png") {
            continue;
        }
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        let sheet = format!(
            "ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles/{name}"
        );
        let theme = theme_group(&sheet).unwrap_or_else(|e| panic!("{sheet}: {e}"));
        let group = resolve_page_group(&theme, &groups).unwrap_or_else(|e| panic!("{sheet}: {e}"));
        assert_eq!(group, model::ATLAS_SHARED_GROUP, "{sheet}");
        seen += 1;
    }
    assert!(seen > 0, "no sheets found in {dir:?} -- vacuous");
}

/// The real mixed scene: every street-kit object plus the interior shell
/// objects, all in the shared group (no themed group exists in the real
/// tree today, so the worst-themed term is 0), plus the character
/// composites -- through the production budget check, on real packed pages.
#[test]
fn the_real_mixed_street_and_interior_shell_scene_fits_the_bound_page_budget() {
    let root = repo_root();
    let mut text_files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    text_files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&text_files).unwrap();

    let mut object_sheet_paths = object_sprite_sheet_paths(&raw);
    object_sheet_paths.sort();
    object_sheet_paths.dedup();
    let mut all_sheet_paths = appearance_sheet_paths(&raw);
    all_sheet_paths.extend(object_sheet_paths.iter().cloned());
    all_sheet_paths.sort();
    all_sheet_paths.dedup();
    let sheet_dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&root, &all_sheet_paths)
        .unwrap()
        .into_iter()
        .collect();
    let code_tables = codes::CodeTables::parse(&fsio::read_codes_golden(&root).unwrap());
    let defs = validate::validate(
        &raw,
        &sheet_dims,
        &code_tables,
        model::SPRITE_SHEET_ALLOWED_ROOT,
    )
    .unwrap();

    let read = |paths: &[String]| -> BTreeMap<String, Vec<u8>> {
        let bufs: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
        fsio::read_bytes(&root, &bufs)
            .unwrap()
            .into_iter()
            .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
            .collect()
    };
    let object_bytes = read(&object_sheet_paths);
    let appearance_bytes = read(&appearance_sheet_paths(&raw));
    let character_parts = collect_character_parts(
        &defs.bodies,
        &defs.eyes,
        &defs.hairstyles,
        &defs.outfits,
        &defs.accessories,
    );
    let out = build_atlas(
        &defs.objects,
        &object_bytes
            .iter()
            .map(|(k, v)| (k.clone(), decode_rgba8(v).unwrap()))
            .collect(),
        &validate::validate_page_groups(&raw).unwrap(),
        &character_parts,
        &appearance_bytes,
        &defs.appearance_layouts,
    )
    .unwrap();

    // The scene: street kit + interior shell, every one on a shared page.
    let scene_keys = [
        "floor_pale_stone",
        "threshold_arch_slate",
        "wall_face",
        "sidewalk_pavement",
        "road_asphalt",
        "grass_ground",
    ];
    for key in scene_keys {
        let o = defs
            .objects
            .iter()
            .find(|o| o.key == key)
            .unwrap_or_else(|| panic!("real object '{key}' is missing"));
        let page = out.atlas_by_object_id[&o.id].page as usize;
        assert_eq!(
            out.pages[page].group,
            model::ATLAS_SHARED_GROUP,
            "'{key}' must pack onto the shared group"
        );
    }

    let pages: Vec<PageMeta> = out
        .pages
        .iter()
        .map(|p| PageMeta {
            group: p.group.clone(),
            width: p.width,
            height: p.height,
        })
        .collect();
    let budget = scene_page_budget(&pages);
    assert!(
        budget.total <= model::ATLAS_MAX_BOUND_PAGES,
        "real scene budget {budget:?} exceeds ATLAS_MAX_BOUND_PAGES ({})",
        model::ATLAS_MAX_BOUND_PAGES
    );
    check_max_bound_pages(&pages).unwrap();
}

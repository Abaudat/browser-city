//! Story 2.14: the interior shell (`Room_Builder_subfiles/`) rides the
//! atlas packer. Both tests run against the real `defs/` tree and the real
//! `ModernTileset/` sheets.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::build::scene_page_budget;
use defs_build::atlas::pack::PageMeta;
use defs_build::atlas::theme::{resolve_page_group, theme_group};
use defs_build::{build_from_repo_root, fsio, model, parse, validate};

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
    let dir =
        root.join("ModernTileset/moderninteriors-win/1_Interiors/16x16/Room_Builder_subfiles");
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

/// The real mixed scene, read from the emitted `defs.json` -- the artefact
/// the client loads -- through the production build: every street-kit
/// object and the interior shell objects resolve to shared-group pages, and
/// the packed pages fit the bound (no themed group exists in the real tree
/// today, so the worst-themed term is 0).
#[test]
fn the_real_mixed_street_and_interior_shell_scene_fits_the_bound_page_budget() {
    let json = build_from_repo_root(&repo_root(), "interior-shell-test-version")
        .unwrap()
        .json;

    let doc: serde_json::Value = serde_json::from_str(&json).unwrap();
    let pages: Vec<PageMeta> = doc["atlas_pages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|p| PageMeta {
            group: p["group"].as_str().unwrap().to_string(),
            width: p["width"].as_u64().unwrap() as u32,
            height: p["height"].as_u64().unwrap() as u32,
        })
        .collect();
    assert!(!pages.is_empty(), "no atlas_pages in defs.json -- vacuous");

    let objects = doc["objects"].as_array().unwrap();
    for key in [
        "floor_pale_stone",
        "threshold_arch_slate",
        "wall_face",
        "sidewalk_pavement",
        "road_asphalt",
        "grass_ground",
    ] {
        let object = objects
            .iter()
            .find(|o| o["key"] == key)
            .unwrap_or_else(|| panic!("real object '{key}' is missing from defs.json"));
        let page = object["atlas"]["page"].as_u64().unwrap() as usize;
        assert_eq!(
            pages[page].group,
            model::ATLAS_SHARED_GROUP,
            "'{key}' must pack onto the shared group"
        );
    }

    let budget = scene_page_budget(&pages);
    assert!(
        budget.total <= model::ATLAS_MAX_BOUND_PAGES,
        "real scene budget {budget:?} exceeds ATLAS_MAX_BOUND_PAGES ({})",
        model::ATLAS_MAX_BOUND_PAGES
    );
}

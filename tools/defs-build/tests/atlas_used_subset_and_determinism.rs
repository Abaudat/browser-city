//! Story 2.6, Quentin's direction, points 3 and 4: a real filesystem
//! fixture (not the shared `tests/support` merged-tree apparatus -- this
//! needs real files with real byte content, including one deliberately
//! corrupt PNG) proving the packer never opens a sheet no object
//! references, and that packing is deterministic under a real shuffle of
//! the input file order (never a plain `reverse()`, which is one fixed
//! permutation and no more a proof of order-independence than testing a
//! sort with an already-sorted input) end to end, through
//! [`defs_build::build`] itself.

use std::collections::BTreeMap;
use std::path::PathBuf;

use defs_build::{atlas, fsio, object_sprite_sheet_paths, parse};

const SHEET_DIR: &str = "ModernTileset/x/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16";
const CAMPING_DIR: &str = "ModernTileset/x/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16";
const SCHOOL_DIR: &str = "ModernTileset/x/ME_Theme_Sorter_16x16/13_School_Singles_16x16";

fn good_png() -> Vec<u8> {
    atlas::image::encode_rgba8(16, 16, &vec![7u8; 16 * 16 * 4]).unwrap()
}

fn object_toml(id: u32, key: &str, sheet_dir: &str, sheet_file: &str) -> String {
    format!(
        "[[object]]\nid = {id}\nkey = \"{key}\"\nname = \"{key}\"\nlayer = \"furniture\"\nsprite = {{ sheet = \"{sheet_dir}/{sheet_file}\", x = 0, y = 0, w = 16, h = 16 }}\nwidth = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\ntags = [\"fixture\"]\n"
    )
}

/// Story 2.9: every object above needs exactly one role tag.
fn roles_toml() -> &'static str {
    "[[tag]]\nid = 1\nkey = \"fixture\"\nrole = { layers = [\"furniture\"] }\n"
}

fn code_tables() -> defs_build::codes::CodeTables {
    defs_build::codes::CodeTables::from_entries(&[("layer", "furniture", 2)])
}

/// FR126's sprite/footprint check needs a `render.tile_size_px` balance
/// key -- 16, matching every fixture sprite's own 16x16 rect.
fn tile_size_balance() -> &'static str {
    "[[balance]]\nkey = \"render.tile_size_px\"\nvalue = 16\nmin = 1\nmax = 64\n"
}

/// Every theme these fixtures name kept as its own page group -- the
/// packer's own `resolve_page_group` requires a row for every theme
/// actually used. The unused `atlas_required` row satisfies
/// `validate_page_groups`'s own structural requirement (at least one
/// theme maps to `ATLAS_SHARED_GROUP`) without changing which page group
/// any of these fixtures' real themes land in.
fn page_groups_toml() -> &'static str {
    "[[page_group]]\ntheme = \"city_props\"\ngroup = \"city_props\"\n\n[[page_group]]\ntheme = \"camping\"\ngroup = \"camping\"\n\n[[page_group]]\ntheme = \"school\"\ngroup = \"school\"\n\n[[page_group]]\ntheme = \"atlas_required\"\ngroup = \"street\"\n"
}

#[test]
fn only_the_used_subset_is_read_a_corrupt_unreferenced_sheet_never_breaks_the_build() {
    let dir = fsio::make_scratch_dir("defs-build-test-used-subset").unwrap();
    std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
    std::fs::create_dir_all(dir.join("defs/tags")).unwrap();
    std::fs::create_dir_all(dir.join("defs/balance")).unwrap();
    std::fs::create_dir_all(dir.join("defs/atlas")).unwrap();
    std::fs::create_dir_all(dir.join(SHEET_DIR)).unwrap();
    std::fs::write(dir.join("defs/balance/render.toml"), tile_size_balance()).unwrap();
    std::fs::write(dir.join("defs/atlas/page-groups.toml"), page_groups_toml()).unwrap();
    std::fs::write(dir.join("defs/tags/roles.toml"), roles_toml()).unwrap();
    std::fs::write(dir.join(SHEET_DIR).join("good.png"), good_png()).unwrap();
    std::fs::write(
        dir.join(SHEET_DIR).join("corrupt.png"),
        b"not a real png at all",
    )
    .unwrap();
    std::fs::write(
        dir.join("defs/objects/a.toml"),
        object_toml(1, "a", SHEET_DIR, "good.png"),
    )
    .unwrap();

    let text_files = fsio::read_text(
        &dir,
        &[
            PathBuf::from("defs/objects/a.toml"),
            PathBuf::from("defs/balance/render.toml"),
            PathBuf::from("defs/atlas/page-groups.toml"),
            PathBuf::from("defs/tags/roles.toml"),
        ],
    )
    .unwrap();
    let raw = parse::parse_all(&text_files).unwrap();
    let mut sheet_paths = object_sprite_sheet_paths(&raw);
    sheet_paths.sort();
    assert_eq!(
        sheet_paths,
        vec![format!("{SHEET_DIR}/good.png")],
        "corrupt.png must never be named as a sheet the build reads"
    );

    let sheet_dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&dir, &sheet_paths)
        .unwrap()
        .into_iter()
        .collect();
    let sheet_paths_buf: Vec<PathBuf> = sheet_paths.iter().map(PathBuf::from).collect();
    let object_sheet_bytes: BTreeMap<String, Vec<u8>> = fsio::read_bytes(&dir, &sheet_paths_buf)
        .unwrap()
        .into_iter()
        .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
        .collect();

    let out = defs_build::build(
        &text_files,
        &sheet_dims,
        &object_sheet_bytes,
        &BTreeMap::new(),
        &code_tables(),
        "",
        "v1",
    )
    .expect("build must succeed -- corrupt.png is never opened because nothing references it");
    assert_eq!(out.atlas_pages.len(), 1);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn packing_three_groups_is_byte_identical_under_a_real_shuffle_of_file_order() {
    let dir = fsio::make_scratch_dir("defs-build-test-atlas-order").unwrap();
    std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
    std::fs::create_dir_all(dir.join("defs/balance")).unwrap();
    std::fs::create_dir_all(dir.join("defs/atlas")).unwrap();
    std::fs::create_dir_all(dir.join("defs/tags")).unwrap();
    std::fs::create_dir_all(dir.join(SHEET_DIR)).unwrap();
    std::fs::create_dir_all(dir.join(CAMPING_DIR)).unwrap();
    std::fs::create_dir_all(dir.join(SCHOOL_DIR)).unwrap();
    std::fs::write(dir.join("defs/balance/render.toml"), tile_size_balance()).unwrap();
    std::fs::write(dir.join("defs/atlas/page-groups.toml"), page_groups_toml()).unwrap();
    std::fs::write(dir.join("defs/tags/roles.toml"), roles_toml()).unwrap();
    std::fs::write(dir.join(SHEET_DIR).join("good.png"), good_png()).unwrap();
    std::fs::write(dir.join(CAMPING_DIR).join("bin.png"), good_png()).unwrap();
    std::fs::write(dir.join(SCHOOL_DIR).join("bench.png"), good_png()).unwrap();
    std::fs::write(
        dir.join("defs/objects/a.toml"),
        object_toml(1, "a", SHEET_DIR, "good.png"),
    )
    .unwrap();
    std::fs::write(
        dir.join("defs/objects/b.toml"),
        object_toml(2, "b", CAMPING_DIR, "bin.png"),
    )
    .unwrap();
    std::fs::write(
        dir.join("defs/objects/c.toml"),
        object_toml(3, "c", SCHOOL_DIR, "bench.png"),
    )
    .unwrap();

    let paths = [
        PathBuf::from("defs/objects/a.toml"),
        PathBuf::from("defs/objects/b.toml"),
        PathBuf::from("defs/objects/c.toml"),
        PathBuf::from("defs/balance/render.toml"),
        PathBuf::from("defs/atlas/page-groups.toml"),
        PathBuf::from("defs/tags/roles.toml"),
    ];
    let forward = fsio::read_text(&dir, &paths).unwrap();
    // A real shuffle, not `reverse()` (one fixed permutation, indistinct
    // from an already-sorted input): rotate by two and swap the last
    // pair, a permutation that is neither the identity nor the reversal
    // of the forward order.
    let shuffled: Vec<(PathBuf, String)> = {
        let n = forward.len();
        let mut order: Vec<usize> = (0..n).map(|i| (i + 2) % n).collect();
        order.swap(0, n - 1);
        order.into_iter().map(|i| forward[i].clone()).collect()
    };
    assert_ne!(
        shuffled.iter().map(|(p, _)| p.clone()).collect::<Vec<_>>(),
        forward.iter().map(|(p, _)| p.clone()).collect::<Vec<_>>(),
        "the shuffle must actually reorder the input"
    );
    assert_ne!(
        shuffled.iter().map(|(p, _)| p.clone()).collect::<Vec<_>>(),
        forward
            .iter()
            .rev()
            .map(|(p, _)| p.clone())
            .collect::<Vec<_>>(),
        "the shuffle must not merely be the reversal"
    );

    let build_once = |files: &[(PathBuf, String)]| {
        let raw = parse::parse_all(files).unwrap();
        let mut sheet_paths = object_sprite_sheet_paths(&raw);
        sheet_paths.sort();
        let sheet_dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&dir, &sheet_paths)
            .unwrap()
            .into_iter()
            .collect();
        let sheet_paths_buf: Vec<PathBuf> = sheet_paths.iter().map(PathBuf::from).collect();
        let object_sheet_bytes: BTreeMap<String, Vec<u8>> =
            fsio::read_bytes(&dir, &sheet_paths_buf)
                .unwrap()
                .into_iter()
                .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
                .collect();
        defs_build::build(
            files,
            &sheet_dims,
            &object_sheet_bytes,
            &BTreeMap::new(),
            &code_tables(),
            "",
            "v1",
        )
        .unwrap()
    };

    let out_a = build_once(&forward);
    let out_b = build_once(&shuffled);
    assert_eq!(
        out_a.atlas_pages, out_b.atlas_pages,
        "a real shuffle of file order must produce byte-identical pages and filenames"
    );
    assert_eq!(out_a.json, out_b.json);

    std::fs::remove_dir_all(&dir).unwrap();
}

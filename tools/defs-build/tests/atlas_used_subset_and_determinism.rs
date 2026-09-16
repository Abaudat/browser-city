//! Story 2.6, Quentin's direction, points 3 and 4: a real filesystem
//! fixture (not the shared `tests/support` merged-tree apparatus -- this
//! needs real files with real byte content, including one deliberately
//! corrupt PNG) proving the packer never opens a sheet no object
//! references, and that packing is deterministic under a shuffled file
//! order end to end, through [`defs_build::build`] itself.

use std::collections::BTreeMap;
use std::path::PathBuf;

use defs_build::{atlas, fsio, object_sprite_sheet_paths, parse};

const SHEET_DIR: &str = "ModernTileset/x/ME_Theme_Sorter_16x16/3_City_Props_Singles_16x16";

fn good_png() -> Vec<u8> {
    atlas::image::encode_rgba8(16, 16, &vec![7u8; 16 * 16 * 4]).unwrap()
}

fn object_toml(id: u32, key: &str, sheet_file: &str) -> String {
    format!(
        "[[object]]\nid = {id}\nkey = \"{key}\"\nname = \"{key}\"\nlayer = \"furniture\"\nsprite = {{ sheet = \"{SHEET_DIR}/{sheet_file}\", x = 0, y = 0, w = 16, h = 16 }}\nwidth = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\n"
    )
}

fn layer_codes() -> BTreeMap<String, u32> {
    [("furniture".to_string(), 2u32)].into_iter().collect()
}

/// FR126's sprite/footprint check needs a `render.tile_size_px` balance
/// key -- 16, matching every fixture sprite's own 16x16 rect.
fn tile_size_balance() -> &'static str {
    "[[balance]]\nkey = \"render.tile_size_px\"\nvalue = 16\nmin = 1\nmax = 64\n"
}

#[test]
fn only_the_used_subset_is_read_a_corrupt_unreferenced_sheet_never_breaks_the_build() {
    let dir = fsio::make_scratch_dir("defs-build-test-used-subset").unwrap();
    std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
    std::fs::create_dir_all(dir.join("defs/balance")).unwrap();
    std::fs::create_dir_all(dir.join(SHEET_DIR)).unwrap();
    std::fs::write(dir.join("defs/balance/render.toml"), tile_size_balance()).unwrap();
    std::fs::write(dir.join(SHEET_DIR).join("good.png"), good_png()).unwrap();
    std::fs::write(
        dir.join(SHEET_DIR).join("corrupt.png"),
        b"not a real png at all",
    )
    .unwrap();
    std::fs::write(
        dir.join("defs/objects/a.toml"),
        object_toml(1, "a", "good.png"),
    )
    .unwrap();

    let text_files = fsio::read_text(
        &dir,
        &[
            PathBuf::from("defs/objects/a.toml"),
            PathBuf::from("defs/balance/render.toml"),
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
        &layer_codes(),
        "",
        "v1",
    )
    .expect("build must succeed -- corrupt.png is never opened because nothing references it");
    assert_eq!(out.atlas_pages.len(), 1);

    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn packing_two_groups_is_byte_identical_regardless_of_file_order() {
    let dir = fsio::make_scratch_dir("defs-build-test-atlas-order").unwrap();
    std::fs::create_dir_all(dir.join("defs/objects")).unwrap();
    std::fs::create_dir_all(dir.join("defs/balance")).unwrap();
    std::fs::create_dir_all(dir.join(SHEET_DIR)).unwrap();
    std::fs::write(dir.join("defs/balance/render.toml"), tile_size_balance()).unwrap();
    let other_dir = "ModernTileset/x/ME_Theme_Sorter_16x16/11_Camping_Singles_16x16";
    std::fs::create_dir_all(dir.join(other_dir)).unwrap();
    std::fs::write(dir.join(SHEET_DIR).join("good.png"), good_png()).unwrap();
    std::fs::write(dir.join(other_dir).join("bin.png"), good_png()).unwrap();
    std::fs::write(
        dir.join("defs/objects/a.toml"),
        object_toml(1, "a", "good.png"),
    )
    .unwrap();
    std::fs::write(
        dir.join("defs/objects/b.toml"),
        format!(
            "[[object]]\nid = 2\nkey = \"b\"\nname = \"b\"\nlayer = \"furniture\"\nsprite = {{ sheet = \"{other_dir}/bin.png\", x = 0, y = 0, w = 16, h = 16 }}\nwidth = 1\nheight = 1\ncollider = {{ x0 = 4, y0 = 4, x1 = 12, y1 = 12 }}\n"
        ),
    )
    .unwrap();

    let paths = [
        PathBuf::from("defs/objects/a.toml"),
        PathBuf::from("defs/objects/b.toml"),
        PathBuf::from("defs/balance/render.toml"),
    ];
    let forward = fsio::read_text(&dir, &paths).unwrap();
    let mut reversed = forward.clone();
    reversed.reverse();

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
            &layer_codes(),
            "",
            "v1",
        )
        .unwrap()
    };

    let out_a = build_once(&forward);
    let out_b = build_once(&reversed);
    assert_eq!(
        out_a.atlas_pages, out_b.atlas_pages,
        "shuffled file order must produce byte-identical pages and filenames"
    );
    assert_eq!(out_a.json, out_b.json);

    std::fs::remove_dir_all(&dir).unwrap();
}

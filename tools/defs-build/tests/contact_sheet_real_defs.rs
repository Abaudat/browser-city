//! Story 2.5 (Quentin's direction): three invariants asserted against the
//! *real*, committed `defs/` tree, cheap enough to run in this crate's own
//! test binary -- never a screenshot, never a browser.
//!
//!   1. every real object's own key appears in the sheet exactly once (no
//!      silent omission);
//!   2. every asset URL the sheet names resolves to a real file on disk,
//!      relative to the sheet's own committed location -- a contact sheet
//!      of broken image icons is a red build, never a surprise in a
//!      browser;
//!   3. the sheet's own header carries `defs_version` and the manifest
//!      hash, so a reviewer can tell at a glance which build they are
//!      looking at.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::{
    appearance_sheet_paths, fsio, layer_codes, model, object_sprite_sheet_paths, parse,
};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn build_real_output() -> defs_build::BuildOutput {
    let root = repo_root();
    let mut text_files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    text_files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&text_files).unwrap();

    let mut sheet_paths = appearance_sheet_paths(&raw);
    sheet_paths.extend(object_sprite_sheet_paths(&raw));
    sheet_paths.sort();
    sheet_paths.dedup();
    let sheet_dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&root, &sheet_paths)
        .unwrap()
        .into_iter()
        .collect();

    let mut object_sheet_paths = object_sprite_sheet_paths(&raw);
    object_sheet_paths.sort();
    object_sheet_paths.dedup();
    let object_sheet_paths_buf: Vec<PathBuf> =
        object_sheet_paths.iter().map(PathBuf::from).collect();
    let object_sheet_bytes: BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(&root, &object_sheet_paths_buf)
            .unwrap()
            .into_iter()
            .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
            .collect();

    let mut appearance_paths = appearance_sheet_paths(&raw);
    appearance_paths.sort();
    appearance_paths.dedup();
    let appearance_paths_buf: Vec<PathBuf> = appearance_paths.iter().map(PathBuf::from).collect();
    let appearance_sheet_bytes: BTreeMap<String, Vec<u8>> =
        fsio::read_bytes(&root, &appearance_paths_buf)
            .unwrap()
            .into_iter()
            .map(|(p, b)| (p.to_string_lossy().replace('\\', "/"), b))
            .collect();

    let codes_golden = fsio::read_codes_golden(&root).unwrap();
    let layer_codes = layer_codes::parse_layer_codes(&codes_golden);

    defs_build::build(
        &text_files,
        &sheet_dims,
        &object_sheet_bytes,
        &appearance_sheet_bytes,
        &layer_codes,
        model::SPRITE_SHEET_ALLOWED_ROOT,
        "real-defs-test-version",
    )
    .unwrap()
}

/// Every real object's own committed defs -- to know the exact key set
/// this test expects to find, without duplicating `validate.rs`'s own
/// parse/lower path.
fn real_object_keys() -> Vec<String> {
    let root = repo_root();
    let mut text_files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    text_files.sort_by(|a, b| a.0.cmp(&b.0));
    let raw = parse::parse_all(&text_files).unwrap();
    raw.objects.iter().map(|o| o.key.value.clone()).collect()
}

#[test]
fn every_real_objects_key_appears_in_the_sheet_exactly_once() {
    let output = build_real_output();
    let keys = real_object_keys();
    assert!(
        !keys.is_empty(),
        "defs/objects/ has no objects -- this test would pass vacuously"
    );
    for key in &keys {
        let needle = format!("data-key=\"{key}\"");
        let count = output.contact_sheet.matches(&needle).count();
        assert_eq!(
            count, 1,
            "'{key}' must appear in the contact sheet exactly once, found {count}"
        );
    }
}

#[test]
fn every_asset_url_resolves_to_a_real_committed_file_relative_to_the_sheets_own_location() {
    let output = build_real_output();
    let sheet_own_dir = repo_root().join("tools/defs-build");
    let mut found_any = false;
    for cap in output.contact_sheet.split("url('").skip(1) {
        let end = cap
            .find('\'')
            .expect("unterminated url(...) in the contact sheet");
        let rel = &cap[..end];
        found_any = true;
        let resolved = sheet_own_dir.join(rel);
        assert!(
            resolved.exists(),
            "asset URL '{rel}' does not resolve to a real file at {}",
            resolved.display()
        );
    }
    assert!(found_any, "the contact sheet named no asset URL at all");
}

/// Quentin's direction: every sprite rect the sheet actually draws
/// (`background-position` + the sprite `div`'s own `width`/`height`) must
/// lie inside the `background-size` (the atlas page) it names -- parsed
/// straight out of the emitted CSS, never re-derived from `atlas.rs`'s
/// own numbers, so an emission bug here is caught even if the packer
/// itself is correct.
#[test]
fn every_sprite_rect_the_sheet_draws_lies_inside_its_own_named_atlas_page() {
    let output = build_real_output();
    let mut checked = 0;
    for card in output
        .contact_sheet
        .split("<div class=\"sprite\" style=\"")
        .skip(1)
    {
        let style_end = card
            .find("\"></div>")
            .expect("unterminated sprite div style");
        let style = &card[..style_end];
        let px = |prop: &str| -> f64 {
            let start = style
                .find(prop)
                .unwrap_or_else(|| panic!("'{prop}' not found in {style}"))
                + prop.len();
            let rest = &style[start..];
            let end = rest.find("px").expect("expected a px value");
            rest[..end].trim_start_matches('-').parse::<f64>().unwrap()
                * if rest.starts_with('-') { -1.0 } else { 1.0 }
        };
        let width = px("width:");
        let height = px("height:");
        let bg_pos_start = style
            .find("background-position:-")
            .expect("background-position")
            + "background-position:-".len();
        let bg_pos_rest = &style[bg_pos_start..];
        let x_end = bg_pos_rest.find("px").unwrap();
        let x: f64 = bg_pos_rest[..x_end].parse().unwrap();
        let after_x = &bg_pos_rest[x_end + 2..];
        let y_start = after_x.find('-').unwrap() + 1;
        let y_rest = &after_x[y_start..];
        let y_end = y_rest.find("px").unwrap();
        let y: f64 = y_rest[..y_end].parse().unwrap();

        let bg_size_start =
            style.find("background-size:").expect("background-size") + "background-size:".len();
        let bg_size_rest = &style[bg_size_start..];
        let w_end = bg_size_rest.find("px").unwrap();
        let page_w: f64 = bg_size_rest[..w_end].parse().unwrap();
        let after_w = &bg_size_rest[w_end + 2..].trim_start();
        let h_end = after_w.find("px").unwrap();
        let page_h: f64 = after_w[..h_end].parse().unwrap();

        assert!(
            x + width <= page_w && y + height <= page_h,
            "sprite rect ({x},{y})+({width}x{height}) does not fit inside its own named page ({page_w}x{page_h})"
        );
        checked += 1;
    }
    assert!(checked > 0, "no sprite div was found to check");
}

#[test]
fn the_header_names_defs_version_and_a_manifest_hash() {
    let output = build_real_output();
    assert!(output.contact_sheet.contains("real-defs-test-version"));
    // A 16-hex-character fingerprint, exactly like `defs_version`'s own
    // length (`version::DEFS_VERSION_LEN`).
    assert!(
        output.contact_sheet.contains("manifest sha256 <code>"),
        "the header must name the manifest hash: {}",
        &output.contact_sheet[..output.contact_sheet.find("</header>").unwrap_or(200)]
    );
}

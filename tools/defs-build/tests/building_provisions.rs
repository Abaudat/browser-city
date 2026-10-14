//! Story 3.10 (FR50, FR130): a building type declares what it provides as
//! authored data -- `provisions = [{ provision = "<name>", base_quality = n }]`
//! -- never a `match` in Rust. Every case builds the real `defs/` tree with
//! one line changed, so the corpus and the validator are held together.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::model::{Defs, SPRITE_SHEET_ALLOWED_ROOT};
use defs_build::{codes, fsio, parse, validate};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn tables() -> codes::CodeTables {
    codes::CodeTables::parse(&fsio::read_codes_golden(&repo_root()).unwrap())
}

/// The real tree with `old` replaced by `new` once in whichever building
/// type file holds it; `None` replacement leaves the tree as committed.
fn build(edit: Option<(&str, &str)>) -> Result<Defs, String> {
    let root = repo_root();
    let mut files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    if let Some((old, new)) = edit {
        let mut replaced = 0;
        for (path, text) in &mut files {
            if path.to_string_lossy().contains("building-types") && text.contains(old) {
                *text = text.replacen(old, new, 1);
                replaced += 1;
            }
        }
        assert_eq!(replaced, 1, "'{old}' must appear once in the building types");
    }
    let raw = parse::parse_all(&files).map_err(|e| e.to_string())?;
    let mut sheets = defs_build::appearance_sheet_paths(&raw);
    sheets.extend(defs_build::object_sprite_sheet_paths(&raw));
    sheets.sort();
    sheets.dedup();
    let dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&root, &sheets)
        .unwrap()
        .into_iter()
        .collect();
    validate::validate(&raw, &dims, &tables(), SPRITE_SHEET_ALLOWED_ROOT).map_err(|e| e.to_string())
}

fn provisions_of(defs: &Defs, key: &str) -> Vec<(u32, u32)> {
    defs.building_types
        .iter()
        .find(|b| b.key == key)
        .unwrap_or_else(|| panic!("no building type {key}"))
        .provisions
        .clone()
}

fn code(name: &str) -> u32 {
    tables().set("provision")[name]
}

#[test]
fn the_cafe_advertises_food_and_social_as_two_entries() {
    let defs = build(None).unwrap();
    let cafe = provisions_of(&defs, "cafe");
    let codes: Vec<u32> = cafe.iter().map(|p| p.0).collect();
    assert!(codes.contains(&code("food")), "{cafe:?}");
    assert!(codes.contains(&code("social")), "{cafe:?}");
    assert!(codes.contains(&code("employment")), "{cafe:?}");
}

#[test]
fn a_vacant_unit_and_a_dwelling_advertise_nothing_public() {
    let defs = build(None).unwrap();
    assert!(provisions_of(&defs, "vacant_unit").is_empty());
    assert!(provisions_of(&defs, "villa").is_empty());
    let rest = code("rest");
    for b in defs.building_types.iter().filter(|b| {
        b.tags
            .iter()
            .any(|t| defs.tags.iter().any(|d| d.id == *t && d.key == "dwelling"))
    }) {
        assert!(
            !b.provisions.iter().any(|p| p.0 == rest),
            "dwelling {} advertises rest",
            b.key
        );
    }
}

#[test]
fn an_unknown_provision_name_is_named() {
    let err = build(Some((
        "professions = [\"barista\", \"server\"]",
        "professions = [\"barista\", \"server\"]\nprovisions = [{ provision = \"nonexistent_need\", base_quality = 50 }]",
    )))
    .unwrap_err();
    assert!(
        err.contains("unknown provision 'nonexistent_need'") && err.contains("cafe"),
        "{err}"
    );
}

#[test]
fn a_duplicate_provision_on_one_type_is_named() {
    let err = build(Some((
        "professions = [\"barista\", \"server\"]",
        "professions = [\"barista\", \"server\"]\nprovisions = [{ provision = \"food\", base_quality = 50 }, { provision = \"food\", base_quality = 60 }, { provision = \"employment\", base_quality = 50 }]",
    )))
    .unwrap_err();
    assert!(err.contains("duplicate provision 'food'") && err.contains("cafe"), "{err}");
}

#[test]
fn an_enterable_type_that_advertises_nothing_is_named() {
    // `bank_branch` is enterable and no dwelling: with its provisions
    // line gone the city's citizens would be blind to it.
    let err = build(Some((
        "professions = [\"bank_teller\", \"manager\", \"security_guard\", \"loan_officer\"]\nprovisions = [{ provision = \"employment\", base_quality = 50 }]",
        "professions = [\"bank_teller\", \"manager\", \"security_guard\", \"loan_officer\"]",
    )))
    .unwrap_err();
    assert!(err.contains("bank_branch") && err.contains("advertises no provision"), "{err}");
}

#[test]
fn a_type_with_professions_must_advertise_employment_and_no_other_type_may() {
    let err = build(Some((
        "provisions = [{ provision = \"employment\", base_quality = 50 }]\n",
        "provisions = [{ provision = \"food\", base_quality = 50 }]\n",
    )));
    // The first type carrying a lone employment entry is rewritten; the
    // verdict names the missing employment or the surplus food.
    let msg = err.unwrap_err();
    assert!(msg.contains("employment"), "{msg}");
}

#[test]
fn a_dwelling_advertising_rest_is_refused() {
    let err = build(Some((
        "key = \"villa\"",
        "key = \"villa\"\nprovisions = [{ provision = \"rest\", base_quality = 50 }]",
    )))
    .unwrap_err();
    assert!(err.contains("villa") && err.contains("rest"), "{err}");
}

#[test]
fn a_base_quality_past_one_hundred_is_refused() {
    let err = build(Some((
        "professions = [\"barista\", \"server\"]",
        "professions = [\"barista\", \"server\"]\nprovisions = [{ provision = \"food\", base_quality = 101 }, { provision = \"employment\", base_quality = 50 }]",
    )))
    .unwrap_err();
    assert!(err.contains("base_quality") && err.contains("cafe"), "{err}");
}

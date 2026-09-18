//! Story 2.5 (Quentin's direction): invariants asserted against the
//! *real*, committed `defs/` tree, cheap enough to run in this crate's own
//! test binary -- never a screenshot, never a browser.
//!
//!   1. every real object's own key appears in the sheet exactly once (no
//!      silent omission);
//!   2. every asset URL the sheet names resolves to a real file on disk,
//!      relative to the sheet's own committed location -- a contact sheet
//!      of broken image icons is a red build, never a surprise in a
//!      browser;
//!   3. every sprite rect the sheet draws lies inside its own named atlas
//!      page;
//!   4. the sheet's own header carries `defs_version` and the *exact*
//!      manifest hash `defs_build::build` computed from this same build's
//!      own id manifest.

use std::path::{Path, PathBuf};

use defs_build::sha256::sha256_hex;
use defs_build::version::DEFS_VERSION_LEN;
use defs_build::{build_from_repo_root, fsio, parse};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

/// The one place this crate's own tests and `bin/defs-build.rs`'s edge
/// both collect a real `defs/` tree's inputs and call `build` (Quentin's
/// direction, cycle 1: this file used to hand-copy ~70 lines of that
/// collection, which would keep asserting against a pipeline the binary
/// no longer ran the moment one of the two drifted).
fn build_real_output() -> defs_build::BuildOutput {
    build_from_repo_root(&repo_root(), "real-defs-test-version").unwrap()
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

/// One `.page-{group}-{ordinal} { background-image: url('...');
/// background-size: WpxHpx; }` rule, parsed straight out of the emitted
/// `<style>` block -- never re-derived from `atlas.rs`'s own numbers, so
/// an emission bug here is caught even if the packer itself is correct.
/// `class` is the part after `.page-` (e.g. `street-0`), keyed by group
/// plus in-group ordinal rather than the global `atlas_pages` index
/// (Tim's direction, cycle 2): an unrelated group gaining or losing a
/// page must never renumber another group's own classes.
struct PageRule {
    class: String,
    href: String,
    width: f64,
    height: f64,
}

fn parse_page_rules(html: &str) -> Vec<PageRule> {
    let mut rules = Vec::new();
    for chunk in html.split(".page-").skip(1) {
        // `{class} { background-image: url('HREF'); background-size: WpxHpx; }`
        let Some(brace) = chunk.find('{') else {
            continue;
        };
        let Some(close) = chunk.find('}') else {
            continue;
        };
        if close < brace {
            continue;
        }
        let rule_body = &chunk[brace + 1..close];
        if !rule_body.contains("background-image") {
            continue; // a `.page-<class>` reference elsewhere (a card's own class), not the rule itself
        }
        let class = chunk[..brace].trim().to_string();
        let href_start = rule_body.find("url('").unwrap() + "url('".len();
        let href_end = rule_body[href_start..].find('\'').unwrap() + href_start;
        let href = rule_body[href_start..href_end].to_string();
        let size_start = rule_body.find("background-size:").unwrap() + "background-size:".len();
        let size_rest = rule_body[size_start..].trim_start();
        let w_end = size_rest.find("px").unwrap();
        let width: f64 = size_rest[..w_end].parse().unwrap();
        let after_w = size_rest[w_end + 2..].trim_start();
        let h_end = after_w.find("px").unwrap();
        let height: f64 = after_w[..h_end].parse().unwrap();
        rules.push(PageRule {
            class,
            href,
            width,
            height,
        });
    }
    rules
}

#[test]
fn every_asset_url_resolves_to_a_real_committed_file_relative_to_the_sheets_own_location() {
    let output = build_real_output();
    let sheet_own_dir = repo_root().join("tools/defs-build");
    let rules = parse_page_rules(&output.contact_sheet);
    assert!(
        !rules.is_empty(),
        "the contact sheet named no atlas page rule at all"
    );
    for rule in &rules {
        let resolved = sheet_own_dir.join(&rule.href);
        assert!(
            resolved.exists(),
            "asset URL '{}' does not resolve to a real file at {}",
            rule.href,
            resolved.display()
        );
    }
}

/// Tim's direction, cycle 2: `atlas_pages` also carries every character-
/// part page, which no object card ever draws from -- a rule for one
/// would be dead weight that still diffs on every character-art change.
#[test]
fn no_emitted_page_rule_names_a_character_part_page() {
    let output = build_real_output();
    let rules = parse_page_rules(&output.contact_sheet);
    assert!(
        !rules.is_empty(),
        "the contact sheet named no atlas page rule at all"
    );
    for rule in &rules {
        assert!(
            !rule.class.starts_with("character_"),
            "'.page-{}' names a character-part page, which no object card ever references",
            rule.class
        );
    }
}

/// Quentin's direction: every sprite rect the sheet actually draws
/// (`.sprite page-<class>`'s own `background-position` plus its `width`/
/// `height`) must lie inside the `.page-<class>` rule's own
/// `background-size`.
#[test]
fn every_sprite_rect_the_sheet_draws_lies_inside_its_own_named_atlas_page() {
    let output = build_real_output();
    let rules = parse_page_rules(&output.contact_sheet);
    let mut checked = 0;
    for card in output
        .contact_sheet
        .split("<div class=\"sprite page-")
        .skip(1)
    {
        let class_end = card
            .find('"')
            .expect("expected a closing quote after the page class");
        let class = &card[..class_end];
        let style_start = card
            .find("style=\"")
            .expect("sprite div must carry a style attr")
            + "style=\"".len();
        let style_rest = &card[style_start..];
        let style_end = style_rest
            .find("\">")
            .expect("unterminated sprite div style");
        let style = &style_rest[..style_end];

        let px = |prop: &str| -> f64 {
            let start = style
                .find(prop)
                .unwrap_or_else(|| panic!("'{prop}' not found in {style}"))
                + prop.len();
            let rest = &style[start..];
            let end = rest.find("px").expect("expected a px value");
            rest[..end].parse::<f64>().unwrap()
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

        let page = rules
            .iter()
            .find(|r| r.class == class)
            .unwrap_or_else(|| panic!("no emitted rule for page class '{class}'"));
        assert!(
            x + width <= page.width && y + height <= page.height,
            "sprite rect ({x},{y})+({width}x{height}) does not fit inside page '{class}' ({}x{})",
            page.width,
            page.height
        );
        checked += 1;
    }
    assert!(checked > 0, "no sprite div was found to check");
}

#[test]
fn the_header_names_defs_version_and_the_exact_manifest_hash() {
    let output = build_real_output();
    assert!(output.contact_sheet.contains("real-defs-test-version"));
    let expected_hash = &sha256_hex(output.id_manifest.as_bytes())[..DEFS_VERSION_LEN];
    let expected = format!("manifest sha256 <code>{expected_hash}</code>");
    assert!(
        output.contact_sheet.contains(&expected),
        "the header must carry the exact manifest hash '{expected_hash}', computed from this \
         same build's own id manifest -- header was: {}",
        &output.contact_sheet[..output.contact_sheet.find("</header>").unwrap_or(300)]
    );
}

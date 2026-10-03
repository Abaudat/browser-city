//! Story 15.14: no object's sprite rect slices through its own art. Real
//! sheets, real defs; the pure rule is unit-tested on synthetic buffers.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use defs_build::atlas::image::decode_rgba8;
use defs_build::codes::CodeTables;
#[path = "support/cut_edges.rs"]
mod cut_edges;
use cut_edges::{Edge, Rect, cut_edges};
use defs_build::model::{Defs, SPRITE_SHEET_ALLOWED_ROOT};
use defs_build::{fsio, parse, validate};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn files() -> Vec<(PathBuf, String)> {
    let root = repo_root();
    let mut files = fsio::read_text(&root, &fsio::list_defs_sources(&root).unwrap()).unwrap();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    files
}

fn tables() -> CodeTables {
    CodeTables::parse(&fsio::read_codes_golden(&repo_root()).unwrap())
}

fn defs_from(files: &[(PathBuf, String)]) -> Defs {
    let root = repo_root();
    let raw = parse::parse_all(files).unwrap();
    let mut sheets = defs_build::appearance_sheet_paths(&raw);
    sheets.extend(defs_build::object_sprite_sheet_paths(&raw));
    sheets.sort();
    sheets.dedup();
    let dims: BTreeMap<String, (u32, u32)> = fsio::read_png_dims(&root, &sheets)
        .unwrap()
        .into_iter()
        .collect();
    validate::validate(&raw, &dims, &tables(), SPRITE_SHEET_ALLOWED_ROOT).unwrap()
}

/// `(examined objects, continued edges, repeat edges)`, or the failure messages.
fn audit(defs: &Defs) -> Result<(usize, usize, usize), Vec<String>> {
    audit_with(defs, &[])
}

/// [`audit`] with some objects' sprite rects replaced in memory (`key`, new
/// rect): the control for a rect the validator would refuse to build.
fn audit_with(
    defs: &Defs,
    overrides: &[(&str, Rect)],
) -> Result<(usize, usize, usize), Vec<String>> {
    let t = tables();
    let tile_layers = [
        t.get("layer", "ground").unwrap(),
        t.get("layer", "walls").unwrap(),
    ];
    let mut by_sheet: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    let mut examined = 0;
    for (i, o) in defs.objects.iter().enumerate() {
        if tile_layers.contains(&o.layer) {
            continue;
        }
        examined += 1;
        by_sheet.entry(o.sprite.sheet.as_str()).or_default().push(i);
    }
    let (mut continued, mut repeated, mut failures) = (0, 0, Vec::new());
    for (sheet, idxs) in by_sheet {
        let bytes = fsio::read_bytes(&repo_root(), &[PathBuf::from(sheet)])
            .unwrap()
            .remove(0)
            .1;
        let (w, h, rgba) = decode_rgba8(&bytes).unwrap();
        let rects: Vec<Rect> = idxs
            .iter()
            .map(|&i| {
                let o = &defs.objects[i];
                if let Some((_, r)) = overrides.iter().find(|(k, _)| *k == o.key) {
                    return *r;
                }
                let s = &o.sprite;
                Rect {
                    x: s.x,
                    y: s.y,
                    w: s.w,
                    h: s.h,
                }
            })
            .collect();
        for e in cut_edges(&rgba, w, h, &rects) {
            let key = &defs.objects[idxs[e.rect]].key;
            if e.continued {
                continued += 1;
            } else if e.repeats {
                repeated += 1;
            } else {
                failures.push(format!(
                    "{key}: sprite rect is cut on its {:?} edge: {} opaque pixel(s) continue outside it, sheet span {}..{}",
                    e.edge, e.count, e.span.0, e.span.1
                ));
            }
        }
    }
    if failures.is_empty() {
        Ok((examined, continued, repeated))
    } else {
        Err(failures)
    }
}

fn with_replaced(old: &str, new: &str) -> Vec<(PathBuf, String)> {
    let mut files = files();
    let mut n = 0;
    for (path, text) in &mut files {
        *text = text.replace("\r\n", "\n");
        if path.ends_with("defs/objects/city-props.toml") && text.contains(old) {
            *text = text.replacen(old, new, 1);
            n += 1;
        }
    }
    assert_eq!(n, 1, "'{old}' must appear once");
    files
}

#[test]
fn no_object_rect_slices_through_its_art() {
    let (examined, continued, repeated) =
        audit(&defs_from(&files())).unwrap_or_else(|f| panic!("{}", f.join("\n")));
    assert!(examined >= 11, "examined only {examined} objects");
    assert!(continued >= 4, "only {continued} sibling-continued edges");
    assert_eq!(
        repeated, 1,
        "the flight's rows 45-47 are the one allowed repeat"
    );
}

#[test]
fn the_old_one_cell_cut_flight_fails_naming_the_key() {
    let files = with_replaced(
        "y = 13, w = 32, h = 32 }\nwidth = 2\nheight = 2",
        "y = 13, w = 32, h = 16 }\nwidth = 2\nheight = 1",
    );
    let msg = audit(&defs_from(&files)).unwrap_err().join("\n");
    assert!(
        msg.contains("platform_stair_flight") && msg.contains("South"),
        "{msg}"
    );
}

#[test]
fn a_shortened_street_bottom_railing_fails_naming_the_uncovered_row() {
    let defs = defs_from(&files());
    let s = &defs
        .objects
        .iter()
        .find(|o| o.key == "stairwell_bottom_railing")
        .unwrap()
        .sprite;
    let short = Rect {
        x: s.x,
        y: s.y,
        w: s.w,
        h: s.h - 1,
    };
    let msg = audit_with(&defs, &[("stairwell_bottom_railing", short)])
        .unwrap_err()
        .join(
            "
",
        );
    assert_eq!(msg.lines().count(), 1, "{msg}");
    assert_eq!(
        msg,
        "stairwell_bottom_railing: sprite rect is cut on its South edge: 48 opaque pixel(s) continue outside it, sheet span 0..48"
    );
}

const SHEET_W: u32 = 4;

/// `#` opaque colour A, `@` opaque colour B, `.` transparent.
fn buf(rows: &[&str]) -> (Vec<u8>, u32) {
    let h = rows.len() as u32;
    let mut v = vec![0u8; (SHEET_W * h * 4) as usize];
    for (y, r) in rows.iter().enumerate() {
        for (x, c) in r.chars().enumerate() {
            let i = (y * SHEET_W as usize + x) * 4;
            match c {
                '#' => v[i..i + 4].copy_from_slice(&[10, 10, 10, 255]),
                '@' => v[i..i + 4].copy_from_slice(&[200, 0, 0, 255]),
                _ => {}
            }
        }
    }
    (v, h)
}

#[test]
fn synthetic_cut_no_cut_and_sibling_cases() {
    // Whole art in the rect: no cut. Interior-to-sheet only.
    let (b, h) = buf(&["....", ".##.", ".##.", "...."]);
    assert!(
        cut_edges(
            &b,
            SHEET_W,
            h,
            &[Rect {
                x: 1,
                y: 1,
                w: 2,
                h: 2
            }]
        )
        .is_empty()
    );
    // Art runs on south, not a repeat of what is inside: cut.
    let (b, h) = buf(&["....", "..#.", ".##.", ".#..", "...."]);
    let rect = Rect {
        x: 1,
        y: 1,
        w: 2,
        h: 2,
    };
    let e = cut_edges(&b, SHEET_W, h, &[rect]);
    assert_eq!(e.len(), 1);
    assert_eq!(
        (e[0].edge, e[0].span, e[0].count, e[0].allowed()),
        (Edge::South, (1, 2), 1, false)
    );
    // Continued by a sibling covering the pixel below: allowed.
    let r = [
        rect,
        Rect {
            x: 1,
            y: 3,
            w: 1,
            h: 1,
        },
    ];
    assert!(
        cut_edges(&b, SHEET_W, h, &r)
            .iter()
            .filter(|e| e.rect == 0)
            .all(|e| e.continued)
    );
    // A sibling covering another column does not continue it.
    let r = [
        rect,
        Rect {
            x: 2,
            y: 3,
            w: 1,
            h: 1,
        },
    ];
    let e = cut_edges(&b, SHEET_W, h, &r);
    assert!(
        e.iter()
            .any(|e| e.rect == 0 && e.edge == Edge::South && !e.allowed())
    );
    // Art that repeats the lines inside (period 1) loses nothing.
    let (b, h) = buf(&["....", ".##.", ".##.", ".##.", "...."]);
    let e = cut_edges(&b, SHEET_W, h, &[rect]);
    assert!(e.len() == 1 && e[0].repeats && e[0].allowed());

    // A period-2 repeat (the flight's real case) loses nothing.
    let (b, h) = buf(&["....", ".#@.", ".@#.", ".#@.", ".@#.", "...."]);
    let e = cut_edges(&b, SHEET_W, h, &[rect]);
    assert!(e.len() == 1 && e[0].repeats && e[0].allowed(), "{e:?}");
    // The first outside line repeats, the second is an end cap: not a repeat.
    let (b, h) = buf(&["....", ".#@.", ".@#.", ".#@.", ".##.", "...."]);
    let e = cut_edges(&b, SHEET_W, h, &[rect]);
    assert!(e.len() == 1 && !e[0].repeats && !e[0].allowed(), "{e:?}");
    // Equal in alpha, different in colour: not a repeat.
    let (b, h) = buf(&["....", ".##.", ".##.", ".@@.", "...."]);
    let e = cut_edges(&b, SHEET_W, h, &[rect]);
    assert!(e.len() == 1 && !e[0].repeats, "{e:?}");
}

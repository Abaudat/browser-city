//! Story 2.5: a fourth output of the same `defs-build` run, alongside
//! `defs.rs`/`defs.json`/the id manifest -- a single self-contained static
//! HTML page (no JS, no build step) that draws every object's declared
//! footprint/collider/`interact_at` over its own real, already-packed
//! atlas pixels, grouped by archetype, so a plausible-but-wrong footprint
//! (AC2's bench-marked-walk-through) is catchable by looking rather than
//! by an invariant. Written to [`crate::model::CONTACT_SHEET_PATH`],
//! committed like every other `defs-build` output and kept current by
//! `scripts/ci/check-defs-current.sh` -- AC3's "no manual step" holds by
//! construction, the same way it already does for the other three.
//!
//! Every number this module draws comes from [`crate::model::ObjectDef`]'s
//! own declared fields (Quentin's direction: never a re-derivation from
//! `collider_inset`, never a pixel/alpha read) -- this file never decodes
//! or composites a source image itself, and `scripts/ci/
//! check-no-runtime-footprint-inference.sh` greps this exact file to keep
//! that true. A thumbnail is drawn by referencing the already-committed
//! atlas page PNG with CSS `background-position`/`background-size`
//! (Quentin's direction: no compositing, no base64, no new image-encoding
//! path) -- every asset URL this module emits is a relative path from the
//! sheet's own location to a real file on disk, proven by this crate's own
//! `tests/contact_sheet_*.rs`.

use crate::model::{
    AtlasPageDef, AtlasRect, COLLIDER_SUBCELLS_PER_CELL, ColliderRect, INTERACT_AT_MAX_REACH_CELLS,
    ObjectDef,
};

/// Fixed integer upscale (Artie's direction): one collider sub-cell lands
/// on a whole 4px boundary, so a one-sub-cell error is visible. Never
/// fractional, never fit-to-box.
pub const SCALE: u32 = 4;

const COLOR_FOOTPRINT_STROKE: &str = "#f0f0f0";
const COLOR_GRID_STROKE: &str = "rgba(240,240,240,0.35)";
const COLOR_ANCHOR: &str = "#ffd23f";
const COLOR_COLLIDER_FILL: &str = "rgba(214,64,50,0.35)";
const COLOR_COLLIDER_STROKE: &str = "#d64032";
const COLOR_INTERACT_STROKE: &str = "#4fb0d8";
const COLOR_OVERHANG_TINT: &str = "rgba(255,255,255,0.10)";
const COLOR_OVERHANG_BASELINE: &str = "#ffffff";
const COLOR_WALKTHROUGH_HATCH: &str = "rgba(255,255,255,0.5)";

/// One rect in unscaled sheet-pixel space (the sprite's own native pixel
/// grid, before [`SCALE`] or the card's own padding is applied). `emit`
/// adds the pad offset once, at render time -- every projection below
/// stays in this one, undecorated coordinate space so it is trivial to
/// table-test.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The pure projection from an [`ObjectDef`]'s own declared geometry to
/// overlay rectangles in sheet pixel space (Quentin's direction) -- no
/// image, no pixel, just the numbers `emit_rust`/`emit_json` already
/// carry. `tile_size_px` is `defs/balance/render.toml`'s own
/// `render.tile_size_px` (never assumed 1 sub-cell == 1px: sub-cells
/// convert via [`COLLIDER_SUBCELLS_PER_CELL`] and this value together).
#[derive(Debug, Clone, PartialEq)]
pub struct ObjectGeometry {
    pub sprite_w: f64,
    pub sprite_h: f64,
    /// The footprint: the bottom `height * tile_size_px` rows of the
    /// sprite -- a tall prop overhangs upward, never sideways or downward
    /// (FR126, already enforced by `validate.rs`).
    pub footprint: Rect,
    pub footprint_cols: u32,
    pub footprint_rows: u32,
    /// The footprint's own min-x/max-y cell (its south-west corner) --
    /// the anchor-vs-north-west-origin distinction this sheet exists to
    /// make visible.
    pub anchor: Rect,
    /// The sprite region above the footprint, present only when the
    /// sprite overhangs (Tim's direction: the walk-behind band).
    pub overhang: Option<Rect>,
    /// `None` is a distinct, positive state (walk-through), never merely
    /// absent ink -- `emit`'s own card renders it as a chip and a hatch,
    /// never blank.
    pub collider: Option<Rect>,
    pub interact_at: Option<Rect>,
}

fn subcell_to_px(v: i32, tile_size_px: u32) -> f64 {
    v as f64 * tile_size_px as f64 / COLLIDER_SUBCELLS_PER_CELL as f64
}

fn collider_rect_to_px(c: &ColliderRect, footprint_top: f64, tile_size_px: u32) -> Rect {
    Rect {
        x: subcell_to_px(c.x0, tile_size_px),
        y: footprint_top + subcell_to_px(c.y0, tile_size_px),
        w: subcell_to_px(c.x1 - c.x0, tile_size_px),
        h: subcell_to_px(c.y1 - c.y0, tile_size_px),
    }
}

/// Projects one object's declared `width`/`height`/`collider`/
/// `interact_at` into [`ObjectGeometry`]. Pure, total: every `ObjectDef`
/// `validate.rs` ever produces has a sprite tall enough for its own
/// footprint (`h >= height * tile_size_px`, already enforced), so
/// `footprint_top` is never negative.
pub fn project(obj: &ObjectDef, tile_size_px: u32) -> ObjectGeometry {
    let sprite_w = obj.sprite.w as f64;
    let sprite_h = obj.sprite.h as f64;
    let footprint_w = obj.width as f64 * tile_size_px as f64;
    let footprint_h = obj.height as f64 * tile_size_px as f64;
    let footprint_top = sprite_h - footprint_h;
    let footprint = Rect {
        x: 0.0,
        y: footprint_top,
        w: footprint_w,
        h: footprint_h,
    };
    let anchor = Rect {
        x: 0.0,
        y: sprite_h - tile_size_px as f64,
        w: tile_size_px as f64,
        h: tile_size_px as f64,
    };
    let overhang = if footprint_top > 0.0 {
        Some(Rect {
            x: 0.0,
            y: 0.0,
            w: sprite_w,
            h: footprint_top,
        })
    } else {
        None
    };
    ObjectGeometry {
        sprite_w,
        sprite_h,
        footprint,
        footprint_cols: obj.width,
        footprint_rows: obj.height,
        anchor,
        overhang,
        collider: obj
            .collider
            .as_ref()
            .map(|c| collider_rect_to_px(c, footprint_top, tile_size_px)),
        interact_at: obj
            .interact_at
            .as_ref()
            .map(|c| collider_rect_to_px(c, footprint_top, tile_size_px)),
    }
}

/// One object's own display inputs, joined by the caller (`lib.rs`'s
/// `build`) from the validated [`ObjectDef`] (geometry, sprite, tags-as-
/// ids) and the pre-lowering [`crate::model::ObjectEntry`] (the archetype
/// key -- authoring-time only, never reachable from `Defs` itself -- and
/// the def's own file/line).
#[derive(Debug, Clone)]
pub struct CardInput<'a> {
    pub obj: &'a ObjectDef,
    pub layer_name: &'a str,
    pub archetype: Option<&'a str>,
    pub tag_keys: Vec<&'a str>,
    pub def_path: &'a str,
    pub def_line: usize,
    pub atlas: AtlasRect,
}

fn html_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

fn fmt_num(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{}", v as i64)
    } else {
        format!("{v:.3}")
    }
}

/// Groups `cards` by declared archetype, `None` (bespoke: declares its
/// own `height`/`collider` inline) sorted first (Artie's direction: the
/// outliers live there, never the leftovers at the bottom), then every
/// named archetype in key order. `Option<&str>`'s own `Ord` already puts
/// `None` before every `Some` (Rust's own total order), so a plain
/// `BTreeMap` gives this order for free -- never a `HashMap`, never a
/// special case.
fn group_and_sort<'a, 'b>(
    cards: &'b [CardInput<'a>],
) -> std::collections::BTreeMap<Option<&'a str>, Vec<&'b CardInput<'a>>> {
    let mut groups: std::collections::BTreeMap<Option<&'a str>, Vec<&'b CardInput<'a>>> =
        std::collections::BTreeMap::new();
    for c in cards {
        groups.entry(c.archetype).or_default().push(c);
    }
    for group in groups.values_mut() {
        // Footprint size then key (Artie's direction): an outlier is
        // visible by comparison only if similarly-sized props sit next to
        // each other; key breaks ties deterministically, never insertion
        // order.
        group.sort_by(|a, b| {
            (a.obj.width, a.obj.height, a.obj.key.as_str()).cmp(&(
                b.obj.width,
                b.obj.height,
                b.obj.key.as_str(),
            ))
        });
    }
    groups
}

fn leaf_filename(sheet: &str) -> &str {
    sheet.rsplit('/').next().unwrap_or(sheet)
}

const STYLE: &str = r#"
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0 0 2rem 0;
  background: #2b2b30;
  color: #e8e8ea;
  font: 14px/1.4 -apple-system, "Segoe UI", sans-serif;
}
header {
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #444;
  position: sticky;
  top: 0;
  background: #1c1c1f;
  z-index: 2;
}
header h1 { margin: 0 0 0.25rem 0; font-size: 1.1rem; }
#legend {
  position: sticky;
  top: 0;
  background: #1c1c1f;
  border-bottom: 1px solid #444;
  padding: 0.5rem 1.5rem;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  z-index: 1;
}
#legend .swatch { display: inline-block; width: 1rem; height: 1rem; vertical-align: middle; margin-right: 0.25rem; border: 1px solid #888; }
.swatch-footprint { border-style: dashed; }
.swatch-collider { background: rgba(214,64,50,0.35); border-color: #d64032; }
.swatch-interact { border-color: #4fb0d8; }
.swatch-overhang { background: rgba(255,255,255,0.10); }
section.group { padding: 1rem 1.5rem; }
section.group h2 { font-size: 1rem; border-bottom: 1px solid #444; padding-bottom: 0.25rem; }
.cards { display: flex; flex-wrap: wrap; gap: 1rem; align-items: flex-end; }
.card { background: #1c1c1f; border: 1px solid #3a3a3f; border-radius: 4px; padding: 0.5rem; display: flex; flex-direction: column; align-items: center; }
.card-body {
  position: relative;
  align-self: flex-end;
  background-color: #444;
  background-image:
    linear-gradient(45deg, #333 25%, transparent 25%), linear-gradient(-45deg, #333 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #333 75%), linear-gradient(-45deg, transparent 75%, #333 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0px;
}
.sprite { position: absolute; image-rendering: pixelated; image-rendering: crisp-edges; }
.overlay { position: absolute; left: 0; top: 0; }
.walkthrough-chip {
  position: absolute; top: 2px; left: 2px; z-index: 3;
  background: #000a; color: #fff; font-size: 10px; letter-spacing: 0.05em;
  padding: 1px 4px; border-radius: 2px; pointer-events: none;
}
dl.meta { margin: 0.5rem 0 0 0; font-size: 11px; width: 100%; }
dl.meta div { display: flex; justify-content: space-between; gap: 0.5rem; }
dl.meta dt { color: #999; }
dl.meta dd { margin: 0; text-align: right; word-break: break-all; }
"#;

const LEGEND_HTML: &str = r#"<div id="legend">
  <label><input type="checkbox" id="toggle-footprint" checked> <span class="swatch swatch-footprint"></span>footprint</label>
  <label><input type="checkbox" id="toggle-collider" checked> <span class="swatch swatch-collider"></span>collider</label>
  <label><input type="checkbox" id="toggle-interact" checked> <span class="swatch swatch-interact"></span>interact_at</label>
  <label><input type="checkbox" id="toggle-overhang" checked> <span class="swatch swatch-overhang"></span>overhang</label>
</div>
"#;

/// Per-layer show/hide via the checkbox hack (pure CSS, no JS): every
/// checkbox above is a sibling of `<main>`, so `:not(:checked) ~ main`
/// hides that layer's own class everywhere inside it.
const TOGGLE_STYLE: &str = r#"
#toggle-footprint:not(:checked) ~ main .layer-footprint { display: none; }
#toggle-collider:not(:checked) ~ main .layer-collider { display: none; }
#toggle-interact:not(:checked) ~ main .layer-interact { display: none; }
#toggle-overhang:not(:checked) ~ main .layer-overhang { display: none; }
"#;

fn render_card(card: &CardInput, tile_size_px: u32, atlas_pages: &[AtlasPageDef]) -> String {
    let geo = project(card.obj, tile_size_px);
    let pad = INTERACT_AT_MAX_REACH_CELLS as f64 * tile_size_px as f64;
    let padded_w = geo.sprite_w + 2.0 * pad;
    let padded_h = geo.sprite_h + 2.0 * pad;
    let page = &atlas_pages[card.atlas.page as usize];
    let image_href = format!("../../{}/{}", crate::model::ATLAS_PAGES_DIR, page.file);

    let mut svg = String::new();
    svg.push_str(&format!(
        "<svg class=\"overlay\" viewBox=\"0 0 {} {}\" width=\"{}\" height=\"{}\">",
        fmt_num(padded_w),
        fmt_num(padded_h),
        (padded_w as u32) * SCALE,
        (padded_h as u32) * SCALE,
    ));

    // Overhang band, drawn first (under everything else) plus its bold
    // baseline at the footprint's own top edge.
    if let Some(o) = &geo.overhang {
        svg.push_str(&format!(
            "<g class=\"layer-overhang\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{COLOR_OVERHANG_TINT}\" /><line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{COLOR_OVERHANG_BASELINE}\" stroke-width=\"1.5\" /></g>",
            fmt_num(pad + o.x), fmt_num(pad + o.y), fmt_num(o.w), fmt_num(o.h),
            fmt_num(pad + geo.footprint.x), fmt_num(pad + geo.footprint.y),
            fmt_num(pad + geo.footprint.x + geo.footprint.w), fmt_num(pad + geo.footprint.y),
        ));
    }

    // Footprint: dashed outline, interior cell grid lines, anchor marker.
    svg.push_str("<g class=\"layer-footprint\">");
    svg.push_str(&format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"{COLOR_FOOTPRINT_STROKE}\" stroke-width=\"1\" stroke-dasharray=\"2,2\" />",
        fmt_num(pad + geo.footprint.x), fmt_num(pad + geo.footprint.y), fmt_num(geo.footprint.w), fmt_num(geo.footprint.h)
    ));
    for i in 1..geo.footprint_cols {
        let x = pad + geo.footprint.x + i as f64 * tile_size_px as f64;
        svg.push_str(&format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{COLOR_GRID_STROKE}\" stroke-width=\"1\" />",
            fmt_num(x), fmt_num(pad + geo.footprint.y), fmt_num(x), fmt_num(pad + geo.footprint.y + geo.footprint.h)
        ));
    }
    for j in 1..geo.footprint_rows {
        let y = pad + geo.footprint.y + j as f64 * tile_size_px as f64;
        svg.push_str(&format!(
            "<line x1=\"{}\" y1=\"{}\" x2=\"{}\" y2=\"{}\" stroke=\"{COLOR_GRID_STROKE}\" stroke-width=\"1\" />",
            fmt_num(pad + geo.footprint.x), fmt_num(y), fmt_num(pad + geo.footprint.x + geo.footprint.w), fmt_num(y)
        ));
    }
    svg.push_str(&format!(
        "<rect class=\"anchor-marker\" x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{COLOR_ANCHOR}\" />",
        fmt_num(pad + geo.anchor.x + geo.anchor.w * 0.375),
        fmt_num(pad + geo.anchor.y + geo.anchor.h * 0.375),
        fmt_num(geo.anchor.w * 0.25),
        fmt_num(geo.anchor.h * 0.25),
    ));
    svg.push_str("</g>");

    // Collider: filled (an area question), or -- when absent -- a
    // positive walk-through hatch across the whole footprint, never
    // blank ink.
    svg.push_str("<g class=\"layer-collider\">");
    match &geo.collider {
        Some(c) => svg.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{COLOR_COLLIDER_FILL}\" stroke=\"{COLOR_COLLIDER_STROKE}\" stroke-width=\"1\" />",
            fmt_num(pad + c.x), fmt_num(pad + c.y), fmt_num(c.w), fmt_num(c.h)
        )),
        None => {
            let fp = &geo.footprint;
            svg.push_str(&format!(
                "<pattern id=\"hatch-{0}\" width=\"6\" height=\"6\" patternTransform=\"rotate(45)\" patternUnits=\"userSpaceOnUse\"><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"{COLOR_WALKTHROUGH_HATCH}\" stroke-width=\"2\" /></pattern>\
                 <rect x=\"{1}\" y=\"{2}\" width=\"{3}\" height=\"{4}\" fill=\"url(#hatch-{0})\" />",
                card.obj.id,
                fmt_num(pad + fp.x), fmt_num(pad + fp.y), fmt_num(fp.w), fmt_num(fp.h)
            ));
        }
    }
    svg.push_str("</g>");

    // interact_at: diagonally hatched, unfilled outline, drawn correctly
    // when it overspills the footprint -- that overspill is the point.
    if let Some(r) = &geo.interact_at {
        svg.push_str(&format!(
            "<g class=\"layer-interact\"><pattern id=\"interact-hatch-{0}\" width=\"6\" height=\"6\" patternTransform=\"rotate(-45)\" patternUnits=\"userSpaceOnUse\"><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"{COLOR_INTERACT_STROKE}\" stroke-width=\"1.5\" /></pattern>\
             <rect x=\"{1}\" y=\"{2}\" width=\"{3}\" height=\"{4}\" fill=\"url(#interact-hatch-{0})\" stroke=\"{COLOR_INTERACT_STROKE}\" stroke-width=\"1\" /></g>",
            card.obj.id,
            fmt_num(pad + r.x), fmt_num(pad + r.y), fmt_num(r.w), fmt_num(r.h)
        ));
    }

    svg.push_str("</svg>");

    let sprite_div = format!(
        "<div class=\"sprite\" style=\"left:{}px; top:{}px; width:{}px; height:{}px; background-image:url('{}'); background-position:-{}px -{}px; background-size:{}px {}px;\"></div>",
        (pad as u32) * SCALE,
        (pad as u32) * SCALE,
        card.obj.sprite.w * SCALE,
        card.obj.sprite.h * SCALE,
        image_href,
        card.atlas.x * SCALE,
        card.atlas.y * SCALE,
        page.width * SCALE,
        page.height * SCALE,
    );

    let walkthrough_chip = if geo.collider.is_none() {
        "<div class=\"walkthrough-chip layer-collider\">WALK-THROUGH</div>".to_string()
    } else {
        String::new()
    };

    let collider_text = match &card.obj.collider {
        Some(c) => format!("({}, {})-({}, {})", c.x0, c.y0, c.x1, c.y1),
        None => "none".to_string(),
    };
    let collider_attr = if card.obj.collider.is_some() {
        "collider"
    } else {
        "none"
    };
    let interact_text = match &card.obj.interact_at {
        Some(c) => format!("({}, {})-({}, {})", c.x0, c.y0, c.x1, c.y1),
        None => "none".to_string(),
    };
    let archetype_attr = card.archetype.unwrap_or("(none)");
    let tags_text = if card.tag_keys.is_empty() {
        "(none)".to_string()
    } else {
        card.tag_keys.join(", ")
    };

    format!(
        "<article class=\"card\" data-key=\"{key}\" data-id=\"{id}\" data-collider=\"{collider_attr}\" data-archetype=\"{archetype_attr_esc}\" data-width=\"{width}\" data-height=\"{height}\">\n\
         <div class=\"card-body\" style=\"width:{padded_w_px}px; height:{padded_h_px}px;\">{sprite_div}{svg}{walkthrough_chip}</div>\n\
         <dl class=\"meta\">\n\
         <div><dt>key</dt><dd>{key}</dd></div>\n\
         <div><dt>name</dt><dd>{name}</dd></div>\n\
         <div><dt>layer</dt><dd>{layer}</dd></div>\n\
         <div><dt>footprint</dt><dd>{width}&times;{height}</dd></div>\n\
         <div><dt>collider</dt><dd>{collider_text}</dd></div>\n\
         <div><dt>interact_at</dt><dd>{interact_text}</dd></div>\n\
         <div><dt>archetype</dt><dd>{archetype_attr_esc}</dd></div>\n\
         <div><dt>tags</dt><dd>{tags_text}</dd></div>\n\
         <div><dt>sheet</dt><dd>{sheet_leaf}</dd></div>\n\
         <div><dt>source</dt><dd>{def_path}:{def_line}</dd></div>\n\
         </dl>\n\
         </article>\n",
        key = html_escape(&card.obj.key),
        id = card.obj.id,
        collider_attr = collider_attr,
        archetype_attr_esc = html_escape(archetype_attr),
        width = card.obj.width,
        height = card.obj.height,
        padded_w_px = (padded_w as u32) * SCALE,
        padded_h_px = (padded_h as u32) * SCALE,
        sprite_div = sprite_div,
        svg = svg,
        walkthrough_chip = walkthrough_chip,
        name = html_escape(&card.obj.name),
        layer = html_escape(card.layer_name),
        collider_text = html_escape(&collider_text),
        interact_text = html_escape(&interact_text),
        tags_text = html_escape(&tags_text),
        sheet_leaf = html_escape(leaf_filename(&card.obj.sprite.sheet)),
        def_path = html_escape(card.def_path),
        def_line = card.def_line,
    )
}

/// Renders the whole contact sheet: one self-contained, `file://`-openable
/// HTML page, byte-deterministic for a given input (no timestamp, no
/// absolute path, no map-iteration order -- Tim's direction).
///
/// `manifest_hash` is a short hash over the same build's own id manifest
/// (`emit::emit_id_manifest`'s output) -- printed beside `defs_version` so
/// a reviewer can tell at a glance which build produced the sheet in
/// front of them (Quentin's direction).
pub fn build(
    cards: &[CardInput],
    tile_size_px: u32,
    atlas_pages: &[AtlasPageDef],
    defs_version: &str,
    manifest_hash: &str,
) -> String {
    let groups = group_and_sort(cards);
    let mut out = String::new();
    out.push_str("<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n");
    out.push_str("<!-- @generated by tools/defs-build -- do not edit by hand -->\n");
    out.push_str(&format!(
        "<title>Browser City contact sheet -- {}</title>\n",
        html_escape(defs_version)
    ));
    out.push_str("<style>\n");
    out.push_str(STYLE);
    out.push_str(TOGGLE_STYLE);
    out.push_str("</style>\n</head>\n<body>\n");
    out.push_str(&format!(
        "<header><h1>Contact sheet</h1><p>defs_version <code>{}</code> &middot; manifest sha256 <code>{}</code> &middot; {} object(s)</p></header>\n",
        html_escape(defs_version),
        html_escape(manifest_hash),
        cards.len()
    ));
    out.push_str(LEGEND_HTML);
    out.push_str("<main>\n");
    for (archetype, group_cards) in &groups {
        let heading = archetype.unwrap_or("(no archetype -- bespoke)");
        out.push_str(&format!(
            "<section class=\"group\" data-archetype=\"{}\">\n<h2>{}</h2>\n<div class=\"cards\">\n",
            html_escape(archetype.unwrap_or("(none)")),
            html_escape(heading)
        ));
        for card in group_cards {
            out.push_str(&render_card(card, tile_size_px, atlas_pages));
        }
        out.push_str("</div>\n</section>\n");
    }
    out.push_str("</main>\n</body>\n</html>\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::SpriteRect;

    fn sprite(w: u32, h: u32) -> SpriteRect {
        SpriteRect {
            sheet: "ModernTileset/x.png".into(),
            x: 0,
            y: 0,
            w,
            h,
        }
    }

    fn object(width: u32, height: u32, sprite_h: u32) -> ObjectDef {
        ObjectDef {
            id: 1,
            key: "obj".into(),
            name: "Obj".into(),
            layer: 2,
            sprite: sprite(width * 16, sprite_h),
            width,
            height,
            collider: None,
            interact_at: None,
            window: false,
            tags: vec![],
        }
    }

    // --- project(): table-driven geometry cases -----------------------

    #[test]
    fn a_1x1_prop_with_a_collider_projects_footprint_and_collider_flush_with_the_sprite() {
        let mut obj = object(1, 1, 16);
        obj.collider = Some(ColliderRect {
            x0: 4,
            y0: 4,
            x1: 12,
            y1: 12,
        });
        let geo = project(&obj, 16);
        assert_eq!(
            geo.footprint,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 16.0,
                h: 16.0
            }
        );
        assert_eq!(geo.footprint_cols, 1);
        assert_eq!(geo.footprint_rows, 1);
        assert!(geo.overhang.is_none());
        assert_eq!(
            geo.collider,
            Some(Rect {
                x: 4.0,
                y: 4.0,
                w: 8.0,
                h: 8.0
            })
        );
    }

    #[test]
    fn a_max_footprint_prop_projects_the_full_eight_by_eight_footprint() {
        let obj = object(8, 8, 128);
        let geo = project(&obj, 16);
        assert_eq!(
            geo.footprint,
            Rect {
                x: 0.0,
                y: 0.0,
                w: 128.0,
                h: 128.0
            }
        );
        assert_eq!((geo.footprint_cols, geo.footprint_rows), (8, 8));
    }

    #[test]
    fn a_prop_with_no_collider_projects_none_never_a_zero_rect() {
        let obj = object(1, 1, 16);
        let geo = project(&obj, 16);
        assert_eq!(geo.collider, None);
    }

    #[test]
    fn a_collider_that_does_not_start_at_the_footprint_origin_keeps_its_own_offset() {
        let mut obj = object(3, 1, 16);
        obj.collider = Some(ColliderRect {
            x0: 16,
            y0: 4,
            x1: 32,
            y1: 12,
        });
        let geo = project(&obj, 16);
        assert_eq!(
            geo.collider,
            Some(Rect {
                x: 16.0,
                y: 4.0,
                w: 16.0,
                h: 8.0
            })
        );
    }

    #[test]
    fn a_tall_overhanging_sprite_projects_the_footprint_at_the_bottom_and_an_overhang_band_above() {
        // A lamppost: 1x1 footprint, sprite four tiles tall.
        let obj = object(1, 1, 64);
        let geo = project(&obj, 16);
        assert_eq!(
            geo.footprint,
            Rect {
                x: 0.0,
                y: 48.0,
                w: 16.0,
                h: 16.0
            }
        );
        assert_eq!(
            geo.overhang,
            Some(Rect {
                x: 0.0,
                y: 0.0,
                w: 16.0,
                h: 48.0
            })
        );
        assert_eq!(
            geo.anchor,
            Rect {
                x: 0.0,
                y: 48.0,
                w: 16.0,
                h: 16.0
            }
        );
    }

    #[test]
    fn interact_at_extending_beyond_the_footprint_keeps_its_own_negative_and_overspilling_bounds() {
        let mut obj = object(1, 1, 16);
        obj.interact_at = Some(ColliderRect {
            x0: -16,
            y0: 0,
            x1: 32,
            y1: 16,
        });
        let geo = project(&obj, 16);
        assert_eq!(
            geo.interact_at,
            Some(Rect {
                x: -16.0,
                y: 0.0,
                w: 48.0,
                h: 16.0
            })
        );
    }

    #[test]
    fn a_tile_size_that_does_not_divide_subcells_evenly_is_never_assumed_one_subcell_one_pixel() {
        // tile_size_px = 24: 1 sub-cell = 24/16 = 1.5px, never 1px.
        let mut obj = object(1, 1, 24);
        obj.collider = Some(ColliderRect {
            x0: 0,
            y0: 0,
            x1: 16,
            y1: 16,
        });
        let geo = project(&obj, 24);
        assert_eq!(
            geo.collider,
            Some(Rect {
                x: 0.0,
                y: 0.0,
                w: 24.0,
                h: 24.0
            })
        );
    }

    // --- grouping/ordering: a total order, never HashMap order ---------

    fn card<'a>(obj: &'a ObjectDef, archetype: Option<&'a str>) -> CardInput<'a> {
        CardInput {
            obj,
            layer_name: "furniture",
            archetype,
            tag_keys: vec![],
            def_path: "defs/objects/x.toml",
            def_line: 1,
            atlas: AtlasRect {
                page: 0,
                x: 0,
                y: 0,
                w: obj.sprite.w,
                h: obj.sprite.h,
            },
        }
    }

    #[test]
    fn objects_naming_no_archetype_land_in_their_own_bucket_sorted_first() {
        let mut a = object(1, 1, 16);
        a.key = "zzz_bespoke".into();
        let mut b = object(1, 1, 16);
        b.key = "aaa_pole".into();

        let cards = vec![card(&b, Some("pole")), card(&a, None)];
        let groups = group_and_sort(&cards);
        let keys: Vec<Option<&str>> = groups.keys().copied().collect();
        assert_eq!(keys, vec![None, Some("pole")], "no-archetype bucket first");
    }

    #[test]
    fn within_a_group_cards_sort_by_footprint_size_then_key_never_insertion_order() {
        let mut wide = object(3, 1, 48);
        wide.key = "b_wide".into();
        let mut small = object(1, 1, 16);
        small.key = "a_small".into();
        let mut small2 = object(1, 1, 16);
        small2.key = "c_small".into();

        let cards = vec![
            card(&wide, Some("g")),
            card(&small2, Some("g")),
            card(&small, Some("g")),
        ];
        let groups = group_and_sort(&cards);
        let ordered: Vec<&str> = groups[&Some("g")]
            .iter()
            .map(|c| c.obj.key.as_str())
            .collect();
        assert_eq!(ordered, vec!["a_small", "c_small", "b_wide"]);
    }

    #[test]
    fn an_object_naming_no_archetype_is_never_silently_dropped() {
        let obj = object(1, 1, 16);
        let cards = vec![card(&obj, None)];
        let groups = group_and_sort(&cards);
        assert_eq!(groups.values().map(|v| v.len()).sum::<usize>(), 1);
    }

    // --- the renderer is never decorative: a declared-value mutation
    // changes the emitted, specific attribute that encodes it -----------

    fn atlas_pages() -> Vec<AtlasPageDef> {
        vec![AtlasPageDef {
            file: "street-0123456789abcdef.png".into(),
            group: "street".into(),
            width: 2048,
            height: 16,
        }]
    }

    #[test]
    fn changing_a_declared_width_changes_the_emitted_footprint_width_attribute() {
        let obj_a = object(1, 1, 16);
        let cards_a = vec![card(&obj_a, None)];
        let html_a = build(&cards_a, 16, &atlas_pages(), "v1", "m1");

        let mut obj_b = object(1, 1, 16);
        obj_b.sprite.w = 32;
        obj_b.width = 2;
        let cards_b = vec![card(&obj_b, None)];
        let html_b = build(&cards_b, 16, &atlas_pages(), "v1", "m1");

        assert!(html_a.contains("data-width=\"1\""));
        assert!(html_b.contains("data-width=\"2\""));
        assert_ne!(html_a, html_b);
    }

    #[test]
    fn changing_a_declared_collider_changes_the_emitted_collider_rect_never_the_sprite_bitmap() {
        let mut obj_a = object(1, 1, 16);
        obj_a.collider = Some(ColliderRect {
            x0: 0,
            y0: 0,
            x1: 8,
            y1: 8,
        });
        let cards_a = vec![card(&obj_a, None)];
        let html_a = build(&cards_a, 16, &atlas_pages(), "v1", "m1");

        let mut obj_b = object(1, 1, 16);
        obj_b.collider = Some(ColliderRect {
            x0: 8,
            y0: 8,
            x1: 16,
            y1: 16,
        });
        let cards_b = vec![card(&obj_b, None)];
        let html_b = build(&cards_b, 16, &atlas_pages(), "v1", "m1");

        assert_ne!(html_a, html_b);
        // Padded by INTERACT_AT_MAX_REACH_CELLS * tile_size_px (2 * 16 =
        // 32) on every side -- see `render_card`'s own `pad`.
        assert!(html_a.contains("x=\"32\" y=\"32\" width=\"8\" height=\"8\""));
        assert!(html_b.contains("x=\"40\" y=\"40\" width=\"8\" height=\"8\""));
    }

    #[test]
    fn a_card_with_every_layer_present_renders_interact_at_grid_lines_archetype_and_tags() {
        // A multi-cell, overhanging prop with a collider, an interact_at
        // and an archetype -- exercises every branch `render_card` has:
        // both grid-line loops (cols > 1, rows > 1), the overhang band,
        // the collider-present path and the interact_at-present path,
        // together, in one card.
        let mut obj = object(2, 2, 64);
        obj.collider = Some(ColliderRect {
            x0: 0,
            y0: 0,
            x1: 16,
            y1: 16,
        });
        obj.interact_at = Some(ColliderRect {
            x0: -16,
            y0: 32,
            x1: 48,
            y1: 48,
        });
        let mut c = card(&obj, Some("pole"));
        c.tag_keys = vec!["fixture", "seating"];
        let cards = vec![c];
        let html = build(&cards, 16, &atlas_pages(), "v1", "m1");
        assert!(html.contains("layer-interact"));
        assert!(html.contains("data-archetype=\"pole\""));
        assert!(html.contains("fixture, seating"));
        assert!(html.contains("layer-overhang"));
        // Two interior grid lines: one vertical (2-cell-wide footprint),
        // one horizontal (2-cell-tall footprint).
        assert_eq!(html.matches("stroke=\"rgba(240,240,240,0.35)\"").count(), 2);
    }

    #[test]
    fn a_fractional_subcell_conversion_renders_a_decimal_collider_rect() {
        // tile_size_px = 24: 1 sub-cell = 1.5px, so the rendered rect
        // carries a decimal, not a truncated integer.
        let mut obj = object(1, 1, 24);
        obj.collider = Some(ColliderRect {
            x0: 0,
            y0: 0,
            x1: 1,
            y1: 1,
        });
        let cards = vec![card(&obj, None)];
        let html = build(&cards, 24, &atlas_pages(), "v1", "m1");
        assert!(html.contains("width=\"1.500\" height=\"1.500\""));
    }

    #[test]
    fn a_walk_through_prop_is_marked_positively_never_by_blank_ink() {
        let obj = object(1, 1, 16);
        let cards = vec![card(&obj, None)];
        let html = build(&cards, 16, &atlas_pages(), "v1", "m1");
        assert!(html.contains("data-collider=\"none\""));
        assert!(html.contains("WALK-THROUGH"));
    }

    #[test]
    fn a_name_with_markup_characters_is_escaped() {
        let mut obj = object(1, 1, 16);
        obj.name = "<b>Bin</b> & \"friends\"".into();
        let cards = vec![card(&obj, None)];
        let html = build(&cards, 16, &atlas_pages(), "v1", "m1");
        assert!(!html.contains("<b>Bin</b>"));
        assert!(html.contains("&lt;b&gt;Bin&lt;/b&gt;"));
        assert!(html.contains("&amp;"));
    }

    #[test]
    fn build_is_byte_identical_across_two_calls_with_the_same_input() {
        let obj = object(1, 1, 16);
        let cards = vec![card(&obj, None)];
        let a = build(&cards, 16, &atlas_pages(), "v1", "m1");
        let b = build(&cards, 16, &atlas_pages(), "v1", "m1");
        assert_eq!(a, b);
    }

    #[test]
    fn the_header_carries_defs_version_and_the_manifest_hash() {
        let html = build(&[], 16, &atlas_pages(), "abc123", "deadbeef");
        assert!(html.contains("abc123"));
        assert!(html.contains("deadbeef"));
    }

    #[test]
    fn every_asset_url_is_a_relative_path_naming_the_objects_own_atlas_page() {
        let obj = object(1, 1, 16);
        let cards = vec![card(&obj, None)];
        let html = build(&cards, 16, &atlas_pages(), "v1", "m1");
        assert!(html.contains("url('../../client/public/atlas/street-0123456789abcdef.png')"));
    }
}

//! Evidence rendering for story 3.2 (`docs/generation.md`'s own Evidence
//! lines): one SVG per pass, per seed, land use as flat colour with
//! density carried as opacity, streets as tier-coloured bands on top --
//! never a game-facing render (Artie's direction: land-use colour is a
//! dev-only overview, never drawn in game). SVG because it is text, zero-
//! dependency and diffable, and needs no image crate (`sim` may not touch
//! the filesystem or pull in a rendering dependency; `bounds` already may,
//! same reasoning as `world_fixture.rs`). Lives in `bounds`, not `sim`, for
//! that same reason.
//!
//! Three seeds, not one (Artie's direction, cycle 1: "one seed cannot
//! show me the rules rather than a lucky roll"), each with a legend (so
//! nobody has to read Rust to know what a colour means) and, on the
//! street SVG, two 40x22-cell viewport outlines (one at the density
//! peak, one at the farthest-from-peak corner) so the per-screen reading
//! is judgeable directly from the image.
//!
//! `dump-generation` (the `regen-world-fixture` precedent) writes these
//! under `docs/generation/`; `tests/generation_evidence_current.rs`
//! regenerates and diffs on every server PR, so the picture Artie reviews
//! can never drift from the code that produced it.

use sim::generated::defs;
use sim::generation::{
    Block, BuildingTypeMap, EnvelopeMap, EnvelopeOutcome, GenerationConfig, GenerationContent,
    LandUse, PlotMap, Side, StreetClass, StreetNetwork, block_land_use, building_types,
    land_use::LandUseMap,
};

/// The three fixed seeds every evidence SVG renders -- committed once,
/// never re-rolled: a stable seed set is what lets a diff mean "the
/// generator changed", not "a different random plan happened to render".
pub const EVIDENCE_SEEDS: [u64; 3] = [1, 2, 3];

/// A 1080p viewport at 3x, in tiles (`docs/generation.md`'s own per-
/// screen framing) -- the outline size drawn on the street SVG.
const VIEWPORT_W: i32 = 40;
const VIEWPORT_H: i32 = 22;

fn land_use_fill(u: LandUse) -> &'static str {
    match u {
        LandUse::Residential => "#bfe3bf",
        LandUse::Commercial => "#bcd9f7",
        LandUse::Industrial => "#f2cf9e",
        LandUse::Institutional => "#ddc2ef",
    }
}

fn land_use_label(u: LandUse) -> &'static str {
    match u {
        LandUse::Residential => "residential",
        LandUse::Commercial => "commercial",
        LandUse::Industrial => "industrial",
        LandUse::Institutional => "institutional",
    }
}

fn street_fill(class: StreetClass) -> &'static str {
    match class {
        StreetClass::Arterial => "#2b2b2b",
        StreetClass::Street => "#6e6e6e",
        StreetClass::Lane => "#a6a6a6",
    }
}

fn street_label(class: StreetClass) -> &'static str {
    match class {
        StreetClass::Arterial => "arterial",
        StreetClass::Street => "street",
        StreetClass::Lane => "lane",
    }
}

/// Density (`cfg.density_min..=cfg.density_max`) mapped onto a 50%-100%
/// opacity band (Artie's direction, cycle 1: 30%-100% read too weak at
/// the low end to tell residential and institutional apart -- raised the
/// floor, integer arithmetic throughout (this is presentation code in
/// `bounds`, not `sim` -- NFR28's float ban is `sim`'s own rule -- but
/// there is no reason to reach for a float here either).
fn opacity_pct(density: i32, cfg: &GenerationConfig) -> i32 {
    let span = (cfg.density_max - cfg.density_min).max(1);
    let clamped = density.clamp(cfg.density_min, cfg.density_max);
    50 + (clamped - cfg.density_min) * 50 / span
}

fn land_use_rects(map: &LandUseMap, cfg: &GenerationConfig, base_opacity_pct: i32) -> String {
    let mut body = String::new();
    for cy in 0..map.rows() {
        for cx in 0..map.cols() {
            let c = map
                .coarse_at(cx, cy)
                .expect("every coarse cell is assigned");
            let x = cx * map.cell_size();
            let y = cy * map.cell_size();
            let size = map.cell_size();
            let opacity_pct = (opacity_pct(c.density, cfg) * base_opacity_pct) / 100;
            body.push_str(&format!(
                "<rect x=\"{x}\" y=\"{y}\" width=\"{size}\" height=\"{size}\" fill=\"{}\" fill-opacity=\"0.{:02}\"/>\n",
                land_use_fill(c.use_),
                opacity_pct.clamp(0, 99)
            ));
        }
    }
    body
}

/// A legend strip drawn in a margin below the map itself -- outside the
/// site extent, so it never reads as part of the generated ground
/// (Artie's direction: no minimap, legend or overlay *in game*; this is
/// dev-only evidence, a different claim).
fn land_use_legend(y0: i64) -> String {
    let mut body = String::new();
    let mut x = 8;
    for u in LandUse::ALL {
        body.push_str(&format!(
            "<rect x=\"{x}\" y=\"{}\" width=\"16\" height=\"16\" fill=\"{}\"/>\n",
            y0 + 4,
            land_use_fill(u)
        ));
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#111\">{}</text>\n",
            x + 20,
            y0 + 16,
            land_use_label(u)
        ));
        x += 140;
    }
    body
}

/// Both legends stacked in one margin (four land uses, then three street
/// tiers) -- Artie's direction, cycle 2: the street SVG's own legend
/// named the tiers but not the land-use tint it also draws.
fn combined_legend(y0: i64) -> String {
    let mut body = String::new();
    body.push_str(&land_use_legend(y0));
    let mut x = 8;
    for class in [
        StreetClass::Arterial,
        StreetClass::Street,
        StreetClass::Lane,
    ] {
        body.push_str(&format!(
            "<rect x=\"{x}\" y=\"{}\" width=\"16\" height=\"16\" fill=\"{}\"/>\n",
            y0 + 32,
            street_fill(class)
        ));
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#111\">{}</text>\n",
            x + 20,
            y0 + 44,
            street_label(class)
        ));
        x += 110;
    }
    body
}

/// Pass 1's own evidence: land use, flat colour, density as opacity, plus
/// a legend in the margin below.
pub fn land_use_svg(map: &LandUseMap, cfg: &GenerationConfig) -> String {
    let site = map.site();
    let (w, h) = (site.width(), site.height());
    let legend_h = 28;
    let total_h = h + legend_h;
    let body = land_use_rects(map, cfg, 100);
    let legend = land_use_legend(h);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{total_h}\" viewBox=\"0 0 {w} {total_h}\">\n\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{total_h}\" fill=\"#ffffff\"/>\n\
         {body}{legend}</svg>\n"
    )
}

/// The world-cell centre of `map`'s own density peak, and of the coarse
/// cell farthest (Chebyshev) from it -- the two viewport outlines drawn
/// on the street SVG.
fn peak_and_far_points(map: &LandUseMap) -> ((i32, i32), (i32, i32)) {
    let (peak_cx, peak_cy) = map.density_peak();
    let corners = [
        (0, 0),
        (map.cols() - 1, 0),
        (0, map.rows() - 1),
        (map.cols() - 1, map.rows() - 1),
    ];
    let (far_cx, far_cy) = corners
        .into_iter()
        .max_by_key(|&(x, y)| (x - peak_cx).abs().max((y - peak_cy).abs()))
        .unwrap();
    let to_world = |cx: i32, cy: i32| {
        (
            map.site().x0 + cx * map.cell_size() + map.cell_size() / 2,
            map.site().y0 + cy * map.cell_size() + map.cell_size() / 2,
        )
    };
    (to_world(peak_cx, peak_cy), to_world(far_cx, far_cy))
}

fn viewport_outline(
    center_x: i32,
    center_y: i32,
    site: sim::generation::SiteBounds,
    stroke: &str,
    label: &str,
) -> String {
    let x = (center_x - VIEWPORT_W / 2).clamp(site.x0, site.x1 - VIEWPORT_W);
    let y = (center_y - VIEWPORT_H / 2).clamp(site.y0, site.y1 - VIEWPORT_H);
    format!(
        "<rect x=\"{x}\" y=\"{y}\" width=\"{VIEWPORT_W}\" height=\"{VIEWPORT_H}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1\"/>\n\
         <text x=\"{x}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"6\" fill=\"{stroke}\">{label}</text>\n",
        y - 2
    )
}

/// Every finished block's own land use, flat colour, at `opacity_pct`'s
/// own floor (density does not vary within a block's own tint here --
/// the point of this backdrop is which use owns the block, not its
/// density) -- Artie's direction, cycle 2: one land use per block,
/// decided by majority coarse-cell area ([`block_land_use`]), so a
/// change of tint only ever happens at a real block edge (a street),
/// never mid-block the way a per-coarse-cell tint could.
fn block_rects(map: &LandUseMap, net: &StreetNetwork) -> String {
    let mut body = String::new();
    for b in net.blocks() {
        let use_ = block_land_use(map, b.bounds);
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" fill-opacity=\"0.55\"/>\n",
            b.bounds.x0,
            b.bounds.y0,
            b.bounds.width(),
            b.bounds.height(),
            land_use_fill(use_)
        ));
    }
    body
}

/// Pass 2's own evidence: one flat land-use tint per block (never per
/// coarse cell -- Artie's direction, cycle 2), streets on top by tier, a
/// combined legend, and two 40x22-cell viewport outlines (density peak,
/// farthest periphery) -- Artie's direction, cycle 1.
pub fn streets_svg(map: &LandUseMap, net: &StreetNetwork) -> String {
    let site = net.site();
    let (w, h) = (site.width(), site.height());
    let legend_h = 56;
    let total_h = h + legend_h;
    let mut body = block_rects(map, net);
    for e in net.edges() {
        let r = e.rect();
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>\n",
            r.x0,
            r.y0,
            r.width(),
            r.height(),
            street_fill(e.class)
        ));
    }
    let (peak_point, far_point) = peak_and_far_points(map);
    body.push_str(&viewport_outline(
        peak_point.0,
        peak_point.1,
        site,
        "#d81b60",
        "core",
    ));
    body.push_str(&viewport_outline(
        far_point.0,
        far_point.1,
        site,
        "#1e88e5",
        "periphery",
    ));
    let legend = combined_legend(h);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{total_h}\" viewBox=\"0 0 {w} {total_h}\">\n\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{total_h}\" fill=\"#ffffff\"/>\n\
         {body}{legend}</svg>\n"
    )
}

/// Where the committed evidence for `seed` lives -- absolute, resolved
/// from this crate's own manifest dir (`crate::world_fixture::
/// repo_root_dir`'s idiom), never relative to whatever directory a
/// caller happened to run `cargo run` from.
pub fn land_use_svg_path(seed: u64) -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join(format!("land-use-seed-{seed}.svg"))
}

pub fn streets_svg_path(seed: u64) -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join(format!("street-network-seed-{seed}.svg"))
}

pub fn envelopes_svg_path(seed: u64) -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join(format!("envelopes-seed-{seed}.svg"))
}

pub fn building_types_svg_path(seed: u64) -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join(format!("building-types-seed-{seed}.svg"))
}

/// A plot's own front-edge segment, in world cells -- the heavier stroke
/// `plots_svg` draws and the anchor `envelopes_svg`'s own door tick is
/// drawn from.
fn front_edge_segment(bounds: sim::world::Rect, front: Side) -> (i32, i32, i32, i32) {
    match front {
        Side::North => (bounds.x0, bounds.y0, bounds.x1, bounds.y0),
        Side::South => (bounds.x0, bounds.y1, bounds.x1, bounds.y1),
        Side::West => (bounds.x0, bounds.y0, bounds.x0, bounds.y1),
        Side::East => (bounds.x1, bounds.y0, bounds.x1, bounds.y1),
    }
}

fn front_edge_midpoint(bounds: sim::world::Rect, front: Side) -> (i32, i32) {
    match front {
        Side::North => ((bounds.x0 + bounds.x1) / 2, bounds.y0),
        Side::South => ((bounds.x0 + bounds.x1) / 2, bounds.y1),
        Side::West => (bounds.x0, (bounds.y0 + bounds.y1) / 2),
        Side::East => (bounds.x1, (bounds.y0 + bounds.y1) / 2),
    }
}

/// A short outward-pointing offset from `front`'s own edge -- the door
/// tick's own direction, always away from the building's own interior.
fn front_edge_outward(front: Side) -> (i32, i32) {
    match front {
        Side::North => (0, -4),
        Side::South => (0, 4),
        Side::West => (-4, 0),
        Side::East => (4, 0),
    }
}

/// `<style>` classes shared by every rect/line this module draws --
/// `class=` instead of repeating `fill`/`fill-opacity`/`stroke`/`stroke-
/// width` on every one of the thousands of elements a 512-cell district
/// draws, which is most of this file's own byte weight.
const STYLE_DEFS: &str = "<defs><pattern id=\"open-hatch\" width=\"5\" height=\"5\" patternTransform=\"rotate(45)\" patternUnits=\"userSpaceOnUse\"><rect width=\"5\" height=\"5\" fill=\"#f2f2f2\"/><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"5\" stroke=\"#9e9e9e\" stroke-width=\"2\"/></pattern><pattern id=\"rejected-hatch\" width=\"5\" height=\"5\" patternTransform=\"rotate(-45)\" patternUnits=\"userSpaceOnUse\"><rect width=\"5\" height=\"5\" fill=\"#fde0e0\"/><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"5\" stroke=\"#c0392b\" stroke-width=\"2\"/></pattern></defs>\n<style>.plot{stroke:#999;stroke-width:0.5}.yard{fill-opacity:0.25;stroke:#999;stroke-width:0.5}.open{fill:url(#open-hatch);stroke:#999;stroke-width:0.5}.rejected{fill:url(#rejected-hatch);stroke:#c0392b;stroke-width:0.5}.envelope{fill-opacity:0.9;stroke:#111;stroke-width:0.5}.front{stroke:#d81b60;stroke-width:2}</style>\n";

/// Every plot's own yard backdrop (a lighter tint of its own block's own
/// use, `open` plots hatched, `rejected` plots hatched red so a reviewer
/// never mistakes a missing-tooth rejection for an empty yard) and every
/// placed envelope's own footprint (a darker, opaque fill of the same
/// tint, a door tick on its own front edge) -- the same file, and the
/// same legend, serves both the plot-subdivision and building-envelope
/// evidence rows.
fn plot_and_envelope_rects(pm: &PlotMap, em: &EnvelopeMap) -> String {
    let mut body = String::new();
    let rejected: std::collections::BTreeSet<u32> = em
        .outcomes()
        .iter()
        .filter_map(|o| match o {
            EnvelopeOutcome::Rejected { plot, .. } => Some(*plot),
            EnvelopeOutcome::Placed(_) => None,
        })
        .collect();
    for (i, p) in pm.plots().iter().enumerate() {
        let class = if p.open {
            "plot open"
        } else if rejected.contains(&(i as u32)) {
            "plot rejected"
        } else {
            "plot yard"
        };
        let fill = if p.open || rejected.contains(&(i as u32)) {
            String::new()
        } else {
            format!(" fill=\"{}\"", land_use_fill(p.land_use))
        };
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" class=\"{class}\"{fill}/>\n",
            p.bounds.x0,
            p.bounds.y0,
            p.bounds.width(),
            p.bounds.height(),
        ));
        if let Some(front) = p.front {
            let (x0, y0, x1, y1) = front_edge_segment(p.bounds, front);
            body.push_str(&format!(
                "<line x1=\"{x0}\" y1=\"{y0}\" x2=\"{x1}\" y2=\"{y1}\" class=\"front\"/>\n"
            ));
        }
    }
    for outcome in em.outcomes() {
        let EnvelopeOutcome::Placed(e) = outcome else {
            continue;
        };
        let plot = &pm.plots()[e.plot as usize];
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" class=\"envelope\" fill=\"{}\"/>\n",
            e.footprint.x0,
            e.footprint.y0,
            e.footprint.width(),
            e.footprint.height(),
            land_use_fill(plot.land_use)
        ));
        let (mx, my) = front_edge_midpoint(e.footprint, e.front);
        let (dx, dy) = front_edge_outward(e.front);
        body.push_str(&format!(
            "<line x1=\"{mx}\" y1=\"{my}\" x2=\"{}\" y2=\"{}\" class=\"front\"/>\n",
            mx + dx,
            my + dy
        ));
    }
    body
}

fn plots_and_envelopes_legend(y0: i64) -> String {
    let mut body = land_use_legend(y0);
    let swatch = |x: i32, y: i64, class: &str, fill: Option<&str>, label: &str| -> String {
        let fill_attr = fill.map(|f| format!(" fill=\"{f}\"")).unwrap_or_default();
        format!(
            "<rect x=\"{x}\" y=\"{y}\" width=\"16\" height=\"16\" class=\"{class}\"{fill_attr}/>\n\
             <text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#111\">{label}</text>\n",
            x + 20,
            y + 12
        )
    };
    body.push_str(&swatch(8, y0 + 32, "plot yard", Some("#bfe3bf"), "yard"));
    body.push_str(&swatch(
        140,
        y0 + 32,
        "plot envelope",
        Some("#bfe3bf"),
        "envelope",
    ));
    body.push_str(&swatch(280, y0 + 32, "plot open", None, "open plot"));
    body.push_str(&swatch(400, y0 + 32, "plot rejected", None, "rejected"));
    body.push_str(&format!(
        "<line x1=\"8\" y1=\"{}\" x2=\"24\" y2=\"{}\" class=\"front\"/>\n\
         <text x=\"30\" y=\"{}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#111\">front edge / door</text>\n",
        y0 + 60,
        y0 + 60,
        y0 + 64
    ));
    body
}

/// A nested, self-contained `<svg>` cropped to `(vx, vy, vw, vh)` (world
/// cells) and scaled to fill a `(w, h)` screen box at `(x, y)` -- SVG's
/// own `viewBox` does the crop-and-scale, so `body` (the full-site
/// content) is reused verbatim rather than re-filtered by bounds.
#[allow(clippy::too_many_arguments)]
fn nested_view(
    body: &str,
    x: i64,
    y: i64,
    w: i64,
    h: i64,
    vx: i32,
    vy: i32,
    vw: i32,
    vh: i32,
    stroke: &str,
    label: &str,
) -> String {
    format!(
        "<text x=\"{x}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"11\" fill=\"{stroke}\">{label}</text>\n\
         <svg x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" viewBox=\"{vx} {vy} {vw} {vh}\">\n\
         <rect x=\"{vx}\" y=\"{vy}\" width=\"{vw}\" height=\"{vh}\" fill=\"#ffffff\"/>\n\
         {body}</svg>\n\
         <rect x=\"{x}\" y=\"{y}\" width=\"{w}\" height=\"{h}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"2\"/>\n",
        y - 4
    )
}

/// Among a district's own residential blocks (the one land use the two
/// insets below always compare, so plot packing alone is what differs
/// between them, never a land-use difference too), the one nearest the
/// density peak and the one farthest from it, by centre point -- `None`
/// if the district has no residential block at all.
fn residential_core_and_periphery_points(
    map: &LandUseMap,
    net: &StreetNetwork,
) -> Option<((i32, i32), (i32, i32))> {
    let (peak_point, _) = peak_and_far_points(map);
    let residential: Vec<&Block> = net
        .blocks()
        .iter()
        .filter(|b| block_land_use(map, b.bounds) == LandUse::Residential)
        .collect();
    let centre = |b: &Block| {
        (
            (b.bounds.x0 + b.bounds.x1) / 2,
            (b.bounds.y0 + b.bounds.y1) / 2,
        )
    };
    let dist = |c: (i32, i32)| (c.0 - peak_point.0).abs().max((c.1 - peak_point.1).abs());
    let core = residential
        .iter()
        .map(|b| centre(b))
        .min_by_key(|&c| dist(c))?;
    let periphery = residential
        .iter()
        .map(|b| centre(b))
        .max_by_key(|&c| dist(c))?;
    Some((core, periphery))
}

/// The one evidence document for both plot subdivision (pass 3) and the
/// building envelope (pass 4) -- `docs/generation.md`'s own Evidence
/// lines for both passes cite this same file, since the envelope SVG
/// already draws every plot's own outline and front edge underneath its
/// envelopes. Block tint and streets as the backdrop (`streets_svg`'s own
/// base), every plot's own yard (a lighter tint, `open` ones hatched grey,
/// rejected ones hatched red), every placed envelope (a darker, opaque
/// fill, a door tick on its own front edge), plus two insets at viewport
/// scale -- a 12x11 envelope is unreadable at 512-cell scale, so this is
/// the only scale the street wall, the 0-or-2 gaps and the build line can
/// actually be judged at. Both insets are the district's own residential
/// blocks specifically (the core one and the farthest-periphery one), so
/// plot packing alone is what differs between them, never a land-use
/// difference too.
pub fn envelopes_svg(
    map: &LandUseMap,
    net: &StreetNetwork,
    pm: &PlotMap,
    em: &EnvelopeMap,
) -> String {
    let site = net.site();
    let (w, h) = (site.width(), site.height());
    let legend_h = 88;
    // The inset frames are exactly 40:22, so "viewport scale" is
    // literally the viewport: a renderer that does not clip shows no
    // more rows than the viewBox names.
    let inset_w: i64 = (w / 2) - 12;
    let inset_box_h: i64 = inset_w * VIEWPORT_H as i64 / VIEWPORT_W as i64;
    let inset_h: i64 = inset_box_h + 32;
    let total_h = h + legend_h + inset_h;
    let mut body = block_rects(map, net);
    for e in net.edges() {
        let r = e.rect();
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>\n",
            r.x0,
            r.y0,
            r.width(),
            r.height(),
            street_fill(e.class)
        ));
    }
    body.push_str(&plot_and_envelope_rects(pm, em));

    // The insets reuse `body` verbatim (cropped and scaled by their own
    // `viewBox`) -- captured *before* the main map's own outline overlay
    // is appended, so that overlay's own small, main-map-scale label text
    // is never magnified into an oversized inset label (found by a
    // rendered screenshot, not by eye on the raw SVG text).
    let content_for_insets = body.clone();

    let (core_point, periphery_point) =
        residential_core_and_periphery_points(map, net).unwrap_or_else(|| peak_and_far_points(map));
    body.push_str(&viewport_outline(
        core_point.0,
        core_point.1,
        site,
        "#d81b60",
        "core",
    ));
    body.push_str(&viewport_outline(
        periphery_point.0,
        periphery_point.1,
        site,
        "#1e88e5",
        "periphery",
    ));

    let inset_y = h + legend_h + 24;
    let core_vx = (core_point.0 - VIEWPORT_W / 2).clamp(site.x0, site.x1 - VIEWPORT_W);
    let core_vy = (core_point.1 - VIEWPORT_H / 2).clamp(site.y0, site.y1 - VIEWPORT_H);
    let periphery_vx = (periphery_point.0 - VIEWPORT_W / 2).clamp(site.x0, site.x1 - VIEWPORT_W);
    let periphery_vy = (periphery_point.1 - VIEWPORT_H / 2).clamp(site.y0, site.y1 - VIEWPORT_H);
    let insets = nested_view(
        &content_for_insets,
        8,
        inset_y,
        inset_w,
        inset_box_h,
        core_vx,
        core_vy,
        VIEWPORT_W,
        VIEWPORT_H,
        "#d81b60",
        "residential core (viewport scale)",
    ) + &nested_view(
        &content_for_insets,
        16 + inset_w,
        inset_y,
        inset_w,
        inset_box_h,
        periphery_vx,
        periphery_vy,
        VIEWPORT_W,
        VIEWPORT_H,
        "#1e88e5",
        "residential periphery (viewport scale)",
    );

    let legend = plots_and_envelopes_legend(h);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{total_h}\" viewBox=\"0 0 {w} {total_h}\">\n\
         {STYLE_DEFS}<rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{total_h}\" fill=\"#ffffff\"/>\n\
         {body}{legend}{insets}</svg>\n"
    )
}

/// Story 3.4's own evidence: every placed envelope tinted by a *derived
/// structural class* (Derek's direction, PR #317 cycle 3: a hashed tag-
/// set tint collided -- two unrelated types could share a swatch, and a
/// reviewer could no longer tell low from high dwellings or homes from
/// workplaces. Structure, never a tag literal, never a hash: is the
/// `per` basis of a committed distribution row (housing); is named by a
/// committed coherence row's own `subject` or `within` (the two form
/// extremes); has posts (`professions` non-empty, workplace); both
/// housing and posts (mixed use -- the corner shop); none of the above
/// (vacant / yard) -- six stable classes, a fixed palette, no collision
/// possible), a distinct marker for every type that is the *subject of
/// a committed distribution row this pass actually feeds* ("sited by a
/// rule" is the data-derived definition of "civic", never a tag name),
/// plus the catchment grid pass 5's own allocation is scoped to, each
/// cell annotated per distribution row with dwellings/owed/placed, and
/// a physically-short catchment (the same exemption `inv_generation_no_
/// quadrant_lacks_its_required_services` grants) marked so a reviewer
/// never mistakes real land scarcity for a placement bug.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum TypeClass {
    Housing,
    FormSubject,
    FormWithin,
    Workplace,
    MixedUse,
    VacantOrYard,
}

fn class_tint(c: TypeClass) -> &'static str {
    match c {
        TypeClass::Housing => "#7cb342",
        TypeClass::FormSubject => "#c0392b",
        TypeClass::FormWithin => "#c8e6c9",
        TypeClass::Workplace => "#3498db",
        TypeClass::MixedUse => "#8e44ad",
        TypeClass::VacantOrYard => "#95a5a6",
    }
}

fn class_label(c: TypeClass) -> &'static str {
    match c {
        TypeClass::Housing => "housing",
        TypeClass::FormSubject => "housing (high-rise)",
        TypeClass::FormWithin => "housing (low-rise)",
        TypeClass::Workplace => "workplace",
        TypeClass::MixedUse => "mixed use",
        TypeClass::VacantOrYard => "vacant / yard",
    }
}

/// The tag sets [`building_type_class`] classifies structurally against
/// -- every committed distribution row's own `per` tag (housing), and
/// every committed coherence row's own `subject`/`within` tags (the two
/// form extremes), read generically through `as_distribution`/`as_
/// coherence`, never a tag key literal.
struct ClassTags {
    per: std::collections::BTreeSet<u32>,
    form_subject: std::collections::BTreeSet<u32>,
    form_within: std::collections::BTreeSet<u32>,
}

fn class_tags(content: &GenerationContent) -> ClassTags {
    ClassTags {
        per: content
            .rules
            .iter()
            .filter_map(|r| r.as_distribution())
            .map(|r| r.per)
            .collect(),
        form_subject: content
            .rules
            .iter()
            .filter_map(|r| r.as_coherence())
            .map(|r| r.subject)
            .collect(),
        form_within: content
            .rules
            .iter()
            .filter_map(|r| r.as_coherence())
            .map(|r| r.within)
            .collect(),
    }
}

/// A type's own derived class -- structure, not a name: mixed use wins
/// over either half alone (both housing and posts), a form extreme wins
/// over plain housing (so a coherence-named type keeps its own distinct
/// tint rather than reading as ordinary housing), and "none of the
/// above" is vacant/yard.
fn building_type_class(def: &defs::BuildingTypeDef, tags: &ClassTags) -> TypeClass {
    let is_housing = def.tags.iter().any(|t| tags.per.contains(t));
    let has_posts = !def.professions.is_empty();
    if is_housing && has_posts {
        return TypeClass::MixedUse;
    }
    if def.tags.iter().any(|t| tags.form_subject.contains(t)) {
        return TypeClass::FormSubject;
    }
    if def.tags.iter().any(|t| tags.form_within.contains(t)) {
        return TypeClass::FormWithin;
    }
    if is_housing {
        return TypeClass::Housing;
    }
    if has_posts {
        return TypeClass::Workplace;
    }
    TypeClass::VacantOrYard
}

const MARKER_SHAPES: [&str; 6] = ["circle", "square", "triangle", "diamond", "star", "plus"];

/// Every committed `[[distribution]]` row this pass actually feeds (its
/// own `per` tag is carried by at least one committed building type --
/// the same scope `catchment_overlay` and the AC3 invariants already
/// hold to, never an earlier story's own unrelated row, e.g. street
/// furniture), sorted by rule id -- the marker palette's own index
/// order, so it stays stable across a run and does not depend on
/// iteration order. The *one* list both the map markers and the legend
/// read their shape index from (PR #317 cycle 3: a second, `placed`-
/// filtered list with its own independent index was the off-by-one --
/// map and legend must draw from one list).
fn scoped_distribution_rows(content: &GenerationContent) -> Vec<sim::rules::DistributionRow> {
    let mut rows: Vec<sim::rules::DistributionRow> = content
        .rules
        .iter()
        .filter_map(|r| r.as_distribution())
        .filter(|row| {
            content
                .building_types
                .iter()
                .any(|b| b.tags.contains(&row.per))
        })
        .collect();
    rows.sort_by_key(|r| r.id);
    rows
}

/// `None` if `def` is not the subject of any row in `rows`; otherwise
/// the marker shape assigned to that row's own position in `rows`.
fn marker_shape_for(
    rows: &[sim::rules::DistributionRow],
    def: &defs::BuildingTypeDef,
) -> Option<&'static str> {
    rows.iter()
        .position(|r| def.tags.contains(&r.subject))
        .map(|i| MARKER_SHAPES[i % MARKER_SHAPES.len()])
}

/// One small SVG marker, centred on `(cx, cy)`, shaped by `shape` --
/// distinct enough at a glance that two civic tags never read the same
/// even before the legend is checked.
fn marker(cx: i32, cy: i32, shape: &str, stroke: &str) -> String {
    let r = 5;
    match shape {
        "square" => format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n",
            cx - r,
            cy - r,
            r * 2,
            r * 2
        ),
        "triangle" => format!(
            "<polygon points=\"{},{} {},{} {},{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n",
            cx,
            cy - r,
            cx - r,
            cy + r,
            cx + r,
            cy + r
        ),
        "diamond" => format!(
            "<polygon points=\"{},{} {},{} {},{} {},{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n",
            cx,
            cy - r,
            cx + r,
            cy,
            cx,
            cy + r,
            cx - r,
            cy
        ),
        "star" => format!(
            "<polygon points=\"{},{} {},{} {},{} {},{} {},{}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n",
            cx,
            cy - r,
            cx + r / 3,
            cy - r / 3,
            cx + r,
            cy,
            cx + r / 3,
            cy + r / 3,
            cx,
            cy + r
        ),
        "plus" => format!(
            "<line x1=\"{}\" y1=\"{cy}\" x2=\"{}\" y2=\"{cy}\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n\
             <line x1=\"{cx}\" y1=\"{}\" x2=\"{cx}\" y2=\"{}\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n",
            cx - r,
            cx + r,
            cy - r,
            cy + r
        ),
        _ => format!(
            "<circle cx=\"{cx}\" cy=\"{cy}\" r=\"{r}\" fill=\"none\" stroke=\"{stroke}\" stroke-width=\"1.5\"/>\n"
        ),
    }
}

/// Every catchment's own per/owed/placed/eligible figures, per
/// committed distribution row -- shared by [`catchment_map_wash`] (the
/// map's own pink-wash-only overlay) and [`catchment_panel`] (the text
/// panel below the map), so the two never compute it two different
/// ways.
struct CatchmentFigures {
    dist_rows: Vec<sim::rules::DistributionRow>,
    catchments: std::collections::BTreeSet<(i32, i32)>,
    per: std::collections::BTreeMap<(u32, i32, i32), u64>,
    placed: std::collections::BTreeMap<(u32, i32, i32), u64>,
    /// Hard-eligible, unclaimed candidate count per (row, catchment) --
    /// the count-only half of the physical-shortage exemption (never
    /// the full min-spacing packing check `sim/tests/invariants.rs`
    /// runs; this is a visual aid, not a gate).
    eligible: std::collections::BTreeMap<(u32, i32, i32), u64>,
}

impl CatchmentFigures {
    fn owed(&self, row_id: u32, c: (i32, i32)) -> u64 {
        let per = self.per.get(&(row_id, c.0, c.1)).copied().unwrap_or(0);
        let ratio = self
            .dist_rows
            .iter()
            .find(|r| r.id == row_id)
            .map(|r| r.ratio.max(1) as u64)
            .unwrap_or(1);
        per / ratio
    }

    fn is_exempt(&self, row_id: u32, c: (i32, i32)) -> bool {
        let owed = self.owed(row_id, c);
        owed > 0 && self.eligible.get(&(row_id, c.0, c.1)).copied().unwrap_or(0) < owed
    }
}

fn catchment_figures(
    site: sim::generation::SiteBounds,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    by_id: &std::collections::BTreeMap<u32, &defs::BuildingTypeDef>,
    pm: &PlotMap,
    bt: &BuildingTypeMap,
    em: &EnvelopeMap,
) -> CatchmentFigures {
    let extent = cfg.building_type_catchment_extent_cells.max(1);
    let front_of_envelope: std::collections::BTreeMap<u32, (i32, i32)> = em
        .envelopes()
        .map(|e| {
            (
                e.plot,
                sim::generation::site::front_cell(e.footprint, e.front),
            )
        })
        .collect();
    let dist_rows = scoped_distribution_rows(content);
    let all_subject_tags: std::collections::BTreeSet<u32> =
        dist_rows.iter().map(|r| r.subject).collect();
    let assigned_by_plot: std::collections::BTreeMap<u32, u32> = bt
        .assignments()
        .iter()
        .map(|a| (a.plot, a.building_type))
        .collect();

    let mut catchments: std::collections::BTreeSet<(i32, i32)> = std::collections::BTreeSet::new();
    let mut per: std::collections::BTreeMap<(u32, i32, i32), u64> =
        std::collections::BTreeMap::new();
    let mut placed: std::collections::BTreeMap<(u32, i32, i32), u64> =
        std::collections::BTreeMap::new();
    for a in bt.assignments() {
        let Some(&(x, y)) = front_of_envelope.get(&a.plot) else {
            continue;
        };
        let c = building_types::catchment_of(x, y, site, extent);
        catchments.insert(c);
        let def = by_id[&a.building_type];
        for row in &dist_rows {
            if def.tags.contains(&row.per) {
                *per.entry((row.id, c.0, c.1)).or_insert(0) += 1;
            }
            if def.tags.contains(&row.subject) {
                *placed.entry((row.id, c.0, c.1)).or_insert(0) += 1;
            }
        }
    }

    let mut eligible: std::collections::BTreeMap<(u32, i32, i32), u64> =
        std::collections::BTreeMap::new();
    for row in &dist_rows {
        let subject_defs: Vec<&defs::BuildingTypeDef> = content
            .building_types
            .iter()
            .filter(|b| b.tags.contains(&row.subject))
            .collect();
        for e in em.envelopes() {
            let plot = &pm.plots()[e.plot as usize];
            let interior_w = e.along_face_cells() - 2 * cfg.envelope_wall_thickness_cells as i64;
            let interior_d = e.depth_cells() - 2 * cfg.envelope_wall_thickness_cells as i64;
            let hard_eligible = subject_defs.iter().any(|b| {
                b.land_uses[plot.land_use as usize]
                    && plot.density >= b.density_min
                    && plot.density <= b.density_max
                    && (b.min_interior_width_cells as i64) <= interior_w
                    && (b.min_interior_depth_cells as i64) <= interior_d
            });
            if !hard_eligible {
                continue;
            }
            let assigned_def = by_id[&assigned_by_plot[&e.plot]];
            let consumed_by_a_sibling_row = assigned_def
                .tags
                .iter()
                .any(|t| *t != row.subject && all_subject_tags.contains(t));
            if consumed_by_a_sibling_row {
                continue;
            }
            let Some(&(x, y)) = front_of_envelope.get(&e.plot) else {
                continue;
            };
            let c = building_types::catchment_of(x, y, site, extent);
            catchments.insert(c);
            *eligible.entry((row.id, c.0, c.1)).or_insert(0) += 1;
        }
    }

    CatchmentFigures {
        dist_rows,
        catchments,
        per,
        placed,
        eligible,
    }
}

/// The map's own catchment overlay: dashed gridlines and, for any
/// catchment that used the physical-shortage exemption on at least one
/// row, a light pink wash -- never text (Derek's direction, PR #317
/// cycle 4: the five-line label plates covered half a catchment and hid
/// the buildings under them; the per-catchment figures move to
/// [`catchment_panel`], below the map).
fn catchment_map_wash(
    site: sim::generation::SiteBounds,
    extent: i32,
    figures: &CatchmentFigures,
) -> String {
    let extent = extent.max(1);
    let mut body = String::new();
    for &(gx, gy) in &figures.catchments {
        let any_exempt = figures
            .dist_rows
            .iter()
            .any(|row| figures.is_exempt(row.id, (gx, gy)));
        if !any_exempt {
            continue;
        }
        let cx = site.x0 + gx * extent;
        let cy = site.y0 + gy * extent;
        body.push_str(&format!(
            "<rect x=\"{cx}\" y=\"{cy}\" width=\"{}\" height=\"{}\" fill=\"#fde0e0\" fill-opacity=\"0.4\"/>\n",
            extent.min(site.x1 - cx),
            extent.min(site.y1 - cy),
        ));
    }
    let mut x = site.x0;
    while x < site.x1 {
        body.push_str(&format!(
            "<line x1=\"{x}\" y1=\"{}\" x2=\"{x}\" y2=\"{}\" stroke=\"#555\" stroke-width=\"1\" stroke-dasharray=\"4 3\"/>\n",
            site.y0, site.y1
        ));
        x += extent;
    }
    let mut y = site.y0;
    while y < site.y1 {
        body.push_str(&format!(
            "<line x1=\"{}\" y1=\"{y}\" x2=\"{}\" y2=\"{y}\" stroke=\"#555\" stroke-width=\"1\" stroke-dasharray=\"4 3\"/>\n",
            site.x0, site.x1
        ));
        y += extent;
    }
    body
}

/// The catchment figures panel, below the map (Derek's direction, PR
/// #317 cycle 4): one line per catchment, keyed by its own `(gx, gy)`
/// coordinate (never assumed to be exactly four quadrants -- a larger
/// site earns more catchments by the same row), every committed
/// distribution row's own per/owed/placed on that line, an asterisk on
/// a row that used the physical-shortage exemption. Returns the body
/// and the panel's own height.
fn catchment_panel(figures: &CatchmentFigures, y0: i64) -> (String, i64) {
    let mut body = String::new();
    body.push_str(&format!(
        "<text x=\"8\" y=\"{}\" font-family=\"sans-serif\" font-size=\"11\" fill=\"#111\">Catchments (per / owed / placed, * = physical-shortage exemption):</text>\n",
        y0 + 14
    ));
    let mut y = y0 + 30;
    for &c in &figures.catchments {
        let mut line = format!("({}, {}): ", c.0, c.1);
        for row in &figures.dist_rows {
            let per = figures.per.get(&(row.id, c.0, c.1)).copied().unwrap_or(0);
            let owed = figures.owed(row.id, c);
            let placed = figures
                .placed
                .get(&(row.id, c.0, c.1))
                .copied()
                .unwrap_or(0);
            let star = if figures.is_exempt(row.id, c) {
                "*"
            } else {
                ""
            };
            line.push_str(&format!("{}: {per}/{owed}/{placed}{star}   ", row.key));
        }
        body.push_str(&format!(
            "<text x=\"8\" y=\"{y}\" font-family=\"monospace\" font-size=\"9\" fill=\"#333\">{}</text>\n",
            line.trim_end()
        ));
        y += 14;
    }
    (body, y - y0)
}

/// Columns that fit within a `w`-wide canvas at 170px each, never a
/// fixed count that can run wider than the map itself (Derek's
/// direction, PR #317 cycle 3: 4 columns at 160px ran to 640px on a
/// 512px site, off the right edge).
fn legend_cols(w: i64) -> i64 {
    (w / 170).max(1)
}

/// The legend's own two halves, both derived from the district's own
/// *placed* types, never from the full committed catalog (so the
/// legend only ever shows what the map itself draws): one swatch per
/// distinct [`TypeClass`] actually placed, labelled by its own fixed
/// name (never a tag union -- six stable classes need no more); one
/// marker per distribution row that actually placed a subject, its
/// shape read from `dist_rows`'s own position (never a second,
/// `placed`-filtered list's own index -- PR #317 cycle 3's own fix for
/// the map/legend mismatch). Wrapped at [`legend_cols`] so nothing runs
/// off the canvas.
fn building_types_legend(
    placed_defs: &[&defs::BuildingTypeDef],
    tags: &ClassTags,
    dist_rows: &[sim::rules::DistributionRow],
    w: i64,
    y0: i64,
) -> String {
    let mut body = String::new();
    let cols = legend_cols(w);
    let col_w = w / cols;

    let placed_classes: std::collections::BTreeSet<TypeClass> = placed_defs
        .iter()
        .map(|def| building_type_class(def, tags))
        .collect();
    let mut row = 0i64;
    for (i, class) in placed_classes.iter().enumerate() {
        let col = i as i64 % cols;
        row = row.max(i as i64 / cols);
        let x = 8 + col * col_w;
        let y = y0 + 4 + (i as i64 / cols) * 20;
        body.push_str(&format!(
            "<rect x=\"{x}\" y=\"{y}\" width=\"14\" height=\"14\" fill=\"{}\"/>\n",
            class_tint(*class)
        ));
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"10\" fill=\"#111\">{}</text>\n",
            x + 18,
            y + 12,
            class_label(*class)
        ));
    }
    let tint_rows = row + 1;

    let mut drawn = 0i64;
    for (i, r) in dist_rows.iter().enumerate() {
        if !placed_defs.iter().any(|d| d.tags.contains(&r.subject)) {
            continue;
        }
        let shape = MARKER_SHAPES[i % MARKER_SHAPES.len()];
        let col = drawn % cols;
        let x = 8 + col * col_w;
        let y = y0 + 8 + tint_rows * 20 + (drawn / cols) * 20;
        body.push_str(&marker(x as i32 + 7, y as i32, shape, "#111"));
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"10\" fill=\"#111\">{}</text>\n",
            x + 18,
            y + 4,
            r.key
        ));
        drawn += 1;
    }
    body
}

/// Pass 5's own evidence: the same block/street backdrop as `envelopes_
/// svg`, every placed envelope tinted by its own derived [`TypeClass`],
/// a distinct marker over every envelope whose own assigned type is the
/// subject of a committed distribution row, the catchment grid (a pink
/// wash over a physically-short catchment, no text on the map itself --
/// Derek's direction, PR #317 cycle 4), a legend derived from what this
/// district actually places rather than hand-named, and a catchment
/// figures panel below everything.
pub fn building_types_svg(
    map: &LandUseMap,
    net: &StreetNetwork,
    pm: &PlotMap,
    em: &EnvelopeMap,
    bt: &BuildingTypeMap,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> String {
    let site = net.site();
    let (w, h) = (site.width(), site.height());
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let tags = class_tags(content);
    let dist_rows = scoped_distribution_rows(content);
    let placed_ids: std::collections::BTreeSet<u32> =
        bt.assignments().iter().map(|a| a.building_type).collect();
    let placed_defs: Vec<&defs::BuildingTypeDef> = placed_ids.iter().map(|id| by_id[id]).collect();

    let cols = legend_cols(w);
    let placed_class_count = placed_defs
        .iter()
        .map(|def| building_type_class(def, &tags))
        .collect::<std::collections::BTreeSet<_>>()
        .len() as i64;
    let placed_row_count = dist_rows
        .iter()
        .filter(|r| placed_defs.iter().any(|d| d.tags.contains(&r.subject)))
        .count() as i64;
    let legend_rows = (placed_class_count + cols - 1) / cols + (placed_row_count + cols - 1) / cols;
    let legend_h = 40 + legend_rows * 20;

    let figures = catchment_figures(site, cfg, content, &by_id, pm, bt, em);
    let panel_h = 30 + figures.catchments.len() as i64 * 14 + 10;
    let total_h = h + legend_h + panel_h;

    let mut body = block_rects(map, net);
    for e in net.edges() {
        let r = e.rect();
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>\n",
            r.x0,
            r.y0,
            r.width(),
            r.height(),
            street_fill(e.class)
        ));
    }

    for outcome in em.outcomes() {
        let EnvelopeOutcome::Placed(e) = outcome else {
            continue;
        };
        let Some(a) = bt.assignments().iter().find(|a| a.plot == e.plot) else {
            continue;
        };
        let def = by_id[&a.building_type];
        let plot = &pm.plots()[e.plot as usize];
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"#999\" stroke-width=\"0.5\"/>\n",
            plot.bounds.x0,
            plot.bounds.y0,
            plot.bounds.width(),
            plot.bounds.height(),
        ));
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" fill-opacity=\"0.9\" stroke=\"#111\" stroke-width=\"0.5\"/>\n",
            e.footprint.x0,
            e.footprint.y0,
            e.footprint.width(),
            e.footprint.height(),
            class_tint(building_type_class(def, &tags))
        ));
        if let Some(shape) = marker_shape_for(&dist_rows, def) {
            let (mx, my) = front_edge_midpoint(e.footprint, e.front);
            body.push_str(&marker(mx, my, shape, "#111"));
        }
    }

    body.push_str(&catchment_map_wash(
        site,
        cfg.building_type_catchment_extent_cells,
        &figures,
    ));

    let legend = building_types_legend(&placed_defs, &tags, &dist_rows, w, h);
    let (panel, _) = catchment_panel(&figures, h + legend_h);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{total_h}\" viewBox=\"0 0 {w} {total_h}\">\n\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{total_h}\" fill=\"#ffffff\"/>\n\
         {body}{legend}{panel}</svg>\n"
    )
}

// --- pass 6: the interior layout -------------------------------------------

/// Pixels per world cell in the contact-sheet insets: a room is
/// unreadable at the 512-cell overview's one pixel per cell (Quentin's/
/// Artie's direction), readable at this.
const INTERIOR_CELL_PX: i64 = 9;
/// The widest footprint the envelope pass allows, in cells, on each axis
/// (a front on a side street turns a 20x16 footprint on its side) -- the
/// size of one contact-sheet slot.
const SHEET_SLOT_CELLS: (i64, i64) = (20, 20);
const SHEET_COLUMNS: i64 = 6;
const SHEET_PER_KIND: usize = 12;
/// Horizontal pitch of the legend columns, in pixels.
const LEGEND_PITCH: i64 = 190;

/// The contact sheet's own four panels, a derived structural kind each --
/// whether the type is a dwelling (the `per` basis of a distribution
/// row, the same derivation the building-type sheet's classes use) and,
/// for everything else, which land use it is sited on (the `land_uses`
/// mask, never a key).
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum SheetKind {
    Housing,
    Commercial,
    Industrial,
    Institutional,
}

impl SheetKind {
    const ALL: [SheetKind; 4] = [
        SheetKind::Housing,
        SheetKind::Commercial,
        SheetKind::Industrial,
        SheetKind::Institutional,
    ];

    fn label(self) -> &'static str {
        match self {
            SheetKind::Housing => "housing (and mixed use)",
            SheetKind::Commercial => "commercial workplaces",
            SheetKind::Industrial => "industrial workplaces",
            SheetKind::Institutional => "institutional workplaces",
        }
    }

    fn tint(self) -> &'static str {
        match self {
            SheetKind::Housing => "#7cb342",
            SheetKind::Commercial => "#3498db",
            SheetKind::Industrial => "#e67e22",
            SheetKind::Institutional => "#8e44ad",
        }
    }
}

fn sheet_kind(def: &defs::BuildingTypeDef, tags: &ClassTags) -> SheetKind {
    if def.tags.iter().any(|t| tags.per.contains(t)) {
        SheetKind::Housing
    } else if def.land_uses[3] {
        SheetKind::Institutional
    } else if def.land_uses[2] {
        SheetKind::Industrial
    } else {
        SheetKind::Commercial
    }
}

const ROOM_PALETTE: [&str; 13] = [
    "#ffe0b2", "#ffccbc", "#d7ccc8", "#f8bbd0", "#bbdefb", "#b3e5fc", "#cfd8dc", "#c8e6c9",
    "#e1bee7", "#fff9c4", "#b2dfdb", "#dcedc8", "#f0f4c3",
];
const FIXTURE_PALETTE: [&str; 12] = [
    "#d32f2f", "#1976d2", "#388e3c", "#f57c00", "#7b1fa2", "#0097a7", "#5d4037", "#c2185b",
    "#455a64", "#afb42b", "#512da8", "#00796b",
];

/// One interior drawn at `(ox, oy)` in a slot: the footprint as the dark
/// shell, each room a pale rect (tinted by its room type's position in
/// the committed table), each doorway white, the street door yellow with
/// a heavy stroke, each fixture a small square tinted by its tag.
fn interior_inset(
    interior: &sim::generation::Interior,
    content: &GenerationContent,
    fixture_tags: &[u32],
    ox: i64,
    oy: i64,
) -> String {
    let px = INTERIOR_CELL_PX;
    let fp = interior.footprint;
    let at = |x: i32, y: i32| (ox + (x - fp.x0) as i64 * px, oy + (y - fp.y0) as i64 * px);
    let mut s = String::new();
    s.push_str(&format!(
        "<rect x=\"{ox}\" y=\"{oy}\" width=\"{}\" height=\"{}\" fill=\"#37474f\"/>\n",
        fp.width() * px,
        fp.height() * px
    ));
    for r in &interior.rooms {
        let (x, y) = at(r.rect.x0, r.rect.y0);
        let idx = content
            .room_types
            .iter()
            .position(|t| t.id == r.room_type)
            .unwrap_or(0);
        s.push_str(&format!(
            "<rect x=\"{x}\" y=\"{y}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>\n",
            r.rect.width() * px,
            r.rect.height() * px,
            ROOM_PALETTE[idx % ROOM_PALETTE.len()]
        ));
    }
    for t in &interior.thresholds {
        let (x, y) = at(t.x, t.y);
        let fill = if t.entrance { "#ffeb3b" } else { "#ffffff" };
        s.push_str(&format!(
            "<rect x=\"{x}\" y=\"{y}\" width=\"{px}\" height=\"{px}\" fill=\"{fill}\" stroke=\"#d81b60\" stroke-width=\"{}\"/>\n",
            if t.entrance { 2 } else { 1 }
        ));
    }
    for f in &interior.fixtures {
        let (x, y) = at(f.x, f.y);
        let idx = fixture_tags.iter().position(|&t| t == f.tag).unwrap_or(0);
        s.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" stroke=\"#000\" stroke-width=\"0.5\"/>\n",
            x + 1,
            y + 1,
            px - 2,
            px - 2,
            FIXTURE_PALETTE[idx % FIXTURE_PALETTE.len()]
        ));
    }
    s
}

/// Pass 6's evidence (`docs/generation.md`'s Interior layout section):
/// the enterable set by kind as a footprint map (a shell grey, a
/// rejected building red -- none at the committed config), then a contact
/// sheet of [`SHEET_PER_KIND`] interiors per kind side by side at
/// viewport scale, so "a hundred places, not a hundred boxes" is judged
/// by eye, and a legend of every room type and fixture tag the sheet
/// shows. Rooms as rects, never one element per cell.
pub fn interiors_svg(
    net: &StreetNetwork,
    em: &EnvelopeMap,
    bt: &BuildingTypeMap,
    io: &sim::generation::InteriorMap,
    content: &GenerationContent,
) -> String {
    let site = net.site();
    let by_id: std::collections::BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let tags = class_tags(content);
    let kind_of_plot: std::collections::BTreeMap<u32, SheetKind> = bt
        .assignments()
        .iter()
        .map(|a| (a.plot, sheet_kind(by_id[&a.building_type], &tags)))
        .collect();
    let outcome_of_plot: std::collections::BTreeMap<u32, &sim::generation::InteriorOutcome> = io
        .outcomes()
        .iter()
        .map(|o| {
            let plot = match o {
                sim::generation::InteriorOutcome::Laid { plot, .. }
                | sim::generation::InteriorOutcome::Shell { plot, .. }
                | sim::generation::InteriorOutcome::Rejected { plot, .. } => *plot,
            };
            (plot, o)
        })
        .collect();

    // Every fixture tag the layouts actually placed, as the fixture
    // palette order -- read off the output, never a tag key.
    let mut fixture_tags: Vec<u32> = io
        .laid()
        .flat_map(|(_, _, i)| i.fixtures.iter().map(|f| f.tag))
        .collect();
    fixture_tags.sort_unstable();
    fixture_tags.dedup();

    let slot_w = SHEET_SLOT_CELLS.0 * INTERIOR_CELL_PX + 12;
    let slot_h = SHEET_SLOT_CELLS.1 * INTERIOR_CELL_PX + 22;
    let w = (SHEET_COLUMNS * slot_w + 16).max(site.width());

    // The overview: one rect per placed envelope, tinted by derived kind.
    let mut overview = String::new();
    for e in em.envelopes() {
        let fill = match outcome_of_plot.get(&e.plot) {
            Some(sim::generation::InteriorOutcome::Laid { .. }) => kind_of_plot[&e.plot].tint(),
            Some(sim::generation::InteriorOutcome::Rejected { .. }) => "#c0392b",
            _ => "#bdbdbd",
        };
        overview.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{fill}\"/>\n",
            e.footprint.x0,
            e.footprint.y0,
            e.footprint.width(),
            e.footprint.height()
        ));
    }

    let mut y = site.height() + 24;
    let mut legend = String::new();
    for (i, kind) in SheetKind::ALL.iter().enumerate() {
        legend.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"12\" height=\"12\" fill=\"{}\"/><text x=\"{}\" y=\"{y}\" font-family=\"sans-serif\" font-size=\"11\">{}</text>\n",
            8 + i as i64 * LEGEND_PITCH,
            y - 11,
            kind.tint(),
            24 + i as i64 * LEGEND_PITCH,
            kind.label()
        ));
    }
    legend.push_str(&format!(
        "<rect x=\"{}\" y=\"{}\" width=\"12\" height=\"12\" fill=\"#bdbdbd\"/><text x=\"{}\" y=\"{y}\" font-family=\"sans-serif\" font-size=\"11\">solid shell (no room program)</text>\n",
        8 + 4 * LEGEND_PITCH,
        y - 11,
        24 + 4 * LEGEND_PITCH
    ));
    y += 28;

    // The contact sheets.
    let mut sheets = String::new();
    for kind in SheetKind::ALL {
        let all: Vec<(u32, u32, &sim::generation::Interior)> = io
            .laid()
            .filter(|(plot, _, _)| kind_of_plot[plot] == kind)
            .collect();
        sheets.push_str(&format!(
            "<text x=\"8\" y=\"{y}\" font-family=\"sans-serif\" font-size=\"13\" font-weight=\"bold\">{}: {} of {} enterable</text>\n",
            kind.label(),
            SHEET_PER_KIND.min(all.len()),
            all.len()
        ));
        let stride = (all.len() / SHEET_PER_KIND).max(1);
        let picks: Vec<_> = all.iter().step_by(stride).take(SHEET_PER_KIND).collect();
        for (i, (_, ty, interior)) in picks.iter().enumerate() {
            let col = i as i64 % SHEET_COLUMNS;
            let row = i as i64 / SHEET_COLUMNS;
            let (ox, oy) = (8 + col * slot_w, y + 22 + row * slot_h);
            sheets.push_str(&format!(
                "<text x=\"{ox}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"9\">{} {}x{} r{}</text>\n",
                oy - 3,
                by_id[ty].key,
                interior.footprint.width(),
                interior.footprint.height(),
                interior.rooms.len()
            ));
            sheets.push_str(&interior_inset(interior, content, &fixture_tags, ox, oy));
        }
        let rows = (picks.len() as i64 + SHEET_COLUMNS - 1) / SHEET_COLUMNS;
        y += 22 + rows * slot_h + 12;
    }

    // The room-type and fixture legend, derived from the committed tables.
    let mut key = String::new();
    key.push_str(&format!(
        "<text x=\"8\" y=\"{y}\" font-family=\"sans-serif\" font-size=\"12\" font-weight=\"bold\">rooms (shell dark, doorway white, street door yellow with a pink stroke) and fixtures</text>\n"
    ));
    y += 8;
    for (i, r) in content.room_types.iter().enumerate() {
        let (cx, cy) = (
            8 + (i as i64 % 6) * LEGEND_PITCH,
            y + 14 + (i as i64 / 6) * 18,
        );
        key.push_str(&format!(
            "<rect x=\"{cx}\" y=\"{}\" width=\"12\" height=\"12\" fill=\"{}\" stroke=\"#777\" stroke-width=\"0.5\"/><text x=\"{}\" y=\"{cy}\" font-family=\"sans-serif\" font-size=\"11\">{}</text>\n",
            cy - 11,
            ROOM_PALETTE[i % ROOM_PALETTE.len()],
            cx + 16,
            r.key
        ));
    }
    y += 14 + ((content.room_types.len() as i64 + 5) / 6) * 18 + 6;
    for (i, &tag) in fixture_tags.iter().enumerate() {
        let name = content
            .tags
            .iter()
            .find(|t| t.id == tag)
            .map_or("?", |t| t.key);
        let (cx, cy) = (
            8 + (i as i64 % 6) * LEGEND_PITCH,
            y + 14 + (i as i64 / 6) * 18,
        );
        key.push_str(&format!(
            "<rect x=\"{cx}\" y=\"{}\" width=\"12\" height=\"12\" fill=\"{}\" stroke=\"#000\" stroke-width=\"0.5\"/><text x=\"{}\" y=\"{cy}\" font-family=\"sans-serif\" font-size=\"11\">{name}</text>\n",
            cy - 11,
            FIXTURE_PALETTE[i % FIXTURE_PALETTE.len()],
            cx + 16
        ));
    }
    y += 14 + ((fixture_tags.len() as i64 + 5) / 6) * 18 + 10;

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{y}\" viewBox=\"0 0 {w} {y}\">\n\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{y}\" fill=\"#ffffff\"/>\n\
         <rect x=\"0\" y=\"0\" width=\"{}\" height=\"{}\" fill=\"#f5f5f5\"/>\n\
         {overview}{legend}{sheets}{key}</svg>\n",
        site.width(),
        site.height()
    )
}

pub fn interiors_svg_path(seed: u64) -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join(format!("interiors-seed-{seed}.svg"))
}

/// Every evidence document [`EVIDENCE_SEEDS`] commits, for one seed.
/// `envelopes` serves both the plot-subdivision and building-envelope
/// Evidence rows in `docs/generation.md` -- one file for both passes.
pub struct EvidenceSvgs {
    pub seed: u64,
    pub land_use: String,
    pub streets: String,
    pub envelopes: String,
    pub building_types: String,
    pub interiors: String,
}

/// Builds every evidence SVG for every seed in [`EVIDENCE_SEEDS`] from
/// the live `defs::BALANCE` config -- the one place both `dump-
/// generation` and `tests/generation_evidence_current.rs` build them, so
/// the two can never drift in how they call `sim::generation`.
pub fn build_all() -> Vec<EvidenceSvgs> {
    let cfg = GenerationConfig::from_balance(sim::generated::defs::BALANCE)
        .expect("live defs/ must be a valid GenerationConfig");
    let content = GenerationContent::committed();
    EVIDENCE_SEEDS
        .iter()
        .map(|&seed| {
            let d = sim::generation::generate(seed, &cfg, &content)
                .expect("the live committed config must generate every evidence seed");
            EvidenceSvgs {
                seed,
                land_use: land_use_svg(&d.land_use, &cfg),
                streets: streets_svg(&d.land_use, &d.streets),
                envelopes: envelopes_svg(&d.land_use, &d.streets, &d.plots, &d.envelopes),
                building_types: building_types_svg(
                    &d.land_use,
                    &d.streets,
                    &d.plots,
                    &d.envelopes,
                    &d.building_types,
                    &cfg,
                    &content,
                ),
                interiors: interiors_svg(
                    &d.streets,
                    &d.envelopes,
                    &d.building_types,
                    &d.interiors,
                    &content,
                ),
            }
        })
        .collect()
}

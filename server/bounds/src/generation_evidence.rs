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

use sim::generation::{
    Block, EnvelopeMap, EnvelopeOutcome, GenerationConfig, GenerationContent, LandUse, PlotMap,
    Side, StreetClass, StreetNetwork, block_land_use, land_use::LandUseMap,
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

/// Every evidence document [`EVIDENCE_SEEDS`] commits, for one seed.
/// `envelopes` serves both the plot-subdivision and building-envelope
/// Evidence rows in `docs/generation.md` -- one file for both passes.
pub struct EvidenceSvgs {
    pub seed: u64,
    pub land_use: String,
    pub streets: String,
    pub envelopes: String,
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
            }
        })
        .collect()
}

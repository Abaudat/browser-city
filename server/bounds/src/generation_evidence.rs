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
    GenerationConfig, LandUse, StreetClass, StreetNetwork, land_use, land_use::LandUseMap,
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

fn street_legend(y0: i64) -> String {
    let mut body = String::new();
    let mut x = 8;
    for class in [
        StreetClass::Arterial,
        StreetClass::Street,
        StreetClass::Lane,
    ] {
        body.push_str(&format!(
            "<rect x=\"{x}\" y=\"{}\" width=\"16\" height=\"16\" fill=\"{}\"/>\n",
            y0 + 4,
            street_fill(class)
        ));
        body.push_str(&format!(
            "<text x=\"{}\" y=\"{}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#111\">{}</text>\n",
            x + 20,
            y0 + 16,
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

/// Pass 2's own evidence: land use dimmed as backdrop, streets on top by
/// tier, a legend, and two 40x22-cell viewport outlines (density peak,
/// farthest periphery) -- Artie's direction, cycle 1.
pub fn streets_svg(map: &LandUseMap, net: &StreetNetwork, cfg: &GenerationConfig) -> String {
    let site = net.site();
    let (w, h) = (site.width(), site.height());
    let legend_h = 28;
    let total_h = h + legend_h;
    let mut body = land_use_rects(map, cfg, 60);
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
    let legend = street_legend(h);
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

/// Builds both SVGs for every seed in [`EVIDENCE_SEEDS`] from the live
/// `defs::BALANCE` config -- the one place both `dump-generation` and
/// `tests/generation_evidence_current.rs` build them, so the two can
/// never drift in how they call `sim::generation`.
pub fn build_all() -> Vec<(u64, String, String)> {
    let cfg = GenerationConfig::from_balance(sim::generated::defs::BALANCE)
        .expect("live defs/ must be a valid GenerationConfig");
    EVIDENCE_SEEDS
        .iter()
        .map(|&seed| {
            let lu = land_use::run(seed, cfg.site(), &cfg)
                .expect("the live site is always a valid multiple of the coarse cell size");
            let net = sim::generation::streets::run(seed, &lu, &cfg);
            (seed, land_use_svg(&lu, &cfg), streets_svg(&lu, &net, &cfg))
        })
        .collect()
}

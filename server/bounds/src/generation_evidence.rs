//! Evidence rendering for story 3.2 (`docs/generation.md`'s own Evidence
//! lines): one SVG per pass, at a fixed seed, land use as flat colour with
//! density carried as opacity, streets as tier-coloured bands on top --
//! never a game-facing render (Artie's direction: land-use colour is a
//! dev-only overview, never drawn in game). SVG because it is text, zero-
//! dependency and diffable, and needs no image crate (`sim` may not touch
//! the filesystem or pull in a rendering dependency; `bounds` already may,
//! same reasoning as `world_fixture.rs`). Lives in `bounds`, not `sim`, for
//! that same reason.
//!
//! `dump-generation` (the `regen-world-fixture` precedent) writes these
//! under `docs/generation/`; `tests/generation_evidence_current.rs`
//! regenerates and diffs on every server PR, so the picture Artie reviews
//! can never drift from the code that produced it.

use sim::generation::{
    GenerationConfig, LandUse, StreetClass, StreetNetwork, land_use::LandUseMap,
};

/// The fixed seed both evidence SVGs render -- committed once, never
/// re-rolled: a stable seed is what lets a diff mean "the generator
/// changed", not "a different random plan happened to render".
pub const EVIDENCE_SEED: u64 = 1;

fn land_use_fill(u: LandUse) -> &'static str {
    match u {
        LandUse::Residential => "#bfe3bf",
        LandUse::Commercial => "#bcd9f7",
        LandUse::Industrial => "#f2cf9e",
        LandUse::Institutional => "#ddc2ef",
    }
}

fn street_fill(class: StreetClass) -> &'static str {
    match class {
        StreetClass::Arterial => "#2b2b2b",
        StreetClass::Street => "#6e6e6e",
        StreetClass::Lane => "#a6a6a6",
    }
}

/// Density (`cfg.density_min..=cfg.density_max`) mapped onto a 30%-100%
/// opacity band, integer arithmetic throughout (this is presentation
/// code in `bounds`, not `sim` -- NFR28's float ban is `sim`'s own rule
/// -- but there is no reason to reach for a float here either).
fn opacity_pct(density: i32, cfg: &GenerationConfig) -> i32 {
    let span = (cfg.density_max - cfg.density_min).max(1);
    let clamped = density.clamp(cfg.density_min, cfg.density_max);
    30 + (clamped - cfg.density_min) * 70 / span
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

/// Pass 1's own evidence: land use, flat colour, density as opacity --
/// nothing else, matching what the pass itself hands down.
pub fn land_use_svg(map: &LandUseMap, cfg: &GenerationConfig) -> String {
    let site = map.site();
    let (w, h) = (site.width(), site.height());
    let body = land_use_rects(map, cfg, 100);
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">\n\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/>\n\
         {body}</svg>\n"
    )
}

/// Pass 2's own evidence: land use dimmed to 40% as backdrop, streets on
/// top by tier -- tiers visually distinguishable by both width and
/// shade.
pub fn streets_svg(map: &LandUseMap, net: &StreetNetwork, cfg: &GenerationConfig) -> String {
    let site = net.site();
    let (w, h) = (site.width(), site.height());
    let mut body = land_use_rects(map, cfg, 40);
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
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{h}\" viewBox=\"0 0 {w} {h}\">\n\
         <rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{h}\" fill=\"#ffffff\"/>\n\
         {body}</svg>\n"
    )
}

/// Where the committed evidence lives -- absolute, resolved from this
/// crate's own manifest dir (`crate::world_fixture::repo_root_dir`'s
/// idiom), never relative to whatever directory a caller happened to run
/// `cargo run` from.
pub fn land_use_svg_path() -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join("land-use.svg")
}

pub fn streets_svg_path() -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join("street-network.svg")
}

/// Builds both SVGs at [`EVIDENCE_SEED`] from the live `defs::BALANCE`
/// config -- the one place both `dump-generation` and
/// `tests/generation_evidence_current.rs` build them, so the two can
/// never drift in how they call `sim::generation`.
pub fn build_both() -> (String, String) {
    let cfg = GenerationConfig::from_balance(sim::generated::defs::BALANCE)
        .expect("live defs/ must be a valid GenerationConfig");
    let lu = sim::generation::land_use::run(EVIDENCE_SEED, cfg.site(), &cfg);
    let net = sim::generation::streets::run(EVIDENCE_SEED, &lu, &cfg);
    (land_use_svg(&lu, &cfg), streets_svg(&lu, &net, &cfg))
}

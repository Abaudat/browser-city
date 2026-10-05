//! Evidence rendering for story 3.7 (FR113, `docs/generation.md`'s
//! "Neighbourhood parameters" Evidence line): per seed, four small panels
//! -- density, building age, affluence, land use -- with every block filled
//! flat over the street network so plateaus and street-aligned steps read
//! at a glance, then one boundary strip at viewport scale across the
//! sharpest adjacent difference in the district, with each side's figures
//! in a panel underneath. No text on a map; legends sit below. Age and
//! affluence are each a single-hue ramp where lightness carries the value,
//! never a red/green pair. Same regen-and-diff guard as the other passes.
//!
//! Content-blind like the rest of the generator's evidence
//! (`check-generator-no-content-keys.sh`): a shuttered unit is a commercial-
//! land type with no post, a shop type a commercial-land type with one --
//! derived, never named.

use std::collections::BTreeMap;

use sim::generated::defs;
use sim::generation::{
    District, GenerationConfig, GenerationContent, LandUse, Neighbourhood, SiteBounds,
    block_land_use,
};

use crate::generation_evidence::{
    building_type_class, class_label, class_tags, class_tint, front_edge_midpoint, land_use_fill,
    land_use_label, marker, marker_shape_for, scoped_distribution_rows, street_fill,
};

/// One panel's side, in drawn pixels; the map is drawn at half scale.
const PANEL: i64 = 256;
const GAP: i64 = 28;
const MARGIN: i64 = 16;
/// The boundary strip's drawn width: the screen plus whole front rows.
const STRIP_WIDTH: i64 = 528;

pub fn neighbourhoods_svg_path(seed: u64) -> std::path::PathBuf {
    crate::world_fixture::repo_root_dir()
        .join("docs")
        .join("generation")
        .join(format!("neighbourhoods-seed-{seed}.svg"))
}

fn pct(value: i32, lo: i32, hi: i32) -> i64 {
    ((value.clamp(lo, hi) - lo) as i64 * 100) / (hi - lo).max(1) as i64
}

/// Single hue, lightness carries the value: 90% (newer) down to 32% (older).
fn age_fill(age: i32, cfg: &GenerationConfig) -> String {
    let n = &cfg.neighbourhood;
    let p = pct(age, n.building_age_min, n.building_age_max);
    format!("hsl(28, 78%, {}%)", 90 - p * 58 / 100)
}

/// Single hue, lightness carries the value: 92% (poorer) down to 30% (richer).
fn affluence_fill(affluence: i32, cfg: &GenerationConfig) -> String {
    let n = &cfg.neighbourhood;
    let p = pct(affluence, n.affluence_min, n.affluence_max);
    format!("hsl(205, 70%, {}%)", 92 - p * 62 / 100)
}

fn density_fill(density: i32, cfg: &GenerationConfig) -> String {
    let p = pct(density, cfg.density_min, cfg.density_max);
    format!("hsl(0, 0%, {}%)", 94 - p * 68 / 100)
}

/// One half-scale panel: every block flat-filled by `fill`, every street on
/// top by tier, an outline.
fn panel(x: i64, y: i64, d: &District, fill: &dyn Fn(&sim::generation::Block) -> String) -> String {
    let mut body = format!("<g transform=\"translate({x},{y}) scale(0.5)\">\n");
    for b in d.streets.blocks() {
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\"/>\n",
            b.bounds.x0,
            b.bounds.y0,
            b.bounds.width(),
            b.bounds.height(),
            fill(b)
        ));
    }
    for e in d.streets.edges() {
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
    body.push_str("</g>\n");
    body.push_str(&format!(
        "<rect x=\"{x}\" y=\"{y}\" width=\"{PANEL}\" height=\"{PANEL}\" fill=\"none\" stroke=\"#444\" stroke-width=\"1\"/>\n"
    ));
    body
}

fn title(x: i64, y: i64, text: &str) -> String {
    format!(
        "<text x=\"{x}\" y=\"{y}\" font-family=\"sans-serif\" font-size=\"12\" fill=\"#111\">{text}</text>\n"
    )
}

/// Five swatches along a ramp with its two end names.
fn ramp_legend(y: i64, name: &str, low: &str, high: &str, fill: &dyn Fn(i32) -> String) -> String {
    let mut body = title(MARGIN, y + 12, name);
    for i in 0..5 {
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{y}\" width=\"28\" height=\"16\" fill=\"{}\" stroke=\"#444\" stroke-width=\"0.5\"/>\n",
            120 + i * 30,
            fill(i * 25)
        ));
    }
    body.push_str(&title(120, y + 30, low));
    body.push_str(&title(250, y + 30, high));
    body
}

/// The window one screen across centred on `(bx, by)`, kept on the site.
fn window_at(d: &District, cfg: &GenerationConfig, (bx, by): (i32, i32)) -> SiteBounds {
    let site = d.land_use.site();
    let n = &cfg.neighbourhood;
    let x0 = (bx - n.viewport_width_cells / 2).clamp(site.x0, site.x1 - n.viewport_width_cells);
    let y0 = (by - n.viewport_height_cells / 2).clamp(site.y0, site.y1 - n.viewport_height_cells);
    SiteBounds {
        x0,
        y0,
        x1: x0 + n.viewport_width_cells,
        y1: y0 + n.viewport_height_cells,
    }
}

/// The sharpest adjacent difference in the district: the pair of
/// neighbourhoods in different patches that share an edge and differ most
/// on age plus affluence, preferring a boundary whose screen holds at least
/// [`MIN_BUILDINGS_PER_SIDE`] buildings on each side (a strip of two
/// buildings cannot show a neighbourhood). Ties go to the lowest index.
/// Returns the two neighbourhoods and the world cell at the middle of
/// their shared edge.
fn sharpest_boundary(
    d: &District,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> Option<(Neighbourhood, Neighbourhood, (i32, i32))> {
    let hoods = d.land_use.neighbourhoods();
    let fronts: Vec<(i32, i32)> = d
        .envelopes
        .envelopes()
        .map(|e| sim::generation::site::front_cell(e.footprint, e.front))
        .collect();
    type Pick = ((bool, i32, bool, usize), usize, usize, (i32, i32));
    let mut best: Option<Pick> = None;
    for (i, a) in hoods.iter().enumerate() {
        for (j, b) in hoods.iter().enumerate().skip(i + 1) {
            if a.patch == b.patch {
                continue;
            }
            let (ra, rb) = (a.bounds, b.bounds);
            let oy = (ra.y1.min(rb.y1), ra.y0.max(rb.y0));
            let ox = (ra.x1.min(rb.x1), ra.x0.max(rb.x0));
            let point = if (ra.x1 == rb.x0 || rb.x1 == ra.x0) && oy.0 > oy.1 {
                Some((
                    if ra.x1 == rb.x0 { ra.x1 } else { rb.x1 },
                    (oy.0 + oy.1) / 2,
                ))
            } else if (ra.y1 == rb.y0 || rb.y1 == ra.y0) && ox.0 > ox.1 {
                Some((
                    (ox.0 + ox.1) / 2,
                    if ra.y1 == rb.y0 { ra.y1 } else { rb.y1 },
                ))
            } else {
                None
            };
            let Some(mid) = point else { continue };
            let vertical = ra.x1 == rb.x0 || rb.x1 == ra.x0;
            let (lo, hi) = if vertical { (oy.1, oy.0) } else { (ox.1, ox.0) };
            let score = (a.building_age - b.building_age).abs() + (a.affluence - b.affluence).abs();
            // Slide the window along the shared edge: the position that
            // shows the most frontage on the thinner side, preferring one
            // with a shuttered unit.
            let mut candidates = vec![mid];
            let mut at = lo;
            while at <= hi {
                candidates.push(if vertical { (mid.0, at) } else { (at, mid.1) });
                at += 4;
            }
            for point in candidates {
                let window = window_at(d, cfg, point);
                let in_window = |h: &Neighbourhood| {
                    fronts
                        .iter()
                        .filter(|&&(x, y)| {
                            x >= window.x0
                                && x < window.x1
                                && y >= window.y0
                                && y < window.y1
                                && d.land_use.neighbourhood_at(x, y).map(|o| o.patch)
                                    == Some(h.patch)
                        })
                        .count()
                };
                let thin = in_window(a).min(in_window(b));
                let rich = thin >= MIN_BUILDINGS_PER_SIDE;
                let key = (rich, score, shuttered_in(d, content, window), thin);
                if best.is_none_or(|(s, ..)| key > s) {
                    best = Some((key, i, j, point));
                }
            }
        }
    }
    best.map(|(_, i, j, p)| (hoods[i], hoods[j], p))
}

/// Whether any shuttered unit's footprint meets `window`.
fn shuttered_in(d: &District, content: &GenerationContent, window: SiteBounds) -> bool {
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    d.envelopes
        .envelopes()
        .zip(d.building_types.assignments())
        .any(|(e, a)| {
            let f = e.footprint;
            f.x1 > window.x0
                && f.x0 < window.x1
                && f.y1 > window.y0
                && f.y0 < window.y1
                && is_shuttered(by_id[&a.building_type])
        })
}

/// The fewest buildings each side of the boundary strip should show.
const MIN_BUILDINGS_PER_SIDE: usize = 3;

const STRIP_DEFS: &str = "<defs><pattern id=\"shuttered\" width=\"3\" height=\"3\" patternTransform=\"rotate(45)\" patternUnits=\"userSpaceOnUse\"><rect width=\"3\" height=\"3\" fill=\"#3a3a3a\"/><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"3\" stroke=\"#e0e0e0\" stroke-width=\"0.8\"/></pattern></defs>\n";

/// A type that is a commercial-land type carrying no post -- a shuttered
/// frontage; its sibling with posts is a working shop.
fn is_shuttered(def: &defs::BuildingTypeDef) -> bool {
    def.land_uses[LandUse::Commercial as usize] && def.professions.is_empty()
}

fn is_frontage(def: &defs::BuildingTypeDef) -> bool {
    def.land_uses[LandUse::Commercial as usize]
}

/// One side of the boundary, as figures.
struct Side {
    density: i32,
    age: i32,
    affluence: i32,
    frontage: usize,
    shop_types: usize,
    vacant_pct: usize,
    citizens: u64,
}

fn side_figures(
    d: &District,
    cfg: &GenerationConfig,
    content: &GenerationContent,
    patch: usize,
) -> Side {
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let hoods: Vec<&Neighbourhood> = d
        .land_use
        .neighbourhoods()
        .iter()
        .filter(|h| h.patch == patch)
        .collect();
    let at = |h: &Neighbourhood| {
        d.land_use
            .at_world(
                (h.bounds.x0 + h.bounds.x1) / 2,
                (h.bounds.y0 + h.bounds.y1) / 2,
            )
            .map(|p| p.density)
            .unwrap_or(cfg.density_min)
    };
    let density = hoods.iter().map(|h| at(h)).sum::<i32>() / hoods.len().max(1) as i32;
    let (mut frontage, mut vacant) = (0usize, 0usize);
    let mut shop_types = std::collections::BTreeSet::new();
    for (e, a) in d.envelopes.envelopes().zip(d.building_types.assignments()) {
        let (x, y) = sim::generation::site::front_cell(e.footprint, e.front);
        if d.land_use.neighbourhood_at(x, y).map(|h| h.patch) != Some(patch) {
            continue;
        }
        let def = by_id[&a.building_type];
        if is_frontage(def) {
            frontage += 1;
            if is_shuttered(def) {
                vacant += 1;
            } else {
                shop_types.insert(def.id);
            }
        }
    }
    // Supported citizens a screen: the patch's total over its own area,
    // scaled to one viewport.
    let area: i64 = hoods
        .iter()
        .map(|h| h.bounds.width() * h.bounds.height())
        .sum();
    let total: u64 = hoods
        .iter()
        .map(|h| d.supported_citizens(h.bounds, cfg, content))
        .sum();
    let screen = cfg.neighbourhood.viewport_width_cells as i64
        * cfg.neighbourhood.viewport_height_cells as i64;
    Side {
        density,
        age: hoods[0].building_age,
        affluence: hoods[0].affluence,
        frontage,
        shop_types: shop_types.len(),
        vacant_pct: (vacant * 100).checked_div(frontage).unwrap_or(0),
        citizens: (total as i64 * screen / area.max(1)) as u64,
    }
}

fn figures_lines(y: i64, name: &str, s: &Side) -> String {
    let mut body = title(
        MARGIN,
        y,
        &format!(
            "{name}: density {} | building age {} | affluence {}",
            s.density, s.age, s.affluence
        ),
    );
    body.push_str(&title(
        MARGIN + 16,
        y + 14,
        &format!(
            "{} frontage units, {} shop types, {}% shuttered | {} citizens per screen",
            s.frontage, s.shop_types, s.vacant_pct, s.citizens
        ),
    ));
    body
}

/// The boundary strip: plots outlined, envelopes tinted by derived class,
/// shuttered units hatched dark, type markers on distribution subjects,
/// streets on top, at viewport scale.
fn strip(
    x: i64,
    y: i64,
    window: SiteBounds,
    d: &District,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> (String, i64) {
    let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
        content.building_types.iter().map(|b| (b.id, b)).collect();
    let tags = class_tags(content);
    let rows = scoped_distribution_rows(content);
    let (w, h) = (window.width(), window.height());
    // The picture covers every footprint that meets the screen whole, so a
    // front row is never cut mid-building; the screen itself is the framed
    // part.
    let (mut vx0, mut vy0, mut vx1, mut vy1) = (window.x0, window.y0, window.x1, window.y1);
    for e in d.envelopes.envelopes() {
        let f = e.footprint;
        if f.x1 > window.x0 && f.x0 < window.x1 && f.y1 > window.y0 && f.y0 < window.y1 {
            vx0 = vx0.min(f.x0);
            vy0 = vy0.min(f.y0);
            vx1 = vx1.max(f.x1);
            vy1 = vy1.max(f.y1);
        }
    }
    let (vw, vh) = ((vx1 - vx0) as i64, (vy1 - vy0) as i64);
    let mut body = format!(
        "<svg x=\"{x}\" y=\"{y}\" width=\"{}\" height=\"{}\" viewBox=\"{vx0} {vy0} {vw} {vh}\">\n\
         <rect x=\"{vx0}\" y=\"{vy0}\" width=\"{vw}\" height=\"{vh}\" fill=\"#ffffff\"/>\n",
        STRIP_WIDTH,
        vh * STRIP_WIDTH / vw,
    );
    for b in d.streets.blocks() {
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" fill-opacity=\"0.35\"/>\n",
            b.bounds.x0,
            b.bounds.y0,
            b.bounds.width(),
            b.bounds.height(),
            land_use_fill(block_land_use(&d.land_use, b.bounds))
        ));
    }
    for e in d.streets.edges() {
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
    for ((e, a), st) in d
        .envelopes
        .envelopes()
        .zip(d.building_types.assignments())
        .zip(d.building_types.states())
    {
        let f = e.footprint;
        if f.x1 <= window.x0 || f.x0 >= window.x1 || f.y1 <= window.y0 || f.y0 >= window.y1 {
            continue;
        }
        let def = by_id[&a.building_type];
        let plot = &d.plots.plots()[e.plot as usize];
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"none\" stroke=\"#999\" stroke-width=\"0.15\"/>\n",
            plot.bounds.x0,
            plot.bounds.y0,
            plot.bounds.width(),
            plot.bounds.height()
        ));
        let fill = if is_shuttered(def) {
            "url(#shuttered)".to_string()
        } else {
            class_tint(building_type_class(def, &tags)).to_string()
        };
        // A worn building (physical state at or under the desirability
        // floor) is outlined dashed; a kept one solid.
        let outline = if st.physical_state <= cfg.neighbourhood.desirability_state_floor {
            "stroke=\"#6d4c41\" stroke-width=\"0.5\" stroke-dasharray=\"1.2 0.8\""
        } else {
            "stroke=\"#111\" stroke-width=\"0.25\""
        };
        body.push_str(&format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{fill}\" {outline}/>\n",
            f.x0,
            f.y0,
            f.width(),
            f.height()
        ));
        // The inner square carries the building's own age, on the panel's
        // ramp.
        if !is_shuttered(def) {
            let inset = 3i32.min(f.width() as i32 / 4).min(f.height() as i32 / 4);
            body.push_str(&format!(
                "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\" fill=\"{}\" stroke=\"#555\" stroke-width=\"0.1\"/>\n",
                f.x0 + inset,
                f.y0 + inset,
                f.width() as i32 - 2 * inset,
                f.height() as i32 - 2 * inset,
                age_fill(st.building_age, cfg)
            ));
        }
        if let Some(shape) = marker_shape_for(&rows, def) {
            let (mx, my) = front_edge_midpoint(f, e.front);
            body.push_str(&marker(mx, my, shape, "#111"));
        }
    }
    // The one-screen frame, in the picture's own coordinates.
    body.push_str(&format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{w}\" height=\"{h}\" fill=\"none\" stroke=\"#d81b60\" stroke-width=\"0.5\"/>\n",
        window.x0, window.y0
    ));
    body.push_str("</svg>\n");
    (body, vh * STRIP_WIDTH / vw)
}

/// The neighbourhoods evidence document for one district.
pub fn neighbourhoods_svg(
    d: &District,
    cfg: &GenerationConfig,
    content: &GenerationContent,
) -> String {
    let n = &cfg.neighbourhood;
    let params_at = |b: &sim::generation::Block| {
        let (cx, cy) = (
            (b.bounds.x0 + b.bounds.x1) / 2,
            (b.bounds.y0 + b.bounds.y1) / 2,
        );
        d.land_use.at_world(cx, cy)
    };
    let panels = [
        (
            "density",
            Box::new(|b: &sim::generation::Block| {
                density_fill(params_at(b).map_or(cfg.density_min, |p| p.density), cfg)
            }) as Box<dyn Fn(&sim::generation::Block) -> String + '_>,
        ),
        (
            "building age",
            Box::new(|b: &sim::generation::Block| {
                age_fill(
                    params_at(b).map_or(n.building_age_min, |p| p.building_age),
                    cfg,
                )
            }),
        ),
        (
            "affluence",
            Box::new(|b: &sim::generation::Block| {
                affluence_fill(params_at(b).map_or(n.affluence_min, |p| p.affluence), cfg)
            }),
        ),
        (
            "land use",
            Box::new(|b: &sim::generation::Block| {
                land_use_fill(block_land_use(&d.land_use, b.bounds)).to_string()
            }),
        ),
    ];
    let w = 2 * PANEL + 3 * MARGIN;
    let mut body = String::new();
    for (i, (name, fill)) in panels.iter().enumerate() {
        let (col, row) = (i as i64 % 2, i as i64 / 2);
        let x = MARGIN + col * (PANEL + MARGIN);
        let y = 24 + row * (PANEL + GAP);
        body.push_str(&title(x, y - 8, name));
        body.push_str(&panel(x, y, d, fill.as_ref()));
    }
    let mut y = 24 + 2 * (PANEL + GAP) + 4;
    body.push_str(&ramp_legend(y, "density", "sparse", "dense", &|p| {
        density_fill(
            cfg.density_min + p * (cfg.density_max - cfg.density_min) / 100,
            cfg,
        )
    }));
    y += 40;
    body.push_str(&ramp_legend(y, "building age", "newer", "older", &|p| {
        age_fill(
            n.building_age_min + p * (n.building_age_max - n.building_age_min) / 100,
            cfg,
        )
    }));
    y += 40;
    body.push_str(&ramp_legend(y, "affluence", "poorer", "richer", &|p| {
        affluence_fill(
            n.affluence_min + p * (n.affluence_max - n.affluence_min) / 100,
            cfg,
        )
    }));
    y += 40;
    for (i, u) in LandUse::ALL.iter().enumerate() {
        let x = MARGIN + i as i64 * 130;
        body.push_str(&format!(
            "<rect x=\"{x}\" y=\"{y}\" width=\"16\" height=\"16\" fill=\"{}\"/>\n",
            land_use_fill(*u)
        ));
        body.push_str(&title(x + 20, y + 12, land_use_label(*u)));
    }
    y += 40;

    // The boundary strip.
    let mut defs_block = String::new();
    if let Some((a, b, point)) = sharpest_boundary(d, cfg, content) {
        let window = window_at(d, cfg, point);
        defs_block.push_str(STRIP_DEFS);
        body.push_str(&title(
            MARGIN,
            y,
            "boundary strip: the sharpest step between two neighbourhoods, one screen across",
        ));
        y += 8;
        let (strip_svg, strip_h) = strip(MARGIN, y, window, d, cfg, content);
        body.push_str(&strip_svg);
        y += strip_h + 20;
        // Name each side by where it lies: the shared edge is vertical
        // (sides left and right) or horizontal (upper and lower).
        let vertical = a.bounds.x1 == b.bounds.x0 || b.bounds.x1 == a.bounds.x0;
        let a_first = if vertical {
            a.bounds.x1 == b.bounds.x0
        } else {
            a.bounds.y1 == b.bounds.y0
        };
        let (first, second) = if vertical {
            ("left side", "right side")
        } else {
            ("upper side", "lower side")
        };
        let sides = if a_first {
            [(first, &a), (second, &b)]
        } else {
            [(first, &b), (second, &a)]
        };
        for (name, hood) in sides {
            body.push_str(&figures_lines(
                y,
                name,
                &side_figures(d, cfg, content, hood.patch),
            ));
            y += 34;
        }
        // Strip legend: the derived building classes and the shuttered hatch.
        let tags = class_tags(content);
        let by_id: BTreeMap<u32, &defs::BuildingTypeDef> =
            content.building_types.iter().map(|b| (b.id, b)).collect();
        let mut classes = std::collections::BTreeSet::new();
        for a in d.building_types.assignments() {
            classes.insert(building_type_class(by_id[&a.building_type], &tags));
        }
        y += 8;
        for (i, c) in classes.iter().enumerate() {
            let x = MARGIN + (i as i64 % 3) * 180;
            let yy = y + (i as i64 / 3) * 20;
            body.push_str(&format!(
                "<rect x=\"{x}\" y=\"{yy}\" width=\"14\" height=\"14\" fill=\"{}\"/>\n",
                class_tint(*c)
            ));
            body.push_str(&title(x + 18, yy + 12, class_label(*c)));
        }
        y += (classes.len() as i64 + 2) / 3 * 20 + 4;
        body.push_str(&format!(
            "<rect x=\"16\" y=\"{y}\" width=\"14\" height=\"14\" fill=\"url(#shuttered)\" stroke=\"#111\" stroke-width=\"0.5\"/>\n"
        ));
        body.push_str(&title(34, y + 12, "shuttered unit"));
        body.push_str(&format!(
            "<rect x=\"196\" y=\"{y}\" width=\"14\" height=\"14\" fill=\"#ffffff\" stroke=\"#6d4c41\" stroke-width=\"1.5\" stroke-dasharray=\"3 2\"/>\n"
        ));
        body.push_str(&title(214, y + 12, "dashed outline: worn"));
        body.push_str(&format!(
            "<rect x=\"376\" y=\"{y}\" width=\"14\" height=\"14\" fill=\"#7cb342\"/><rect x=\"380\" y=\"{}\" width=\"6\" height=\"6\" fill=\"{}\" stroke=\"#555\" stroke-width=\"0.5\"/>\n",
            y + 4,
            age_fill(n.building_age_max, cfg)
        ));
        body.push_str(&title(394, y + 12, "inner square: age"));
        y += 28;
    }
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{w}\" height=\"{y}\" viewBox=\"0 0 {w} {y}\">\n\
         {defs_block}<rect x=\"0\" y=\"0\" width=\"{w}\" height=\"{y}\" fill=\"#ffffff\"/>\n\
         {body}</svg>\n"
    )
}

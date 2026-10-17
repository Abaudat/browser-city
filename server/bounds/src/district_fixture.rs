//! Story 3.16: the live city's district as a committed dump, the fixture
//! the client's unit tests and e2e specs build their world from instead of
//! a hand-laid street. It is the rows `create_district` inserts for
//! `city.seed` -- the same function (`District::region_rows`) -- ground
//! and roof rects included. Written to `fixtures/district-pinned.v1.json`
//! by `regen-district-fixture`; `tests/district_fixture_current.rs` fails
//! CI when generation code, `defs/` or `GENERATION_VERSION` moved and the
//! dump was not regenerated.
//!
//! A row's id is not written: the module hands `auto_inc` ids out in
//! `RegionRows` order, so it is the row's 1-based position in its own list.

use std::path::PathBuf;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, GroundConfig, generate};

use crate::world_fixture::repo_root_dir;

/// Where the committed dump lives.
pub fn fixture_path() -> PathBuf {
    repo_root_dir()
        .join("fixtures")
        .join("district-pinned.v1.json")
}

/// The dump's text: one compact row array per line, so a review diff reads
/// by row and the file stays small.
pub fn build_document() -> String {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).expect("committed balance parses");
    let content = GenerationContent::committed();
    let seed = GroundConfig::city_seed(defs::BALANCE);
    let (district, _graph) = generate(seed, &cfg, &content).expect("the city seed generates");
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let rows = district.region_rows(&ground, &content, &cfg);
    let site = cfg.site();
    let arrival = district
        .arrival_cell(&cfg, &content)
        .expect("the city has an arrival cell");

    let mut out = String::new();
    out.push_str("{\n");
    out.push_str("\"version\": 3,\n");
    out.push_str(&format!("\"seed\": {seed},\n"));
    out.push_str(&format!(
        "\"site\": [{},{},{},{}],\n",
        site.x0, site.y0, site.x1, site.y1
    ));
    out.push_str(&format!("\"arrival\": [{},{}],\n", arrival.0, arrival.1));
    out.push_str("\"objects\": [\n");
    for (i, p) in rows.placed.iter().enumerate() {
        if i > 0 {
            out.push_str(",\n");
        }
        out.push_str(&format!(
            "[{},{},{},{},{},{}]",
            p.def_id, p.x, p.y, p.floor, p.layer, p.orientation
        ));
    }
    out.push_str("\n],\n");
    out.push_str("\"ground\": [\n");
    for (i, g) in rows.ground.iter().enumerate() {
        if i > 0 {
            out.push_str(",\n");
        }
        out.push_str(&format!(
            "[{},{},{},{},{},{}]",
            g.def_id, g.x0, g.y0, g.x1, g.y1, g.floor
        ));
    }
    out.push_str("\n],\n");
    out.push_str("\"roofs\": [\n");
    for (i, r) in rows.roofs.iter().enumerate() {
        if i > 0 {
            out.push_str(",\n");
        }
        // The building id is a 64-bit hash: a string, as the areas' owners.
        out.push_str(&format!(
            "[\"{}\",{},{},{},{},{},{}]",
            r.building_id, r.def_id, r.x0, r.y0, r.x1, r.y1, r.floor
        ));
    }
    out.push_str("\n],\n");
    for (name, areas) in [
        ("buildingAreas", &rows.building_areas),
        ("roomAreas", &rows.room_areas),
    ] {
        out.push_str(&format!("\"{name}\": [\n"));
        for (i, a) in areas.iter().enumerate() {
            if i > 0 {
                out.push_str(",\n");
            }
            // The owner id is a 64-bit hash: a JSON number would lose bits in
            // any reader that parses it as a double, so it is a string.
            out.push_str(&format!(
                "[\"{}\",{},{},{},{},{}]",
                a.owner_id, a.x0, a.y0, a.x1, a.y1, a.floor
            ));
        }
        out.push_str(if name == "roomAreas" {
            "\n]\n"
        } else {
            "\n],\n"
        });
    }

    out.push_str("}\n");
    out
}

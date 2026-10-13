//! Story 3.16: the live city's district as a committed dump, the fixture
//! the client's unit tests and e2e specs build their world from instead of
//! a hand-laid street. It is the rows `create_district` inserts for
//! `city.seed` -- the same function (`District::region_rows`) -- minus the
//! ground, which is derived (`city.ground.*`) and would only repeat the
//! site. Written to `fixtures/district-pinned.v1.json` by
//! `regen-district-fixture`; `tests/district_fixture_current.rs` fails CI
//! when generation code, `defs/` or `GENERATION_VERSION` moved and the
//! dump was not regenerated.
//!
//! Object ids are the `auto_inc` ids the module hands out: rows are
//! inserted in `RegionRows` order, ground first, so a row's id is its
//! 1-based position in `RegionRows::placed`.

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
    let rows = district.region_rows(&ground, &content);
    let site = cfg.site();
    let arrival = district
        .arrival_cell(&cfg, &content)
        .expect("the city has an arrival cell");
    let ground_ids = [
        ground.open_object_id,
        ground.pavement_object_id,
        ground.road_object_id,
        ground.floor_object_id,
    ];

    let mut out = String::new();
    out.push_str("{\n");
    out.push_str("\"version\": 1,\n");
    out.push_str(&format!("\"seed\": {seed},\n"));
    out.push_str(&format!(
        "\"site\": [{},{},{},{}],\n",
        site.x0, site.y0, site.x1, site.y1
    ));
    out.push_str(&format!("\"arrival\": [{},{}],\n", arrival.0, arrival.1));
    out.push_str(&format!(
        "\"groundObjectIds\": [{}, {}, {}, {}],\n",
        ground_ids[0], ground_ids[1], ground_ids[2], ground_ids[3]
    ));
    out.push_str(&format!("\"groundMargin\": {},\n", ground.margin_cells));
    out.push_str("\"objects\": [\n");
    let mut first = true;
    for (i, p) in rows.placed.iter().enumerate() {
        if ground_ids.contains(&p.def_id) {
            continue;
        }
        if !first {
            out.push_str(",\n");
        }
        first = false;
        out.push_str(&format!(
            "[{},{},{},{},{},{},{}]",
            i + 1,
            p.def_id,
            p.x,
            p.y,
            p.floor,
            p.layer,
            p.orientation
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
            out.push_str(&format!(
                "[{},{},{},{},{},{},{}]",
                i + 1,
                a.owner_id,
                a.x0,
                a.y0,
                a.x1,
                a.y1,
                a.floor
            ));
        }
        out.push_str(if name == "roomAreas" { "\n]\n" } else { "\n],\n" });
    }
    out.push_str("}\n");
    out
}

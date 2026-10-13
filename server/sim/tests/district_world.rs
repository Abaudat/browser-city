//! Story 3.16: the generated district as the world rows a client streams.
//! Everything here is measured over the rows `District::region_rows`
//! produces (what `create_district` inserts), never over the generator's
//! own structs.

use sim::generated::defs;
use sim::generation::{
    District, GenerationConfig, GenerationContent, GroundConfig, RegionRows, generate,
};
use sim::table_bounds::TABLE_BOUNDS;
use sim::world::{CHUNK_SIZE, chunk_key, clip_rect_to_chunks};

fn city() -> (GenerationConfig, GenerationContent<'static>, u64) {
    let cfg = GenerationConfig::from_balance(defs::BALANCE).unwrap();
    (
        cfg,
        GenerationContent::committed(),
        GroundConfig::city_seed(defs::BALANCE),
    )
}

fn world() -> (District, RegionRows, GenerationConfig) {
    let (cfg, content, seed) = city();
    let (district, _) = generate(seed, &cfg, &content).expect("the committed city generates");
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let rows = district.region_rows(&ground, &content);
    (district, rows, cfg)
}

#[test]
fn every_row_carries_the_chunk_key_of_its_anchor_or_its_clipped_rect() {
    let (_, rows, _) = world();
    for p in &rows.placed {
        assert_eq!(p.chunk_key, chunk_key(p.x, p.y, p.floor), "{p:?}");
    }
    for a in rows.building_areas.iter().chain(&rows.room_areas) {
        let rect = sim::world::Rect {
            x0: a.x0,
            y0: a.y0,
            x1: a.x1,
            y1: a.y1,
        };
        let pieces = clip_rect_to_chunks(rect, a.floor);
        assert_eq!(pieces.len(), 1, "an area row lies inside one chunk: {a:?}");
        assert_eq!(pieces[0].1, a.chunk_key);
        assert!(a.x1 - a.x0 <= CHUNK_SIZE && a.y1 - a.y0 <= CHUNK_SIZE);
    }
}

#[test]
fn row_counts_sit_inside_the_declared_table_bounds() {
    let (_, rows, _) = world();
    let bound = |name: &str| {
        TABLE_BOUNDS
            .iter()
            .find(|b| b.accessor == name)
            .unwrap_or_else(|| panic!("no bound for {name}"))
    };
    for (name, n) in [
        ("placed_object", rows.placed.len()),
        ("building_area", rows.building_areas.len()),
        ("room_area", rows.room_areas.len()),
        ("floor_transition", rows.transitions.len()),
    ] {
        assert!(
            (n as u64) <= bound(name).expected_rows,
            "{name}: {n} rows over the expected {}",
            bound(name).expected_rows
        );
    }
    println!(
        "rows: placed_object={} building_area={} room_area={} floor_transition={}",
        rows.placed.len(),
        rows.building_areas.len(),
        rows.room_areas.len(),
        rows.transitions.len()
    );
}

#[test]
fn every_cell_of_the_site_and_its_margin_has_exactly_one_ground_row() {
    let (_, rows, cfg) = world();
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let site = cfg.site();
    let m = ground.margin_cells;
    let w = (site.x1 - site.x0 + 2 * m) as usize;
    let h = (site.y1 - site.y0 + 2 * m) as usize;
    let mut seen = vec![0u8; w * h];
    let ground_ids = [
        ground.open_object_id,
        ground.pavement_object_id,
        ground.road_object_id,
        ground.floor_object_id,
    ];
    for p in rows.placed.iter().filter(|p| ground_ids.contains(&p.def_id)) {
        assert_eq!(p.layer, 0, "ground is the ground layer");
        let (x, y) = (p.x - (site.x0 - m), p.y - (site.y0 - m));
        assert!(x >= 0 && y >= 0 && (x as usize) < w && (y as usize) < h, "{p:?}");
        seen[y as usize * w + x as usize] += 1;
    }
    let bare = seen.iter().filter(|&&n| n == 0).count();
    let doubled = seen.iter().filter(|&&n| n > 1).count();
    assert_eq!((bare, doubled), (0, 0), "bare cells, doubled cells");
}

#[test]
fn the_arrival_cell_is_a_walkable_floor_zero_cell_inside_a_dwelling() {
    let (district, _, cfg) = world();
    let content = GenerationContent::committed();
    let cell = district
        .arrival_cell(&cfg, &content)
        .expect("the committed city has a dwelling to arrive in");
    assert!(district.walkability(0).is_standable(cell.0, cell.1));
    let inside = district
        .interiors
        .laid()
        .any(|(_, _, i)| i.rooms.iter().any(|r| r.rect.contains(cell.0, cell.1)));
    assert!(inside, "{cell:?} is on a room floor");
    let again = district.arrival_cell(&cfg, &content).unwrap();
    assert_eq!(cell, again, "deterministic");
}

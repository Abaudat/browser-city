//! Story 3.16: the generated district as the world rows a client streams.
//! Everything here is measured over the rows `District::region_rows`
//! produces (what `create_district` inserts), never over the generator's
//! own structs.

mod support;

use sim::generated::defs;
use sim::generation::{
    District, GenerationConfig, GenerationContent, GroundConfig, RegionRows, generate,
};
use sim::table_bounds::TABLE_BOUNDS;
use sim::world::{CHUNK_SIZE, chunk_key, clip_rect_to_chunks};
use support::district_checks;

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
    let rows = district.region_rows(&ground, &content, &cfg);
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
fn buildings_and_rooms_are_named_in_laid_order_from_one() {
    let (district, rows, _) = world();
    let n_buildings = district.interiors.laid().count() as u64;
    let n_rooms: u64 = district
        .interiors
        .laid()
        .map(|(_, _, i)| i.rooms.len() as u64)
        .sum();
    let buildings: std::collections::BTreeSet<u64> =
        rows.building_areas.iter().map(|a| a.owner_id).collect();
    let rooms: std::collections::BTreeSet<u64> =
        rows.room_areas.iter().map(|a| a.owner_id).collect();
    assert_eq!(buildings, (1..=n_buildings).collect());
    assert_eq!(rooms, (1..=n_rooms).collect());
    let first = district.interiors.laid().next().unwrap().2.footprint;
    let a = rows
        .building_areas
        .iter()
        .find(|a| a.owner_id == 1)
        .unwrap();
    assert!(a.x0 >= first.x0 && a.x1 <= first.x1 && a.y0 >= first.y0 && a.y1 <= first.y1);
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
        ("ground_area", rows.ground.len()),
        ("roof_area", rows.roofs.len()),
    ] {
        assert!(
            (n as u64) <= bound(name).expected_rows,
            "{name}: {n} rows over the expected {}",
            bound(name).expected_rows
        );
    }
    println!(
        "rows: placed_object={} building_area={} room_area={} floor_transition={} ground_area={} roof_area={}",
        rows.placed.len(),
        rows.building_areas.len(),
        rows.room_areas.len(),
        rows.transitions.len(),
        rows.ground.len(),
        rows.roofs.len()
    );
}

/// The tag keys of a def.
fn tag_keys(content: &GenerationContent, def_id: u32) -> Vec<&'static str> {
    let def = content.objects.iter().find(|o| o.id == def_id).unwrap();
    def.tags
        .iter()
        .filter_map(|t| content.tags.iter().find(|g| g.id == *t).map(|g| g.key))
        .collect()
}

/// The def painted on `(x, y)` after every ground rect, in order.
fn painted(rows: &RegionRows, x: i32, y: i32) -> Option<u32> {
    rows.ground
        .iter()
        .rev()
        .find(|g| x >= g.x0 && x < g.x1 && y >= g.y0 && y < g.y1)
        .map(|g| g.def_id)
}

#[test]
fn ground_is_rects_inside_one_chunk_each_and_never_a_row_per_cell() {
    let (_, rows, _) = world();
    let content = GenerationContent::committed();
    for g in &rows.ground {
        let pieces = clip_rect_to_chunks(
            sim::world::Rect {
                x0: g.x0,
                y0: g.y0,
                x1: g.x1,
                y1: g.y1,
            },
            g.floor,
        );
        assert_eq!(
            pieces.len(),
            1,
            "a ground rect lies inside one chunk: {g:?}"
        );
        assert_eq!(pieces[0].1, g.chunk_key);
        let tags = tag_keys(&content, g.def_id);
        assert!(
            ["ground", "pavement", "road", "floor"]
                .iter()
                .any(|t| tags.contains(t)),
            "{g:?} is painted with a non-ground def {tags:?}"
        );
    }
    let cells: i64 = rows
        .ground
        .iter()
        .map(|g| i64::from(g.x1 - g.x0) * i64::from(g.y1 - g.y0))
        .sum();
    assert!(
        (rows.ground.len() as i64) * 8 < cells,
        "{} rows over {cells} cells: ground is rects, not tiles",
        rows.ground.len()
    );
}

#[test]
fn every_footprint_cell_is_laid_with_a_floor_and_every_street_cell_with_its_surface() {
    let (district, rows, _) = world();
    let content = GenerationContent::committed();
    // The whole footprint, wall ring included: a window in the wall shows
    // floor through it, never the lawn.
    for (_, _, i) in district.interiors.laid() {
        let f = i.footprint;
        for y in f.y0..f.y1 {
            for x in f.x0..f.x1 {
                let def = painted(&rows, x, y).expect("a footprint cell is painted");
                assert!(tag_keys(&content, def).contains(&"floor"), "({x},{y})");
            }
        }
    }
    let street = district.props.street();
    let site = district.skeleton.plots.site();
    for y in site.y0..site.y1 {
        for x in site.x0..site.x1 {
            if street.is_road(x, y) {
                let def = painted(&rows, x, y).expect("a carriageway cell is painted");
                assert!(tag_keys(&content, def).contains(&"road"), "({x},{y})");
            } else if street.is_pavement(x, y) {
                assert!(painted(&rows, x, y).is_some(), "pavement ({x},{y})");
            }
        }
    }
}

#[test]
fn every_street_that_meets_the_site_edge_continues_through_the_margin() {
    let (district, rows, cfg) = world();
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let content = GenerationContent::committed();
    let site = cfg.site();
    let street = district.props.street();
    let mut crossings = 0;
    let check = |x: i32, y: i32| {
        let def = painted(&rows, x, y).expect("margin road is painted");
        assert!(tag_keys(&content, def).contains(&"road"), "({x},{y})");
    };
    for t in site.x0..site.x1 {
        for (edge, outward) in [(site.y0, -1), (site.y1 - 1, 1)] {
            if street.is_road(t, edge) {
                crossings += 1;
                for k in 1..=ground.margin_cells {
                    check(t, edge + outward * k);
                }
            }
        }
    }
    for t in site.y0..site.y1 {
        for (edge, outward) in [(site.x0, -1), (site.x1 - 1, 1)] {
            if street.is_road(edge, t) {
                crossings += 1;
                for k in 1..=ground.margin_cells {
                    check(edge + outward * k, t);
                }
            }
        }
    }
    assert!(crossings > 0, "the committed city has streets at its edge");
}

#[test]
fn every_building_has_a_roof_over_its_interior_net_and_its_north_rim_but_the_door() {
    let (district, rows, cfg) = world();
    let content = GenerationContent::committed();
    let t = cfg.envelope_wall_thickness_cells;
    let mut roofed = 0;
    let mut notched = 0;
    for (n, (_, _, i)) in district.interiors.laid().enumerate() {
        let id = n as u64 + 1;
        let pieces: Vec<_> = rows.roofs.iter().filter(|r| r.building_id == id).collect();
        // Every cell of the interior net and of the north rim between the
        // side walls is roofed exactly once, except a door cell in the rim.
        let (x0, x1, y1) = (i.footprint.x0 + t, i.footprint.x1 - t, i.footprint.y1 - t);
        let door = |x: i32, y: i32| i.thresholds.iter().any(|d| d.x == x && d.y == y);
        for y in i.footprint.y0..y1 {
            for x in x0..x1 {
                let n = pieces
                    .iter()
                    .filter(|r| x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)
                    .count();
                let want = usize::from(!(y < i.footprint.y0 + t && door(x, y)));
                assert_eq!(n, want, "{id}: cell ({x},{y}) roofed {n} times");
            }
        }
        if i.thresholds.iter().any(|d| d.y < i.footprint.y0 + t) {
            notched += 1;
        }
        // Nothing outside that span is roofed.
        for r in &pieces {
            assert!(
                r.x0 >= x0 && r.x1 <= x1 && r.y0 >= i.footprint.y0 && r.y1 <= y1,
                "{r:?}"
            );
        }
        // One building's roof is one chunk's rows: keyed on the chunk of the
        // net's south-west cell, so a client holds all of it or none.
        let anchor = chunk_key(x0, y1 - 1, 0);
        assert!(pieces.iter().all(|r| r.chunk_key == anchor), "{id}");
        assert!(
            pieces
                .iter()
                .all(|r| tag_keys(&content, r.def_id).contains(&"roof")),
            "a roof is a roof-tagged def"
        );
        roofed += 1;
    }
    assert!(roofed >= 100);
    assert!(notched > 0, "the committed city has doors in a north rim");
}

#[test]
fn a_dwelling_roof_reads_the_building_age_band() {
    let (district, rows, cfg) = world();
    let content = GenerationContent::committed();
    let plots = district.skeleton.plots.plots();
    let nb = &cfg.neighbourhood;
    let dwelling = content
        .tags
        .iter()
        .find(|t| t.key == "dwelling")
        .map(|t| t.id)
        .unwrap();
    let mut seen = std::collections::BTreeSet::new();
    for (n, (plot, ty, _)) in district.interiors.laid().enumerate() {
        let def = content.building_types.iter().find(|b| b.id == ty).unwrap();
        if !def.tags.contains(&dwelling) {
            continue;
        }
        // The bands every neighbourhood guarantee is judged on.
        let age = plots[plot as usize].building_age;
        let want = if age >= nb.old_from() {
            "aged_old"
        } else if age <= nb.new_to() {
            "aged_new"
        } else {
            "aged_mid"
        };
        let id = n as u64 + 1;
        let roof = rows.roofs.iter().find(|r| r.building_id == id).unwrap();
        let tags = tag_keys(&content, roof.def_id);
        assert!(tags.contains(&want), "age {age}: roof tags {tags:?}");
        seen.insert(want);
    }
    assert!(
        seen.len() >= 2,
        "the committed city shows more than one age band: {seen:?}"
    );
}

#[test]
fn a_room_floor_is_the_affluent_twin_exactly_in_the_rich_band() {
    let (district, rows, cfg) = world();
    let content = GenerationContent::committed();
    let plots = district.skeleton.plots.plots();
    let rich_from = cfg.neighbourhood.rich_from();
    // (room kind, rich band?) -> whether its floor is the affluent twin.
    let mut seen: std::collections::BTreeMap<(u32, bool), std::collections::BTreeSet<bool>> =
        Default::default();
    for (plot, _, i) in district.interiors.laid() {
        let rich = plots[plot as usize].affluence >= rich_from;
        for room in &i.rooms {
            let def = painted(&rows, room.rect.x0, room.rect.y0).expect("a room cell is painted");
            let affluent = tag_keys(&content, def).contains(&"affluent");
            seen.entry((room.room_type, rich))
                .or_default()
                .insert(affluent);
        }
    }
    let mut twins = 0;
    for ((kind, rich), floors) in &seen {
        // Outside the rich band no floor is affluent; inside it, a kind with
        // an affluent twin always lays it.
        if !rich {
            assert!(
                !floors.contains(&true),
                "room kind {kind} is affluent outside the rich band"
            );
        } else if floors.contains(&true) {
            assert!(
                !floors.contains(&false),
                "room kind {kind} lays both floors in the rich band"
            );
            twins += 1;
        }
    }
    assert!(twins > 0, "the committed city lays some affluent twin");
}

#[test]
fn the_arrival_is_a_viewport_in_from_the_site_edge() {
    let (district, _, cfg) = world();
    let content = GenerationContent::committed();
    let (x, y) = district.arrival_cell(&cfg, &content).unwrap();
    let site = cfg.site();
    let (vw, vh) = (
        cfg.neighbourhood.viewport_width_cells,
        cfg.neighbourhood.viewport_height_cells,
    );
    assert!(x - site.x0 >= vw && site.x1 - x > vw, "x {x}");
    assert!(y - site.y0 >= vh && site.y1 - y > vh, "y {y}");
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

#[test]
fn a_walk_crosses_the_site_edge_to_core_to_opposite_edge_within_the_stretch() {
    let (district, _, cfg) = world();
    let crossings = district_checks::crossings(&district, &cfg);
    assert_eq!(
        crossings.len(),
        3,
        "edge, core and edge each have a standable cell"
    );
    for c in crossings {
        let stretch = c
            .stretch_pct
            .unwrap_or_else(|| panic!("{:?} cannot reach {:?}", c.from, c.to));
        println!(
            "route {:?}->{:?}: {} steps, {stretch}% of straight",
            c.from,
            c.to,
            c.steps.unwrap()
        );
        assert!(
            stretch <= district_checks::ROUTE_STRETCH_MAX_PCT,
            "{:?}->{:?} {stretch}%",
            c.from,
            c.to
        );
    }
}

#[test]
fn at_least_a_hundred_buildings_are_enterable_furnished_and_reachable_from_arrival() {
    let (district, rows, cfg) = world();
    let content = GenerationContent::committed();
    let arrival = district.arrival_cell(&cfg, &content).unwrap();
    let good = district_checks::furnished_reachable(&district, &rows, &content, arrival);
    println!(
        "{good} of {} laid buildings are enterable, furnished and reachable",
        district.interiors.laid().count()
    );
    assert!(
        good >= 100,
        "only {good} enterable furnished reachable buildings"
    );
}

/// Two neighbourhoods across one arterial: the dial differences at the
/// midpoint of their shared edge (a world cell on each side).
struct Step {
    affluence: i32,
    age: i32,
    cell: (i32, i32),
    a: sim::world::Rect,
    b: sim::world::Rect,
}

fn adjacent_steps(district: &District) -> Vec<Step> {
    let hoods = district.skeleton.land_use.neighbourhoods();
    let mut out = Vec::new();
    for (i, a) in hoods.iter().enumerate() {
        for b in &hoods[i + 1..] {
            let (ab, bb) = (a.bounds, b.bounds);
            let ys = ab.y0.max(bb.y0)..ab.y1.min(bb.y1);
            let xs = ab.x0.max(bb.x0)..ab.x1.min(bb.x1);
            let cell = if (ab.x1 == bb.x0 || bb.x1 == ab.x0) && !ys.is_empty() {
                let x = if ab.x1 == bb.x0 { ab.x1 } else { ab.x0 };
                (x, (ys.start + ys.end) / 2)
            } else if (ab.y1 == bb.y0 || bb.y1 == ab.y0) && !xs.is_empty() {
                let y = if ab.y1 == bb.y0 { ab.y1 } else { ab.y0 };
                ((xs.start + xs.end) / 2, y)
            } else {
                continue;
            };
            out.push(Step {
                affluence: (a.affluence - b.affluence).abs(),
                age: (a.building_age - b.building_age).abs(),
                cell,
                a: ab,
                b: bb,
            });
        }
    }
    out
}

/// The least dial step across an arterial a screenshot can tell apart: the
/// sharpest adjacent pair of the committed seed must reach it, per dial.
const LEGIBLE_DIAL_STEP_MIN: i32 = 20;

#[test]
fn the_committed_seed_has_an_arterial_where_each_dial_steps_enough_to_read() {
    let (district, _, _) = world();
    let steps = adjacent_steps(&district);
    assert!(!steps.is_empty(), "no adjacent neighbourhoods");
    let sharpest_aff = steps.iter().max_by_key(|s| s.affluence).unwrap();
    let sharpest_age = steps.iter().max_by_key(|s| s.age).unwrap();
    println!(
        "sharpest affluence step {} at {:?}; sharpest age step {} at {:?}; {} adjacent pairs",
        sharpest_aff.affluence,
        sharpest_aff.cell,
        sharpest_age.age,
        sharpest_age.cell,
        steps.len()
    );
    assert!(sharpest_aff.affluence >= LEGIBLE_DIAL_STEP_MIN);
    assert!(sharpest_age.age >= LEGIBLE_DIAL_STEP_MIN);
}

/// Total-variation distance between two def histograms, in percent: 0 when
/// the two sides are made of the same things in the same shares, 100 when
/// they share nothing.
fn tv_pct(
    a: &std::collections::BTreeMap<u32, i64>,
    b: &std::collections::BTreeMap<u32, i64>,
) -> i64 {
    let (ta, tb): (i64, i64) = (a.values().sum(), b.values().sum());
    if ta == 0 || tb == 0 {
        return if ta == tb { 0 } else { 100 };
    }
    let keys: std::collections::BTreeSet<u32> = a.keys().chain(b.keys()).copied().collect();
    let twice: i64 = keys
        .iter()
        .map(|k| {
            let pa = a.get(k).copied().unwrap_or(0) * 10_000 / ta;
            let pb = b.get(k).copied().unwrap_or(0) * 10_000 / tb;
            (pa - pb).abs()
        })
        .sum();
    twice / 200
}

fn inside(r: &sim::world::Rect, x: i32, y: i32) -> bool {
    r.contains(x, y)
}

/// What a neighbourhood's rect is made of, as a player sees it: the props
/// standing in it, the floors its rooms are laid with (by area) and the roofs
/// over its buildings (by area).
struct Made {
    props: std::collections::BTreeMap<u32, i64>,
    floors: std::collections::BTreeMap<u32, i64>,
    roofs: std::collections::BTreeMap<u32, i64>,
}

fn made_of(rows: &RegionRows, content: &GenerationContent, r: &sim::world::Rect) -> Made {
    let mut m = Made {
        props: Default::default(),
        floors: Default::default(),
        roofs: Default::default(),
    };
    for p in &rows.placed {
        if inside(r, p.x, p.y) {
            *m.props.entry(p.def_id).or_default() += 1;
        }
    }
    let floor_tag = content.tags.iter().find(|t| t.key == "floor").unwrap().id;
    let area_in = |x0: i32, y0: i32, x1: i32, y1: i32| -> i64 {
        let w = (x1.min(r.x1) - x0.max(r.x0)).max(0);
        let h = (y1.min(r.y1) - y0.max(r.y0)).max(0);
        i64::from(w) * i64::from(h)
    };
    for g in &rows.ground {
        let is_floor = content
            .objects
            .iter()
            .find(|o| o.id == g.def_id)
            .is_some_and(|o| o.tags.contains(&floor_tag));
        if is_floor {
            *m.floors.entry(g.def_id).or_default() += area_in(g.x0, g.y0, g.x1, g.y1);
        }
    }
    for g in &rows.roofs {
        *m.roofs.entry(g.def_id).or_default() += area_in(g.x0, g.y0, g.x1, g.y1);
    }
    m
}

/// The least a screenshot can tell apart on output: two sides of the
/// sharpest arterial of the committed seed differ by at least this many
/// percent (total variation) in what they are made of, per dial.
const LEGIBLE_OUTPUT_DISTANCE_PCT: i64 = 15;

#[test]
fn across_the_sharpest_arterial_each_dial_changes_what_the_district_is_made_of() {
    let (district, rows, _) = world();
    let content = GenerationContent::committed();
    let steps = adjacent_steps(&district);
    let by_aff = steps.iter().max_by_key(|s| s.affluence).unwrap();
    let by_age = steps.iter().max_by_key(|s| s.age).unwrap();

    // Affluence: floors and props. The tile a room is laid with and the
    // furniture standing on it are the carriers the generator reads it by.
    let (fa, fb) = (
        made_of(&rows, &content, &by_aff.a),
        made_of(&rows, &content, &by_aff.b),
    );
    let floors = tv_pct(&fa.floors, &fb.floors);
    let props = tv_pct(&fa.props, &fb.props);
    println!(
        "affluence step {} at {:?}: floors differ {floors}%, props {props}%",
        by_aff.affluence, by_aff.cell
    );
    assert!(
        floors.max(props) >= LEGIBLE_OUTPUT_DISTANCE_PCT,
        "affluence steps {} across the arterial but the output differs by only floors {floors}% / props {props}%",
        by_aff.affluence
    );

    // Building age: roofs. The dwelling's roof reads its age band; nothing
    // else in the district reads it yet (the facade variant is a later story).
    let (ra, rb) = (
        made_of(&rows, &content, &by_age.a),
        made_of(&rows, &content, &by_age.b),
    );
    let roofs = tv_pct(&ra.roofs, &rb.roofs);
    println!(
        "age step {} at {:?}: roofs differ {roofs}%",
        by_age.age, by_age.cell
    );
    assert!(
        roofs >= LEGIBLE_OUTPUT_DISTANCE_PCT,
        "age steps {} across the arterial but the roofs differ by only {roofs}%",
        by_age.age
    );
}

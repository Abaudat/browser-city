//! The one rasteriser of placed rows on the server: rows plus their defs
//! become one [`FloorCollision`] per floor. A tile is blocked iff a
//! collider touches it, half-open. The client derives its own grid from the
//! same rule (`world/collision-grid.ts`); `fixtures/world-conformance.v1.json`
//! is the contract between the two, no code is shared (NFR30).

use std::collections::BTreeMap;

use super::collision::{FloorCollision, Rect};
use super::walkability::{Placement, footprint_origin};
use crate::generated::defs::{self, MAX_FLOOR, MIN_FLOOR};

/// The tiles a def's collider touches for a row anchored at `(anchor_x,
/// anchor_y)`: `None` for a def with no collider.
pub fn collider_cells(anchor_x: i32, anchor_y: i32, def: &defs::ObjectDef) -> Option<Rect> {
    let c = def.collider?;
    let s = defs::COLLIDER_SUBCELLS_PER_CELL;
    let (ox, oy) = footprint_origin(anchor_x, anchor_y, def.height);
    Some(Rect {
        x0: ox + c.x0.div_euclid(s),
        y0: oy + c.y0.div_euclid(s),
        x1: ox + (c.x1 + s - 1).div_euclid(s),
        y1: oy + (c.y1 + s - 1).div_euclid(s),
    })
}

/// One grid per floor `MIN_FLOOR..=MAX_FLOOR`, empty or not, each bounded
/// by `bounds` exactly. `Err` for an unknown def, a floor outside the
/// range, or a collider that leaves `bounds` -- a cell outside the bounds
/// would silently read as walkable.
pub fn floor_grids(
    bounds: Rect,
    rows: &[Placement],
    objects: &[defs::ObjectDef],
) -> Result<BTreeMap<i8, FloorCollision>, String> {
    let by_id: BTreeMap<u32, &defs::ObjectDef> = objects.iter().map(|o| (o.id, o)).collect();
    let mut per_floor: BTreeMap<i8, Vec<Rect>> = (MIN_FLOOR..=MAX_FLOOR)
        .map(|f| (f as i8, Vec::new()))
        .collect();
    for p in rows {
        let def = by_id
            .get(&p.def_id)
            .ok_or_else(|| format!("floor_grids: unknown def {}", p.def_id))?;
        let Some(c) = collider_cells(p.anchor_x, p.anchor_y, def) else {
            continue;
        };
        if c.x0 < bounds.x0 || c.y0 < bounds.y0 || c.x1 > bounds.x1 || c.y1 > bounds.y1 {
            return Err(format!(
                "floor_grids: collider {c:?} of def {} on floor {} leaves the site {bounds:?}",
                p.def_id, p.floor
            ));
        }
        per_floor
            .get_mut(&p.floor)
            .ok_or_else(|| format!("floor_grids: floor {} is out of range", p.floor))?
            .push(c);
    }
    per_floor
        .into_iter()
        .map(|(floor, colliders)| Ok((floor, FloorCollision::build(bounds, &colliders)?)))
        .collect()
}

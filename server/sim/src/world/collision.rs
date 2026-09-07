//! The addressing/collision/transition/ownership model itself. Ordered
//! collections only (`BTreeMap`, never `HashMap`) -- the world is iterated
//! during generation and rendering, and iteration order must be
//! deterministic (NFR25/NFR26's determinism posture, applied here even
//! though nothing in this module derives from a seed yet).

use std::cell::Cell;
use std::collections::BTreeMap;

/// An axis-aligned, half-open rectangle: contains `x0..x1`, `y0..y1`.
/// Every comparison here widens to `i64` first, so no combination of `i32`
/// inputs (including `i32::MIN`/`i32::MAX`) can overflow a comparison or
/// subtraction -- `inv_world_query_total` (`../../tests/invariants.rs`)
/// holds this to arbitrary `i32` input, not just realistic world sizes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
}

impl Rect {
    /// A rect is valid only if it encloses at least one cell.
    pub fn is_valid(&self) -> bool {
        self.x1 as i64 > self.x0 as i64 && self.y1 as i64 > self.y0 as i64
    }

    pub fn contains(&self, x: i32, y: i32) -> bool {
        let (x, y) = (x as i64, y as i64);
        x >= self.x0 as i64 && x < self.x1 as i64 && y >= self.y0 as i64 && y < self.y1 as i64
    }

    pub fn width(&self) -> i64 {
        self.x1 as i64 - self.x0 as i64
    }

    pub fn height(&self) -> i64 {
        self.y1 as i64 - self.y0 as i64
    }
}

/// One floor's collision set, dense so a query is one arithmetic index
/// (Quentin's direction, story 1.5): a cell collision query sits on every
/// entity's hot path, so it must never be a scan over instances and never a
/// map lookup per cell. One bit per cell -- `tests/world_perf.rs` holds the
/// memory budget to this, and holds the query itself to a bounded number of
/// accesses regardless of world size.
///
/// Cells outside `bounds` are never blocked: a query there means "no
/// collider is known for that cell", which is exactly FR128's rule
/// (walkability is the absence of a collider) applied to the absence of
/// any data at all.
#[derive(Debug, Clone)]
pub struct FloorCollision {
    bounds: Rect,
    blocked: Vec<u64>,
    /// Counts `is_blocked`'s own dense-storage word accesses --
    /// instrumentation for `tests/world_perf.rs`, which asserts a query
    /// costs a bounded, small number of accesses regardless of world size
    /// rather than asserting a wall-clock budget (which flakes on a shared
    /// runner). `Cell` because the query methods take `&self`: a counter is
    /// not part of a floor's collision state, only of how many times it was
    /// asked.
    access_count: Cell<u64>,
}

fn words_for(bit_count: i64) -> usize {
    ((bit_count + 63) / 64).max(0) as usize
}

impl FloorCollision {
    /// Builds a dense collision grid covering `bounds`, blocked wherever
    /// any of `colliders` overlaps -- the rasterisation Tim's direction
    /// describes: real object colliders are resolved from `placed_object`
    /// rows plus their definitions by a later story; this function accepts
    /// the already-resolved rectangles so it stays free of that dependency.
    ///
    /// `bounds` must be valid and small enough that `width * height` bits
    /// fit in memory -- a caller-side contract (world generation controls
    /// its own extent), not something this function can make total without
    /// accepting unbounded allocation.
    pub fn build(bounds: Rect, colliders: &[Rect]) -> Self {
        assert!(
            bounds.is_valid(),
            "FloorCollision::build: bounds must be valid"
        );
        let cell_count = bounds.width() * bounds.height();
        let mut blocked = vec![0u64; words_for(cell_count)];
        for collider in colliders {
            let x0 = collider.x0.max(bounds.x0);
            let y0 = collider.y0.max(bounds.y0);
            let x1 = collider.x1.min(bounds.x1);
            let y1 = collider.y1.min(bounds.y1);
            for y in y0..y1 {
                for x in x0..x1 {
                    let idx = Self::index(&bounds, x, y);
                    blocked[idx / 64] |= 1u64 << (idx % 64);
                }
            }
        }
        FloorCollision {
            bounds,
            blocked,
            access_count: Cell::new(0),
        }
    }

    fn index(bounds: &Rect, x: i32, y: i32) -> usize {
        let local_x = x as i64 - bounds.x0 as i64;
        let local_y = y as i64 - bounds.y0 as i64;
        (local_y * bounds.width() + local_x) as usize
    }

    /// `(x, y)` is inside the floor's known extent at all.
    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        self.bounds.contains(x, y)
    }

    /// The collision query itself (FR117/FR128): one bounds check plus, at
    /// most, one bit read -- a bounded, small number of accesses regardless
    /// of world size (`tests/world_perf.rs`), and total over every `i32`
    /// `(x, y)` (`inv_world_query_total`): out of bounds is simply
    /// unblocked, never a panic.
    pub fn is_blocked(&self, x: i32, y: i32) -> bool {
        if !self.in_bounds(x, y) {
            return false;
        }
        self.access_count.set(self.access_count.get() + 1);
        let idx = Self::index(&self.bounds, x, y);
        (self.blocked[idx / 64] >> (idx % 64)) & 1 == 1
    }

    /// In bounds and not blocked -- what a floor transition's target must
    /// be (`inv_floor_transition_lands_standable`).
    pub fn is_standable(&self, x: i32, y: i32) -> bool {
        self.in_bounds(x, y) && !self.is_blocked(x, y)
    }

    /// Total dense-storage word accesses `is_blocked` has performed since
    /// the last [`Self::reset_access_count`] -- `tests/world_perf.rs`'s
    /// instrumentation.
    pub fn access_count(&self) -> u64 {
        self.access_count.get()
    }

    pub fn reset_access_count(&self) {
        self.access_count.set(0);
    }

    /// Bytes the dense per-cell collision bitset itself occupies -- the
    /// quantity that scales with world size, excluding this struct's fixed,
    /// per-floor bookkeeping overhead (the bounds rect and the access
    /// counter). `tests/world_perf.rs` holds this to the documented
    /// per-cell budget (`docs/architecture.md`'s "World addressing"
    /// section).
    pub fn dense_storage_bytes(&self) -> usize {
        self.blocked.len() * std::mem::size_of::<u64>()
    }
}

/// A floor transition's far side (FR117): entering the anchor cell moves
/// the entity here, in the same step that swaps in the target floor's
/// collision set -- see [`World::enter_transition`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Transition {
    pub target_x: i32,
    pub target_y: i32,
    pub target_floor: i8,
}

/// The sentinel `building`/`room` ownership id for "no owner" (FR119) --
/// documented once here rather than an `Option` every caller unwraps.
/// Safe as a sentinel because `#[auto_inc]` surrogate keys in SpacetimeDB
/// start at 1 (never 0).
pub const NO_OWNER: u64 = 0;

/// The building/room ownership id for one cell (FR119), queried
/// independently: a cell can be inside a building but not inside any one
/// room of it (a corridor), so `room_id` being [`NO_OWNER`] does not imply
/// `building_id` is too.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Ownership {
    pub building_id: u64,
    pub room_id: u64,
}

#[derive(Debug, Clone, Copy)]
struct Area {
    owner_id: u64,
    floor: i8,
    rect: Rect,
}

/// The addressed world model itself: one collision set per floor, floor
/// transitions keyed by their anchor cell, and the building/room ownership
/// areas. Built only through [`WorldSpec::build`], which is the one place
/// that can refuse to construct an invalid world (a transition landing off
/// a floor, or on top of a collider) -- see that type's doc comment.
#[derive(Debug, Clone)]
pub struct World {
    floors: BTreeMap<i8, FloorCollision>,
    transitions: BTreeMap<(i32, i32, i8), Transition>,
    building_areas: Vec<Area>,
    room_areas: Vec<Area>,
}

impl World {
    /// The collision query for an entity on `floor` (FR117's acceptance
    /// criterion: "an entity on floor 0 tests collision only against floor
    /// 0"). A floor this world never declared is simply empty -- nothing on
    /// it could ever have placed a collider.
    pub fn is_blocked(&self, x: i32, y: i32, floor: i8) -> bool {
        match self.floors.get(&floor) {
            Some(fc) => fc.is_blocked(x, y),
            None => false,
        }
    }

    /// The floor transition anchored at this cell, if any (FR117). A door
    /// is never one of these rows (FR118) -- it is simply a walkable cell
    /// this returns `None` for.
    pub fn transition_at(&self, x: i32, y: i32, floor: i8) -> Option<Transition> {
        self.transitions.get(&(x, y, floor)).copied()
    }

    /// Entering a transition cell (FR117): the target floor and that same
    /// floor's collision set, from one function application -- there is no
    /// intermediate state where the entity's floor has changed but its
    /// collision set has not, because both come out of this one call.
    /// `None` if `(x, y, floor)` is not a transition's anchor.
    pub fn enter_transition(&self, x: i32, y: i32, floor: i8) -> Option<(i8, &FloorCollision)> {
        let transition = self.transitions.get(&(x, y, floor))?;
        let target_floor = transition.target_floor;
        // WorldSpec::build refused any transition whose target floor
        // does not exist or is not standable, so this is always Some.
        self.floors.get(&target_floor).map(|fc| (target_floor, fc))
    }

    /// The building/room ownership id for `(x, y, floor)` (FR119),
    /// queryable both inside and outside a building or room -- total over
    /// every `i32` `(x, y)` and every `i8` floor, [`NO_OWNER`] where
    /// nothing owns the cell. Two calls with the same input always agree
    /// (`inv_cell_ownership_defined`): this only ever reads immutable data.
    pub fn ownership_at(&self, x: i32, y: i32, floor: i8) -> Ownership {
        let building_id = Self::find_owner(&self.building_areas, x, y, floor);
        let room_id = Self::find_owner(&self.room_areas, x, y, floor);
        Ownership {
            building_id,
            room_id,
        }
    }

    fn find_owner(areas: &[Area], x: i32, y: i32, floor: i8) -> u64 {
        areas
            .iter()
            .find(|a| a.floor == floor && a.rect.contains(x, y))
            .map(|a| a.owner_id)
            .unwrap_or(NO_OWNER)
    }
}

/// One floor's declared extent and colliders -- the hand-authored input to
/// [`WorldSpec`].
#[derive(Debug, Clone)]
pub struct FloorSpec {
    pub floor: i8,
    pub bounds: Rect,
    pub colliders: Vec<Rect>,
}

/// One floor transition's anchor and target (FR117) -- the hand-authored
/// input to [`WorldSpec`]. Mirrors `floor_transition`'s columns
/// (`../../../src/tables/world.rs`) so a world generator can build this
/// directly from the table's rows.
#[derive(Debug, Clone, Copy)]
pub struct TransitionSpec {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
    pub target_x: i32,
    pub target_y: i32,
    pub target_floor: i8,
}

/// One ownership rect (FR119) -- the hand-authored input to [`WorldSpec`].
/// Mirrors `building_area`/`room_area`'s columns.
#[derive(Debug, Clone, Copy)]
pub struct AreaSpec {
    pub owner_id: u64,
    pub floor: i8,
    pub rect: Rect,
}

/// The declarative description of a [`World`]: plain data, easy to
/// hand-author (see [`super::fixture`]) and easy to serialise for the
/// shared conformance fixture (`../../../../fixtures/world-conformance.v1.json`,
/// regenerated by `bounds`'s `regen-world-fixture` binary, since `sim`
/// itself never depends on `serde`).
#[derive(Debug, Clone, Default)]
pub struct WorldSpec {
    pub floors: Vec<FloorSpec>,
    pub transitions: Vec<TransitionSpec>,
    pub building_areas: Vec<AreaSpec>,
    pub room_areas: Vec<AreaSpec>,
}

impl WorldSpec {
    /// Builds the [`World`], refusing (`Err`, never a panic) any
    /// transition whose target floor does not exist in `self.floors` or
    /// whose target cell is not standable there -- players falling out of
    /// the world is impossible by construction, not by generator luck
    /// (`inv_floor_transition_lands_standable`): there is no other way to
    /// get a [`World`] with a transition in it.
    pub fn build(&self) -> Result<World, String> {
        let mut floors = BTreeMap::new();
        for spec in &self.floors {
            floors.insert(
                spec.floor,
                FloorCollision::build(spec.bounds, &spec.colliders),
            );
        }

        let mut transitions = BTreeMap::new();
        for t in &self.transitions {
            let target = floors.get(&t.target_floor).ok_or_else(|| {
                format!(
                    "transition ({}, {}, {}) targets floor {}, which this world does not declare",
                    t.x, t.y, t.floor, t.target_floor
                )
            })?;
            if !target.is_standable(t.target_x, t.target_y) {
                return Err(format!(
                    "transition ({}, {}, {}) targets ({}, {}, {}), which is not standable",
                    t.x, t.y, t.floor, t.target_x, t.target_y, t.target_floor
                ));
            }
            transitions.insert(
                (t.x, t.y, t.floor),
                Transition {
                    target_x: t.target_x,
                    target_y: t.target_y,
                    target_floor: t.target_floor,
                },
            );
        }

        let to_areas = |specs: &[AreaSpec]| -> Vec<Area> {
            specs
                .iter()
                .map(|a| Area {
                    owner_id: a.owner_id,
                    floor: a.floor,
                    rect: a.rect,
                })
                .collect()
        };

        Ok(World {
            floors,
            transitions,
            building_areas: to_areas(&self.building_areas),
            room_areas: to_areas(&self.room_areas),
        })
    }
}

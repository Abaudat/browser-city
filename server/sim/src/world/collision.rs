//! The addressing/collision/transition/ownership model itself. Ordered
//! collections only (`BTreeMap`, never `HashMap`) -- the world is iterated
//! during generation and rendering, and iteration order must be
//! deterministic (NFR25/NFR26's determinism posture, applied here even
//! though nothing in this module derives from a seed yet).

use std::collections::BTreeMap;

use super::chunk::{chunk_key, rect_is_within_one_chunk};

/// An axis-aligned, half-open rectangle: contains `x0..x1`, `y0..y1`.
/// Every comparison here widens to `i64` first, so no combination of `i32`
/// inputs (including `i32::MIN`/`i32::MAX`) can overflow a comparison or
/// subtraction -- `tests/invariants.rs`'s `inv_world_query_total` holds
/// this to arbitrary `i32` input, not just realistic world sizes.
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

    fn overlaps(&self, other: &Rect) -> bool {
        self.x0 < other.x1 && other.x0 < self.x1 && self.y0 < other.y1 && other.y0 < self.y1
    }
}

/// The largest number of cells a single floor's collision grid may cover
/// (`FloorCollision::build`'s ceiling): 64 Mi cells is a 64Ki x 1Ki extent
/// (or any factoring of it), which at the grid's own 1-bit-per-cell budget
/// is 8 MiB -- generous past NFR14's 1024-tile growth target on every
/// axis, while still refusing an unbounded allocation from a degenerate or
/// malicious extent.
pub const MAX_CELLS_PER_FLOOR: u64 = 64 * 1024 * 1024;

/// The cell index [`FloorCollision`]'s dense storage uses for `(x, y)`
/// within `bounds` -- a pure function of its three inputs, total (`None`
/// outside `bounds`, or if `bounds` is wide enough that the index would
/// overflow `i64` -- unreachable through a real [`FloorCollision`], whose
/// `bounds` already passed [`FloorCollision::build`]'s
/// [`MAX_CELLS_PER_FLOOR`] check, but this function is called directly by
/// `tests/world_perf.rs` with arbitrary bounds too) and never allocating,
/// so its arithmetic-only shape is directly testable without instrumenting
/// the query that uses it.
pub fn cell_index(bounds: Rect, x: i32, y: i32) -> Option<usize> {
    if !bounds.contains(x, y) {
        return None;
    }
    let local_x = x as i64 - bounds.x0 as i64;
    let local_y = y as i64 - bounds.y0 as i64;
    let idx = local_y.checked_mul(bounds.width())?.checked_add(local_x)?;
    usize::try_from(idx).ok()
}

/// One floor's collision set, dense so a query is one arithmetic index
/// (Quentin's direction, story 1.5): a cell collision query sits on every
/// entity's hot path, so it must never be a scan over instances and never
/// a map lookup per cell. One bit per cell -- `tests/world_perf.rs` holds
/// the memory budget to this.
///
/// Cells outside `bounds` are never blocked: a query there means "no
/// collider is known for that cell", which is exactly FR128's rule
/// (walkability is the absence of a collider) applied to the absence of
/// any data at all.
#[derive(Debug, Clone)]
pub struct FloorCollision {
    bounds: Rect,
    blocked: Vec<u64>,
}

fn words_for(bit_count: u64) -> usize {
    bit_count.div_ceil(64) as usize
}

impl FloorCollision {
    /// Builds a dense collision grid covering `bounds`, blocked wherever
    /// any of `colliders` overlaps -- the rasterisation Tim's direction
    /// describes: real object colliders are resolved from `placed_object`
    /// rows plus their definitions by a later story; this function accepts
    /// the already-resolved rectangles so it stays free of that dependency.
    ///
    /// Total, never a panic: `Err` on an invalid `bounds`, and `Err` (not
    /// an unbounded allocation) if `bounds` covers more than
    /// [`MAX_CELLS_PER_FLOOR`] cells. `bounds.width() * bounds.height()`
    /// is computed via `checked_mul` on `i64` -- both operands fit in
    /// `i64` (each at most `u32::MAX`), but their product can exceed it
    /// for a wide-enough rect, and the published profile's
    /// `overflow-checks` would abort the reducer on an unchecked
    /// multiplication.
    pub fn build(bounds: Rect, colliders: &[Rect]) -> Result<Self, String> {
        if !bounds.is_valid() {
            return Err(format!("FloorCollision::build: invalid bounds {bounds:?}"));
        }
        let cell_count = bounds
            .width()
            .checked_mul(bounds.height())
            .ok_or_else(|| format!("FloorCollision::build: {bounds:?} overflows a cell count"))?;
        let cell_count = u64::try_from(cell_count)
            .map_err(|_| format!("FloorCollision::build: {bounds:?} has a negative cell count"))?;
        if cell_count > MAX_CELLS_PER_FLOOR {
            return Err(format!(
                "FloorCollision::build: {bounds:?} covers {cell_count} cells, over the {MAX_CELLS_PER_FLOOR}-cell ceiling"
            ));
        }

        let mut blocked = vec![0u64; words_for(cell_count)];
        for collider in colliders {
            let x0 = collider.x0.max(bounds.x0);
            let y0 = collider.y0.max(bounds.y0);
            let x1 = collider.x1.min(bounds.x1);
            let y1 = collider.y1.min(bounds.y1);
            for y in y0..y1 {
                for x in x0..x1 {
                    let Some(idx) = cell_index(bounds, x, y) else {
                        continue;
                    };
                    blocked[idx / 64] |= 1u64 << (idx % 64);
                }
            }
        }
        Ok(FloorCollision { bounds, blocked })
    }

    /// `(x, y)` is inside the floor's known extent at all.
    pub fn in_bounds(&self, x: i32, y: i32) -> bool {
        self.bounds.contains(x, y)
    }

    /// The collision query itself (FR117/FR128): a bounds check plus, at
    /// most, one dense-storage word read via [`cell_index`] -- provably
    /// bounded regardless of world size, and total over every `i32` `(x,
    /// y)` (`inv_world_query_total`): out of bounds is simply unblocked,
    /// never a panic.
    pub fn is_blocked(&self, x: i32, y: i32) -> bool {
        let Some(idx) = cell_index(self.bounds, x, y) else {
            return false;
        };
        (self.blocked[idx / 64] >> (idx % 64)) & 1 == 1
    }

    /// In bounds and not blocked -- what a floor transition's anchor and
    /// target must both be (`inv_floor_transition_lands_standable`).
    pub fn is_standable(&self, x: i32, y: i32) -> bool {
        self.in_bounds(x, y) && !self.is_blocked(x, y)
    }

    /// Bytes the dense per-cell collision bitset itself occupies -- the
    /// quantity that scales with world size, excluding this struct's
    /// fixed, per-floor bookkeeping overhead (the bounds rect).
    /// `tests/world_perf.rs` holds this to the documented per-cell budget
    /// (`docs/architecture.md`'s "World addressing" section).
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
    rect: Rect,
}

/// Areas bucketed by `chunk_key`, so `World::ownership_at` costs one map
/// lookup plus a scan of one chunk's rects (`WorldSpec::build` guarantees
/// every area fits entirely inside the one chunk its bucket key names),
/// never a scan of every area in the world.
type AreaIndex = BTreeMap<u64, Vec<Area>>;

/// The addressed world model itself: one collision set per floor, floor
/// transitions keyed by their anchor cell, and the building/room ownership
/// areas. Built only through [`WorldSpec::build`], which is the one place
/// that can refuse to construct an invalid world (a transition anchored or
/// landing off a floor or on top of a collider, an ownership area that
/// spans more than one chunk, or two overlapping same-kind areas) -- see
/// that type's doc comment.
#[derive(Debug, Clone)]
pub struct World {
    floors: BTreeMap<i8, FloorCollision>,
    transitions: BTreeMap<(i32, i32, i8), Transition>,
    building_areas: AreaIndex,
    room_areas: AreaIndex,
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
    /// nothing owns the cell. Two calls with the same input always agree:
    /// this only ever reads immutable data.
    pub fn ownership_at(&self, x: i32, y: i32, floor: i8) -> Ownership {
        let key = chunk_key(x, y, floor);
        Ownership {
            building_id: Self::find_owner(&self.building_areas, key, x, y),
            room_id: Self::find_owner(&self.room_areas, key, x, y),
        }
    }

    fn find_owner(index: &AreaIndex, key: u64, x: i32, y: i32) -> u64 {
        index
            .get(&key)
            .and_then(|areas| areas.iter().find(|a| a.rect.contains(x, y)))
            .map(|a| a.owner_id)
            .unwrap_or(NO_OWNER)
    }

    /// The number of areas sharing the chunk `chunk_key(x, y, floor)`
    /// names, in `building_areas` -- a plain, side-effect-free read
    /// exposing the data shape [`Self::ownership_at`]'s bounded cost rests
    /// on (`tests/world_perf.rs`), not a counter of any query performed.
    pub fn building_areas_in_chunk_of(&self, x: i32, y: i32, floor: i8) -> usize {
        self.building_areas
            .get(&chunk_key(x, y, floor))
            .map_or(0, Vec::len)
    }

    /// [`Self::building_areas_in_chunk_of`]'s `room_area` counterpart.
    pub fn room_areas_in_chunk_of(&self, x: i32, y: i32, floor: i8) -> usize {
        self.room_areas
            .get(&chunk_key(x, y, floor))
            .map_or(0, Vec::len)
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
/// Mirrors `building_area`/`room_area`'s columns, `chunk_key` included:
/// [`WorldSpec::build`] checks that `chunk_key` really is
/// `sim::world::chunk_key(rect.x0, rect.y0, floor)` and that `rect` fits
/// entirely inside the chunk it names, the same check a live row's writer
/// must satisfy. [`super::clip_rect_to_chunks`] produces both fields
/// together, correctly, from an arbitrary rect.
#[derive(Debug, Clone, Copy)]
pub struct AreaSpec {
    pub owner_id: u64,
    pub floor: i8,
    pub rect: Rect,
    pub chunk_key: u64,
}

/// The declarative description of a [`World`]: plain data, easy to
/// hand-author (see `super::fixture`) and easy to serialise for the
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
    /// Builds the [`World`], refusing (`Err`, never a panic):
    ///
    /// - a floor whose extent is invalid or over [`MAX_CELLS_PER_FLOOR`]
    ///   ([`FloorCollision::build`]'s own checks);
    /// - a transition whose anchor or target floor does not exist, or
    ///   whose anchor or target cell is not standable there
    ///   (`inv_floor_transition_lands_standable`) -- players falling out
    ///   of the world, or a transition anchored on unreachable geometry,
    ///   is impossible by construction, not by generator luck;
    /// - an ownership area whose rect is invalid, whose declared
    ///   `chunk_key` does not match `sim::world::chunk_key(rect.x0,
    ///   rect.y0, floor)`, or that does not fit entirely inside that one
    ///   chunk; and
    /// - two areas of the same kind (`building_area`/`room_area`) on the
    ///   same floor whose rects overlap, since which one a query would
    ///   answer with would otherwise depend on row order (NFR25's
    ///   determinism posture applied to ownership).
    ///
    /// There is no other way to get a [`World`].
    pub fn build(&self) -> Result<World, String> {
        let mut floors = BTreeMap::new();
        for spec in &self.floors {
            let fc = FloorCollision::build(spec.bounds, &spec.colliders)?;
            floors.insert(spec.floor, fc);
        }

        let standable_or_err = |x: i32, y: i32, floor: i8, role: &str| -> Result<(), String> {
            let fc = floors
                .get(&floor)
                .ok_or_else(|| format!("{role} ({x}, {y}, {floor}) is on an undeclared floor"))?;
            if !fc.is_standable(x, y) {
                return Err(format!("{role} ({x}, {y}, {floor}) is not standable"));
            }
            Ok(())
        };

        let mut transitions = BTreeMap::new();
        for t in &self.transitions {
            standable_or_err(t.x, t.y, t.floor, "a transition anchor")?;
            standable_or_err(
                t.target_x,
                t.target_y,
                t.target_floor,
                "a transition target",
            )?;
            transitions.insert(
                (t.x, t.y, t.floor),
                Transition {
                    target_x: t.target_x,
                    target_y: t.target_y,
                    target_floor: t.target_floor,
                },
            );
        }

        let building_areas = Self::build_area_index(&self.building_areas, "building_area")?;
        let room_areas = Self::build_area_index(&self.room_areas, "room_area")?;

        Ok(World {
            floors,
            transitions,
            building_areas,
            room_areas,
        })
    }

    fn build_area_index(specs: &[AreaSpec], kind: &str) -> Result<AreaIndex, String> {
        let mut index: AreaIndex = BTreeMap::new();
        for spec in specs {
            if !spec.rect.is_valid() {
                return Err(format!("{kind} {:?} is invalid", spec.rect));
            }
            if !rect_is_within_one_chunk(spec.rect, spec.floor) {
                return Err(format!(
                    "{kind} {:?} on floor {} spans more than one chunk",
                    spec.rect, spec.floor
                ));
            }
            let real_key = chunk_key(spec.rect.x0, spec.rect.y0, spec.floor);
            if real_key != spec.chunk_key {
                return Err(format!(
                    "{kind} {:?} on floor {} declares chunk_key {}, but its own chunk_key is {real_key}",
                    spec.rect, spec.floor, spec.chunk_key
                ));
            }

            let bucket = index.entry(spec.chunk_key).or_default();
            if bucket.iter().any(|a: &Area| a.rect.overlaps(&spec.rect)) {
                return Err(format!(
                    "{kind} {:?} on floor {} overlaps another {kind} in the same chunk",
                    spec.rect, spec.floor
                ));
            }
            bucket.push(Area {
                owner_id: spec.owner_id,
                rect: spec.rect,
            });
        }
        Ok(index)
    }
}

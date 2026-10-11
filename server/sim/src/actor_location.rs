//! Where an actor stands, at chunk grain (FR136). `actor_location` exists
//! so a client can subscribe to the actors of a chunk: a derived value
//! cannot be subscribed to, so the chunk is a stored column. It is
//! rewritten only when an actor's chunk or floor changes -- never per
//! step -- and [`plan_move`] is the only thing that decides so. The chunk
//! is always derived here, through [`crate::world::chunk_key`], never
//! taken from a caller.

use crate::codes::actor_kind;
use crate::world::chunk_key;

/// Each actor kind's own table accessor. Feeds `actor_location`'s row
/// bound (`bounds/tests/schema_shape.rs`).
pub const ACTOR_TABLES: &[(u32, &str)] = &[(actor_kind::CITIZEN, "citizen")];

/// What `actor_location` stores about where an actor is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Placement {
    pub chunk_key: u64,
    pub floor: i8,
}

/// The write a move requires, if any: `current` is the actor's row (none
/// for an actor never placed), `(x, y, floor)` where it now stands.
/// `None` means the row is already right and nothing is written.
pub fn plan_move(current: Option<Placement>, x: i32, y: i32, floor: i8) -> Option<Placement> {
    let next = Placement {
        chunk_key: chunk_key(x, y, floor),
        floor,
    };
    (current != Some(next)).then_some(next)
}

/// One chunk or floor change along a leg: the city instant it happens and
/// the placement the actor holds from then on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Crossing {
    pub at: i64,
    pub placement: Placement,
}

/// A route waypoint: a tile and its floor. The actor stands at tile centres.
pub type Waypoint = (i32, i32, i8);

/// The longest straight segment, in cells along either axis, the instants are
/// defined for: the client computes the same integer square root in doubles,
/// which is exact below this.
pub const MAX_SEGMENT_CELLS: i32 = 65_535;

/// Each waypoint's integer instant: the leg duration shared by cumulative
/// straight-line distance in 1/1024 cells (an integer square root, rounded
/// down), floor division. This is L3's rule, so the instant a crossing is
/// written and the instant every client's ledger position crosses agree; both
/// sides pin it with `fixtures/leg-instants.v1.json`. A route with a segment
/// longer than `MAX_SEGMENT_CELLS` has no instants.
pub fn leg_instants(route: &[Waypoint], t_depart: i64, t_arrive: i64) -> Option<Vec<i64>> {
    if route.windows(2).any(|w| {
        (w[0].0 - w[1].0).abs() > MAX_SEGMENT_CELLS || (w[0].1 - w[1].1).abs() > MAX_SEGMENT_CELLS
    }) {
        return None;
    }
    let duration = (t_arrive - t_depart).max(0);
    let seg = |i: usize| -> i64 {
        let (ax, ay, _) = route[i - 1];
        let (bx, by, _) = route[i];
        let (dx, dy) = ((ax - bx) as i64, (ay - by) as i64);
        (((dx * dx + dy * dy) as u64) << 20).isqrt() as i64
    };
    let total: i64 = (1..route.len()).map(seg).sum();
    let mut out = vec![t_depart];
    let mut cumulative = 0i64;
    for i in 1..route.len() {
        cumulative += seg(i);
        if total == 0 {
            out.push(t_depart);
        } else if i == route.len() - 1 {
            out.push(t_depart + duration);
        } else {
            out.push(t_depart + (duration as i128 * cumulative as i128 / total as i128) as i64);
        }
    }
    Some(out)
}

/// The cell an actor on `a -> b` stands in `u` of the way along (`u` as the
/// integer ratio `num / den`), floor division on the tile-centre line.
fn cell_at(a: i32, b: i32, num: i64, den: i64) -> i32 {
    // position * 2 = (2a + 1) + 2 (b - a) num / den, in half cells.
    let twice = (2 * a as i64 + 1) * den + 2 * (b as i64 - a as i64) * num;
    twice.div_euclid(2 * den) as i32
}

/// Every placement change along a leg, in instant order: the route's
/// interpolation is L3's (`leg_instants`), and a placement is derived only
/// through `plan_move`'s own `chunk_key`. Pure -- no clock, no table. The
/// first element is the placement at departure when it is not `start`.
pub fn crossings(
    route: &[Waypoint],
    t_depart: i64,
    t_arrive: i64,
    start: Option<Placement>,
) -> Vec<Crossing> {
    use crate::world::CHUNK_SIZE;
    let Some(&(fx, fy, ff)) = route.first() else {
        return Vec::new();
    };
    let Some(instants) = leg_instants(route, t_depart, t_arrive) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let mut here = start;
    if let Some(p) = plan_move(here, fx, fy, ff) {
        out.push(Crossing {
            at: t_depart,
            placement: p,
        });
        here = Some(p);
    }
    for s in 0..route.len().saturating_sub(1) {
        let (ax, ay, af) = route[s];
        let (bx, by, bf) = route[s + 1];
        let (t0, t1) = (instants[s], instants[s + 1]);
        let span = t1 - t0;
        // Candidate instants: every chunk boundary either axis passes, and
        // the segment's end (where the floor changes).
        let mut candidates: Vec<i64> = Vec::new();
        if span > 0 {
            for (a, b) in [(ax, bx), (ay, by)] {
                if a == b {
                    continue;
                }
                let (lo, hi) = (a.min(b), a.max(b));
                let mut boundary = lo.div_euclid(CHUNK_SIZE) * CHUNK_SIZE + CHUNK_SIZE;
                while boundary <= hi {
                    // First instant whose cell is on the far side of it.
                    let (mut l, mut h) = (t0, t1);
                    let far = |t: i64| {
                        let c = cell_at(a, b, t - t0, span);
                        if b > a { c >= boundary } else { c < boundary }
                    };
                    while l < h {
                        let m = l + (h - l) / 2;
                        if far(m) { h = m } else { l = m + 1 }
                    }
                    candidates.push(l);
                    boundary += CHUNK_SIZE;
                }
            }
        }
        candidates.push(t1);
        candidates.sort_unstable();
        candidates.dedup();
        for t in candidates {
            let (x, y, f) = if t >= t1 {
                (bx, by, bf)
            } else {
                (
                    cell_at(ax, bx, t - t0, span),
                    cell_at(ay, by, t - t0, span),
                    af,
                )
            };
            if let Some(p) = plan_move(here, x, y, f) {
                out.push(Crossing {
                    at: t,
                    placement: p,
                });
                here = Some(p);
            }
        }
    }
    out
}

/// How many `actor_location` writes a route costs, past the one that places
/// the actor at its start. A figure of the route alone: 5.18 reads it over a
/// population without running a scheduler.
pub fn crossings_per_route(route: &[Waypoint]) -> usize {
    // A duration large enough that no two boundaries share an instant.
    let n = crossings(route, 0, 1 << 40, None).len();
    n.saturating_sub(1)
}

/// Thousandths of a chunk-boundary crossing per hour of straight walking on
/// one axis, at `chunk_size` cells per chunk and `walk_millicells_per_s`. The trade the
/// dial `CHUNK_SIZE` makes: a smaller chunk is proportionally more writes.
pub fn crossings_per_walking_hour_milli(chunk_size: i32, walk_millicells_per_s: u32) -> u64 {
    // cells per hour = millicells/s * 3600 / 1000; crossings = that / chunk_size.
    walk_millicells_per_s as u64 * 3600 / chunk_size as u64
}

//! The four neighbourhood dials (FR113, story 3.7): density, building age,
//! affluence and land-use mix. Density and land use are the pass-1 field
//! ([`super::land_use`]); this module authors the other two and derives
//! the quantities the gentrification loop later reads.
//!
//! A neighbourhood is an area, never an identity: the ground between
//! arterials ([`super::streets::neighbourhood_rects`]). Age and
//! affluence are constant across one and step only where an arterial
//! separates two, so a block interior never carries a change, and every
//! raw value is a pure function of `(city_seed, the neighbourhood's own
//! world-absolute corner, cfg)` -- never normalised against the site's
//! extent. Each dial has its own keyed stream, so age, affluence and the
//! density peak are independent of one another.
//!
//! [`author`] draws raw values, then repairs the handful of district-level
//! guarantees `docs/generation.md` states (a poor neighbourhood that holds
//! dwellings, a legible step between adjacent neighbourhoods on each dial,
//! at least `min_corners` of the four age/affluence corners) in a fixed
//! order, so the same seed always yields the same district. A
//! neighbourhood narrower than the minimum patch span shares a patch --
//! and its dials -- with a neighbour, so a place is always bigger than a
//! screen.
//!
//! Everything numeric is a balance key read through [`NeighbourhoodConfig`].
//! No type, family or neighbourhood key appears here
//! (`check-generator-no-content-keys.sh`): "no fifth mechanism" holds
//! because this module is the only place a place's character is decided,
//! and it decides it from the two dials alone.

use crate::generated::defs;
use crate::rng::{Rng, seed_from_ids};
use crate::world::Rect;

/// Stream salts: one per dial, so no dial's draws move another's.
const STREAM_AGE: u64 = 0x4147_4531;
const STREAM_AFFLUENCE: u64 = 0x4146_464c;
const STREAM_BUILDING_AGE: u64 = 0x4247_4531;

/// Every balance key the dials read, loaded once into
/// [`super::GenerationConfig::neighbourhood`].
#[derive(Debug, Clone, Copy)]
pub struct NeighbourhoodConfig {
    pub building_age_min: i32,
    pub building_age_max: i32,
    pub affluence_min: i32,
    pub affluence_max: i32,
    /// Percent of neighbourhoods drawn at an end of a dial rather than in
    /// its middle third.
    pub extreme_share_percent: i32,
    /// The smallest gap on one dial that reads as two different places.
    pub legible_step: i32,
    /// Affluence at or below this is the bottom band.
    pub poor_band_max: i32,
    /// The fewest of the four age/affluence corners a district shows.
    pub min_corners: usize,
    /// A building's own age sits within this of its neighbourhood's.
    pub building_age_spread: i32,
    pub state_weight_age: i32,
    pub state_weight_affluence: i32,
    /// Mean physical state at or below this is wholly undesirable.
    pub desirability_state_floor: i32,
    pub viewport_width_cells: i32,
    pub viewport_height_cells: i32,
    /// No patch is narrower than this many viewports, either way (unless
    /// merging further would leave fewer patches than `min_corners`).
    pub min_patch_span_viewports: i32,
    /// A bottom-band patch must hold at least this many residential coarse
    /// cells to count as somewhere affordable to begin.
    pub min_home_cells: i64,
    pub citizens_per_dwelling: i32,
    pub citizens_per_post: i32,
}

impl NeighbourhoodConfig {
    pub fn from_balance(balance: &[defs::BalanceSeed]) -> Self {
        let g = |k: &str| {
            crate::balance::value(balance, &format!("generation.neighbourhood.{k}")) as i32
        };
        NeighbourhoodConfig {
            building_age_min: g("building_age_min"),
            building_age_max: g("building_age_max"),
            affluence_min: g("affluence_min"),
            affluence_max: g("affluence_max"),
            extreme_share_percent: g("extreme_share_percent"),
            legible_step: g("legible_step"),
            poor_band_max: g("poor_band_max"),
            min_corners: g("min_corners") as usize,
            building_age_spread: g("building_age_spread"),
            state_weight_age: g("state_weight_age"),
            state_weight_affluence: g("state_weight_affluence"),
            desirability_state_floor: g("desirability_state_floor"),
            viewport_width_cells: g("viewport_width_cells"),
            viewport_height_cells: g("viewport_height_cells"),
            min_patch_span_viewports: g("min_patch_span_viewports"),
            min_home_cells: g("min_home_cells") as i64,
            citizens_per_dwelling: g("citizens_per_dwelling"),
            citizens_per_post: g("citizens_per_post"),
        }
    }

    /// Cross-key sanity a single key's own range cannot express.
    pub fn check(&self) -> Result<(), String> {
        if self.building_age_min >= self.building_age_max {
            return Err("building_age_min must be below building_age_max".into());
        }
        if self.affluence_min >= self.affluence_max {
            return Err("affluence_min must be below affluence_max".into());
        }
        if self.poor_band_max < self.affluence_min || self.poor_band_max >= self.affluence_max {
            return Err("poor_band_max must lie inside the affluence range".into());
        }
        // Two opposite thirds of a dial must be a legible step apart, or a
        // pair of distinct corners could read as the same place.
        for (lo, hi) in [
            (self.building_age_min, self.building_age_max),
            (self.affluence_min, self.affluence_max),
        ] {
            let span = hi - lo;
            if span - 2 * (span / 3) < self.legible_step {
                return Err("legible_step is too wide for one dial's range".into());
            }
        }
        if self.state_weight_age + self.state_weight_affluence <= 0 {
            return Err("the physical-state weights must sum above zero".into());
        }
        if self.desirability_state_floor >= 100 {
            return Err("desirability_state_floor must be below 100".into());
        }
        Ok(())
    }

    fn third(lo: i32, hi: i32) -> i32 {
        (hi - lo) / 3
    }

    /// The inclusive age at or above which a neighbourhood is "old".
    pub fn old_from(&self) -> i32 {
        self.building_age_max - Self::third(self.building_age_min, self.building_age_max)
    }

    /// The inclusive age at or below which a neighbourhood is "new".
    pub fn new_to(&self) -> i32 {
        self.building_age_min + Self::third(self.building_age_min, self.building_age_max)
    }

    /// The inclusive affluence at or above which a neighbourhood is "rich".
    pub fn rich_from(&self) -> i32 {
        self.affluence_max - Self::third(self.affluence_min, self.affluence_max)
    }

    /// The inclusive affluence at or below which a neighbourhood is "poor".
    pub fn poor_to(&self) -> i32 {
        self.affluence_min + Self::third(self.affluence_min, self.affluence_max)
    }
}

/// One neighbourhood as pass 1 hands it to [`author`]: its area and how
/// much of it is residential (the repair that guarantees an affordable
/// place to start puts the poor end where there are homes).
#[derive(Debug, Clone, Copy)]
pub struct HoodInput {
    pub bounds: Rect,
    pub residential_cells: i64,
}

/// A neighbourhood's two authored dials.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Dials {
    pub building_age: i32,
    pub affluence: i32,
}

/// The result of [`author`].
#[derive(Debug, Clone)]
pub struct Authored {
    /// One pair of dials per input neighbourhood.
    pub dials: Vec<Dials>,
    /// One patch id per input neighbourhood: neighbourhoods narrower than
    /// the minimum span share a patch -- and its dials -- with a neighbour.
    pub patch: Vec<usize>,
}

/// The age/affluence corner a dial pair sits at, if both dials are at an
/// end: `(old?, rich?)`, `None` when either is in its middle third.
pub fn corner(d: Dials, cfg: &NeighbourhoodConfig) -> Option<(bool, bool)> {
    let old = if d.building_age >= cfg.old_from() {
        Some(true)
    } else if d.building_age <= cfg.new_to() {
        Some(false)
    } else {
        None
    };
    let rich = if d.affluence >= cfg.rich_from() {
        Some(true)
    } else if d.affluence <= cfg.poor_to() {
        Some(false)
    } else {
        None
    };
    Some((old?, rich?))
}

fn world_key(v: i32) -> u64 {
    v as i64 as u64
}

/// One dial's raw value for the patch whose world-absolute corner is
/// `corner`: a pure function of `(city_seed, dial, corner, range, share)`.
fn raw_value(
    city_seed: u64,
    salt: u64,
    corner: (i32, i32),
    lo: i32,
    hi: i32,
    extreme_pct: i32,
) -> i32 {
    let mut rng = Rng::new(seed_from_ids(
        seed_from_ids(city_seed, salt),
        seed_from_ids(world_key(corner.0), world_key(corner.1)),
    ));
    let third = (hi - lo) / 3;
    if (rng.below(100) as i32) < extreme_pct {
        let off = rng.below(third as u64 + 1) as i32;
        if rng.below(2) == 0 {
            lo + off
        } else {
            hi - off
        }
    } else {
        let mid_lo = lo + third + 1;
        let mid_hi = hi - third - 1;
        mid_lo + rng.below((mid_hi - mid_lo + 1).max(1) as u64) as i32
    }
}

/// The raw (unrepaired) dials of the patch whose world-absolute corner is
/// `corner`: a pure function of `(city_seed, corner, cfg)` -- never of the
/// site's extent or of any other neighbourhood, so ground added elsewhere
/// leaves it unchanged.
pub fn raw_dials(city_seed: u64, corner: (i32, i32), cfg: &NeighbourhoodConfig) -> Dials {
    Dials {
        building_age: raw_value(
            city_seed,
            STREAM_AGE,
            corner,
            cfg.building_age_min,
            cfg.building_age_max,
            cfg.extreme_share_percent,
        ),
        affluence: raw_value(
            city_seed,
            STREAM_AFFLUENCE,
            corner,
            cfg.affluence_min,
            cfg.affluence_max,
            cfg.extreme_share_percent,
        ),
    }
}

fn distinct_corners(
    dials: &[Dials],
    cfg: &NeighbourhoodConfig,
) -> std::collections::BTreeSet<(bool, bool)> {
    dials.iter().filter_map(|d| corner(*d, cfg)).collect()
}

/// Length of the edge two half-open rects share; 0 when they meet only at
/// a corner or not at all.
fn shared_edge(a: Rect, b: Rect) -> i32 {
    let overlap_y = a.y1.min(b.y1) - a.y0.max(b.y0);
    let overlap_x = a.x1.min(b.x1) - a.x0.max(b.x0);
    if (a.x1 == b.x0 || b.x1 == a.x0) && overlap_y > 0 {
        overlap_y
    } else if (a.y1 == b.y0 || b.y1 == a.y0) && overlap_x > 0 {
        overlap_x
    } else {
        0
    }
}

/// The patches: neighbourhoods narrower than the minimum span (a number
/// of viewports across, either way) cannot carry a place of their own and
/// are joined to the neighbour they share the longest edge with (a wide
/// one first), repeating until every patch is wide enough or has nothing
/// left to join (and never below `min_corners` patches). Returns each neighbourhood's patch id, the lowest member
/// index. A patch's neighbourhoods share one pair of dials, so a place is
/// always bigger than a screen and the dials still step only at arterials.
fn group_patches(hoods: &[HoodInput], cfg: &NeighbourhoodConfig) -> Vec<usize> {
    let min_w = cfg.min_patch_span_viewports * cfg.viewport_width_cells;
    let min_h = cfg.min_patch_span_viewports * cfg.viewport_height_cells;
    let mut label: Vec<usize> = (0..hoods.len()).collect();
    let bbox = |label: &[usize], l: usize| -> Option<Rect> {
        hoods
            .iter()
            .enumerate()
            .filter(|(i, _)| label[*i] == l)
            .map(|(_, h)| h.bounds)
            .reduce(|b, r| Rect {
                x0: b.x0.min(r.x0),
                y0: b.y0.min(r.y0),
                x1: b.x1.max(r.x1),
                y1: b.y1.max(r.y1),
            })
    };
    let wide = |label: &[usize], l: usize| {
        bbox(label, l).is_some_and(|b| b.x1 - b.x0 >= min_w && b.y1 - b.y0 >= min_h)
    };
    let mut stuck: Vec<usize> = Vec::new();
    for _ in 0..hoods.len() {
        let labels: std::collections::BTreeSet<usize> = label.iter().copied().collect();
        // Never merge below the patches the corner guarantee needs.
        if labels.len() <= cfg.min_corners {
            break;
        }
        let Some(narrow) = labels
            .iter()
            .copied()
            .find(|&l| !wide(&label, l) && !stuck.contains(&l))
        else {
            break;
        };
        // Candidate neighbour patches, scored by (wide, shared edge, lowest id).
        type Score = (bool, i32, std::cmp::Reverse<usize>);
        let mut best: Option<(Score, usize)> = None;
        for &other in labels.iter().filter(|&&l| l != narrow) {
            let edge: i32 = (0..hoods.len())
                .filter(|&i| label[i] == narrow)
                .flat_map(|i| {
                    (0..hoods.len())
                        .filter(|&j| label[j] == other)
                        .map(move |j| (i, j))
                })
                .map(|(i, j)| shared_edge(hoods[i].bounds, hoods[j].bounds))
                .sum();
            if edge > 0 {
                let score = (wide(&label, other), edge, std::cmp::Reverse(other));
                if best.is_none_or(|(s, _)| score > s) {
                    best = Some((score, other));
                }
            }
        }
        match best {
            Some((_, other)) => {
                let keep = narrow.min(other);
                for l in label.iter_mut() {
                    if *l == narrow || *l == other {
                        *l = keep;
                    }
                }
            }
            None => stuck.push(narrow),
        }
    }
    label
}

/// The district's authored dials, one pair per input neighbourhood in input
/// order, plus each neighbourhood's patch id. Raw values first, then the
/// guarantees, each repair acting only when its own check fails.
pub fn author(city_seed: u64, hoods: &[HoodInput], cfg: &NeighbourhoodConfig) -> Authored {
    let patch = group_patches(hoods, cfg);
    // Units are patches, in lowest-member order.
    let reps: Vec<usize> = {
        let mut r: Vec<usize> = patch.clone();
        r.sort_unstable();
        r.dedup();
        r
    };
    let unit_of = |hood: usize| reps.iter().position(|&r| r == patch[hood]).unwrap_or(0);
    let units = reps.len();
    let mut residential = vec![0i64; units];
    let mut touching = vec![vec![false; units]; units];
    for (i, h) in hoods.iter().enumerate() {
        residential[unit_of(i)] += h.residential_cells;
        for (j, g) in hoods.iter().enumerate().skip(i + 1) {
            let (u, v) = (unit_of(i), unit_of(j));
            if u != v && shared_edge(h.bounds, g.bounds) > 0 {
                touching[u][v] = true;
                touching[v][u] = true;
            }
        }
    }
    let pairs = || {
        (0..units).flat_map(|u| {
            let touching = &touching;
            (u + 1..units)
                .filter(move |&v| touching[u][v])
                .map(move |v| (u, v))
        })
    };
    let has_step = |dials: &[Dials], value: &dyn Fn(&Dials) -> i32| {
        pairs().any(|(u, v)| (value(&dials[u]) - value(&dials[v])).abs() >= cfg.legible_step)
    };

    let mut dials: Vec<Dials> = reps
        .iter()
        .map(|&r| raw_dials(city_seed, (hoods[r].bounds.x0, hoods[r].bounds.y0), cfg))
        .collect();

    if units >= 2 {
        let poor_value = cfg.affluence_min + (cfg.poor_band_max - cfg.affluence_min) / 2;
        let rich_value = cfg.affluence_max - (cfg.affluence_max - cfg.affluence_min) / 6;
        let old_value = cfg.building_age_max - (cfg.building_age_max - cfg.building_age_min) / 6;
        let new_value = cfg.building_age_min + (cfg.building_age_max - cfg.building_age_min) / 6;

        // The most residential patch: where the affordable end goes.
        let home = (0..units)
            .max_by_key(|&u| (residential[u], std::cmp::Reverse(u)))
            .unwrap_or(0);

        for _ in 0..4 {
            // 1. Somewhere affordable to begin: a bottom-band patch that
            // holds dwellings.
            let affordable = (0..units).any(|u| {
                dials[u].affluence <= cfg.poor_band_max && residential[u] >= cfg.min_home_cells
            });
            if !affordable {
                dials[home].affluence = poor_value;
            }
            // The poorest residential patch anchors the affluence step.
            let poor = (0..units)
                .filter(|&u| residential[u] >= cfg.min_home_cells)
                .min_by_key(|&u| (dials[u].affluence, u))
                .unwrap_or(home);

            // 2. A legible step between adjacent patches on affluence.
            if !has_step(&dials, &|d| d.affluence)
                && let Some(n) = (0..units).find(|&n| n != poor && touching[poor][n])
            {
                dials[n].affluence = rich_value;
            }

            // 3. ... and on age: the adjacent pair furthest apart is pulled
            // to the two ends.
            if !has_step(&dials, &|d| d.building_age)
                && let Some((u, v)) = pairs().max_by_key(|&(u, v)| {
                    (
                        (dials[u].building_age - dials[v].building_age).abs(),
                        std::cmp::Reverse((u, v)),
                    )
                })
            {
                let (older, newer) = if dials[u].building_age >= dials[v].building_age {
                    (u, v)
                } else {
                    (v, u)
                };
                dials[older].building_age = old_value;
                dials[newer].building_age = new_value;
            }

            // 4. At least `min_corners` of the four corners present, taken
            // from patches the steps above do not lean on where possible.
            let mut present = distinct_corners(&dials, cfg);
            if present.len() < cfg.min_corners {
                let step_pair = |value: &dyn Fn(&Dials) -> i32, dials: &[Dials]| {
                    pairs().find(|&(u, v)| {
                        (value(&dials[u]) - value(&dials[v])).abs() >= cfg.legible_step
                    })
                };
                let mut protected = vec![poor];
                for pair in [
                    step_pair(&|d| d.affluence, &dials),
                    step_pair(&|d| d.building_age, &dials),
                ]
                .into_iter()
                .flatten()
                {
                    protected.extend([pair.0, pair.1]);
                }
                for want in [(true, false), (true, true), (false, false), (false, true)] {
                    if present.len() >= cfg.min_corners {
                        break;
                    }
                    if present.contains(&want) {
                        continue;
                    }
                    let surplus = |u: usize, dials: &[Dials]| match corner(dials[u], cfg) {
                        None => true,
                        Some(c) => {
                            dials.iter().filter(|d| corner(**d, cfg) == Some(c)).count() >= 2
                        }
                    };
                    let victim = (0..units)
                        .find(|&u| !protected.contains(&u) && surplus(u, &dials))
                        .or_else(|| (0..units).find(|&u| u != poor && surplus(u, &dials)));
                    if let Some(v) = victim {
                        dials[v] = Dials {
                            building_age: if want.0 { old_value } else { new_value },
                            affluence: if want.1 { rich_value } else { poor_value },
                        };
                        present = distinct_corners(&dials, cfg);
                    }
                }
            }
        }
    }
    // The repairs above almost always settle; where a district's patches
    // leave them short, build the three guarantees outright along a walk
    // of adjacent patches from the poorest residential one: that patch and
    // its first two neighbours take (a, poor), (not a, poor), (a, rich),
    // so every adjacent pair of the walk differs on a dial and the trio
    // shows three corners.
    if units >= 3 {
        let settled = distinct_corners(&dials, cfg).len() >= cfg.min_corners.min(units)
            && has_step(&dials, &|d| d.affluence)
            && has_step(&dials, &|d| d.building_age);
        if !settled {
            let poor_value = cfg.affluence_min + (cfg.poor_band_max - cfg.affluence_min) / 2;
            let rich_value = cfg.affluence_max - (cfg.affluence_max - cfg.affluence_min) / 6;
            let old_value =
                cfg.building_age_max - (cfg.building_age_max - cfg.building_age_min) / 6;
            let new_value =
                cfg.building_age_min + (cfg.building_age_max - cfg.building_age_min) / 6;
            let start = (0..units)
                .filter(|&u| residential[u] >= cfg.min_home_cells)
                .min_by_key(|&u| (dials[u].affluence, u))
                .unwrap_or(0);
            let mut order = vec![start];
            let mut i = 0;
            while i < order.len() && order.len() < 4.min(units) {
                for (v, &next_to) in touching[order[i]].iter().enumerate() {
                    if next_to && !order.contains(&v) && order.len() < 4 {
                        order.push(v);
                    }
                }
                i += 1;
            }
            let a_old =
                dials[start].building_age >= (cfg.building_age_min + cfg.building_age_max) / 2;
            let corners = [
                (a_old, false),
                (!a_old, false),
                (a_old, true),
                (!a_old, true),
            ];
            for (&u, &(old, rich)) in order.iter().zip(corners.iter()) {
                dials[u] = Dials {
                    building_age: if old { old_value } else { new_value },
                    affluence: if rich { rich_value } else { poor_value },
                };
            }
        }
    }
    Authored {
        dials: (0..hoods.len()).map(|i| dials[unit_of(i)]).collect(),
        patch,
    }
}

/// A building's own age: its neighbourhood's, plus a small spread keyed on
/// the building's own footprint (never list position), clamped to the dial.
pub fn building_age(
    pass_seed: u64,
    footprint_key: u64,
    neighbourhood_age: i32,
    cfg: &NeighbourhoodConfig,
) -> i32 {
    let mut rng = Rng::new(seed_from_ids(
        seed_from_ids(pass_seed, STREAM_BUILDING_AGE),
        footprint_key,
    ));
    let spread = cfg.building_age_spread.max(0);
    let off = rng.below(2 * spread as u64 + 1) as i32 - spread;
    (neighbourhood_age + off).clamp(cfg.building_age_min, cfg.building_age_max)
}

fn percent(value: i32, lo: i32, hi: i32) -> i32 {
    ((value.clamp(lo, hi) - lo) * 100) / (hi - lo).max(1)
}

/// A building's initial physical state, 0 (worn) to 100 (kept): the older
/// the building and the poorer its neighbourhood, the more worn. A pure
/// function of the two dials; this story sets it once at generation and
/// nothing mutates it.
pub fn initial_physical_state(building_age: i32, affluence: i32, cfg: &NeighbourhoodConfig) -> i32 {
    let age_pct = percent(building_age, cfg.building_age_min, cfg.building_age_max);
    let aff_pct = percent(affluence, cfg.affluence_min, cfg.affluence_max);
    ((100 - age_pct) * cfg.state_weight_age + aff_pct * cfg.state_weight_affluence)
        / (cfg.state_weight_age + cfg.state_weight_affluence)
}

/// Desirability, 0 to 100: one pure function of a block's mean physical
/// state. Affluence is never an input -- the gentrification loop closes
/// through state, not through the dial that seeded it.
pub fn desirability_of(mean_physical_state: i32, cfg: &NeighbourhoodConfig) -> i32 {
    let floor = cfg.desirability_state_floor;
    ((mean_physical_state - floor).max(0) * 100) / (100 - floor).max(1)
}

//! Routing (FR130, FR131): the travel-time estimator, and later the graph
//! and search that share its cost unit.

pub mod estimate;

/// In-city time in thousandths of an in-city minute -- the one cost unit
/// of everything under `routing/` (FR130: no second distance unit).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(transparent)]
pub struct Milliminutes(pub i64);

/// How a trip is travelled; the ladder is data (`routing.speed_percent.*`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TransportMode {
    Walk,
    Bike,
    Transit,
}

/// A cell address: world x, y and floor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
}

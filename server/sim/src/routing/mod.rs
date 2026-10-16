//! Routing (FR130, FR131): the travel-time estimator, and later the graph
//! and search that share its cost unit, and the provision index.

pub mod commute;
pub mod estimate;
pub mod graph;
pub mod provision;
pub mod search;

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

impl TransportMode {
    /// Every mode. The exhaustive `match` fails to compile when a variant
    /// is added, until it is also added to the list.
    pub const ALL: [TransportMode; 3] = [
        TransportMode::Walk,
        TransportMode::Bike,
        TransportMode::Transit,
    ];

    #[allow(dead_code)]
    fn _all_is_exhaustive(self) {
        match self {
            TransportMode::Walk | TransportMode::Bike | TransportMode::Transit => {}
        }
    }
}

/// A cell address: world x, y and floor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Point {
    pub x: i32,
    pub y: i32,
    pub floor: i8,
}

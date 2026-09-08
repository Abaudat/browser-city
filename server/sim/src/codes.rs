//! Extensible-set code tables (NFR36): matter kinds, provisions, reason
//! codes and node kinds are `u32` codes plus a name, each backed by a
//! companion data table in `../../src/tables/codes.rs`, never a Rust enum
//! -- a new variant is a row insert rather than a migration. The codes
//! themselves are pure data, defined once here so they are unit-testable
//! without `spacetimedb` (NFR28), and seeded into their companion tables
//! by an insert-if-absent helper callable from `init` and re-runnable
//! against a live world (NFR38).
//!
//! A code's number is as permanent as a primary key: renumbering one, or
//! handing a retired number to a different name, would silently change the
//! meaning of anything already stored under it. `tests/codes.rs` pins the
//! whole mapping in a golden.

/// One row of an extensible set: `code` is what a referencing column
/// stores; `name` is what the companion table's row for it carries.
pub struct Code {
    pub code: u32,
    pub name: &'static str,
}

/// A matter's jurisdiction category (FR69). Referenced by `u32`
/// everywhere a matter's kind matters, never by an enum.
pub mod matter_kind {
    use super::Code;

    pub const CODES: &[Code] = &[
        Code {
            code: 0,
            name: "sanitation",
        },
        Code {
            code: 1,
            name: "budget",
        },
        Code {
            code: 2,
            name: "housing",
        },
        Code {
            code: 3,
            name: "labour",
        },
    ];
}

/// What a macro-graph node advertises (FR130) -- the index of what the
/// city offers at that node.
pub mod provision {
    use super::Code;

    pub const CODES: &[Code] = &[
        Code {
            code: 0,
            name: "retail",
        },
        Code {
            code: 1,
            name: "employment",
        },
        Code {
            code: 2,
            name: "transit",
        },
        Code {
            code: 3,
            name: "housing",
        },
    ];
}

/// Why a decider acted on a matter (FR75), carried on the decision record
/// alongside the action and the severity at the time of the decision.
pub mod reason_code {
    use super::Code;

    pub const CODES: &[Code] = &[
        Code {
            code: 0,
            name: "insufficient_budget",
        },
        Code {
            code: 1,
            name: "low_severity",
        },
        Code {
            code: 2,
            name: "duplicate_complaint",
        },
        Code {
            code: 3,
            name: "out_of_jurisdiction",
        },
    ];
}

/// A cell's rendering-order dimension within its floor (FR117, FR123):
/// never a second collision dimension -- a collision test always consults
/// a whole floor's merged blocking set, regardless of layer. Unlike the
/// other extensible sets in this module, a layer carries its FR123
/// depth-sort `rank` inline on the same entry as `code`/`name` (not a
/// parallel array, here or anywhere else): a code can never be added
/// without a rank, and the mapping is pinned by the same golden as the
/// code numbers (`tests/codes.rs`). A minimal, honest set for what this
/// story's fixture needs (a road and the deck above it), not a
/// speculative full set.
pub mod layer {
    /// One layer code and its FR123 depth-sort rank. `../../src/tables/
    /// world.rs`'s `LayerCode` is the companion table this seeds.
    pub struct LayerCode {
        pub code: u32,
        pub name: &'static str,
        pub rank: u32,
    }

    pub const CODES: &[LayerCode] = &[
        LayerCode {
            code: 0,
            name: "ground",
            rank: 0,
        },
        LayerCode {
            code: 1,
            name: "overhead",
            rank: 1,
        },
    ];
}

/// A macro-graph node's kind (FR134): interiors collapse to an entrance
/// node, plus an internal node for large buildings.
pub mod node_kind {
    use super::Code;

    pub const CODES: &[Code] = &[
        Code {
            code: 0,
            name: "entrance",
        },
        Code {
            code: 1,
            name: "internal",
        },
        Code {
            code: 2,
            name: "street",
        },
        Code {
            code: 3,
            name: "transit_stop",
        },
    ];
}

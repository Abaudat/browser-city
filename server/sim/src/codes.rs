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
/// without a rank. `rank` is as permanent as `code` itself and pinned by
/// the same golden (`tests/codes.rs`, `docs/architecture.md`'s "World
/// addressing" section) -- get a layer's depth order right the first
/// time; `../../src/tables/codes.rs`'s `seed_all_codes` only ever inserts
/// a code once and never updates an existing row, so there is no update
/// path for a rank once seeded.
///
/// `ground` (rank 0) is the flat-pass floor/road surface: never a pool
/// member (see the client's own render-order comparator), so its rank is
/// never compared against a pool rank. The five pool layers -- `furniture`,
/// `objects`, `walls`, `wall_decals`, `characters` -- are minted a decade
/// apart (story 1.6), leaving every in-between number free for a future
/// layer to slot into without renumbering anything. Every live rank is
/// unique and every pool rank is a multiple of ten
/// (`layer_ranks_are_unique_and_pool_ranks_are_multiples_of_ten`,
/// `tests/codes.rs`).
///
/// `overhead` (code 1, rank 1) is deprecated (see [`DEPRECATED_CODES`]):
/// it was minted for a bridge deck FR124's floor offset already expresses,
/// its rank cannot be moved, and it cannot sit anywhere sane in the tens
/// ladder. The row stays seeded forever -- deprecation is a usage ban, not
/// a deletion -- but nothing may place new content on it.
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
        LayerCode {
            code: 2,
            name: "furniture",
            rank: 10,
        },
        LayerCode {
            code: 3,
            name: "objects",
            rank: 20,
        },
        LayerCode {
            code: 4,
            name: "walls",
            rank: 30,
        },
        LayerCode {
            code: 5,
            name: "wall_decals",
            rank: 40,
        },
        LayerCode {
            code: 6,
            name: "characters",
            rank: 50,
        },
    ];

    /// Codes no `PlacedObject` (or `WorldSpec` fixture) may ever be placed
    /// on again -- a usage ban, not a deletion: the row stays in
    /// [`CODES`]/seeded forever, since anything already stored under it
    /// must keep resolving. Checked by [`is_deprecated`]; there is no
    /// live call site yet that constructs a `PlacedObject` at all (that
    /// lands with the world-generation story), so this is the guard that
    /// story must call before accepting a layer value, not a check wired
    /// into `WorldSpec::build` today.
    pub const DEPRECATED_CODES: &[u32] = &[1];

    /// Whether `code` is banned from new placement (see
    /// [`DEPRECATED_CODES`]'s doc comment). Total over every `u32`,
    /// including a code [`CODES`] has never heard of.
    pub fn is_deprecated(code: u32) -> bool {
        DEPRECATED_CODES.contains(&code)
    }

    /// Why [`live_rank`] refused a code -- a plain enum, not a formatted
    /// `String`: `sim` is a pure crate (NFR28) and this refusal sits on
    /// what could become a hot path once a placement reducer calls it, so
    /// it must not allocate to report it.
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub enum RankLookupError {
        Deprecated(u32),
        Unknown(u32),
    }

    /// The FR123 depth-sort rank for a *live* (non-deprecated, known)
    /// layer code -- `Err` for a deprecated or unknown code, never a
    /// silent fallback rank. The client's own rank lookup mirrors this
    /// refusal (NFR30: a separate TypeScript implementation, not shared
    /// code).
    pub fn live_rank(code: u32) -> Result<u32, RankLookupError> {
        if is_deprecated(code) {
            return Err(RankLookupError::Deprecated(code));
        }
        CODES
            .iter()
            .find(|c| c.code == code)
            .map(|c| c.rank)
            .ok_or(RankLookupError::Unknown(code))
    }
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

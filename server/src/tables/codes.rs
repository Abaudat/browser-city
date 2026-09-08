//! Companion tables for the extensible sets defined in `sim::codes`
//! (NFR36): matter kinds, provisions, reason codes and node kinds are each
//! a `u32` code plus a name; layers are a `u32` code plus a name and a
//! FR123 depth-sort `rank`. Never a Rust enum, so a new variant is a row
//! insert rather than a migration.

use spacetimedb::{ReducerContext, Table};

use super::world::{LayerCode, layer_code};

#[spacetimedb::table(accessor = matter_kind)]
pub struct MatterKind {
    #[primary_key]
    pub code: u32,
    pub name: String,
}

#[spacetimedb::table(accessor = provision)]
pub struct Provision {
    #[primary_key]
    pub code: u32,
    pub name: String,
}

#[spacetimedb::table(accessor = reason_code)]
pub struct ReasonCode {
    #[primary_key]
    pub code: u32,
    pub name: String,
}

#[spacetimedb::table(accessor = node_kind)]
pub struct NodeKind {
    #[primary_key]
    pub code: u32,
    pub name: String,
}

/// Inserts every code in `sim::codes` not already present in its companion
/// table, keyed by `code`. Idempotent, so it is safe to call from `init`
/// and again from the `reseed_codes` reducer (`../lib.rs`) any time after
/// -- `init` only ever runs on the module's first publish, so
/// `reseed_codes` is the explicit, re-callable path that lands a code
/// added in month six (NFR38's read-through backfill posture) without
/// waiting for a data-wiping republish.
pub fn seed_all_codes(ctx: &ReducerContext) {
    for c in sim::codes::matter_kind::CODES {
        if ctx.db.matter_kind().code().find(c.code).is_none() {
            ctx.db.matter_kind().insert(MatterKind {
                code: c.code,
                name: c.name.to_string(),
            });
        }
    }
    for c in sim::codes::provision::CODES {
        if ctx.db.provision().code().find(c.code).is_none() {
            ctx.db.provision().insert(Provision {
                code: c.code,
                name: c.name.to_string(),
            });
        }
    }
    for c in sim::codes::reason_code::CODES {
        if ctx.db.reason_code().code().find(c.code).is_none() {
            ctx.db.reason_code().insert(ReasonCode {
                code: c.code,
                name: c.name.to_string(),
            });
        }
    }
    for c in sim::codes::node_kind::CODES {
        if ctx.db.node_kind().code().find(c.code).is_none() {
            ctx.db.node_kind().insert(NodeKind {
                code: c.code,
                name: c.name.to_string(),
            });
        }
    }
    for c in sim::codes::layer::CODES {
        if ctx.db.layer_code().code().find(c.code).is_none() {
            ctx.db.layer_code().insert(LayerCode {
                code: c.code,
                name: c.name.to_string(),
                rank: c.rank,
            });
        }
    }
}

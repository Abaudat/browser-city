//! Operator-facing state: today, just who is allowed to call an
//! operator-only reducer. `reseed_codes` is the module's first one, and
//! the next will be a balance reload or a world fixup where "whoever felt
//! like it" is not survivable -- so the check is built once, here, rather
//! than copied ad hoc per reducer.

use spacetimedb::{Identity, ReducerContext, Table};

/// A one-row config table: `id` is always `0`, permanently (NFR33 -- a
/// primary key can never move, and a singleton row needs one all the
/// same). `owner` is the identity that ran `init`, i.e. whoever published
/// the module -- SpacetimeDB has no other notion of "the operator".
#[derive(Clone)]
#[spacetimedb::table(accessor = module_owner)]
pub struct ModuleOwner {
    #[primary_key]
    // `pub`, not private: `tables::restore::restore_module_owner`
    // constructs this row from a different module (story 1.4).
    pub id: u8,
    pub owner: Identity,
}

/// Records `ctx.sender()` as the module owner. Called once, from `init`
/// only -- `init` runs on the module's first publish and never again, so
/// the owner is whoever published it that first time. Never overwritten:
/// republishing (even by a different identity, e.g. a CI service account)
/// must not silently hand ownership to someone else.
pub fn record_owner_from_init(ctx: &ReducerContext) {
    if ctx.db.module_owner().id().find(0).is_none() {
        ctx.db.module_owner().insert(ModuleOwner {
            id: 0,
            owner: ctx.sender(),
        });
    }
}

/// Rejects any caller that is not the recorded module owner. An
/// operator-only reducer (`reseed_codes` today) calls this first, the same
/// way a scheduled reducer calls `require_scheduler` -- a caller check
/// enforced by the type system's absence is a caller check nobody wrote.
pub fn require_owner(ctx: &ReducerContext) -> Result<(), String> {
    match ctx.db.module_owner().id().find(0) {
        Some(row) if row.owner == ctx.sender() => Ok(()),
        Some(_) => Err("this reducer may only be invoked by the module owner".to_string()),
        None => Err("module owner is not set -- init did not run".to_string()),
    }
}

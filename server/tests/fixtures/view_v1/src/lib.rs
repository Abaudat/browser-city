//! The "before" build `scripts/ci/check-view-live-refresh.sh` publishes
//! first: a public anonymous view over a compiled-in constant, exactly
//! the shape `server/src/version.rs`'s real `module_version` view is
//! (story 2.8, FR147). `view_v2` differs only in `FIXTURE_VALUE` -- same
//! schema, same accessor, so republishing it over the same live database
//! is a same-schema hot swap, never a migration.

use spacetimedb::{AnonymousViewContext, SpacetimeType, view};

pub const FIXTURE_VALUE: &str = "v1";

#[derive(SpacetimeType, Clone, Debug)]
pub struct FixtureVersion {
    pub value: String,
}

#[view(accessor = fixture_version, public)]
pub fn fixture_version(_ctx: &AnonymousViewContext) -> Vec<FixtureVersion> {
    vec![FixtureVersion {
        value: FIXTURE_VALUE.to_string(),
    }]
}

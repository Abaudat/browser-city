//! The "after" build `scripts/ci/check-view-live-refresh.sh` republishes
//! over the same live database `view_v1` first published -- identical
//! schema, only `FIXTURE_VALUE` differs, proving `module_version`-shaped
//! views (story 2.8) re-evaluate on a hot-swap republish rather than
//! serving a value cached from the previous build.

use spacetimedb::{AnonymousViewContext, SpacetimeType, view};

pub const FIXTURE_VALUE: &str = "v2";

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

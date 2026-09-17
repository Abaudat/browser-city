//! FR147's handshake (story 2.8): a public anonymous view over two
//! generated constants -- `sim::generated::defs::DEFS_VERSION` and
//! `generated::protocol_version::PROTOCOL_VERSION` -- never a table
//! (Tim's direction). A view over constants cannot go stale: there is no
//! row to stamp after publish, no deploy step that can be missed, nothing
//! to back up or restore, nothing to migrate (NFR33 untouched), and no
//! write on `client_connected`. It gets no `bounds::TABLE_BOUNDS` entry
//! and no `restore_module_version` reducer -- `bounds::schema::
//! parse_module_schema` only recognises the qualified `table` attribute
//! form (never `view`), so this view is structurally invisible to both
//! `registry_matches_tables.rs` and `restore_coverage.rs`, nothing here
//! needs to teach them otherwise.
//!
//! Whether this view actually re-evaluates on a live hot-swap republish
//! (rather than serving a value cached from the previous build) is proven
//! against a real disposable SpacetimeDB instance, not assumed:
//! `scripts/ci/check-view-live-refresh.sh`.

use spacetimedb::{AnonymousViewContext, SpacetimeType, view};

use crate::generated::protocol_version::PROTOCOL_VERSION;

/// The FR147 handshake's own row shape -- exactly the two fields
/// `docs/architecture.md` says `defs_version` and `protocol_version`
/// cover, nothing folded together (Tim's direction: `defs_version` stays
/// exactly what `check-defs-version-bump.sh` depends on it being).
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct ModuleVersion {
    pub defs_version: String,
    pub protocol_version: String,
}

/// Always exactly one row, built fresh from the two compiled-in constants
/// on every read -- never written, never stored.
#[view(accessor = module_version, public)]
pub fn module_version(_ctx: &AnonymousViewContext) -> Vec<ModuleVersion> {
    vec![ModuleVersion {
        defs_version: sim::generated::defs::DEFS_VERSION.to_string(),
        protocol_version: PROTOCOL_VERSION.to_string(),
    }]
}

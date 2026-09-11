//! Static description and hot state never share a table (NFR35's narrowness,
//! read as a keying decision): `citizen` never rewrites at a transition,
//! `citizen_state` always does. Splitting them later would be a migration;
//! joining them later is free -- so the split happens from the first
//! commit, before either table carries real fields.

use spacetimedb::Timestamp;

/// A citizen's static description (FR48: home, job, appearance seed,
/// ends). Those fields arrive additively as the stories that need them
/// land (NFR33) -- only the surrogate key is a permanent decision here.
#[derive(Clone)]
#[spacetimedb::table(accessor = citizen)]
pub struct Citizen {
    #[primary_key]
    #[auto_inc]
    pub citizen_id: u64,
    pub created_at: Timestamp,
}

/// A citizen's hot state, rewritten at every L2 transition (FR49). Shares
/// `citizen`'s own id rather than minting its own -- the two rows are
/// always created and destroyed together, never independently.
#[spacetimedb::table(accessor = citizen_state)]
pub struct CitizenState {
    #[primary_key]
    pub citizen_id: u64,
    pub updated_at: Timestamp,
}

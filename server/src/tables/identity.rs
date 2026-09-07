//! The character<->identity mapping (FR142, D5): required to exist before
//! any character row can be created, so it is declared here, on day one,
//! rather than the story that first populates it.

use spacetimedb::{Identity, Timestamp};

/// A player's persistent entity. Deliberately thin: name, appearance and
/// everything else arrive additively as later stories need them (NFR33) --
/// the only permanent decision settled here is the surrogate key.
#[spacetimedb::table(accessor = character)]
pub struct Character {
    #[primary_key]
    #[auto_inc]
    pub character_id: u64,
    pub created_at: Timestamp,
}

/// One-character-to-N-identities (FR142): `identity` is `#[unique]` (an
/// identity reaches at most one character); `character_id` is a plain
/// btree index, not unique (a character may be reached by any number of
/// identities -- an anonymous identity that later links an OIDC one, for
/// instance). Putting `Identity` on `Character` as its own key, or making
/// `character_id` unique here, would forbid that permanently.
#[spacetimedb::table(accessor = character_identity)]
pub struct CharacterIdentity {
    #[primary_key]
    #[auto_inc]
    pub mapping_id: u64,
    #[unique]
    pub identity: Identity,
    #[index(btree)]
    pub character_id: u64,
}

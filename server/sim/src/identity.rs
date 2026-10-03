//! Story 4.5 (FR141-FR143): the pure decisions behind identity. Which
//! character a caller reaches, creating one, linking a second identity to
//! it, and whether a token's issuer and audience are ones the game accepts.
//! The reducers in `../src/tables/identity.rs` read, call these, and write.
//! Nothing here merges characters or removes a mapping.

/// `character_identity.issuer_id` for a server-issued anonymous identity.
pub const ANONYMOUS_ISSUER: u64 = 0;

/// What `create_character` does for a caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CreatePlan {
    /// The caller already reaches this character: nothing is written.
    Existing(u64),
    /// Insert a character and map the caller to it.
    New,
}

pub fn plan_create(caller_character: Option<u64>) -> CreatePlan {
    match caller_character {
        Some(id) => CreatePlan::Existing(id),
        None => CreatePlan::New,
    }
}

/// What `complete_link` writes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkPlan {
    /// Both already reach the same character: nothing is written.
    AlreadyLinked,
    /// Map the redeeming identity onto the requester's character.
    MapRedeemer(u64),
    /// Map the requesting identity onto the redeemer's character.
    MapRequester(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkError {
    /// Both identities reach a character and they differ; characters are
    /// never merged.
    DifferentCharacters,
    /// Neither identity reaches a character.
    NoCharacter,
}

impl LinkError {
    pub fn message(self) -> &'static str {
        match self {
            LinkError::DifferentCharacters => "both identities already have a different character",
            LinkError::NoCharacter => "neither identity has a character to link",
        }
    }
}

/// Of the requester and the redeemer, the one without a character is
/// mapped onto the other's.
pub fn plan_link(requester: Option<u64>, redeemer: Option<u64>) -> Result<LinkPlan, LinkError> {
    match (requester, redeemer) {
        (Some(a), Some(b)) if a == b => Ok(LinkPlan::AlreadyLinked),
        (Some(_), Some(_)) => Err(LinkError::DifferentCharacters),
        (Some(c), None) => Ok(LinkPlan::MapRedeemer(c)),
        (None, Some(c)) => Ok(LinkPlan::MapRequester(c)),
        (None, None) => Err(LinkError::NoCharacter),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimError {
    /// No such claim: never issued, or already spent.
    Unknown,
    Expired,
    /// Too many unexpired claims are pending to take another.
    Full,
}

impl ClaimError {
    pub fn message(self) -> &'static str {
        match self {
            ClaimError::Unknown => "unknown or already used link code",
            ClaimError::Expired => "link code expired",
            ClaimError::Full => "too many link codes are pending, try again shortly",
        }
    }
}

/// `link_request`'s row ceiling (`table_bounds`). Anyone may mint a claim,
/// so `begin_link` refuses at it once stale rows are pruned.
pub const LINK_REQUEST_MAX_ROWS: u64 = 10_000;

/// Whether a stored claim has lapsed and may be pruned (the same boundary
/// `check_claim` refuses at).
pub fn is_claim_stale(expires_at: i64, now: i64) -> bool {
    expires_at <= now
}

/// `pending` is the row count after pruning and after the caller's own
/// previous request was dropped.
pub fn check_capacity(pending: u64) -> Result<(), ClaimError> {
    if pending >= LINK_REQUEST_MAX_ROWS {
        Err(ClaimError::Full)
    } else {
        Ok(())
    }
}

/// `expires_at` is the stored claim's expiry (`None`: no such claim), both
/// in microseconds since the Unix epoch.
pub fn check_claim(expires_at: Option<i64>, now: i64) -> Result<(), ClaimError> {
    match expires_at {
        None => Err(ClaimError::Unknown),
        Some(e) if is_claim_stale(e, now) => Err(ClaimError::Expired),
        Some(_) => Ok(()),
    }
}

/// One `oidc_issuer` row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IssuerRow {
    pub issuer_id: u64,
    pub issuer: String,
    pub client_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Credential {
    pub issuer_id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialError {
    /// The issuer is registered but the token was minted for another
    /// application.
    WrongAudience,
}

/// A token whose issuer is registered must carry that row's `client_id` in
/// `aud`; any other issuer is an anonymous credential (its identity reaches
/// a character only through a mapping, which only a completed link writes).
pub fn credential(
    issuer: &str,
    audience: &[&str],
    accepted: &[IssuerRow],
) -> Result<Credential, CredentialError> {
    match accepted.iter().find(|r| r.issuer == issuer) {
        None => Ok(Credential {
            issuer_id: ANONYMOUS_ISSUER,
        }),
        Some(r) if audience.contains(&r.client_id.as_str()) => Ok(Credential {
            issuer_id: r.issuer_id,
        }),
        Some(_) => Err(CredentialError::WrongAudience),
    }
}

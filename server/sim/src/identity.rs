//! Story 4.5 (FR141-FR143): the pure decisions behind identity. Which
//! character a caller reaches, creating one, linking a second identity to
//! it, and whether a token's issuer and audience are ones the game accepts.
//! The reducers in `../src/tables/identity.rs` read, call these, and write.
//! Nothing here merges characters or removes a mapping.

use crate::generated::defs::NAME_MAX_CHARS;
use crate::housing::{Assignment, Home, plan_assign_ranked};

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

/// A flat let to a character.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Tenancy {
    /// The dwelling's building id.
    pub home: u64,
    /// The asked rent, frozen at signing.
    pub weekly_rent: u64,
}

/// What a new character is written with, together: its tenancy (none only
/// when no dwelling is vacant) and the cell of its first position row.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Arrival {
    pub tenancy: Option<Tenancy>,
    pub spawn: (i32, i32),
}

/// A new character's flat and first cell, planned as one: the spawn is the
/// let dwelling's own. `open` is the vacant homes in rank order
/// ([`Home::rank`]); `street` is where a character stands when none is
/// open -- a full stock is a character on the street, never an error.
pub fn plan_arrival(
    character_id: u64,
    open: impl IntoIterator<Item = Home>,
    street: (i32, i32),
) -> Arrival {
    let homes: Vec<Home> = open.into_iter().collect();
    let chosen = match plan_assign_ranked(character_id, homes.iter().copied()) {
        Assignment::Edge(id) | Assignment::Fallback(id) => homes.iter().find(|h| h.id == id),
        Assignment::NoVacancy => None,
    };
    match chosen {
        Some(h) => Arrival {
            tenancy: Some(Tenancy {
                home: h.id,
                weekly_rent: h.rent,
            }),
            spawn: h.spawn,
        },
        None => Arrival {
            tenancy: None,
            spawn: street,
        },
    }
}

/// Why a character name is refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NameError {
    /// Nothing is left once trimmed.
    Empty,
    /// More than `NAME_MAX_CHARS` scalar values.
    TooLong,
    /// A control character or an invisible format character (zero-width,
    /// bidirectional override, BOM).
    ForbiddenCharacter,
}

impl NameError {
    pub fn message(self) -> &'static str {
        match self {
            NameError::Empty => "a name cannot be empty",
            NameError::TooLong => "that name is too long",
            NameError::ForbiddenCharacter => "that name has a character a name cannot have",
        }
    }
}

fn is_invisible_format(c: char) -> bool {
    matches!(c,
        '\u{00AD}' | '\u{061C}' | '\u{180E}'
        | '\u{200B}'..='\u{200F}'
        | '\u{202A}'..='\u{202E}'
        | '\u{2060}'..='\u{2064}'
        | '\u{2066}'..='\u{206F}'
        | '\u{FEFF}')
}

/// The name rule: trimmed, 1..=`NAME_MAX_CHARS` scalar values, no control or
/// invisible format characters. Returns the name to store. Idempotent.
/// The client's name prompt mirrors it from the same case table
/// (`fixtures/character-names.v1.tsv`).
pub fn plan_name(raw: &str) -> Result<String, NameError> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(NameError::Empty);
    }
    if name
        .chars()
        .any(|c| c.is_control() || is_invisible_format(c))
    {
        return Err(NameError::ForbiddenCharacter);
    }
    if name.chars().count() > NAME_MAX_CHARS as usize {
        return Err(NameError::TooLong);
    }
    Ok(name.to_string())
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

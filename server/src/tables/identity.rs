//! The character<->identity mapping (FR142, D5) and everything that reads
//! or writes it (story 4.5, FR141-FR143). Only this file, `restore.rs` and
//! `metrics.rs` name the `character_identity` accessor
//! (`scripts/ci/check-character-identity-path.sh`); every other table keys
//! on `character_id`, never on an identity.

use sim::identity::{
    ANONYMOUS_ISSUER, ClaimError, CreatePlan, IssuerRow, LinkPlan, check_capacity, check_claim,
    credential, is_claim_stale, plan_create, plan_link,
};
use sim::reducer_classes::ReducerClass;
use spacetimedb::{Identity, ReducerContext, SpacetimeType, Table, Timestamp, ViewContext, view};

use super::metrics::count_call;
use super::ops::{module_owner, require_owner};

/// A player's persistent entity. Deliberately thin: name, appearance and
/// everything else arrive additively as later stories need them (NFR33) --
/// the only permanent decision settled here is the surrogate key.
#[derive(Clone)]
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
#[derive(Clone)]
#[spacetimedb::table(accessor = character_identity)]
pub struct CharacterIdentity {
    #[primary_key]
    #[auto_inc]
    pub mapping_id: u64,
    #[unique]
    pub identity: Identity,
    #[index(btree)]
    pub character_id: u64,
    /// 0 is a server-issued anonymous identity, otherwise an `oidc_issuer`
    /// row. An identity is a hash, so the issuer can never be recovered
    /// later and is recorded from the first row.
    #[default(0)]
    pub issuer_id: u64,
}

/// An accepted OIDC provider. Zero rows means linking is off. Written only
/// by `accept_oidc_issuer`.
#[derive(Clone)]
#[spacetimedb::table(accessor = oidc_issuer)]
pub struct OidcIssuer {
    #[primary_key]
    #[auto_inc]
    pub issuer_id: u64,
    pub issuer: String,
    pub client_id: String,
}

/// A one-time claim: `identity` offers to share its character with whoever
/// redeems `code`. `issuer_id` is the requester's own issuer (0 anonymous).
#[derive(Clone)]
#[spacetimedb::table(accessor = link_request)]
pub struct LinkRequest {
    #[primary_key]
    #[auto_inc]
    pub request_id: u64,
    #[index(btree)]
    pub identity: Identity,
    pub issuer_id: u64,
    #[index(btree)]
    pub code: String,
    /// Microseconds since the Unix epoch.
    #[index(btree)]
    pub expires_at: i64,
}

/// How long a link code lives, in real microseconds (ten minutes).
const LINK_CODE_LIFETIME_MICROS: i64 = 600_000_000;
/// A client-generated 256-bit code, hex-encoded.
const LINK_CODE_LEN: usize = 64;

/// What a client learns about its own character: the row for the caller
/// only (`character_identity` itself stays private).
#[derive(SpacetimeType, Clone, Debug, PartialEq, Eq)]
pub struct MyCharacter {
    pub character_id: u64,
    pub created_at: Timestamp,
    /// Some identity of this character came through an OIDC issuer.
    pub linked: bool,
}

#[view(accessor = my_character, public)]
pub fn my_character(ctx: &ViewContext) -> Vec<MyCharacter> {
    let Some(me) = ctx.db.character_identity().identity().find(ctx.sender()) else {
        return Vec::new();
    };
    let Some(ch) = ctx.db.character().character_id().find(me.character_id) else {
        return Vec::new();
    };
    let linked = ctx
        .db
        .character_identity()
        .character_id()
        .filter(me.character_id)
        .any(|m| m.issuer_id != ANONYMOUS_ISSUER);
    vec![MyCharacter {
        character_id: ch.character_id,
        created_at: ch.created_at,
        linked,
    }]
}

fn issuer_rows(ctx: &ReducerContext) -> Vec<IssuerRow> {
    ctx.db
        .oidc_issuer()
        .iter()
        .map(|r| IssuerRow {
            issuer_id: r.issuer_id,
            issuer: r.issuer,
            client_id: r.client_id,
        })
        .collect()
}

/// The caller's credential: its token's issuer is registered and carries
/// our `client_id`, or it is not a registered issuer's at all. A caller
/// with no token claims is anonymous.
pub fn caller_issuer(ctx: &ReducerContext) -> Result<u64, String> {
    let Some(jwt) = ctx.sender_auth().jwt() else {
        return Ok(ANONYMOUS_ISSUER);
    };
    let aud: Vec<&str> = jwt.audience().iter().map(String::as_str).collect();
    credential(jwt.issuer(), &aud, &issuer_rows(ctx))
        .map(|c| c.issuer_id)
        .map_err(|_| "token was issued for another application".to_string())
}

/// The only path from an identity to its character.
fn character_of(ctx: &ReducerContext, identity: Identity) -> Option<u64> {
    ctx.db
        .character_identity()
        .identity()
        .find(identity)
        .map(|m| m.character_id)
}

/// `identity_connected`'s check: writes nothing. The module owner is
/// exempt so a deploy can never lock itself out.
pub fn check_connecting(ctx: &ReducerContext) -> Result<(), String> {
    if let Some(owner) = ctx.db.module_owner().id().find(0)
        && owner.owner == ctx.sender()
    {
        return Ok(());
    }
    caller_issuer(ctx).map(|_| ())
}

/// An explicit player act (never a side effect of connecting): inserts the
/// character and its mapping in one transaction; a no-op when the caller
/// already reaches one.
#[spacetimedb::reducer]
pub fn create_character(ctx: &ReducerContext) -> Result<(), String> {
    count_call(ctx, ReducerClass::Player);
    let issuer_id = caller_issuer(ctx)?;
    match plan_create(character_of(ctx, ctx.sender())) {
        CreatePlan::Existing(_) => Ok(()),
        CreatePlan::New => {
            let ch = ctx.db.character().insert(Character {
                character_id: 0,
                created_at: ctx.timestamp,
            });
            ctx.db.character_identity().insert(CharacterIdentity {
                mapping_id: 0,
                identity: ctx.sender(),
                character_id: ch.character_id,
                issuer_id,
            });
            Ok(())
        }
    }
}

/// Stores a client-generated code for ten real minutes, replacing the
/// caller's previous request and pruning every expired one.
#[spacetimedb::reducer]
pub fn begin_link(ctx: &ReducerContext, code: String) -> Result<(), String> {
    count_call(ctx, ReducerClass::Player);
    if code.len() != LINK_CODE_LEN || !code.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("link code must be 64 hex characters".to_string());
    }
    if ctx.db.oidc_issuer().iter().next().is_none() {
        return Err("linking is not available".to_string());
    }
    let issuer_id = caller_issuer(ctx)?;
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    let expired: Vec<u64> = ctx
        .db
        .link_request()
        .expires_at()
        .filter(..=now)
        .filter(|r| is_claim_stale(r.expires_at, now))
        .map(|r| r.request_id)
        .collect();
    for id in expired {
        ctx.db.link_request().request_id().delete(id);
    }
    let mine: Vec<u64> = ctx
        .db
        .link_request()
        .identity()
        .filter(ctx.sender())
        .map(|r| r.request_id)
        .collect();
    for id in mine {
        ctx.db.link_request().request_id().delete(id);
    }
    check_capacity(ctx.db.link_request().count()).map_err(|e| e.message().to_string())?;
    ctx.db.link_request().insert(LinkRequest {
        request_id: 0,
        identity: ctx.sender(),
        issuer_id,
        code,
        expires_at: now.saturating_add(LINK_CODE_LIFETIME_MICROS),
    });
    Ok(())
}

/// Redeems a code as the OIDC identity: of the requester and the caller,
/// the one without a character is mapped onto the other's. Characters are
/// never merged; a refusal changes nothing (and so leaves the code).
#[spacetimedb::reducer]
pub fn complete_link(ctx: &ReducerContext, code: String) -> Result<(), String> {
    count_call(ctx, ReducerClass::Player);
    let issuer_id = caller_issuer(ctx)?;
    if issuer_id == ANONYMOUS_ISSUER {
        return Err("linking needs a token from the configured provider".to_string());
    }
    let req = ctx.db.link_request().code().filter(&code).next();
    let now = ctx.timestamp.to_micros_since_unix_epoch();
    check_claim(req.as_ref().map(|r| r.expires_at), now).map_err(|e: ClaimError| e.message())?;
    let Some(req) = req else {
        return Err(ClaimError::Unknown.message().to_string());
    };
    if req.identity == ctx.sender() {
        return Err("an identity cannot link to itself".to_string());
    }
    let plan = plan_link(
        character_of(ctx, req.identity),
        character_of(ctx, ctx.sender()),
    )
    .map_err(|e| e.message().to_string())?;
    match plan {
        LinkPlan::AlreadyLinked => {}
        LinkPlan::MapRedeemer(c) => {
            ctx.db.character_identity().insert(CharacterIdentity {
                mapping_id: 0,
                identity: ctx.sender(),
                character_id: c,
                issuer_id,
            });
        }
        LinkPlan::MapRequester(c) => {
            ctx.db.character_identity().insert(CharacterIdentity {
                mapping_id: 0,
                identity: req.identity,
                character_id: c,
                issuer_id: req.issuer_id,
            });
        }
    }
    ctx.db.link_request().request_id().delete(req.request_id);
    Ok(())
}

/// Owner-only and idempotent: registers an OIDC provider, or updates its
/// `client_id`. A second provider is a row, not a migration.
#[spacetimedb::reducer]
pub fn accept_oidc_issuer(
    ctx: &ReducerContext,
    issuer: String,
    client_id: String,
) -> Result<(), String> {
    count_call(ctx, ReducerClass::Operator);
    require_owner(ctx)?;
    if issuer.is_empty() || client_id.is_empty() {
        return Err("issuer and client id must be non-empty".to_string());
    }
    match ctx.db.oidc_issuer().iter().find(|r| r.issuer == issuer) {
        Some(row) if row.client_id == client_id => {}
        Some(row) => {
            ctx.db
                .oidc_issuer()
                .issuer_id()
                .update(OidcIssuer { client_id, ..row });
        }
        None => {
            ctx.db.oidc_issuer().insert(OidcIssuer {
                issuer_id: 0,
                issuer,
                client_id,
            });
        }
    }
    Ok(())
}

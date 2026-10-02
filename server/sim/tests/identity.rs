//! Story 4.5 (FR141-FR143): which character an identity reaches, creating
//! one, and linking a second identity to it. The decisions are pure plans;
//! `support::identity_model` applies them the way the reducers do.

use sim::identity::{
    ANONYMOUS_ISSUER, ClaimError, CreatePlan, Credential, CredentialError, IssuerRow, LinkError,
    LinkPlan, check_claim, credential, plan_create, plan_link,
};

#[test]
fn create_is_a_noop_for_an_identity_that_has_a_character() {
    assert_eq!(plan_create(Some(7)), CreatePlan::Existing(7));
    assert_eq!(plan_create(None), CreatePlan::New);
}

#[test]
fn link_maps_whichever_side_has_no_character() {
    assert_eq!(plan_link(Some(1), None), Ok(LinkPlan::MapRedeemer(1)));
    assert_eq!(plan_link(None, Some(2)), Ok(LinkPlan::MapRequester(2)));
    assert_eq!(plan_link(Some(3), Some(3)), Ok(LinkPlan::AlreadyLinked));
}

#[test]
fn link_refuses_two_characters_and_none_without_merging() {
    assert_eq!(
        plan_link(Some(1), Some(2)),
        Err(LinkError::DifferentCharacters)
    );
    assert_eq!(plan_link(None, None), Err(LinkError::NoCharacter));
}

#[test]
fn claims_expire_and_spent_claims_are_unknown() {
    assert_eq!(check_claim(None, 5), Err(ClaimError::Unknown));
    assert_eq!(check_claim(Some(5), 5), Err(ClaimError::Expired));
    assert_eq!(check_claim(Some(5), 6), Err(ClaimError::Expired));
    assert_eq!(check_claim(Some(6), 5), Ok(()));
}

fn rows() -> Vec<IssuerRow> {
    vec![IssuerRow {
        issuer_id: 4,
        issuer: "https://idp".into(),
        client_id: "bc".into(),
    }]
}

#[test]
fn credential_requires_the_registered_client_id_in_the_audience() {
    assert_eq!(
        credential("https://idp", &["bc"], &rows()),
        Ok(Credential { issuer_id: 4 })
    );
    assert_eq!(
        credential("https://idp", &["other", "bc"], &rows()),
        Ok(Credential { issuer_id: 4 })
    );
    assert_eq!(
        credential("https://idp", &["other"], &rows()),
        Err(CredentialError::WrongAudience)
    );
    assert_eq!(
        credential("https://idp", &[], &rows()),
        Err(CredentialError::WrongAudience)
    );
}

#[test]
fn an_unregistered_issuer_is_anonymous() {
    assert_eq!(
        credential("https://elsewhere", &["bc"], &rows()),
        Ok(Credential {
            issuer_id: ANONYMOUS_ISSUER
        })
    );
    assert_eq!(
        credential("x", &[], &[]),
        Ok(Credential {
            issuer_id: ANONYMOUS_ISSUER
        })
    );
}

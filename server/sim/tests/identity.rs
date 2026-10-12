//! Story 4.5 (FR141-FR143): which character an identity reaches, creating
//! one, and linking a second identity to it. The decisions are pure plans;
//! `support::identity_model` applies them the way the reducers do.

use proptest::prelude::*;
use sim::generated::defs::NAME_MAX_CHARS;
use sim::identity::{
    ANONYMOUS_ISSUER, ClaimError, CreatePlan, Credential, CredentialError, IssuerRow,
    LINK_REQUEST_MAX_ROWS, LinkError, LinkPlan, check_capacity, check_claim, credential,
    is_claim_stale, plan_create, plan_link,
};
use sim::identity::{NameError, plan_name};

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

#[test]
fn a_claim_is_stale_exactly_when_check_claim_refuses_it() {
    for (exp, now) in [(5, 4), (5, 5), (5, 6), (i64::MIN, 0), (i64::MAX, 0)] {
        assert_eq!(
            is_claim_stale(exp, now),
            check_claim(Some(exp), now).is_err()
        );
    }
}

#[test]
fn begin_link_is_refused_at_the_ceiling_and_not_below_it() {
    assert_eq!(check_capacity(0), Ok(()));
    assert_eq!(check_capacity(LINK_REQUEST_MAX_ROWS - 1), Ok(()));
    assert_eq!(check_capacity(LINK_REQUEST_MAX_ROWS), Err(ClaimError::Full));
    assert_eq!(check_capacity(u64::MAX), Err(ClaimError::Full));
}

/// Decodes `\uXXXX` and `\u{X..}` escapes of the shared case table.
fn unescape(text: &str) -> String {
    const BACKSLASH: char = '\u{5C}';
    let mut out = String::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        if c != BACKSLASH {
            out.push(c);
            continue;
        }
        assert_eq!(chars.next(), Some('u'), "only u escapes are used");
        let hex: String = if chars.peek() == Some(&'{') {
            chars.next();
            chars.by_ref().take_while(|&h| h != '}').collect()
        } else {
            chars.by_ref().take(4).collect()
        };
        let scalar = u32::from_str_radix(&hex, 16).expect("hex escape");
        out.push(char::from_u32(scalar).expect("scalar value"));
    }
    out
}

#[test]
fn the_shared_name_case_table_holds() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/character-names.v1.tsv"
    );
    let table = std::fs::read_to_string(path).expect("shared name table");
    let mut cases = 0;
    for line in table
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        let (input, expected) = line.split_once('\t').expect("input<TAB>expected");
        let got = plan_name(&unescape(input));
        if expected == "-" {
            assert!(got.is_err(), "{input:?} must be rejected, got {got:?}");
        } else {
            assert_eq!(got, Ok(unescape(expected)), "{input:?}");
        }
        cases += 1;
    }
    assert!(cases >= 15);
}

#[test]
fn name_refusals_are_typed() {
    assert_eq!(plan_name("  "), Err(NameError::Empty));
    let long = "a".repeat(NAME_MAX_CHARS as usize + 1);
    assert_eq!(plan_name(&long), Err(NameError::TooLong));
    assert_eq!(plan_name("a\u{0}b"), Err(NameError::ForbiddenCharacter));
}

proptest! {
    #[test]
    fn inv_character_name_rule_never_panics(s in ".*") {
        let _ = plan_name(&s);
    }

    #[test]
    fn inv_accepted_name_is_normalised(s in ".*") {
        if let Ok(name) = plan_name(&s) {
            prop_assert_eq!(plan_name(&name), Ok(name.clone()));
            prop_assert!(name.chars().count() <= NAME_MAX_CHARS as usize);
            prop_assert!(!name.is_empty());
            prop_assert_eq!(name.trim(), name.as_str());
        }
    }
}

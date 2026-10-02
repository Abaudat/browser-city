//! Story 4.5 (FR141-FR143): which character an identity reaches, creating
//! one, and linking a second identity to it. The decisions are pure plans;
//! the model below applies them the way the reducers do.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use sim::identity::{
    ANONYMOUS_ISSUER, ClaimError, Credential, CreatePlan, CredentialError, IssuerRow, LinkError,
    LinkPlan, check_claim, credential, plan_create, plan_link,
};

#[derive(Debug, Clone)]
enum Op {
    Create(u8),
    /// requester, redeemer
    Link(u8, u8),
}

#[derive(Default, Clone)]
struct Model {
    next: u64,
    /// character_id -> created_at (never changes)
    characters: BTreeMap<u64, u64>,
    /// identity -> character (one row per identity: the `#[unique]`)
    mapping: BTreeMap<u8, u64>,
}

impl Model {
    fn apply(&mut self, op: &Op) -> Result<(), String> {
        match *op {
            Op::Create(id) => match plan_create(self.mapping.get(&id).copied()) {
                CreatePlan::Existing(_) => Ok(()),
                CreatePlan::New => {
                    self.next += 1;
                    self.characters.insert(self.next, self.next * 10);
                    self.mapping.insert(id, self.next);
                    Ok(())
                }
            },
            Op::Link(a, b) => {
                let plan = plan_link(self.mapping.get(&a).copied(), self.mapping.get(&b).copied())
                    .map_err(|e| format!("{e:?}"))?;
                match plan {
                    LinkPlan::AlreadyLinked => {}
                    LinkPlan::MapRedeemer(c) => {
                        self.mapping.insert(b, c);
                    }
                    LinkPlan::MapRequester(c) => {
                        self.mapping.insert(a, c);
                    }
                }
                Ok(())
            }
        }
    }

    fn identity_sets(&self) -> BTreeMap<u64, BTreeSet<u8>> {
        let mut m: BTreeMap<u64, BTreeSet<u8>> = BTreeMap::new();
        for (&i, &c) in &self.mapping {
            m.entry(c).or_default().insert(i);
        }
        m
    }
}

fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0u8..6).prop_map(Op::Create),
        (0u8..6, 0u8..6).prop_map(|(a, b)| Op::Link(a, b)),
    ]
}

proptest! {
    #[test]
    fn inv_identity_reaches_at_most_one_character(ops in prop::collection::vec(op(), 0..60)) {
        let mut m = Model::default();
        for o in &ops {
            let _ = m.apply(o);
            // The mapping is keyed by identity, so "at most one" means the
            // plans never name a second character for a mapped identity:
            for (&i, &c) in &m.mapping {
                prop_assert!(m.characters.contains_key(&c), "identity {i} maps to a missing character");
            }
        }
        // And a mapped identity is never remapped by a later plan.
        for (a, b) in (0u8..6).flat_map(|a| (0u8..6).map(move |b| (a, b))) {
            if let (Some(x), Some(y)) = (m.mapping.get(&a), m.mapping.get(&b)) {
                let p = plan_link(Some(*x), Some(*y));
                prop_assert!(p == Ok(LinkPlan::AlreadyLinked) || p == Err(LinkError::DifferentCharacters));
            }
        }
    }

    #[test]
    fn inv_linking_never_changes_or_orphans_a_character(ops in prop::collection::vec(op(), 0..60)) {
        let mut m = Model::default();
        for o in &ops {
            let before_chars = m.characters.clone();
            let before_sets = m.identity_sets();
            let _ = m.apply(o);
            if matches!(o, Op::Link(..)) {
                prop_assert_eq!(&m.characters, &before_chars);
            }
            let after_sets = m.identity_sets();
            for (c, set) in &before_sets {
                let now = after_sets.get(c);
                prop_assert!(now.is_some_and(|n| n.is_superset(set) && !n.is_empty()));
            }
        }
    }

    #[test]
    fn inv_identity_planning_never_panics(
        a in prop::option::of(any::<u64>()),
        b in prop::option::of(any::<u64>()),
        now in any::<i64>(),
        exp in prop::option::of(any::<i64>()),
        issuer in ".{0,12}",
        aud in prop::collection::vec(".{0,8}", 0..4),
        rows in prop::collection::vec((any::<u64>(), ".{0,12}", ".{0,8}"), 0..4),
    ) {
        let _ = plan_create(a);
        let _ = plan_link(a, b);
        let _ = check_claim(exp, now);
        let accepted: Vec<IssuerRow> = rows
            .iter()
            .map(|(id, i, c)| IssuerRow { issuer_id: *id, issuer: i.clone(), client_id: c.clone() })
            .collect();
        let aud: Vec<&str> = aud.iter().map(String::as_str).collect();
        let _ = credential(&issuer, &aud, &accepted);
    }
}

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
    assert_eq!(plan_link(Some(1), Some(2)), Err(LinkError::DifferentCharacters));
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
    vec![IssuerRow { issuer_id: 4, issuer: "https://idp".into(), client_id: "bc".into() }]
}

#[test]
fn credential_requires_the_registered_client_id_in_the_audience() {
    assert_eq!(credential("https://idp", &["bc"], &rows()), Ok(Credential { issuer_id: 4 }));
    assert_eq!(
        credential("https://idp", &["other", "bc"], &rows()),
        Ok(Credential { issuer_id: 4 })
    );
    assert_eq!(
        credential("https://idp", &["other"], &rows()),
        Err(CredentialError::WrongAudience)
    );
    assert_eq!(credential("https://idp", &[], &rows()), Err(CredentialError::WrongAudience));
}

#[test]
fn an_unregistered_issuer_is_anonymous() {
    assert_eq!(
        credential("https://elsewhere", &["bc"], &rows()),
        Ok(Credential { issuer_id: ANONYMOUS_ISSUER })
    );
    assert_eq!(credential("x", &[], &[]), Ok(Credential { issuer_id: ANONYMOUS_ISSUER }));
}

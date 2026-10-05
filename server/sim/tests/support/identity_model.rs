//! Story 4.5: a model of the identity tables the reducers drive through
//! `sim::identity`'s plans, shared by the invariants.

use std::collections::{BTreeMap, BTreeSet};

use proptest::prelude::*;
use sim::identity::{CreatePlan, LinkPlan, plan_create, plan_link};

#[derive(Debug, Clone)]
pub enum Op {
    Create(u8),
    /// requester, redeemer
    Link(u8, u8),
}

#[derive(Default, Clone)]
pub struct Model {
    pub next: u64,
    /// character_id -> created_at (never changes)
    pub characters: BTreeMap<u64, u64>,
    /// identity -> character (one row per identity: the `#[unique]`)
    pub mapping: BTreeMap<u8, u64>,
}

impl Model {
    pub fn apply(&mut self, op: &Op) -> Result<(), String> {
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

    pub fn identity_sets(&self) -> BTreeMap<u64, BTreeSet<u8>> {
        let mut m: BTreeMap<u64, BTreeSet<u8>> = BTreeMap::new();
        for (&i, &c) in &self.mapping {
            m.entry(c).or_default().insert(i);
        }
        m
    }
}

pub fn op() -> impl Strategy<Value = Op> {
    prop_oneof![
        (0u8..6).prop_map(Op::Create),
        (0u8..6, 0u8..6).prop_map(|(a, b)| Op::Link(a, b)),
    ]
}

//! FR112's "one source" seam (story 2.11, Tim's direction): [`RuleSet`]'s
//! own field is private *to this module*, so nothing outside it -- not
//! even the rest of `sim::rules` -- can build one from an arbitrary
//! slice. Only two constructors exist: [`RuleSet::committed`] (wraps the
//! real, generated table) and, gated so it never reaches the published
//! module, [`RuleSet::for_test`]. [`super::evaluate`] accepts only a
//! `RuleSet`, never a bare slice, so "the generator and the harness read
//! one rule source" becomes a property the type system holds, not a
//! convention a reviewer has to keep re-checking.
//!
//! `scripts/ci/check-rule-source.sh` covers the one hole the type system
//! itself cannot see: a manifest enabling `test-fixtures` outside this
//! crate's own self-dependency, or `for_test`/`RuleKind::` reappearing in
//! a `src/` tree outside this module -- the shape a second, independently
//! authored interpreter would have to take.

use super::RuleDef;

/// The only carrier [`super::evaluate`] accepts. Its field is private to
/// this module: a `RuleSet { rules }` struct literal, or a tuple-struct
/// `RuleSet(rules)`, is unreachable from anywhere else, including the
/// rest of `sim::rules` -- see the `compile_fail` doctest below.
#[derive(Debug, Clone, Copy)]
pub struct RuleSet<'a> {
    rules: &'a [RuleDef],
}

impl RuleSet<'static> {
    /// The one non-test constructor: wraps the committed, generated rule
    /// table (`sim::generated::defs::RULES`). Epic 3's generator and
    /// story 2.11's harness both reach the same rule set only ever
    /// through this call -- never a parameter, never a second table.
    pub fn committed() -> Self {
        RuleSet {
            rules: crate::generated::defs::RULES,
        }
    }
}

impl<'a> RuleSet<'a> {
    /// A test-only escape hatch: builds a `RuleSet` from an arbitrary
    /// slice, so a unit test can pin one rule's behaviour without the
    /// whole committed table. Gated so it never reaches the published
    /// wasm module -- `check-rule-source.sh` also fails the build if this
    /// name ever appears in a `src/` tree outside this module.
    #[cfg(any(test, feature = "test-fixtures"))]
    pub fn for_test(rules: &'a [RuleDef]) -> Self {
        RuleSet { rules }
    }

    pub(crate) fn rules(&self) -> &'a [RuleDef] {
        self.rules
    }
}

/// AC4 (FR112): there is no public or crate-visible way to build a
/// `RuleSet` from a slice outside the two constructors above -- pinned by
/// a `compile_fail` doctest, since a unit test can only prove a
/// *positive* ("this compiles"), never that an alternative path is
/// closed.
///
/// ```compile_fail,E0451
/// let rules: &[sim::rules::RuleDef] = &[];
/// let _ = sim::rules::RuleSet { rules };
/// ```
#[allow(dead_code)]
struct CompileFailRuleSetFieldIsPrivate;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn committed_wraps_the_real_generated_table() {
        let set = RuleSet::committed();
        assert_eq!(set.rules().len(), crate::generated::defs::RULES.len());
    }

    #[test]
    fn for_test_wraps_exactly_the_given_slice() {
        let rules: &[RuleDef] = &[];
        let set = RuleSet::for_test(rules);
        assert_eq!(set.rules().len(), 0);
    }
}

//! Story 1.10 (FR61/FR62): a citizen's appearance is a stable, five-integer
//! tuple -- `body`, `eyes`, `outfit`, `hairstyle`, `accessory` -- generated
//! once, server-side, from the citizen id, and stored (never re-derived).
//! Determinism uses `sim::rng`, seeded from the citizen id and this
//! module's own stream salt, exactly like every other seeded system.
//!
//! `0` is the "no layer" sentinel for `hairstyle` and `accessory` -- it is
//! never a declared id in `defs/appearance/` (`tools/defs-build` rejects
//! that), only a value this generator can produce.
//!
//! FR62 (Artie's direction, cycle 1): the stored tuple is a citizen's own
//! civilian look, drawn only from the civilian pool. Occupation drives a
//! separate, fixed *uniform override* for the outfit and/or accessory
//! layer ([`resolve_uniform`]) -- looked up by profession key, applied only
//! at render time while on shift, and never written back into the stored
//! tuple. That is a deliberate departure from an earlier draft of this
//! story's direction (Tim's, which had `generate` re-roll the outfit
//! column from a profession's own outfit pool): a uniform must be the same
//! one fixed look for every worker of a role for FR62's "readable from
//! across a street" to hold, and a render-time override needs no write
//! when a shift starts or ends. See the story 1.10 PR description for the
//! full reasoning.
//!
//! Bumped whenever this generator's algorithm, its seeding, or its table
//! order changes in a way that could move its output for an id already in
//! play -- `tests/goldens/appearance_v1.golden` is keyed to this, exactly
//! like `sim::rng::RNG_VERSION`.

use crate::generated::defs::{self, Family, Pool};
use crate::rng::{Rng, seed_from_ids};

pub const APPEARANCE_VERSION: u32 = 1;

/// This module's own salt for [`seed_from_ids`], distinct from any other
/// system that also seeds off a citizen id -- so two systems drawing from
/// the same citizen never accidentally share a stream.
const APPEARANCE_STREAM: u64 = 0x4150_5031_4152_5030; // "APP1ARP0"

/// The five stored layer indices (FR61). `0` on `hairstyle`/`accessory`
/// means "no layer"; `body`/`eyes`/`outfit` are always non-zero -- every
/// citizen has a body, eyes and an outfit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Appearance {
    pub body: u16,
    pub eyes: u16,
    pub outfit: u16,
    pub hairstyle: u16,
    pub accessory: u16,
}

/// FR62: a profession's fixed uniform. `None` on either field means that
/// layer is left at the citizen's own civilian look while on shift.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct UniformOverride {
    pub outfit: Option<u16>,
    pub accessory: Option<u16>,
}

fn balance_value(key: &str) -> i64 {
    defs::BALANCE
        .iter()
        .find(|b| b.key == key)
        .map(|b| b.value)
        .unwrap_or_else(|| panic!("sim::appearance: missing balance key '{key}'"))
}

/// Uniformly picks one of `items` using `rng`, or `None` for an empty
/// slice -- a defs tree with a family that declares no parts of some kind
/// is a defs-authoring mistake, not a panic here.
fn pick_uniform(rng: &mut Rng, items: &[u16]) -> Option<u16> {
    if items.is_empty() {
        return None;
    }
    let idx = (rng.next_u64() % items.len() as u64) as usize;
    Some(items[idx])
}

fn family_ids<T>(
    items: &'static [T],
    family: Family,
    get: impl Fn(&T) -> (Family, u16),
) -> Vec<u16> {
    items
        .iter()
        .filter_map(|item| {
            let (f, id) = get(item);
            (f == family).then_some(id)
        })
        .collect()
}

/// Generates one citizen's appearance tuple, deterministic from `citizen_id`
/// alone (FR61: "the same barista looks the same forever"). Called once, at
/// citizen creation, by the caller (a later story); this module never
/// re-derives an existing citizen's tuple, and never will -- appending a
/// part to a manifest must never change an existing face.
pub fn generate(citizen_id: u64, family: Family) -> Appearance {
    let mut rng = Rng::new(seed_from_ids(citizen_id, APPEARANCE_STREAM));

    let bodies = family_ids(defs::BODIES, family, |b| (b.family, b.id as u16));
    let body = pick_uniform(&mut rng, &bodies).unwrap_or(0);

    let eyes_ids = family_ids(defs::EYES, family, |e| (e.family, e.id as u16));
    let eyes = pick_uniform(&mut rng, &eyes_ids).unwrap_or(0);

    let civilian_outfits: Vec<u16> = defs::OUTFITS
        .iter()
        .filter(|o| o.family == family && o.pool == Pool::Civilian)
        .map(|o| o.id as u16)
        .collect();
    let outfit = pick_uniform(&mut rng, &civilian_outfits).unwrap_or(0);

    let hairstyle = pick_hairstyle(&mut rng, family);
    let accessory = pick_accessory(&mut rng, family);

    Appearance {
        body,
        eyes,
        outfit,
        hairstyle,
        accessory,
    }
}

/// Artie's direction: hair colour is weighted towards natural colours, with
/// bright/rare colours drawn only `citizen.appearance.hair_rare_chance`
/// percent of the time (a balance key, never a literal). Falls back to
/// whichever pool is non-empty if the family has none of the wanted kind
/// (a kid family's own hairstyles, declared with `rare = false` throughout
/// today, have no rare entries).
fn pick_hairstyle(rng: &mut Rng, family: Family) -> u16 {
    let rare_ids: Vec<u16> = defs::HAIRSTYLES
        .iter()
        .filter(|h| h.family == family && h.rare)
        .map(|h| h.id as u16)
        .collect();
    let common_ids: Vec<u16> = defs::HAIRSTYLES
        .iter()
        .filter(|h| h.family == family && !h.rare)
        .map(|h| h.id as u16)
        .collect();

    let rare_chance = balance_value("citizen.appearance.hair_rare_chance") as u64;
    let roll = rng.next_u64() % 100;
    let want_rare = roll < rare_chance;

    let pool = if want_rare && !rare_ids.is_empty() {
        &rare_ids
    } else if !common_ids.is_empty() {
        &common_ids
    } else {
        &rare_ids
    };
    pick_uniform(rng, pool).unwrap_or(0)
}

/// Artie's direction: about 70% of adult civilians wear no accessory
/// (`citizen.appearance.accessory_none_chance`, a balance key). Kids have
/// no accessory tables at all, so a kid's accessory is always `0` -- forced
/// here, not merely the accidental result of an empty candidate list, so
/// the rule reads as a decision rather than a side effect.
fn pick_accessory(rng: &mut Rng, family: Family) -> u16 {
    if family == Family::Kid {
        return 0;
    }
    let none_chance = balance_value("citizen.appearance.accessory_none_chance") as u64;
    let roll = rng.next_u64() % 100;
    if roll < none_chance {
        return 0;
    }
    let candidates: Vec<u16> = defs::ACCESSORIES
        .iter()
        .filter(|a| a.family == family && a.pool == Pool::Civilian)
        .map(|a| a.id as u16)
        .collect();
    pick_uniform(rng, &candidates).unwrap_or(0)
}

/// FR62: the fixed uniform override for `profession_key`, or `None` when
/// that profession declares no `[[uniform]]` (most professions today).
/// `tools/defs-build` already proved every `[[uniform]]`'s `outfit`/
/// `accessory` names a real, adult, `role_only` part, so this never
/// silently drops a reference -- an `.expect` names the defect loudly
/// rather than returning a wrong id.
pub fn resolve_uniform(profession_key: &str) -> Option<UniformOverride> {
    let uniform = defs::UNIFORMS
        .iter()
        .find(|u| u.profession == profession_key)?;
    let outfit = uniform.outfit.map(|key| {
        defs::OUTFITS
            .iter()
            .find(|o| o.key == key)
            .unwrap_or_else(|| panic!("sim::appearance: uniform outfit '{key}' not found"))
            .id as u16
    });
    let accessory = uniform.accessory.map(|key| {
        defs::ACCESSORIES
            .iter()
            .find(|a| a.key == key)
            .unwrap_or_else(|| panic!("sim::appearance: uniform accessory '{key}' not found"))
            .id as u16
    });
    Some(UniformOverride { outfit, accessory })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_is_deterministic_for_the_same_id() {
        let a = generate(42, Family::Adult);
        let b = generate(42, Family::Adult);
        assert_eq!(a, b);
    }

    #[test]
    fn generate_never_returns_a_zero_body_eyes_or_outfit() {
        for id in [0u64, 1, 42, u64::MAX] {
            let a = generate(id, Family::Adult);
            assert_ne!(a.body, 0);
            assert_ne!(a.eyes, 0);
            assert_ne!(a.outfit, 0);
        }
    }

    #[test]
    fn generate_never_gives_a_kid_an_accessory() {
        for id in [0u64, 1, 42, 1234, u64::MAX] {
            let a = generate(id, Family::Kid);
            assert_eq!(a.accessory, 0);
        }
    }

    #[test]
    fn generate_only_uses_the_requested_familys_parts() {
        for id in 0u64..200 {
            let adult = generate(id, Family::Adult);
            let body = defs::BODIES
                .iter()
                .find(|b| b.id as u16 == adult.body)
                .unwrap();
            assert_eq!(body.family, Family::Adult);
            let outfit = defs::OUTFITS
                .iter()
                .find(|o| o.id as u16 == adult.outfit)
                .unwrap();
            assert_eq!(outfit.family, Family::Adult);
            assert_eq!(outfit.pool, Pool::Civilian);

            let kid = generate(id, Family::Kid);
            let kid_body = defs::BODIES
                .iter()
                .find(|b| b.id as u16 == kid.body)
                .unwrap();
            assert_eq!(kid_body.family, Family::Kid);
        }
    }

    #[test]
    fn resolve_uniform_finds_the_sanitation_worker_mapping() {
        let uniform =
            resolve_uniform("sanitation_worker").expect("sanitation_worker must have a uniform");
        assert!(uniform.accessory.is_some());
    }

    #[test]
    fn resolve_uniform_is_none_for_a_profession_with_no_uniform_entry() {
        assert_eq!(resolve_uniform("no_such_profession_at_all"), None);
    }
}

//! A citizen's appearance is a stable, five-integer tuple -- `body`,
//! `eyes`, `outfit`, `hairstyle`, `accessory` (FR61) -- generated once,
//! server-side, from the citizen id, and stored (never re-derived).
//! Determinism uses `sim::rng`, seeded from the citizen id and this
//! module's own stream salt, exactly like every other seeded system.
//!
//! `0` is the "no layer" sentinel for `hairstyle` and `accessory` -- it is
//! never a declared id in `defs/appearance/` (`tools/defs-build` rejects
//! that), only a value this generator can produce.
//!
//! FR62: the stored tuple is a citizen's own civilian look, drawn only
//! from the civilian pool. Occupation drives a separate, fixed uniform
//! override for the outfit and/or accessory layer, looked up by
//! profession key from `defs/appearance/`'s own `[[uniform]]` table and
//! applied only at render time while on shift -- never written back into
//! the stored tuple. The server never resolves a uniform: nothing on the
//! server side needs the citizen's rendered, on-shift look, only its
//! stored civilian one, so that resolution lives entirely on the render
//! side (`resolveUniform`, outside this crate).
//!
//! Bumped whenever this generator's algorithm or its seeding changes in a
//! way that could move its output for an id already in play --
//! `tests/goldens/appearance_v1.golden` is keyed to this, exactly like
//! `sim::rng::RNG_VERSION`. The golden is pinned against a small, fixed,
//! test-local catalogue, not the live `defs/`: [`generate`] is not stable
//! across catalogue changes either (appending a part to a family shifts
//! every later pick's `% len`), so pinning against the live catalogue
//! would force a version bump on every routine art addition. That
//! catalogue instability is harmless in production only because
//! `generate` is called once, at citizen creation, and its result is
//! stored -- appending a part afterwards never touches an
//! already-generated row, because nothing ever calls `generate` again
//! for that citizen id.

use crate::generated::defs::{self, Family, Pool};
use crate::rng::{Rng, seed_from_ids};

pub const APPEARANCE_VERSION: u32 = 2;

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

/// Every input [`generate`] draws from, passed in rather than read from
/// `generated::defs` directly: pinning `tests/goldens/appearance_v1.
/// golden` against a small fixed `Catalogue` (built in the test itself)
/// keeps the golden -- and the `APPEARANCE_VERSION` bump it forces --
/// tied to the algorithm, not to the live catalogue's own size. Property
/// tests over [`live_catalogue`] still cover the family/pool/range
/// invariants against the real `defs/`.
pub struct Catalogue<'a> {
    pub bodies: &'a [defs::BodyDef],
    pub eyes: &'a [defs::EyesDef],
    pub hairstyles: &'a [defs::HairstyleDef],
    pub outfits: &'a [defs::OutfitDef],
    pub accessories: &'a [defs::AccessoryDef],
    /// `citizen.appearance.hair_rare_chance`'s value, out of 100.
    pub hair_rare_chance: i64,
    /// `citizen.appearance.accessory_none_chance`'s value, out of 100.
    pub accessory_none_chance: i64,
}

fn balance_value(key: &str) -> i64 {
    defs::BALANCE
        .iter()
        .find(|b| b.key == key)
        .map(|b| b.value)
        .unwrap_or_else(|| panic!("sim::appearance: missing balance key '{key}'"))
}

/// The real, live `defs/appearance/` catalogue -- what a caller outside
/// this module's own tests always wants.
pub fn live_catalogue() -> Catalogue<'static> {
    Catalogue {
        bodies: defs::BODIES,
        eyes: defs::EYES,
        hairstyles: defs::HAIRSTYLES,
        outfits: defs::OUTFITS,
        accessories: defs::ACCESSORIES,
        hair_rare_chance: balance_value("citizen.appearance.hair_rare_chance"),
        accessory_none_chance: balance_value("citizen.appearance.accessory_none_chance"),
    }
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

/// Every civilian-pool id of `family` (bodies and eyes both use this: a
/// generated citizen's body and eyes are drawn from the same civilian
/// pool an outfit already was, never the costume pool a handful of
/// vendor sheets landed in -- an unnaturally coloured skin tone or iris
/// is a costume choice, not a citizen anyone would generate).
fn civilian_family_ids<T>(
    items: &[T],
    family: Family,
    get: impl Fn(&T) -> (Family, Pool, u16),
) -> Vec<u16> {
    items
        .iter()
        .filter_map(|item| {
            let (f, pool, id) = get(item);
            (f == family && pool == Pool::Civilian).then_some(id)
        })
        .collect()
}

/// Generates one citizen's appearance tuple, deterministic from
/// `citizen_id`, `family` and `catalogue` together (FR61). Called once,
/// at citizen creation, by the caller (a later story); the result is
/// stored and never re-derived -- see the module doc for why this
/// function's own output is *not* stable across catalogue changes, only
/// storage keeps an already-generated citizen's face fixed.
pub fn generate(citizen_id: u64, family: Family, catalogue: &Catalogue) -> Appearance {
    let mut rng = Rng::new(seed_from_ids(citizen_id, APPEARANCE_STREAM));

    let bodies = civilian_family_ids(catalogue.bodies, family, |b| (b.family, b.pool, b.id));
    let body = pick_uniform(&mut rng, &bodies).unwrap_or(0);

    let eyes_ids = civilian_family_ids(catalogue.eyes, family, |e| (e.family, e.pool, e.id));
    let eyes = pick_uniform(&mut rng, &eyes_ids).unwrap_or(0);

    let civilian_outfits: Vec<u16> = catalogue
        .outfits
        .iter()
        .filter(|o| o.family == family && o.pool == Pool::Civilian)
        .map(|o| o.id)
        .collect();
    let outfit = pick_uniform(&mut rng, &civilian_outfits).unwrap_or(0);

    let hairstyle = pick_hairstyle(&mut rng, family, catalogue);
    let accessory = pick_accessory(&mut rng, family, catalogue);

    Appearance {
        body,
        eyes,
        outfit,
        hairstyle,
        accessory,
    }
}

/// Hair colour is weighted towards natural colours, with rare/dye
/// colours (`HairstyleDef::rare`) drawn only `hair_rare_chance` percent
/// of the time. Falls back to whichever pool is non-empty if the family
/// has none of the wanted kind. In the committed catalogue this is
/// exactly one dye colour per family (a saturated blue, distinctly
/// different from every natural blonde/brown/auburn/grey shade around
/// it) -- every other colour, adult and kid alike, is natural.
fn pick_hairstyle(rng: &mut Rng, family: Family, catalogue: &Catalogue) -> u16 {
    let rare_ids: Vec<u16> = catalogue
        .hairstyles
        .iter()
        .filter(|h| h.family == family && h.rare)
        .map(|h| h.id)
        .collect();
    let common_ids: Vec<u16> = catalogue
        .hairstyles
        .iter()
        .filter(|h| h.family == family && !h.rare)
        .map(|h| h.id)
        .collect();

    let roll = rng.next_u64() % 100;
    let want_rare = roll < catalogue.hair_rare_chance as u64;

    let pool = if want_rare && !rare_ids.is_empty() {
        &rare_ids
    } else if !common_ids.is_empty() {
        &common_ids
    } else {
        &rare_ids
    };
    pick_uniform(rng, pool).unwrap_or(0)
}

/// A civilian has `accessory_none_chance` percent chance of wearing no
/// accessory at all. Kids have no accessory tables at all, so a kid's
/// accessory is always `0` -- forced here, not merely the accidental
/// result of an empty candidate list, so the rule reads as a decision
/// rather than a side effect.
fn pick_accessory(rng: &mut Rng, family: Family, catalogue: &Catalogue) -> u16 {
    if family == Family::Kid {
        return 0;
    }
    let roll = rng.next_u64() % 100;
    if roll < catalogue.accessory_none_chance as u64 {
        return 0;
    }
    let candidates: Vec<u16> = catalogue
        .accessories
        .iter()
        .filter(|a| a.family == family && a.pool == Pool::Civilian)
        .map(|a| a.id)
        .collect();
    pick_uniform(rng, &candidates).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generate_is_deterministic_for_the_same_id() {
        let catalogue = live_catalogue();
        let a = generate(42, Family::Adult, &catalogue);
        let b = generate(42, Family::Adult, &catalogue);
        assert_eq!(a, b);
    }

    #[test]
    fn generate_never_returns_a_zero_body_eyes_or_outfit() {
        let catalogue = live_catalogue();
        for id in [0u64, 1, 42, u64::MAX] {
            let a = generate(id, Family::Adult, &catalogue);
            assert_ne!(a.body, 0);
            assert_ne!(a.eyes, 0);
            assert_ne!(a.outfit, 0);
        }
    }

    #[test]
    fn generate_never_gives_a_kid_an_accessory() {
        let catalogue = live_catalogue();
        for id in [0u64, 1, 42, 1234, u64::MAX] {
            let a = generate(id, Family::Kid, &catalogue);
            assert_eq!(a.accessory, 0);
        }
    }

    #[test]
    fn generate_only_uses_the_requested_familys_parts() {
        let catalogue = live_catalogue();
        for id in 0u64..200 {
            let adult = generate(id, Family::Adult, &catalogue);
            let body = defs::BODIES.iter().find(|b| b.id == adult.body).unwrap();
            assert_eq!(body.family, Family::Adult);
            let outfit = defs::OUTFITS.iter().find(|o| o.id == adult.outfit).unwrap();
            assert_eq!(outfit.family, Family::Adult);
            assert_eq!(outfit.pool, Pool::Civilian);

            let kid = generate(id, Family::Kid, &catalogue);
            let kid_body = defs::BODIES.iter().find(|b| b.id == kid.body).unwrap();
            assert_eq!(kid_body.family, Family::Kid);
        }
    }
}

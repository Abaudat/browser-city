//! Story 3.16: AC1 and AC2 over fresh city seeds, so a seed that walls off
//! the core or ships fewer than a hundred furnished buildings is caught
//! before `city.seed` ever changes to it. One world per run on the PR
//! path (`ci.yml`'s fixed `PROPTEST_RNG_SEED`); `explore.yml` runs
//! `BC_DISTRICT_WORLDS` of them weekly with its own fresh seed. A failure
//! names the world seed; pin it as a plain `#[test]` in `district_world.rs`
//! and fix the generator, never retry.

mod support;

use sim::generated::defs;
use sim::generation::{GenerationConfig, GenerationContent, GroundConfig, generate};
use support::district_checks;

/// How many worlds one run generates: `BC_DISTRICT_WORLDS`, else one.
fn worlds() -> u64 {
    std::env::var("BC_DISTRICT_WORLDS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1)
}

/// The least furnished, enterable, reachable buildings a city owes (FR114).
const FURNISHED_MIN: usize = 100;

fn splitmix(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = *state;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

#[test]
fn fresh_city_seeds_cross_edge_to_core_and_hold_a_hundred_furnished_buildings() {
    let run_seed: u64 = std::env::var("PROPTEST_RNG_SEED")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);
    let cfg = GenerationConfig::from_balance(defs::BALANCE).expect("balance parses");
    let content = GenerationContent::committed();
    let ground = GroundConfig::from_balance(defs::BALANCE);
    let mut state = run_seed;
    let mut generated = 0;
    let mut failures: Vec<String> = Vec::new();
    for _ in 0..worlds() {
        let seed = splitmix(&mut state) & 0xFFFF_FFFF;
        // A seed generation refuses (a typed error) never becomes a world:
        // it is not a district to walk.
        let Ok((district, _)) = generate(seed, &cfg, &content) else {
            continue;
        };
        generated += 1;
        for c in district_checks::crossings(&district, &cfg) {
            match c.stretch_pct {
                None => failures.push(format!(
                    "world seed {seed}: {:?} cannot reach {:?}",
                    c.from, c.to
                )),
                Some(p) if p > district_checks::ROUTE_STRETCH_MAX_PCT => failures.push(format!(
                    "world seed {seed}: {:?} -> {:?} walks {p}% of straight",
                    c.from, c.to
                )),
                Some(_) => {}
            }
        }
        let rows = district.region_rows(&ground, &content, &cfg);
        match district.arrival_cell(&cfg, &content) {
            None => failures.push(format!("world seed {seed}: no arrival cell")),
            Some(arrival) => {
                let n = district_checks::furnished_reachable(&district, &rows, &content, arrival);
                if n < FURNISHED_MIN {
                    failures.push(format!(
                        "world seed {seed}: only {n} furnished buildings reachable from arrival"
                    ));
                }
            }
        }
    }
    assert!(
        generated > 0,
        "no seed generated a world (run seed {run_seed})"
    );
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

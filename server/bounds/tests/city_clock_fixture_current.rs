//! Keeps `fixtures/city-clock-conformance.v1.json` current, and proves
//! `sim::time` agrees with every hand-typed row in it.

use bounds::city_clock_fixture::{build_fixture_document, fixture_path};

#[test]
fn city_clock_fixture_is_current() {
    let expected = build_fixture_document().to_pretty_json();
    let path = fixture_path();
    let committed = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "cannot read {}: {e} -- run `cargo run -p bounds --bin regen-city-clock-fixture` and commit the result",
            path.display()
        )
    });
    assert_eq!(
        committed.replace("\r\n", "\n"),
        expected,
        "{} is stale -- run `cargo run -p bounds --bin regen-city-clock-fixture` and commit the result",
        path.display()
    );
}

#[test]
fn sim_time_matches_every_city_clock_case() {
    let doc = build_fixture_document();
    assert_eq!(doc.real_ms_per_city_minute, 2500);
    for c in &doc.cases {
        let t = sim::time::city_time(
            c.epoch_micros.parse().unwrap(),
            c.now_micros.parse().unwrap(),
        );
        assert_eq!(
            (t.day, t.hour, t.minute, t.weekday, t.real_ms_into_minute),
            (c.day, c.hour, c.minute, c.weekday, c.real_ms_into_minute),
            "epoch {} now {}",
            c.epoch_micros,
            c.now_micros
        );
    }
}

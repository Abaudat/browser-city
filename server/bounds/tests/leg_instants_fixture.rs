//! `fixtures/leg-instants.v1.json` pins L3's waypoint-instant rule on both
//! sides: `client/tests/unit/l3/body.test.ts` reads the same file. A server
//! wake-up instant and a client ledger position agree at a chunk boundary
//! only while the two implementations agree on these numbers.

use sim::actor_location::leg_instants;

#[test]
fn leg_instants_match_the_shared_fixture() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/leg-instants.v1.json");
    let doc: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&path).expect("fixture")).unwrap();
    for case in doc["cases"].as_array().unwrap() {
        let route: Vec<(i32, i32, i8)> = case["route"]
            .as_array()
            .unwrap()
            .iter()
            .map(|w| {
                let w = w.as_array().unwrap();
                (
                    w[0].as_i64().unwrap() as i32,
                    w[1].as_i64().unwrap() as i32,
                    w[2].as_i64().unwrap() as i8,
                )
            })
            .collect();
        let want: Vec<i64> = case["instants"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_i64().unwrap())
            .collect();
        let got = leg_instants(
            &route,
            case["departAt"].as_i64().unwrap(),
            case["arriveAt"].as_i64().unwrap(),
        );
        assert_eq!(got, want, "route {route:?}");
    }
}

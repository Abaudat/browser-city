//! NFR17: every reducer and procedure the module exports belongs to
//! exactly one cost class, and every counted call is attributed to it
//! (`tables::metrics::count_call`). The unit the hosting bill reads is
//! calls (NFR13), so calls per class is what is instrumented -- the
//! module SDK exposes no energy figure.
//! `bounds/tests/reducer_classes_coverage.rs` fails on an unregistered
//! reducer; `scripts/ci/check-reducer-counted.sh` fails on one that never
//! counts.

/// The closed set of cost classes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReducerClass {
    /// Every cadence fire.
    Scheduled,
    /// Anything else a client identity may call.
    Player,
    /// A client's position write: the one term that scales with
    /// concurrency.
    Position,
    /// Owner-only and dev-only: publish, restore, time control.
    Operator,
    /// `init` (never counted: it runs before the counter is seeded) and
    /// the connect/disconnect hooks, whose rate scales with players.
    Lifecycle,
}

/// Every class, in the order the sampler writes them.
pub const ALL_CLASSES: [ReducerClass; 5] = [
    ReducerClass::Scheduled,
    ReducerClass::Player,
    ReducerClass::Position,
    ReducerClass::Operator,
    ReducerClass::Lifecycle,
];

/// The number of classes: `reducer_class_counter`'s `max_rows`.
pub const CLASS_COUNT: u64 = ALL_CLASSES.len() as u64;

impl ReducerClass {
    /// The stable name stored in `reducer_class_counter`/`_sample`.
    pub fn name(self) -> &'static str {
        match self {
            ReducerClass::Scheduled => "scheduled",
            ReducerClass::Player => "player",
            ReducerClass::Position => "position",
            ReducerClass::Operator => "operator",
            ReducerClass::Lifecycle => "lifecycle",
        }
    }
}

/// Every reducer and procedure by name. Add a row in the same PR that adds
/// one -- `bounds/tests/reducer_classes_coverage.rs` fails otherwise.
pub const REDUCER_CLASSES: &[(&str, ReducerClass)] = &[
    ("advance_citizen_transitions", ReducerClass::Scheduled),
    ("advance_world_clock", ReducerClass::Scheduled),
    ("run_budget_review", ReducerClass::Scheduled),
    ("run_economy_tick", ReducerClass::Scheduled),
    ("run_growth_tick", ReducerClass::Scheduled),
    ("run_maintenance", ReducerClass::Scheduled),
    ("sample_metrics", ReducerClass::Scheduled),
    ("send_ping", ReducerClass::Player),
    ("sync_clock", ReducerClass::Player),
    ("create_character", ReducerClass::Player),
    ("begin_link", ReducerClass::Player),
    ("complete_link", ReducerClass::Player),
    ("set_player_position", ReducerClass::Position),
    ("accept_oidc_issuer", ReducerClass::Operator),
    ("finish_publish", ReducerClass::Operator),
    ("begin_restore", ReducerClass::Operator),
    ("finish_restore", ReducerClass::Operator),
    ("jump_clock", ReducerClass::Operator),
    ("set_clock_speed", ReducerClass::Operator),
    ("create_district", ReducerClass::Operator),
    ("restore_building", ReducerClass::Operator),
    ("restore_building_area", ReducerClass::Operator),
    ("restore_cadence_liveness", ReducerClass::Operator),
    ("restore_character", ReducerClass::Operator),
    ("restore_character_identity", ReducerClass::Operator),
    ("restore_link_request", ReducerClass::Operator),
    ("restore_oidc_issuer", ReducerClass::Operator),
    ("restore_citizen", ReducerClass::Operator),
    ("restore_district", ReducerClass::Operator),
    ("restore_citizen_state", ReducerClass::Operator),
    ("restore_demo_ping", ReducerClass::Operator),
    ("restore_floor_transition", ReducerClass::Operator),
    ("restore_layer_code", ReducerClass::Operator),
    ("restore_matter_kind", ReducerClass::Operator),
    ("restore_module_owner", ReducerClass::Operator),
    ("restore_node_kind", ReducerClass::Operator),
    ("restore_placed_object", ReducerClass::Operator),
    ("restore_provision", ReducerClass::Operator),
    ("restore_reason_code", ReducerClass::Operator),
    ("restore_room", ReducerClass::Operator),
    ("restore_room_area", ReducerClass::Operator),
    ("restore_storage_sample", ReducerClass::Operator),
    ("restore_table_sample", ReducerClass::Operator),
    ("restore_unit", ReducerClass::Operator),
    ("restore_holder_kind", ReducerClass::Operator),
    ("restore_actor_kind", ReducerClass::Operator),
    ("restore_actor_location", ReducerClass::Operator),
    ("restore_player_position", ReducerClass::Operator),
    ("restore_business", ReducerClass::Operator),
    ("restore_stock", ReducerClass::Operator),
    ("restore_item_instance", ReducerClass::Operator),
    ("restore_item_placed", ReducerClass::Operator),
    ("restore_item_held", ReducerClass::Operator),
    ("restore_container_kind", ReducerClass::Operator),
    ("restore_world_clock", ReducerClass::Operator),
    ("restore_reducer_class_counter", ReducerClass::Operator),
    ("restore_reducer_class_sample", ReducerClass::Operator),
    ("init", ReducerClass::Lifecycle),
    ("identity_connected", ReducerClass::Lifecycle),
    ("identity_disconnected", ReducerClass::Lifecycle),
];

/// The class of `reducer`, if registered.
pub fn class_of(reducer: &str) -> Option<ReducerClass> {
    REDUCER_CLASSES
        .iter()
        .find(|(name, _)| *name == reducer)
        .map(|(_, class)| *class)
}

/// The counter after one more call: saturates, never wraps.
pub fn next_calls(calls: u64) -> u64 {
    calls.saturating_add(1)
}

/// Calls since the previous sample. A counter that went backwards (a
/// restore replaced it) reads as zero, never as a wrapped huge figure.
pub fn calls_delta(calls_total: u64, previous_total: u64) -> u64 {
    calls_total.saturating_sub(previous_total)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn class_names_are_distinct_and_cover_all_classes() {
        let mut names: Vec<&str> = ALL_CLASSES.iter().map(|c| c.name()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), ALL_CLASSES.len());
        assert_eq!(CLASS_COUNT, 5);
    }

    #[test]
    fn a_reducer_is_registered_once() {
        for (i, (name, _)) in REDUCER_CLASSES.iter().enumerate() {
            assert!(
                !REDUCER_CLASSES[..i].iter().any(|(n, _)| n == name),
                "`{name}` is registered twice"
            );
        }
    }

    #[test]
    fn class_of_attributes_by_name() {
        assert_eq!(class_of("sample_metrics"), Some(ReducerClass::Scheduled));
        assert_eq!(class_of("send_ping"), Some(ReducerClass::Player));
        assert_eq!(class_of("sync_clock"), Some(ReducerClass::Player));
        assert_eq!(
            class_of("set_player_position"),
            Some(ReducerClass::Position)
        );
        assert_eq!(class_of("finish_publish"), Some(ReducerClass::Operator));
        assert_eq!(class_of("restore_citizen"), Some(ReducerClass::Operator));
        assert_eq!(class_of("init"), Some(ReducerClass::Lifecycle));
        assert_eq!(class_of("nope"), None);
    }

    #[test]
    fn every_class_has_a_reducer() {
        for class in ALL_CLASSES {
            assert!(
                REDUCER_CLASSES.iter().any(|(_, c)| *c == class),
                "{class:?} has no reducer"
            );
        }
    }

    #[test]
    fn calls_saturate_and_deltas_never_wrap() {
        assert_eq!(next_calls(0), 1);
        assert_eq!(next_calls(u64::MAX), u64::MAX);
        assert_eq!(calls_delta(10, 4), 6);
        assert_eq!(calls_delta(4, 4), 0);
        assert_eq!(calls_delta(3, 10), 0);
    }
}

# Trace matrix

The invariants named across `requirements.md` and the architecture, and
whether an automated test protects each one today. `covered` rows name the
`#[test]` function that protects them; `deferred` rows name the story that
will add the subsystem they protect. `scripts/ci/check-trace-matrix.sh`
fails CI if a `covered` row's test does not exist, or if a test named
`inv_*` exists with no row here.

| Invariant id | Description | Status | Test | Story |
| --- | --- | --- | --- | --- |
| `inv_identical_seeds_derive_identically` | Two derivations from identical seeded inputs match (NFR25) | covered | `inv_identical_seeds_derive_identically` | — |
| `inv_no_matter_starves` | No matter starves indefinitely | deferred | | matter/needs system |
| `inv_inventory_superset_after_absence` | Inventory is a superset after any absence | deferred | | inventory system |
| `inv_no_owned_item_degrades_during_absence` | No owned item degrades during absence | deferred | | inventory/decay system |
| `inv_budget_never_negative` | Budget never goes negative | deferred | | economy system |
| `inv_collider_within_footprint` | `collider` is contained within `footprint` | deferred | | placement/collision system |
| `inv_collision_only_within_floor` | No cell on any other floor ever contributes to an entity's collision result (FR117) | covered | `inv_collision_only_within_floor` | — |
| `inv_floor_transition_lands_standable` | No transition cell ever targets a floor or cell where the entity would be inside geometry or out of bounds (FR117) | covered | `inv_floor_transition_lands_standable` | — |
| `inv_world_query_total` | A world query never panics and never wraps, for any i32 coordinate and any floor or layer (FR117) | covered | `inv_world_query_total` | — |
| `inv_cell_ownership_defined` | Every in-bounds cell answers the ownership query, and ids are stable across queries (FR119) | covered | `inv_cell_ownership_defined` | — |

## Coverage scale (NFR29)

Rows above track whether an invariant is exercised at all; this tracks
whether it is exercised at the scale NFR29 asks for. Not part of the
id/constant/test symmetry `check-trace-matrix.sh` enforces above (there is
no `INV_` constant for a case count) -- checked by eye until there is a
citizen simulation to run it against.

| Requirement | Status | Blocked on |
| --- | --- | --- |
| Property suite runs thousands of simulated citizen-weeks (NFR29) | deferred | citizen simulation |

## Round trip and client/server boundary

Not part of the `inv_*`/`INV_*` id symmetry above (these guard requirements
that span the client/server boundary or the CI graph itself, not a `sim`
invariant), but not just checked by eye either: `check-trace-matrix.sh`
asserts that the path named in every `covered` row's Guard column exists.
A guard renamed or deleted without updating this table fails CI.

| Requirement | Status | Guard |
| --- | --- | --- |
| Browser-exclusive, no install/plugin/download gate (NFR5) | covered | `client/tests/e2e/round-trip.spec.ts` -- runs the client in stock headless Chromium with no flag, plugin or install step |
| No code shared between `server/` and `client/` (NFR30) | covered | `scripts/ci/check-no-shared-code.sh` |
| Sim purity, reducers as the only table-touching layer (NFR28) | covered | `scripts/ci/check-sim-purity.sh` (unchanged by this story) |
| TeV per reducer class instrumented from day one (NFR17) | deferred | first real reducer class -- nothing to measure yet (story 1.1) |

## Schema permanence

Story 1.2: the permanent decisions NFR33-NFR37 forbid ever getting wrong
in a second commit. Same Guard-path discipline as the section above --
`check-trace-matrix.sh` asserts every `covered` row's path exists.

| Requirement | Status | Guard |
| --- | --- | --- |
| Every table has exactly one primary key; no Rust enum in module source; tables stay under the column ceiling or carry a waiver (NFR33, NFR35, NFR36) | covered | `server/bounds/tests/schema_shape.rs` |
| Every scheduled table carries `scheduled_id`/`scheduled_at` and names a real, scheduler-only reducer (NFR34) | covered | `server/bounds/tests/schema_shape.rs` -- `every_scheduled_table_has_the_required_columns_and_names_a_real_reducer` |
| The schema snapshot is never stale against source | covered | `server/bounds/tests/schema_snapshot_current.rs` |
| A moved primary key, a moved unique constraint, a changed scheduled status, a removed/retyped/reordered column, or a column inserted ahead of an existing one fails the build (NFR33) | covered | `scripts/ci/check-schema-additive.sh` |
| Appending a column with a default publishes against a live world; appending one without a default is rejected, not silently accepted, and the rejection is the automigration one -- not a build or connection failure passing for it (NFR33) | covered | `scripts/ci/check-live-migration.sh` |
| The character&lt;-&gt;identity mapping is one-character-to-N-identities, `identity` unique and `character_id` a plain index (FR142, D5) | covered | `server/schema.snapshot.json` (`character_identity`'s row: `identity`'s `unique` and `character_id`'s `indexed` fields, pinned and diffed by the two guards above) |
| A committed `sim::codes` line (a code number or a name) never changes or disappears once merged; only new lines may be appended (NFR36) | covered | `scripts/ci/check-codes-append-only.sh` |
| Re-seeding the extensible-set companion tables is idempotent (`reseed_codes`) (NFR36, NFR38) | covered | `scripts/ci/check-live-migration.sh` |
| An operator-only reducer rejects any caller that is not the module owner (`reseed_codes`, `tables::ops::require_owner`) | covered | `scripts/ci/check-live-migration.sh` |

## World addressing

Story 1.5: `(x, y, floor, layer)` addressing, collision, floor transitions
and cell ownership (FR117-FR119). Same Guard-path discipline as the
sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| Two cells at the same (x, y) on different floors both exist without conflict; an entity on floor 0 tests collision only against floor 0 (FR117) | covered | `server/sim/tests/world_acceptance.rs` -- `two_cells_at_the_same_xy_on_different_floors_never_conflict` |
| A player under a bridge deck passes under it the whole span; the same walk one floor up interacts with the deck geometry above (FR117) | covered | `server/sim/tests/world_acceptance.rs` -- `walking_under_the_bridge_is_unobstructed_the_whole_span` and `walking_on_the_bridge_deck_interacts_with_its_railings` |
| Entering a transition cell changes the entity floor and its collision set together, from one function application (FR117) | covered | `server/sim/tests/world_acceptance.rs` -- `entering_a_transition_yields_the_target_floor_and_its_collision_set_together` |
| A door is an ordinary walkable cell; walking through one is a continuous position sequence with no space transition (FR118) | covered | `server/sim/tests/world_acceptance.rs` -- `walking_through_a_doorway_is_a_continuous_walk_with_no_space_transition` |
| A building ownership id is queryable for the player position, inside and outside it (FR119) | covered | `server/sim/tests/world_acceptance.rs` -- `the_buildings_id_is_queryable_inside_and_not_outside` |
| The canonical fixture world and its hand-typed query answers are checked against the real `sim::world` query functions (Quentin direction) | covered | `server/sim/tests/world_conformance.rs` |
| The shared conformance fixture (`fixtures/world-conformance.v1.json`) is never stale against the `sim::world::fixture` source | covered | `server/bounds/tests/world_fixture_current.rs` |
| The `chunk_key` packing round-trips and never panics, including at the extremes (FR145) | covered | `server/sim/tests/world_chunk.rs` |
| A collision query costs a bounded, small number of dense-storage accesses regardless of world size, and the collision grid stays within its documented 1-bit-per-cell budget | covered | `server/sim/tests/world_perf.rs` |
| An ownership query scans only the areas sharing the queried chunk, never every area in the world (FR119, FR120, FR122) | covered | `server/sim/tests/world_perf.rs` -- `ownership_lookup_scans_only_the_queried_chunk_not_every_area_in_the_world` |
| The client-side TypeScript port of addressing, collision, transition and ownership reads the same fixtures/world-conformance.v1.json its Rust oracle reads (NFR30) | deferred | client-side collision/addressing story |

## Scheduled-reducer timing

Story 1.3: `docs/spikes/1.3-scheduled-reducer-timing.md`'s measured drift
budget and post-publish schedule rule (R10, D7). Same Guard-path
discipline as the sections above.

| Requirement | Status | Guard |
| --- | --- | --- |
| The spike report measured SpacetimeDB version never goes stale against the `server/Cargo.toml` pin, the `docs/architecture.md` stack line, or the pinned CLI installer exact patch | covered | `scripts/ci/check-sched-timing-pin.sh` |
| The drift claims in `docs/spikes/1.3-scheduled-reducer-timing.md` are re-runnable with one command | covered | `scripts/dev/run-sched-timing-spike.sh` |
| Whether a pending scheduled row survives a schema-changing publish, or a publish to Maincloud, is unmeasured (only a same-wasm, same-schema local republish was measured) | deferred | the deploy story |

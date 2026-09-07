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
| Every scheduled table carries `scheduled_id`/`scheduled_at` and names a real, owner-only reducer (NFR34) | covered | `server/bounds/tests/schema_shape.rs` -- `every_scheduled_table_has_the_required_columns_and_names_a_real_reducer` |
| The schema snapshot is never stale against source | covered | `server/bounds/tests/schema_snapshot_current.rs` |
| A moved primary key, a moved unique constraint, a changed scheduled status, a removed/retyped/reordered column, or a column inserted ahead of an existing one fails the build (NFR33) | covered | `scripts/ci/check-schema-additive.sh` |
| Appending a column with a default publishes against a live world; appending one without a default is rejected, not silently accepted, and the rejection is the automigration one -- not a build or connection failure passing for it (NFR33) | covered | `scripts/ci/check-live-migration.sh` |
| The character&lt;-&gt;identity mapping is one-character-to-N-identities, `identity` unique and `character_id` a plain index (FR142, D5) | covered | `server/schema.snapshot.json` (`character_identity`'s row: `identity`'s `unique` and `character_id`'s `indexed` fields, pinned and diffed by the two guards above) |
| A committed `sim::codes` line (a code number or a name) never changes or disappears once merged; only new lines may be appended (NFR36) | covered | `scripts/ci/check-codes-append-only.sh` |
| Re-seeding the extensible-set companion tables is idempotent (`reseed_codes`) (NFR36, NFR38) | covered | `scripts/ci/check-live-migration.sh` |

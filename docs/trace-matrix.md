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
